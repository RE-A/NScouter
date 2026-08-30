# NScouter 테스트 환경 구축 계획

> 목적: 실제 Scouter Collector + Java Agent가 붙은 Spring Boot 애플리케이션을 컨테이너로 띄워, NScouter 클라이언트가 소비하는 모든 데이터(XLog / Profile / Counter / Alert / Object)를 실제로 발생시킨다.

---

## 1. 현황 분석

### 1.1 NScouter가 콜렉터에 요청하는 커맨드

`src-tauri/src/scouter/protocol.rs`, `src-tauri/src/commands.rs` 기준.

| 커맨드 | 용도 | 발생 조건 (테스트 서버가 만들어야 할 것) |
|--------|------|------------------------------------------|
| `LOGIN` | 세션 발급 | 콜렉터 기동 + 계정(admin/admin) |
| `GET_OBJECT_LIST_REAL_TIME` ★ | 에이전트 목록 | 서로 다른 `obj_name`의 에이전트 2개 이상 |
| `TRANX_REAL_TIME_GROUP_LATEST` | XLog 실시간 | 지속적인 HTTP 트랜잭션 |
| `GET_TEXT_100` | hash→text 사전 | service / sql / error / apicall / obj 텍스트 |
| `TRANX_PROFILE`, `XLOG_READ_BY_TXID` | 프로파일 상세 | SQL 실행, 외부 API 호출 스텝 |
| `COUNTER_REAL_TIME_ALL` | 성능 카운터 | TPS·Heap·CPU (에이전트 상시 수집) |
| `ALERT_REAL_TIME` | 알람 | 응답시간/에러율 임계치 초과 |

### 1.2 XLogPack 필드 → 테스트 요구사항 역산

`docs/architecture.md` 7·8절의 XLogPack 필드와 색상 규칙에서 역산한 필수 조건.

| 필드 | 화면 영향 | 테스트 서버 요구사항 |
|------|-----------|----------------------|
| `elapsed` | 스캐터 Y축 | 응답시간 분포가 넓어야 함 (10ms ~ 5000ms) |
| `error` | 빨간 점 | 의도적 5xx / 예외 엔드포인트 필요 |
| `objHash` | 에이전트별 색상(12색 팔레트) | 에이전트 2개 이상이어야 색 구분 확인 가능 |
| `service` | 서비스명 표시 | URL 패턴이 여러 개 |
| `sqlCount`, `sqlTime` | 상세/프로파일 | 실제 DB 쿼리 수행 필요 |
| `gxid`, `caller` | 분산 트랜잭션 연계 | **앱 A → 앱 B HTTP 호출**이 있어야 채워짐 |
| `xType` | 회색/연빨강 점 | 비동기(@Async) 처리 엔드포인트 |

→ **앱 2개를 단순히 병렬로 두는 게 아니라, 한쪽이 다른 쪽을 REST로 호출하도록 설계해야 `gxid`/`caller`/`apicall` 프로파일까지 검증 가능하다.**

★ 표시 항목은 실제 콜렉터와 통신해보니 **NScouter 쪽에 문제가 있었다.** 아래 1.2.1 참조.

### 1.2.1 실제 콜렉터로 확인된 NScouter 결함 (Phase 4~5)

이 테스트 환경을 만든 목적 그대로, 실제 콜렉터에 붙여보니 NScouter 구현에서 네 가지 문제가 드러났다.
모두 재현 스크립트(`scripts/login_check.py`, `scripts/xlog_check.py`)로 확인했다.

**(1) 오브젝트 목록 커맨드명이 틀렸다**

`src-tauri/src/scouter/protocol.rs`
```rust
pub const CMD_GET_OBJECT_LIST_REAL_TIME: &str = "GET_OBJECT_LIST_REAL_TIME";
```

`scouter.common` 의 `RequestCmd.java` 에는 그런 커맨드가 없다. 올바른 이름은 `OBJECT_LIST_REAL_TIME` 이다.
콜렉터는 모르는 커맨드를 받으면 **응답 없이 TCP 연결을 끊는다.** NScouter의 `get_object_list` 는
항상 실패한다. 이름을 고치니 오브젝트 2건이 정상 수신됐다.

NScouter가 쓰는 나머지 커맨드 9개는 `RequestCmd.java` 와 전부 일치한다 (대조 완료).

**(2) XLog 요청에 `count` 파라미터가 빠졌다**

`streaming.rs` 의 `build_request_param()` 은 `objHash` / `loop` / `index` 만 넣는다.
`scouter.webapp` 의 `XLogConsumer.handleRealTimeXLog()` 는 여기에 `count`(= `ParamConstant.XLOG_COUNT`)를 추가한다.

동일 조건에서 파라미터만 바꿔 실측한 결과다.

| 요청 파라미터 | 결과 |
|---|---|
| `objHash` + `loop` + `index` + `count` (webapp 방식) | XLog **143건** |
| `objHash` + `loop` + `index` (NScouter 방식) | XLog **0건** |

에러도 나지 않고 조용히 0건이 온다. 스캐터 차트에 아무 점도 안 찍히는 증상이 된다.

**(3) 콜렉터는 연결당 명령을 1개만 처리한다**

NScouter의 `ScouterConnection` 은 TCP 연결 하나를 만들어 로그인부터 스트리밍 폴링, 텍스트 조회,
오브젝트 목록까지 계속 재사용한다. 실제 콜렉터는 그렇게 동작하지 않는다.

같은 연결에서 `OBJECT_LIST_REAL_TIME` 을 연속 호출한 결과:

```
1회차: pack 2건 - OK
2회차: 연결 종료
3회차: 연결 종료
```

로그인을 별도 연결에서 하고 세션만 재사용해도 동일하다 (1회차 성공, 2회차부터 종료).
정식 클라이언트가 `TcpProxy` + `ConnectionPool` 구조를 쓰는 이유가 이것이다.
**명령마다 새 연결(매직 넘버 전송 → 명령 1개)을 열어야 한다.**

