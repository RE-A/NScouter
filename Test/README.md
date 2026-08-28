# NScouter 테스트 환경

NScouter 클라이언트가 붙을 실제 Scouter Collector와, Scouter Java Agent가 부착된
Spring Boot 애플리케이션을 컨테이너로 띄운다.

설계 배경과 검증 근거는 [PLAN.md](PLAN.md) 참조.

---

## 사전 준비

| 항목 | 버전 | 비고 |
|------|------|------|
| podman | 5.7.1 | machine 이름이 `podman-machine` |
| podman-compose | 1.6.0 | `pip install podman-compose` |
| Python | 3.12 | 검증 스크립트용 |

```powershell
podman machine start podman-machine
```

> machine 이름이 기본값(`podman-machine-default`)이 아니므로 이름을 명시해야 한다.

## 1. Scouter 릴리스 바이너리 내려받기

`vendor/` 는 65MB라 git에 포함하지 않는다. 클론 직후 한 번 실행한다.

```powershell
.\scripts\fetch-scouter.ps1
```

`vendor\scouter\{server, agent.java, agent.host}` 가 생성된다.

## 2. 기동

```powershell
.\scripts\up.ps1        # 이미지 빌드 + podman-compose up -d
```

## 3. 종료

```powershell
.\scripts\down.ps1
```

## 4. 검증

```powershell
python .\scripts\login_check.py
```

콜렉터에 실제로 TCP 접속해 `LOGIN` 핸드셰이크를 수행한다. NScouter의
`src-tauri/src/scouter/connection.rs` 와 동일한 프로토콜을 사용하므로,
이 스크립트가 성공하면 NScouter도 접속할 수 있다.

기대 출력:

```
session   = <0이 아닌 값>
server_id = NSCOUTER-TEST
=> 로그인 성공
```

## 5. 부하 생성 (선택)

```powershell
.\scripts\load.ps1            # 시작
.\scripts\load.ps1 -Follow    # 시작 후 로그 따라가기
.\scripts\load.ps1 -Stop      # 중지
```

`.env` 의 `K6_VUS` / `K6_DURATION` 으로 부하량을 조절한다.
기본 기동(`up.ps1`)에는 포함되지 않는다.

## 6. NScouter에서 접속

```powershell
cd ..            # 프로젝트 루트
npm run tauri dev
```

접속 다이얼로그에 아래 값을 넣고 연결한다. (자동 접속 기능은 없다)

| 항목 | 값 |
|------|-----|
| Host | `127.0.0.1` |
| Port | `6100` |
| ID | `admin` |
| Password | `admin` |

## 7. 실서버 대상 Rust 테스트

이 환경이 떠 있어야 실행된다. 기본 실행에서는 `#[ignore]`로 빠져 있다.

```powershell
cd ..\src-tauri
cargo test --test live_collector -- --ignored --nocapture
```

| 테스트 | 검증 |
|---|---|
| `live_object_list` | 오브젝트 목록 수신 |
| `live_sequential_requests` | 같은 연결로 연속 요청 |
| `live_xlog_stream` | XLog 수신 + 커서 이어받기 |

XLog 테스트는 트래픽이 있어야 하므로 `load.ps1`을 켠 상태에서 실행한다.

---

## 구성

| 컨테이너 | 포트 | 상태 |
|----------|------|------|
| `postgres` | 5432 | 구현 완료 (`shopdb` / `orderdb`) |
| `scouter-collector` | 6100/tcp, 6100/udp | 구현 완료 |
| `scouter-host-agent` | — | 구현 완료 (host Family 카운터, `obj_type=linux`) |
| `shop-app` | 8081 | 구현 완료 (**에이전트 부착됨**) |
| `order-app` | 8082 | 구현 완료 (**에이전트 부착됨**) |
| `load-gen` (k6) | — | 구현 완료 (기본 기동 제외, `profiles: load`) |

### 검증 스크립트

```powershell
python .\scripts\login_check.py     # 로그인 + 오브젝트 목록
python .\scripts\xlog_check.py      # + 실시간 XLog 수신
python .\scripts\signal_check.py    # + 신호 품질 요약 (부하 중에 쓴다)
```

`signal_check.py` 출력 예:

```
총 XLog       : 1871건
에이전트별    : {'shop-app': 1271, 'order-app': 600}
error != 0    : 65건  (빨간 점)
caller != 0   : 267건 (분산 트랜잭션 하위)
sqlCount > 0  : 1597건 / 최대 51
elapsed       : min 0 / p50 8 / p90 122 / p99 1824 / max 6052 ms
```

점이 안 보일 때 앱·콜렉터 문제인지 NScouter 문제인지 가르는 기준으로 쓴다.

### shop-app 엔드포인트

| 경로 | 용도 |
|------|------|
| `GET /shop/products` | 상품 목록 (Thymeleaf) |
| `GET /shop/products/{id}` | 상세 |
| `POST /shop/products` | 등록 |
| `POST /shop/products/{id}/edit` | 수정 |
| `POST /shop/products/{id}/delete` | 삭제 |
| `GET /shop/stocks` | 재고 목록 |
| `GET /shop/api/products/{id}` | order-app이 호출하는 내부 REST |
| `GET /shop/lab/slow?ms=1500` | 인위적 지연 |
| `GET /shop/lab/jitter?minMs=50&maxMs=2000` | 랜덤 지연 |
| `GET /shop/lab/error?type=http500\|npe\|illegal` | 에러 발생 |
| `GET /shop/lab/async` | 별도 스레드 처리 |
| `GET /shop/lab/heavy-sql?limit=30` | N+1 쿼리 |
| `GET /shop/lab/literal-sql` | 값이 문장에 박힌 SQL (Statement) — 프로파일에 `'@{1}'` 형태로 온다 |
| `GET /shop/lab/in-clause` | 리터럴이 여럿인 SQL — `@{1}` … `@{11}` |
| `GET /shop/lab/mixed-sql?minId=10&name=zzz` | **리터럴과 바인딩이 한 문장에** — `@{n}` 과 `?` 가 같이 온다 (F-51) |
| `GET /shop/lab/dashboard?categories=3` | **한 요청에 SQL 여러 개 + order-app 호출 + INSERT/커밋** |