**(4) ObjectPack 필드 순서가 틀렸다** — (1)을 고친 뒤 실제 응답을 받아보고 나서 드러났다

`connection.rs` 의 `read_object_pack()` 이 `objHash` 를 먼저 읽는데, 실제
`ObjectPack.read(DataInputX)` 는 `objType` 이 먼저다. 게다가 뒤쪽 `wakeup`(decimal) 과
`tags`(MapValue) 를 읽지 않아 스트림에 바이트가 남아 두 번째 오브젝트부터 파싱이 깨졌다.

mock 서버가 오브젝트 목록을 ObjectPack 이 아니라 MapPack 으로 돌려주고 있어서
기존 통합 테스트가 이 경로를 전혀 검증하지 못했다.

---

**네 건 모두 수정 완료 (2026-08-13).** 수정 내역과 검증 결과는
[NSCOUTER-ISSUES.md](NSCOUTER-ISSUES.md) 참조.
실서버 대상 테스트 `src-tauri/tests/live_collector.rs` 를 추가했다.

### 1.3 릴리스 바이너리 실측 결과 (Phase 0 검증 완료)

`scouter-all-2.21.3.tar.gz`(65MB)를 실제로 내려받아 확인한 내용.

**아카이브 구조**
```
scouter/
├── server/                 # 콜렉터
│   ├── scouter-server-boot.jar
│   ├── startup.sh / startup.bat / stop.sh
│   ├── lib/                # scouter-server-2.21.3.jar 외 의존 jar
│   └── conf/scouter.conf   # 비어 있음(전 항목 기본값)
├── agent.java/             # ★ Java 8+ 빌드 — 이걸 사용
│   ├── scouter.agent.jar
│   └── conf/scouter.conf   # 전부 주석 처리된 샘플
├── agent.java21plus/       # Java 21 전용 빌드 — 사용 안 함
├── agent.host/             # OS 카운터 에이전트
└── webapp/                 # REST API 게이트웨이 (NScouter는 미사용)
```

**바이트코드 major 버전 실측** — Java 17 사용 가능 여부의 핵심 근거

| jar | major | 대응 JDK | Java 17 실행 |
|-----|-------|----------|--------------|
| `server/scouter-server-boot.jar` | 52 | Java 8 | 가능 |
| `server/lib/scouter-server-2.21.3.jar` | 50 | Java 6 (Scala 2.11) | 가능 |
| `agent.java/scouter.agent.jar` | **52** | **Java 8** | **가능** |
| `agent.java21plus/scouter.agent.jar` | 65 | Java 21 | 불가 (Java 21 전용) |

**릴리스 노트의 "Minimum Java version increased from 17 to 21"은 Eclipse RCP 기반 Scouter Client에만 해당한다.** 해당 문구는 릴리스 노트의 "Scouter Client Modernization → Eclipse Platform Upgrade" 항목에 있으며, `scouter.agent.java/pom.xml`의 기본 프로파일은 `java-8-plus`(source/target 1.8), `scouter.server/pom.xml`은 source/target 1.8이다. NScouter가 그 Eclipse 클라이언트를 대체하므로 이 제약은 우리와 무관하다.

→ **2.21.3 그대로 쓰면서 Java 17로 통일 가능.**

**콜렉터 기동 — `--add-opens` 필수 (실측으로 확인)**

`server/startup.sh`의 기본 커맨드는 다음과 같다.
```bash
java -Xmx1024m -classpath ./scouter-server-boot.jar scouter.boot.Boot ./lib
```

이대로 JDK 11+ 에서 실행하면 **기동에 실패한다.** 실제 발생한 스택:
```
java.security.PrivilegedActionException: java.lang.NoSuchMethodException:
    sun.misc.Unsafe.defineClass(...)
  at com.sun.xml.bind.v2.runtime.reflect.opt.Injector.<clinit>
...
Exception in thread "main" java.lang.ExceptionInInitializerError
Caused by: java.lang.NullPointerException: Cannot invoke
    "java.lang.reflect.Method.invoke(...)" because
    "com.sun.xml.bind.v2.runtime.reflect.opt.Injector.defineClass" is null
  at scouter.server.Configure.<clinit>(Configure.java:78)
```

원인: 번들된 JAXB RI 2.x가 `sun.misc.Unsafe.defineClass`(JDK 11에서 제거됨)를 먼저 시도하고, 폴백인 `ClassLoader.defineClass` 리플렉션 접근이 JDK 16+ 강한 캡슐화에 막힌다. JDK 17에서도 동일하게 발생한다.

**해결 — 아래 옵션을 붙이면 정상 기동한다 (검증 완료).**
```bash
java -Xmx1024m \
  --add-opens=java.base/java.lang=ALL-UNNAMED \
  --add-exports=java.base/sun.net=ALL-UNNAMED \
  -classpath ./scouter-server-boot.jar scouter.boot.Boot ./lib
```

**콜렉터가 여는 포트 (실측)**

| 포트 | 프로토콜 | 용도 |
|------|----------|------|
| 6100 | TCP | 클라이언트/에이전트 통신 ← **NScouter가 붙는 포트** |
| 6100 | UDP | 에이전트 성능 메트릭 수집 |
| 6180 | TCP | 내장 Jetty HTTP 서버 (Telegraf/HTTP 수집용) |

**콜렉터 기본 설정**: `server/conf/scouter.conf`가 비어 있어 전 항목 기본값(`net_tcp_listen_port=6100`, `net_udp_listen_port=6100`, `db_dir=./database`)으로 동작한다.

**LOGIN 핸드셰이크 검증 완료**

NScouter의 `connection.rs` 로직을 그대로 옮긴 스크립트로 실제 콜렉터에 접속해 확인했다.

- 매직 넘버 `0xCAFE2001` 전송 → `writeText("LOGIN")` + `writeLong(0)` + MapPack 전송
- 비밀번호는 `SHA256("qwertyuiop!@#$%^&*()zxcvbnm,." + password)` hex
- 기본 계정 `admin` / `admin` 으로 **로그인 성공**
- 응답 MapPack 키: `session`, `server_id`, `policy`, `menu`, `timezone`, `so_time_out`, `client_version`, `type` 등
- 파싱 후 잔여 바이트 0 → NScouter의 코덱 구현이 실제 서버 응답과 정확히 일치함

### 1.4 환경 사실 (Phase 0 확인 완료)

| 항목 | 확인값 |
|------|--------|
| Scouter 소스 버전 (`ASIS/scouter-master/pom.xml`) | `2.21.3` (최신 릴리스와 동일) |
| `ASIS/scouter-master` 내 collector 소스 | **없음** → 릴리스 바이너리 사용 |
| podman | 5.7.1 (WSL provider), **기동 완료** |
| podman machine 이름 | `podman-machine` (기본값 `podman-machine-default` 아님) → `podman machine start podman-machine` |
| podman-compose | **1.6.0 설치 완료** |
| Python | 3.12.10 / pip 25.0.1 |
| 로컬 JDK | Temurin 21.0.9 (컨테이너는 17로 고정) |
| Spring Boot 최신 | 3.5.16 — 최소 Java 17이라 요구사항 충족 |
| tarball | 스크래치패드에 전개 완료, 재다운로드 불필요 |

---

## 2. 설계 결정

### 2.1 Java 17 (확정)

회사 공식 JDK가 17이며, 1.3절 실측대로 콜렉터·에이전트 모두 Java 8 바이트코드라 17에서 동작한다. Spring Boot 3.5.x도 최소 요구가 Java 17이다.

- 베이스 이미지: `eclipse-temurin:17-jdk`(빌드) / `eclipse-temurin:17-jre`(런타임)
- Scouter: **2.21.3**, `agent.java` 디렉토리 사용 (`agent.java21plus` 아님)

### 2.2 "서로 다른 스펙 2개"의 정의 — **도메인과 API 경로로 구분**

기술 스택은 **동일하게** 두고(가장 단순한 스펙 유지), 도메인·API 경로·에이전트 식별자만 다르게 한다.

**공통 스택 (두 앱 동일)**
- Java 17, Spring Boot 3.5.x, 내장 Tomcat
- Spring Data JPA + **PostgreSQL 17** (`org.postgresql:postgresql`)
- Thymeleaf

**차이점**

| | **shop-app** | **order-app** |
|---|---|---|
| 도메인 | 상품 / 재고 | 주문 / 배송 |
| API 경로 prefix | `/shop/**` | `/order/**` |
| 엔티티 | `Product`, `Stock` | `Order`, `Delivery` |
| 데이터베이스 | `shopdb` | `orderdb` (동일 PostgreSQL 인스턴스 내 분리) |
| 포트 | 8081 | 8082 |
| Scouter `obj_name` | `shop-app` | `order-app` |
| 앱 간 호출 | 내부 REST 제공 | **shop-app 호출** → `gxid`/`caller` 생성 |

NScouter 화면에서 두 에이전트가 구분되는 근거는 `obj_name`/`objHash`이므로 이 정도 차이로 충분하다. 서비스명(`service` 해시)도 경로 prefix가 달라 사전 조회 결과가 명확히 구분된다.

### 2.3 DB는 PostgreSQL — **SQLite에서 교체함**

처음에는 "가장 단순한 스펙"으로 SQLite를 썼으나 Phase 4에서 문제가 드러나 PostgreSQL로 바꿨다.

**교체 이유**

| | SQLite | PostgreSQL |
|---|---|---|
| Scouter 기본 JDBC 후킹 대상 | **아님** | **맞음** (`org.postgresql.jdbc.PgPreparedStatement` / `PgStatement`) |
| `sqlCount` / `sqlTime` | `hook_jdbc_*` 를 직접 지정해야 수집됨 | 설정 없이 수집됨 |
| 동시 쓰기 | 단일 라이터 → 부하 시 `SQLITE_BUSY` 로 의도치 않은 에러 발생 | 문제 없음 |
| Hibernate 방언 | `hibernate-community-dialects` 추가 + 명시 필요 | 드라이버로 자동 판별 |
| 실제 운영 환경과의 유사도 | 낮음 | 높음 |

APM 테스트 환경의 목적이 "실제와 같은 신호를 만드는 것"인데, SQLite는 그 목적을 위해
에이전트 설정을 우회해야 했고 부하를 걸면 DB 자체가 노이즈 에러를 만들었다.
트래픽 규모가 작아 PostgreSQL 컨테이너 하나를 추가하는 비용이 크지 않다.

**구성**

- 이미지: `postgres:17-alpine` 기반, 초기화 SQL을 **이미지에 구움**
  (Windows 호스트 경로를 podman(WSL)에 볼륨 마운트할 때 생기는 경로 변환 문제 회피)
- `shopdb` / `orderdb` 두 데이터베이스를 인스턴스 하나에 분리 생성
- compose `healthcheck` + `depends_on: condition: service_healthy` 로 기동 순서 보장
- 앱에 `restart: on-failure` 를 걸어 순서가 어긋나도 복구되게 함
- HikariCP `maximum-pool-size: 10`, `initialization-fail-timeout: 60000`
- 데이터는 볼륨에 저장하지 않아 컨테이너를 지우면 초기화된다 (테스트 목적)

### 2.4 컨테이너 구성

```
                        ┌───────────────────────────────┐
  Windows Host          │  podman network: scouter-net   │
  ┌──────────────┐      │                                │
  │  NScouter    │      │  ┌──────────────────────┐     │
  │  (Tauri)     │──────┼─▶│  scouter-collector    │     │
  └──────────────┘ TCP  │  │  6100/tcp, 6100/udp   │     │
     127.0.0.1:6100     │  └──────────▲────────────┘     │
                        │             │ UDP/TCP 6100      │
                        │   ┌─────────┴─────────┐         │
                        │ ┌─┴──────────┐  ┌─────┴─────┐   │
                        │ │ shop-app   │◀─┤ order-app │   │
                        │ │ :8081      │  │ :8082     │   │
                        │ │ +javaagent │  │+javaagent │   │
                        │ └─────▲──────┘  └─────▲─────┘   │
                        │    ┌──┴───────────────┴──┐      │
                        │    │      load-gen (k6)   │      │
                        │    └──────────────────────┘      │
                        │  ┌──────────────────────┐       │
                        │  │  scouter-host (선택)  │       │
                        │  └──────────────────────┘       │
                        └───────────────────────────────┘
```