### order-app 엔드포인트

| 경로 | 용도 |
|------|------|
| `GET /order/orders` | 주문 목록 (Thymeleaf) |
| `GET /order/orders/{id}` | 상세 (배송 포함) |
| `POST /order/orders` | 주문 생성 — **shop-app 호출 후 저장** |
| `POST /order/orders/{id}/cancel` | 주문 취소 |
| `GET /order/deliveries` | 배송 목록 |
| `GET /order/reports/daily` | 상태별 집계 |
| `GET /order/lab/timeout?ms=6000` | shop 호출 타임아웃 (읽기 3초) |
| `GET /order/api/summary` | 상태별 집계 (JSON) — shop-app 대시보드가 부른다 |
| `GET /order/api/pipeline?categories=3` | **3단 체인**: order → shop(대시보드) → order(요약) |

주문 생성 폼 파라미터는 `productId`, `quantity` 다.

### 흐름이 두꺼운 요청 두 가지

화면(프로파일 요약·흐름 트리·프로파일 검색)을 확인하려면 **요청 하나가 여러 일을 해야** 한다.
select 한두 개로 끝나는 요청만 있으면 요약 표는 두 줄이고 흐름 트리는 늘 같은 모양이다.

`GET /shop/lab/dashboard` 한 건이 만드는 것 (실측):

```
ELAPSED 952ms · SQL 66ms / 129건 · API 1건
  SQL  select … from stock … where product_id=?          ×120   ← 의도한 N+1
  SQL  select category, count(*), avg(price) … group by  ×2     ← 집계
  SQL  select … from product p join stock s … (subquery) ×1     ← 조인+서브쿼리
  SQL  select … from product … where category=?          ×3
  M    COMMIT / setAutoCommit(false→true)                       ← 쓰기 트랜잭션
  API  order-app 호출
```

`GET /order/api/pipeline` 은 앱을 **두 번 오간다**:

```
/order/api/pipeline<GET>   449ms  order-app
  → /shop/lab/dashboard<GET>  78ms  shop-app
      → /order/api/summary<GET>  54ms  order-app
```

- 재현: `cargo test --test live_collector live_three_level_chain -- --ignored --nocapture`
- shop → order 방향은 `ORDER_BASE_URL` 로 붙는다 (compose.yml). 이 방향이 없으면
  흐름 트리가 늘 2단에서 끝난다.

---

## 알아둘 것

- **이미지 빌드는 compose가 하지 않는다.** `scripts\build.ps1` 이 `podman build` 를 직접 호출한다.
  podman-compose 1.6.0이 Windows 절대경로를 git URL로 오인하는 버그 때문이다. 자세한 내용은
  [compose.yml](compose.yml) 상단 주석 참조.
- **콜렉터 JVM 옵션**: `--add-opens=java.base/java.lang=ALL-UNNAMED` 가 없으면 JDK 11+ 에서
  JAXB 초기화 실패로 기동하지 못한다. [collector/Containerfile](collector/Containerfile) 참조.
- 콜렉터 데이터는 컨테이너 내부 `/data` 에 있어 컨테이너를 지우면 초기화된다.
- **호스트 에이전트가 재는 "호스트"는 Windows 가 아니라 podman VM 이다.**
  컨테이너 안에서 돌지만 `/proc` 은 격리되지 않아 sigar 가 VM 의 값을 읽는다.
  24개 중 18개만 값이 온다 — 어떤 게 오는지는 `verified-facts.md` F-22 참조.
- **DB는 PostgreSQL이다.** 처음엔 SQLite였으나 Scouter 기본 JDBC 후킹 대상이 아니라
  `sqlCount`/`sqlTime` 이 항상 0이었고, 부하 시 `SQLITE_BUSY` 노이즈도 생겼다.
  PostgreSQL은 기본 후킹 대상이라 `hook_jdbc_*` 설정 없이 SQL 프로파일이 잡힌다.
  자세한 경위는 [PLAN.md](PLAN.md) 2.3절.
- DB 데이터는 볼륨에 저장하지 않는다. `podman-compose down` 후 다시 올리면 초기화된다.
  호스트에서 직접 붙어보려면 `psql -h 127.0.0.1 -p 5432 -U scouter -d shopdb` (비밀번호 `scouter`).
- **빨간 점(에러)을 만들려면 `/shop/lab/error?type=npe` 또는 `type=illegal` 을 써야 한다.**
  `type=http500` 은 `ResponseStatusException` 이라 응답은 500이지만 XLog `error` 는 0으로 남는다.
- **NScouter 쪽 결함 3건이 이 환경에서 드러났다.** 수정 목록은 [NSCOUTER-ISSUES.md](NSCOUTER-ISSUES.md),
  근거는 [PLAN.md](PLAN.md) 1.2.1절 — 오브젝트 목록 커맨드명 오류, XLog 요청의 `count` 파라미터 누락, TCP 연결 재사용.