| 컨테이너 | 이미지 | 역할 | 기본 기동 |
|----------|--------|------|-----------|
| `postgres` | 자체 빌드 (postgres:17-alpine + 초기화 SQL) | shopdb / orderdb | O |
| `scouter-collector` | 자체 빌드 (temurin:17-jre + 릴리스 server) | 수집·저장, 호스트에 6100/tcp 퍼블리시 | O |
| `shop-app` | 자체 빌드 (multi-stage maven) | 상품/재고 CRUD, agent 부착 | O |
| `order-app` | 자체 빌드 (multi-stage maven) | 주문/배송 CRUD, agent 부착, shop 호출 | O |
| `load-gen` | `grafana/k6` | **k6 트래픽 생성 (확정)** | 프로파일 `load` |
| `scouter-host` | 자체 빌드 (host agent) | OS 카운터 | 프로파일 `host` (선택) |

**콜렉터는 직접 만들지 않는다.** 릴리스 tarball의 `scouter/server`를 그대로 이미지에 복사하고, `conf/scouter.conf`와 기동 커맨드만 컨테이너에 맞게 바꾼다.

### 2.5 컨테이너 오케스트레이션 — **빌드는 compose가 하지 않는다**

`podman-compose 1.6.0` 설치 완료. 다만 **Windows에서 `build:` 섹션을 쓸 수 없다.**

원인 (`podman_compose.py` 소스에서 확인):
```python
def is_context_git_url(path: str) -> bool:
    r = urllib.parse.urlparse(path)
    ...
    if r.scheme != "" and r.netloc == "" and r.path != "":
        return True     # ← "E:\..." 가 여기 걸린다
```
compose가 `context: .` 를 절대경로로 정규화하면 `E:\Programming\...` 가 되는데,
`urlparse`가 드라이브 문자 `E`를 URL scheme으로 파싱해 **git URL로 오인**한다.
그러면 `if not is_context_git_url(ctx):` 블록 전체가 건너뛰어져 `podman build` 에
`-f` 가 전달되지 않고, 다음 오류로 실패한다.

```
Error: no Containerfile or Dockerfile specified or found in context directory, E:\...\Test
```

실측 확인:
```
'.'                                    -> is_git_url = False
'E:\Programming\Project\NScouter\Test' -> is_git_url = True
```

**대응:** `compose.yml` 에서 `build:` 를 제거하고 `image:` 만 선언한다. 이미지 빌드는
`scripts/build.ps1` 이 `podman build -f collector\Containerfile -t <tag> .` 로 직접 수행한다.
`scripts/up.ps1` 이 빌드 후 `podman-compose up -d` 를 호출한다.

선택 컨테이너(load-gen, scouter-host)는 compose profile로 분리해 기본 기동에서 제외한다.

---

## 3. 디렉토리 구조

`[O]` = Phase 1에서 생성 완료

```
Test/
├── PLAN.md                         # 이 문서                        [O]
├── README.md                       # 실행 방법                      [O]
├── .gitignore                      # vendor/, target/, *.db 제외    [O]
├── .containerignore                # 빌드 컨텍스트 축소             [O]
├── compose.yml                     # build: 없음 (2.5절 참조)       [O]
├── .env                            # SCOUTER_VERSION, 포트, 부하량  [O]
├── scripts/
│   ├── fetch-scouter.ps1           # tarball 다운로드 + vendor/ 전개 [O]
│   ├── build.ps1                   # podman build 직접 호출          [O]
│   ├── up.ps1 / down.ps1           # 기동 / 종료                     [O]
│   ├── login_check.py              # LOGIN + 오브젝트 목록 검증      [O]
│   └── xlog_check.py               # 실시간 XLog 수신 검증           [O]
├── vendor/                         # git 제외 (47MB)                 [O]
│   └── scouter/{server, agent.java, agent.host}
├── postgres/
│   ├── Containerfile               #                                 [O]
│   └── init/01-create-databases.sql  # shopdb / orderdb 생성         [O]
├── collector/
│   ├── Containerfile               #                                 [O]
│   └── conf/scouter.conf           # 포트, db_dir, log_dir           [O]
├── agent/
│   ├── shop.conf                   # obj_name=shop-app
│   └── order.conf                  # obj_name=order-app
├── apps/
│   ├── shop/    (pom.xml, Containerfile, src/main/{java,resources})
│   └── order/   (pom.xml, Containerfile, src/main/{java,resources})
└── loadgen/
    └── scenario.js                 # k6 시나리오
```

---

## 4. 엔드포인트 설계

### 4.1 shop-app (`:8081`, 경로 prefix `/shop`)

| 메서드 | 경로 | 목적 |
|--------|------|------|
| GET | `/shop/products` | 목록 (Thymeleaf) — 기본 트래픽 |
| GET | `/shop/products/{id}` | 상세 |
| GET | `/shop/products/new`, POST `/shop/products` | 등록 (INSERT) |
| POST | `/shop/products/{id}/edit` | 수정 (UPDATE) |
| POST | `/shop/products/{id}/delete` | 삭제 (DELETE) |
| GET | `/shop/stocks` | 재고 목록 (조인 쿼리) |
| GET | `/shop/api/products/{id}` | **order-app이 호출하는 내부 REST** (JSON) |
| GET | `/shop/lab/slow?ms=1500` | 인위적 지연 → 스캐터 상단 점 |
| GET | `/shop/lab/error?type=npe\|http500` | 예외 발생 → **빨간 점** |
| GET | `/shop/lab/async` | `@Async` 처리 → `xType` 변화 확인 |
| GET | `/shop/lab/heavy-sql` | N+1 유발 쿼리 → `sqlCount`/`sqlTime` 증가 |

### 4.2 order-app (`:8082`, 경로 prefix `/order`)

| 메서드 | 경로 | 목적 |
|--------|------|------|
| GET | `/order/orders` | 목록 (Thymeleaf) |
| GET | `/order/orders/{id}` | 상세 |
| POST | `/order/orders` | **shop `/shop/api/products/{id}` 호출 후 INSERT** → `gxid`/`caller`/`apicall` |
| POST | `/order/orders/{id}/cancel` | 상태 변경 |
| GET | `/order/deliveries` | 배송 목록 |
| GET | `/order/reports/daily` | 집계 쿼리 (느린 SQL) |
| GET | `/order/lab/timeout` | shop `/shop/lab/slow?ms=6000` 호출 → 타임아웃 에러 |

### 4.3 부하 시나리오 (k6 — 확정)

| 비중 | 시나리오 | 기대 결과 |
|------|----------|-----------|
| 60% | 목록/상세 조회 | 저지연 점 밀집대 |
| 20% | 주문 생성 (앱간 호출) | 중간 지연 + gxid 연계 |
| 10% | `/shop/lab/slow` 랜덤 지연 | 상단 산포 |
| 5% | `/shop/lab/heavy-sql`, `/order/reports/daily` | sqlTime 큰 점 |
| 5% | `/shop/lab/error`, `/order/lab/timeout` | 빨간 점 |

VU 5~20, 무한 실행. 부하량은 `.env`로 조절.

---

## 5. 단계별 실행 계획

### Phase 0 — 사전 검증 (**완료**)

| # | 항목 | 결과 |
|---|------|------|
| 0-1 | podman machine 기동 | **완료** — machine 이름이 `podman-machine`이라 `podman machine start podman-machine` 필요 |
| 0-2 | podman-compose 설치 | **완료** — 1.6.0 |
| 0-3 | 릴리스 tarball 다운로드 + 구조 확인 | **완료** (1.3절) |
| 0-4 | 에이전트/서버 바이트코드 버전 → Java 17 가능 여부 | **완료** — 가능 |
| 0-5 | 콜렉터 호스트 단독 기동 + LOGIN 검증 | **완료** — `--add-opens` 필요, admin/admin 로그인 성공 |

### Phase 1 — 콜렉터 컨테이너화 (**완료**)

산출물

| 파일 | 내용 |
|------|------|
| `collector/Containerfile` | `eclipse-temurin:17-jre` + `vendor/scouter/server` 복사, ENTRYPOINT를 포그라운드 + `--add-opens`/`--add-exports` 로 고정 |
| `collector/conf/scouter.conf` | `server_id=NSCOUTER-TEST`, TCP/UDP 6100, `db_dir=/data/database`, `log_dir=/data/logs`, `xlog_realtime_lower_bound_ms=0` |
| `compose.yml` | `scouter-collector` 서비스, `6100:6100/tcp`+`6100:6100/udp` 퍼블리시, `scouter-net` 네트워크 |
| `scripts/build.ps1`, `up.ps1`, `down.ps1`, `fetch-scouter.ps1` | 빌드/기동/종료/바이너리 수급 |

**설정 키는 추측하지 않고 `javap -p scouter.server.Configure` 로 실제 public 필드를 확인해서만 사용했다.**
그 과정에서 `xlog_realtime_lower_bound_ms` 를 발견했다 — 이 값이 0이 아니면 빠른 트랜잭션이
실시간 스캐터에 나오지 않으므로 명시적으로 0을 지정했다.

검증 결과

| 항목 | 결과 |
|------|------|
| 이미지 빌드 | 성공 (368MB) |
| 컨테이너 기동 | 성공, `0.0.0.0:6100->6100/tcp`, `0.0.0.0:6100->6100/udp` |
| conf 적용 | `/data/database`, `/data/logs` 생성 확인 |
| LOGIN | **성공** — `server_id=NSCOUTER-TEST` 로 응답 (conf 반영 재확인) |
| `GET_OBJECT_LIST_REAL_TIME` | 응답 없이 연결 종료 — R10 재현 (에이전트 0개 상태) |

콜렉터 알람 임계치는 `Configure` 에 해당 키가 없어 서버 설정으로 다루지 않는다. 알람은 Phase 4에서 에이전트 conf로 설정한다.

### Phase 2 — shop-app 구현 (**완료**)

Spring Boot **3.5.16** / Java 17 / JPA + Thymeleaf. 에이전트는 아직 붙이지 않았다.
(당시 DB는 SQLite였고 이후 PostgreSQL로 교체했다 — 2.3절)

JDBC 드라이버 버전은 spring-boot-dependencies 가 관리하므로 pom에 명시하지 않는다.
현재 구성은 `org.postgresql:postgresql`(42.7.11) 하나이며, Hibernate 방언은 드라이버로
자동 판별된다.

> 최초 구현 시에는 SQLite(`sqlite-jdbc` + `hibernate-community-dialects`)를 썼고
> `journal_mode=WAL` / `busy_timeout=5000` 을 적용해 R4를 막았다. Phase 4에서 SQL 프로파일이
> 수집되지 않는 문제가 드러나 PostgreSQL로 교체했고(2.3절), 이 설정들은 모두 제거했다.

기동 시 접속한 DB를 로그로 남긴다 — `DataSeeder` / `DbInfoLogger` 가
`DatabaseMetaData` 를 찍으므로 어디에 붙었는지 항상 확인할 수 있다.

```
DB 접속: PostgreSQL 17.10 / driver PostgreSQL JDBC Driver 42.7.11 / url jdbc:postgresql://postgres:5432/shopdb
DB 접속: PostgreSQL 17.10 / driver PostgreSQL JDBC Driver 42.7.11 / url jdbc:postgresql://postgres:5432/orderdb
```

**검증 결과** (컨테이너 기동 후 실제 호출)

| 엔드포인트 | 결과 |
|-----------|------|
| `GET /shop/products` | 200 |
| `GET /shop/products/{id}` | 200 |
| `GET /shop/stocks` | 200 |
| `GET /shop/api/products/{id}` | 200 (JSON, `availableQuantity` 포함) |
| `GET /shop/api/products/999999` | 404 |
| `GET /shop/lab/slow?ms=800` | 200 / 0.81s |
| `GET /shop/lab/jitter` | 200 |
| `GET /shop/lab/async` | 200 |
| `GET /shop/lab/heavy-sql` | 200 |
| `GET /shop/lab/error?type=http500\|npe\|illegal` | 500 (3종 모두) |
| `POST /shop/products` (등록) | 302 → 신규 ID |
| `POST /shop/products/{id}/edit` (수정) | 302, 값 반영 확인 |
| `POST /shop/products/{id}/delete` (삭제) | 302, 건수 감소 확인 |
| 시드 데이터 | product 200건, stock 300건 |
| UTF-8 폼 처리 | 정상 (퍼센트 인코딩으로 별도 확인) |

계획 대비 추가한 것은 `GET /shop/lab/jitter` 하나다. k6에서 응답시간 산포를 만들 때
`slow` 의 고정 지연보다 다루기 쉬워서 넣었다.

### Phase 3 — order-app 구현 (**완료**)

shop-app 과 동일 스택(Spring Boot 3.5.16 / Java 17 / JPA + Thymeleaf).
차이는 도메인(`Order`/`Delivery`)과 경로 prefix(`/order/**`), 그리고 **shop-app 호출**이다.

shop 호출은 `RestClient` 로 하며 연결 2초 / 읽기 3초 타임아웃을 건다.
테이블명은 SQL 예약어를 피해 `orders` 로 둔다.

**검증 결과** (컨테이너 기동 후 실제 호출)

| 엔드포인트 | 결과 |
|-----------|------|
| `GET /order/orders` | 200 |
| `POST /order/orders` (productId=1, qty=2) | 302 → `/order/orders/1` |
| `GET /order/orders/{id}` | 200 |
| `GET /order/deliveries` | 200 |
| `GET /order/reports/daily` | 200 (상태별 집계) |
| `POST /order/orders/{id}/cancel` | 302, 상태 `CANCELED` 반영 확인 |
| `POST /order/orders` (productId=999999) | **400** — shop 404를 400으로 변환 |
| `GET /order/lab/timeout?ms=6000` | **500 / 3.017초** — 읽기 타임아웃 3초가 정확히 동작 |
| DB 접속 | `PostgreSQL 17.10` / `orderdb` (기동 로그로 확인) |

**앱 간 호출이 실제로 일어난다는 근거**: shop-app 의 상품 1 단가는 `1234`인데,
order-app 이 만든 주문 1의 `unitPrice` 가 `1234`, `totalPrice` 가 `2468`(=1234×2)로 기록됐다.
order-app 에는 이 값의 출처가 없으므로 HTTP 호출로 받아온 것이 확인된다.
Phase 4에서 에이전트를 붙이면 이 호출이 `gxid`/`caller` 와 apicall 프로파일 스텝으로 나타나야 한다.

### Phase 4 — Scouter 에이전트 부착 (**완료**)

두 앱 Containerfile 에 `-javaagent` 를 추가하고 `agent/{shop,order}.conf` 를 작성했다.
설정 키는 `javap -p scouter.agent.Configure` 로 실제 public 필드를 확인한 것만 사용했다.
계획 초안에 적었던 `profile_sql_enabled` / `profile_apicall_enabled` 는 **존재하지 않는 키**였다.
SQL·apicall 프로파일은 `profile_off` 가 마스터 스위치이고 기본 수집된다.

JVM 옵션:
```
-javaagent:/scouter/scouter.agent.jar
-Dscouter.config=/scouter/conf/shop.conf
-Djdk.attach.allowAttachSelf=true
--add-opens=java.base/java.lang=ALL-UNNAMED
--add-exports=java.base/sun.net=ALL-UNNAMED
```

**검증 결과**

| 항목 | 결과 |
|------|------|
| 에이전트 로드 | `[SCOUTER] Version 2.21.3 ... GMT_ENV_java8plus` — Java 17에서 정상 |
| 오브젝트 등록 | `/shop-app/shop-app` (hash=-1585387669), `/order-app/order-app` (hash=16367847) |
| XLog 수신 | 143건 |
| objHash 구분 | 두 에이전트가 서로 다른 해시 → 스캐터에서 다른 색으로 표시됨 |
| elapsed 분포 | 1ms ~ 3030ms |
| `caller != 0` | 16건 — 분산 트랜잭션 하위 XLog |
| `gxid` 공유 | order(root, caller=0)와 shop(child, caller=order txid)이 동일 gxid |
| `sqlCount` / `sqlTime` | 36/38건에서 > 0, 최대 26건 / 8ms |

**JDBC 후킹 — SQLite에서 PostgreSQL로 교체한 경위 (실측)**

처음에는 SQLite로 구성했는데 XLog 108건 전부 `sqlCount=0`, `sqlTime=0` 이었고
프로파일에 SQL 스텝이 남지 않았다.

원인: Scouter 에이전트의 기본 JDBC 후킹 대상은
Oracle / MariaDB / MySQL / **PostgreSQL** / jTDS / SQLServer / Tibero / HSQLDB / H2 /
CUBRID / Altibase 이고 **SQLite는 없다**
(`JDBCPreparedStatementASM.class`, `JDBCStatementASM.class` 상수 풀에서 확인).

`hook_jdbc_{pstmt,stmt,rs}_classes` 에 SQLite 클래스(jdbc3 / jdbc4 / core)를 직접 지정하면
36/38건에서 `sqlCount > 0` 으로 동작하는 것까지 확인했으나, 2.3절의 이유로 **DB를 PostgreSQL로
교체**하고 이 설정은 제거했다.

PostgreSQL 전환 후 `hook_jdbc_*` **설정 없이** 측정한 결과:

| 항목 | 값 |
|------|-----|
| 총 XLog | 72건 |
| `sqlCount > 0` | 48건 (최대 26) |
| `sqlTime` 최대 | 30ms |
| `error != 0` | 8건 |
| `caller != 0` | 9건 |
| elapsed | 1ms ~ 6052ms (median 23ms) |
| objHash 분포 | shop 54건 / order 18건 |
| DB 접속 로그 | `PostgreSQL 17.10 / driver PostgreSQL JDBC Driver 42.7.11` |


**에러 유형에 따라 `error` 필드가 달라진다 (실측)**

각 유형을 10회씩 호출하고 XLog 의 `error != 0` 증가분을 센 결과다.

| `/shop/lab/error?type=` | 구현 | `error != 0` 증가 |
|---|---|---|
| `npe` | `NullPointerException` 발생 | **+10** |
| `illegal` | `IllegalStateException` 발생 | **+10** |
| `http500` | `ResponseStatusException(500)` | **+0** |

실제로 던져진 예외만 `error` 로 기록된다. `ResponseStatusException` 은 Spring 예외 리졸버가
처리해서 서블릿까지 전파되지 않으므로 응답이 500이어도 XLog 는 정상으로 남는다.
**빨간 점을 만들려면 `npe` / `illegal` 을 써야 한다.** `http500` 은 "5xx인데 에러로 안 잡히는
경우"를 검증하는 용도로 남겨둔다.

### Phase 5 — 부하 생성기 (k6) (**완료**)

`loadgen/scenario.js` 를 `grafana/k6` 이미지에 구워서 쓴다(볼륨 마운트 대신 — postgres 초기화
SQL 과 같은 이유). compose `profiles: [load]` 로 분리해 기본 기동에서 제외된다.

```powershell
.\scripts\load.ps1            # 부하 시작
.\scripts\load.ps1 -Follow    # 시작 후 로그 따라가기
.\scripts\load.ps1 -Stop      # 중지
```

VU 와 지속시간은 `.env` 의 `K6_VUS` / `K6_DURATION` 으로 조절한다.
k6 가 이 두 환경변수를 스크립트 `options` 보다 우선 적용한다.

**트래픽 구성** (가중치 합 100)

| 비중 | 시나리오 | 노리는 신호 |
|---|---|---|
| 30 | shop 목록 + 상세 | 저지연 점 밀집대, SQL |
| 20 | 주문 생성 (order → shop 호출) | `gxid` / `caller` / apicall |
| 10 | shop 재고 목록 | SQL |
| 10 | order 목록 | — |
| 10 | `/shop/lab/jitter` (30~2000ms) | elapsed 산포 |
| 5 | `/shop/lab/heavy-sql` | `sqlCount` / `sqlTime` |
| 5 | order 집계 | 느린 SQL |
| 5 | `/shop/lab/async` | `xType` |
| 5 | 에러 (npe 60% / illegal 30% / order 타임아웃 10%) | 빨간 점 |

에러 시나리오에 `type=http500` 을 넣지 않았다. Phase 4에서 확인했듯 `ResponseStatusException`
은 XLog `error` 를 0으로 남기므로 빨간 점이 되지 않는다.

**검증 결과** — VU 10 으로 약 1분 부하 후 `scripts/signal_check.py`

```
총 XLog       : 1871건
에이전트별    : {'shop-app': 1271, 'order-app': 600}
error != 0    : 65건  (빨간 점)
caller != 0   : 267건 (분산 트랜잭션 하위)
sqlCount > 0  : 1597건 / 최대 51
sqlTime 최대  : 42ms
elapsed       : min 0 / p50 8 / p90 122 / p99 1824 / max 6052 ms
elapsed 분포  : {'<50ms': 1612, '50-200ms': 165, '200ms-1s': 41, '1-3s': 47, '>3s': 6}
```

k6 처리량은 10 VU 기준 약 13 iteration/s 였다.
`profiles` 가 podman-compose 1.6.0 에서 정상 동작하는 것도 확인했다
(`podman-compose up -d` 시 load-gen 미기동).

### Phase 6 — NScouter 연동 검증 (진행 중)

Phase 4~5에서 드러난 NScouter 결함 4건을 먼저 수정했다
([NSCOUTER-ISSUES.md](NSCOUTER-ISSUES.md)). 백엔드 경로는 실서버 대상 테스트로 검증 완료다.

```
cd src-tauri && cargo test --test live_collector -- --ignored --nocapture
  live_object_list         ok   오브젝트 2건
  live_sequential_requests ok   같은 연결로 3회 연속 요청
  live_xlog_stream         ok   XLog 10000건, 커서 loop=2 index=3841
```

앱은 `npm run tauri dev` 로 기동해 창까지 뜬 것을 확인했다(프로세스 `nscouter`, 창 제목 `Nscouter`).
접속 다이얼로그에 자동 접속 기능이 없어 **화면 검증은 사람이 접속 버튼을 눌러야 한다.**

접속 정보: `127.0.0.1` / `6100` / `admin` / `admin`

> **아래 표는 2026-08-15 시점의 기록이다.** 그 뒤로 기능이 크게 늘어 항목별 상태는
> 여기서 관리하지 않는다 — **`src/features/parity/inventory.ts` 가 원본**이고,
> `parity.test.ts` 가 status 마다 evidence(테스트명·파일)를 강제한다.
> 아래는 그때 무엇을 열어 두고 시작했는지의 기록으로 남긴다.

| # | 검증 항목 | 2026-08-15 상태 | 이후 |
|---|-----------|------|------|
| 1 | 로그인 | 백엔드 검증 완료 (L4) | |
| 2 | 에이전트 목록 2건 | 백엔드 검증 완료 (L4) | |
| 3 | XLog 실시간 유입 | 백엔드 검증 완료 (L4) | |
| 4 | 에이전트별 색상 | 화면 확인 필요 | |
| 5 | 에러 점(빨간색) | 화면 확인 필요 — 데이터에는 288건 존재 | |
| 6 | 비동기 점(회색/연빨강) | 화면 확인 필요 | |
| 7 | Y축 분포 | 화면 확인 필요 — max 6003ms | Y축 종류를 늘리며 실물로 확인 (`284d608`) |
| 8 | 텍스트 사전(서비스명) | 화면 확인 필요 | L4 `live_text_dictionary_types` |
| 9 | 프로파일 SQL 스텝 | 화면 확인 필요 — sqlCount>0 8567건 | L4 `live_xlog_profile_steps` · 바인딩은 `live_sql_mixed_literal_and_bind` |
| 10 | apicall 프로파일 | 화면 확인 필요 | L4 `live_flow_apicall_links_child_xlog` |
| 11 | gxid 연계 | 화면 확인 필요 — caller!=0 1443건 | L4 `live_xlog_by_gxid` |
| 12 | 카운터 | 미검증 (PerfCounterPack 파싱 미확인) | 프로토콜 L4 검증(`live_counter_real_time_all`·`live_javaee_counter_values`·`live_host_counters`). PerfCounterPack 자체는 N-5 수정 + L3 회귀 |
| 13 | 알람 | 미검증 | 파싱 L4 검증(`live_alert_pack_fields`·`live_alert_cursor_advances`). **화면 표시는 아직 미확인** — parity 에 partial |
| 14 | 대량 부하 렌더링 | 화면 확인 필요 | 실환경 1,600건 드래그에서 나온 것들은 [backlog.md](../docs/backlog.md) |

**화면 항목(4~7)은 항목별 대조표가 유지되지 않았다.** 실물 화면 확인은 이후 여러 번
있었지만(`9b31190` 등) 이 표에 되돌려 적지 않았다. 다시 볼 때는 parity inventory 를 본다.

부하 상태 신호 (`scripts/signal_check.py`):

```
총 XLog       : 10000건
에이전트별    : {'shop-app': 6830, 'order-app': 3170}
error != 0    : 288건
caller != 0   : 1443건
sqlCount > 0  : 8567건 / 최대 51
elapsed       : min 0 / p50 3 / p90 121 / p99 1867 / max 6003 ms
```


---

## 6. 리스크

| # | 리스크 | 영향 | 대응 | 상태 |
|---|--------|------|------|------|
| R1 | 에이전트가 Java 17 미지원 | 앱 JDK 제약 | 바이트코드 major=52 실측 | **해소** |
| R2 | 콜렉터가 기동 실패 | 전체 블로킹 | 호스트 단독 기동 성공 확인 | **해소** |
| R5 | podman-compose 설치 실패 | 기동 불가 | 1.6.0 설치 완료 | **해소** |
| R11 | podman-compose가 Windows 절대경로를 git URL로 오인해 `build:` 섹션이 동작하지 않음 | compose로 빌드 불가 | **실제 발생.** `build:` 제거 + `scripts/build.ps1` 로 분리 (2.5절) | **해소** |
| R12 | `net_http_server_enabled=false` 를 줘도 내장 Jetty가 6180에 뜬다 (실측) | 없음 — 호스트로 퍼블리시하지 않음 | 관찰만 기록 | 영향 없음 |
| R6 | Windows/WSL 포트 6100 퍼블리시 실패 | NScouter 접속 불가 | 퍼블리시 + 로그인 성공 확인 | **해소** |
| R9 | JDK 강한 캡슐화로 콜렉터 기동 실패 | 콜렉터 불가 | **실제 발생.** `--add-opens=java.base/java.lang=ALL-UNNAMED` + `--add-exports=java.base/sun.net=ALL-UNNAMED`로 해결 확인 | **해소** |
| R3 | 에이전트→콜렉터 UDP 패킷 유실 (컨테이너 MTU) | 카운터 누락 | `net_udp_packet_max_bytes` 축소 | 미해소 |
| R4 | `SQLITE_BUSY`로 의도치 않은 에러 폭증 | 에러 점 노이즈 | **DB를 PostgreSQL로 교체해 원인 자체를 제거** (2.3절) | **해소** |
| R7 | vendor가 git에 커밋됨 | 저장소 오염 | `Test/.gitignore`에 `vendor/` 등록 완료 | **해소** |
| R8 | Maven 의존성 다운로드 지연 | 빌드 지연 | `.m2` 캐시 볼륨 마운트 | 미해소 |
| R10 | `GET_OBJECT_LIST_REAL_TIME` 요청 시 콜렉터가 TCP 연결을 종료 | 오브젝트 목록 조회 실패 | 올바른 이름은 `OBJECT_LIST_REAL_TIME`. 상수 수정 완료 | **해소** |
| R13 | NScouter가 XLog 요청에 `count` 파라미터를 넣지 않아 항상 0건 수신 | 스캐터에 점이 안 찍힘 | `build_request_param()` 에 `count=10000` 추가 완료 | **해소** |
| R14 | NScouter가 TCP 연결 1개를 모든 명령에 재사용. 콜렉터는 연결당 명령 1개만 처리 | 로그인 이후 두 번째 명령부터 전부 실패 | `send_request()` 가 전송 직전 소켓을 새로 연다 | **해소** |
| R15 | Scouter 기본 JDBC 후킹 대상에 SQLite 없음 → `sqlCount`/`sqlTime`=0, SQL 프로파일 없음 | 프로파일 뷰 검증 불가 | **DB를 PostgreSQL(기본 후킹 대상)로 교체.** `hook_jdbc_*` 설정 자체가 불필요해짐 | **해소** |
| R16 | NScouter `read_object_pack()` 필드 순서 오류 + `wakeup`/`tags` 미소비 | 오브젝트 2건 이상이면 파싱 붕괴 | `ObjectPack.read()` 순서대로 수정. mock 서버가 이 경로를 검증 못 하고 있었음 | **해소** |

---

## 7. 확정된 사항

- Java 17 / Scouter 2.21.3 (`agent.java`)
- 두 앱은 동일 스택, 도메인·API 경로로 구분
- DB: **PostgreSQL 17** (`shopdb` / `orderdb`) — SQLite에서 교체 (2.3절)
- order-app → shop-app REST 호출 (gxid 검증용)
- 부하 생성기: **k6**
- host agent: compose profile `host`로 분리, 기본 기동에서 제외
