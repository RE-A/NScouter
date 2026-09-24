# 설정 — 상세 설명

> 바로 조치할 것만 보려면 [간략 가이드](settings-guide.md).
> 이 문서는 **왜 그런지**와 **무엇으로 확인했는지**를 적는다. 모든 항목에 근거를 붙였다.

| 근거 표기 | 뜻 |
|---|---|
| **실측** | 테스트 환경(콜렉터·에이전트 2.21.3)에 붙여 확인했다. `F-nn` 은 [verified-facts.md](verified-facts.md) 항목 |
| **코드** | scouter 2.21.3 jar 를 `javap` 로 열어 확인했다 |
| **공식** | [공식 설정 문서](https://github.com/scouter-project/scouter/blob/master/scouter.document/main/Configuration.md)의 설명·기본값만 옮겼다. 동작은 확인하지 않았다 |

---

## 적용 시점

설정 화면에서 저장하면 에이전트·콜렉터는 **파일을 통째로 쓰고 다시 읽는다**(코드: 콜렉터 `setConfigureServer` → `saveText` → `reload(true)`,
에이전트도 같은 방식 — F-40·F-47). 다만 «다시 읽었다» 와 «그 기능이 새 값으로 돈다» 는 다르다. 확인한 것은 아래뿐이다.

| 설정 | 재시작 없이 적용 | 근거 |
|---|---|---|
| [콜] `net_tcp_get_agent_connection_wait_ms` | 저장 직후 요청부터 | 실측 (대조 실험) |
| [에] `net_collector_tcp_session_count` | 약 1초 안에 | 코드 (`TcpRequestMgr` 가 1초마다 다시 읽어 연결 수를 맞춘다) |
| [에] `counter_interaction_enabled` | 된다 | 실측 F-40 (원격으로 켜서 데이터가 생겼다) |
| [에] `jmx_counter_enabled` | 된다 | 실측 F-41 (같은 방법) |
| [JVM] 옵션 전부 · [앱] 속성 | **재시작 필요** | JVM 기동 인자다 |
| 그 밖의 항목 | **확인하지 않았다** | — |

> **저장은 파일을 통째로 덮어쓴다.** 원문을 읽어 그 위에 고친 줄만 바꿔 보내야 한다 — NScouter 설정 화면이 그렇게 한다.
> 저장 성공 여부는 예외가 아니라 응답의 `result` 글자로 온다(F-47). 설정 화면은 저장한 뒤 다시 읽어 확인한다.

---

## 1. XLog (스캐터)

### 1.1 빠른 트랜잭션이 안 보인다

세 곳에서 걸러질 수 있다. 하나라도 걸리면 스캐터가 듬성하거나 비어 보인다 (실측 F-11).

| 어디 | 설정 | 기본 | 공식 설명 |
|---|---|---|---|
| [콜] | `xlog_realtime_lower_bound_ms` | `0` | Ignored time(ms) in retrieving XLog in real time |
| [콜] | `xlog_pasttime_lower_bound_ms` | `0` | Ignored time(ms) in retrieving previous XLog |
| [에] | `xlog_sampling_enabled` | `false` | XLog sampling mode enabled |

- 샘플링을 켜면 응답시간 구간마다 일부만 보낸다 — 구간 경계 `xlog_sampling_step1_ms`·`step2_ms`·`step3_ms`
  (기본 100·1000·3000), 비율 `…_rate_pct` (기본 3·10·30%, 그 위는 `xlog_sampling_over_rate_pct` 100%) (공식).
  **빠른 것일수록 적게 보낸다** — 스캐터 아래쪽이 비는 모양이 된다.
- [에] `xlog_lower_bound_time_ms` 는 공식 문서에 «deprecated, xlog_sampling_xxx 를 쓸 것» 으로 적혀 있다.

### 1.2 특정 서비스만 스캐터에 없다

[에] `xlog_discard_service_patterns` (기본 비어 있음) — 공식 설명: «XLog 는 남기지 않지만 TPS 와 요약에는 반영한다».
그래서 **카운터에는 잡히는데 스캐터에만 없는** 모양이 된다. (공식)

### 1.3 빨간 점이 안 생긴다

설정 문제가 아니다. XLog 의 `error` 는 **서블릿까지 실제로 던져진 예외**만 기록한다.
Spring 의 예외 리졸버가 처리해 500 으로 응답한 것은 정상으로 남는다 (실측 F-10: `NullPointerException` +10 · `ResponseStatusException(500)` +0).

### 1.4 과거 조회가 에러 없이 0건

콜렉터는 XLog·프로파일을 **자기 타임존 기준 날짜** 디렉토리에 저장하고, 클라이언트는 자기 날짜로 묻는다.
둘이 어긋나면 **에러 없이 0건**이다 — 예를 들어 콜렉터가 UTC, PC 가 KST 면 KST 00~09시가 하루씩 밀린다 (실측 F-18).
스카우터 원래 클라이언트도 같은 한계다. **콜렉터 서버의 타임존을 사용자 쪽과 맞춘다.**

### 1.5 점이 창 밖으로 밀린다

차트 오른쪽 끝은 이 PC 의 «지금» 이다. 서버 시계가 앞서면 점이 창 오른쪽 밖에, 뒤처지면 오른쪽이 빈다.
시각 차가 크면 차트에 배지가 뜬다 ([사용자 가이드 §8.4](user-guide.md#84-점이-사라진다-싶을-때)). 서버와 PC 의 시계를 맞춘다.

---

## 2. 프로파일

### 2.1 SQL 스텝이 하나도 안 남는다

에이전트의 기본 JDBC 후킹 대상은 Oracle · MariaDB · MySQL · PostgreSQL · jTDS · SQLServer · Tibero · HSQLDB · H2 · CUBRID · Altibase 다.
**SQLite 는 없다** — 쓰면 `sqlCount`/`sqlTime` 이 늘 0 이고 SQL 스텝이 안 남는다 (코드·실측 F-9).
목록에 없는 드라이버는 [에] `hook_jdbc_pstmt_classes` · `hook_jdbc_stmt_classes` · `hook_jdbc_rs_classes` 로 지정한다.
적용 시점은 확인하지 않았다.

> 프로파일 전체를 끄는 스위치는 [에] `profile_off` 다. 공식 문서에는 없지만 에이전트에 실재한다 (코드 F-12).
> 반대로 `profile_sql_enabled`·`profile_apicall_enabled` 는 **없는 키**다 — 넣어도 아무 일도 없다.

### 2.2 SQL 에 `@{1}` 이 보인다

[에] `profile_sql_escape_enabled` (기본 `true`, 공식: «쿼리를 정규화하려고 리터럴을 빼낸다»).
켜져 있으면 SQL 안의 리터럴이 `@{n}` 으로 바뀌고 값은 따로 온다. 문자열은 따옴표가 문장 쪽에 남는다 (`'@{1}'`) (실측 F-49).
NScouter 는 값을 다시 채워 보여주므로 보통은 그대로 둔다. 리터럴과 `?` 가 섞이면 값은 **리터럴 먼저, 바인딩 나중** 순서로 온다 (실측 F-51).

### 2.3 바인드 값이 잘린다

| 설정 | 기본 | 근거 |
|---|---|---|
| [에] `trace_sql_parameter_max_length` | `20` (최대 500) | 코드·실측 F-52 |
| [에] `_trace_sql_parameter_max_count` | `128` | 코드 F-52 |

값 하나가 이 길이에서 **잘린 채 따옴표가 닫혀** 온다. 문장은 멀쩡해 보이는데 값이 다르다 —
값을 채운 SQL 을 복사해 DB 에 돌리면 결과가 달라질 수 있다. 적용 시점은 확인하지 않았다.

**설정으로 안 되는 것:** 프로시저의 OUT 파라미터(`registerOutParameter`)는 에이전트가 기록하지 않는다.
OUT 이 중간에 있으면 그 뒤 값이 한 칸씩 당겨져 위치를 복원할 수 없다 (실측 F-52).

### 2.4 SQL 본문이 «unknown» 이다

설정으로 안 된다. 에이전트가 **문자열 `"unknown"` 을 그대로 보낸다.** 자동 생성 키를 돌려받는 INSERT
(Hibernate `GenerationType.IDENTITY`)는 드라이버가 문장 없이 PreparedStatement 를 만들어 에이전트가 문장을 얻지 못한다 (코드·실측 F-53).
NScouter 는 이 경우 «에이전트가 SQL 문장을 받지 못했습니다» 로 적는다.

### 2.5 흐름 보기에서 서버 간 호출이 안 이어진다

[에] `trace_interservice_enabled` (기본 `true`, 공식: «HttpTransfer 에서 gxid 연결을 켠다»). 꺼져 있으면 서버를 넘는 호출이 한 그룹으로 묶이지 않는다.
흐름을 잇는 것은 ApiCall 스텝의 `txid` 와 같은 gxid 그룹이다 (실측 F-31·F-48). 이 설정을 끄고 확인하지는 않았다.

---

## 3. Active 탭

### 3.1 콜렉터는 에이전트에 어떻게 묻는가

Active 탭은 `OBJECT_ACTIVE_SERVICE_LIST` 를 **종류(objType) 단위로** 보낸다. 콜렉터는 그 종류의 살아 있는
에이전트마다 **차례로** 묻는다. 방향이 보통 생각과 반대다.

```
  NScouter ──TCP──▶ 콜렉터
                      │  에이전트마다 차례로
                      ▼
                 세션 풀에서 꺼냄 ◀── 에이전트가 미리 열어 둔 TCP 연결 (기본 1개)
                      │
          net_tcp_get_agent_connection_wait_ms (기본 1초) 안에 못 꺼내면
                      ▼
          [S501] 로그 → 그 서버는 «행 없는 빈 응답»
```

- 콜렉터가 에이전트로 연결을 여는 게 아니라, **에이전트가 콜렉터로 열어 둔 연결**을 꺼내 쓰고 돌려놓는다.
- 대기 시간 안에 못 꺼내면 `[S501] Cannot find a tcp agent for <objName>` 을 남기고 **objHash 만 든 빈 응답**을 넣는다.
- 에이전트는 정상 응답에 **건수와 무관하게 늘** `complete=true` 를 붙인다. 그래서 `complete` 가 없으면 «한가하다» 가 아니라 **«못 물어봤다»** 다.

| 사실 | 근거 (코드) |
|---|---|
| 종류의 에이전트를 차례로 순회 | 콜렉터 `ThreadList.agentActiveServiceList` |
| 세션을 꺼내 쓰고 돌려놓음, 못 얻으면 S501 · null | 콜렉터 `AgentCall.call` → `TcpAgentManager.get`/`add` |
| 대기가 `net_tcp_get_agent_connection_wait_ms` | 콜렉터 `TcpAgentManager.get` |
| 정상 응답엔 늘 `complete=true` | 에이전트 `AgentThread.activeThreadList` |

**실측** — 테스트 콜렉터의 대기를 10ms 로 내리고 한 에이전트의 연결을 무거운 요청으로 붙잡은 채 물었다.
5회 중 4회 **붙잡힌 에이전트만** 빈 응답, 다른 에이전트는 정상, 콜렉터 로그에 `[S501] Cannot find a tcp agent for /shop-app/shop-app`.
기본값(1초)에서는 동시 8건으로도 재현되지 않았다 — 로컬 호출은 몇 ms 라 대기 안에 풀린다.

### 3.2 서버가 목록에서 사라지는 경우는 **둘**이다

둘 다 «못 물어본 것» 인데 응답이 다르다. 고치는 곳도 다르다.

| | 콜렉터가 한 일 | 응답 | 원인 |
|---|---|---|---|
| **빈 팩** | 물으려 했는데 에이전트 연결을 못 얻었다 | `objHash` 만 든 팩 (`S501` 로그) | 3.3 세션 |
| **팩 없음** | **묻지도 않았다** | 아무것도 없다 | 3.4 하트비트 |

#### 빈 팩 — 연결을 1초 안에 못 얻었다

1. 콜렉터–에이전트 사이 **네트워크가 느리다**
2. 그 에이전트에 **다른 요청이 연결을 쓰는 중**이다 — 다른 사용자의 클라이언트, 덤프 같은 무거운 요청
3. 에이전트의 연결이 **끊긴 채**다 — 다시 붙을 때까지 매번 빈 응답

로컬에서 재현한 것은 ②뿐이고 ①·③ 은 구조상 같은 결과가 나오는 경우다.
로그에 같은 서버가 **간헐적으로** 찍히면 ①·②, **계속** 찍히면 ③ 을 먼저 의심한다.

#### 팩 없음 — 콜렉터가 «살아 있지 않다» 고 본다

콜렉터는 조회 대상을 `AgentManager.getLiveObjHashList` 로 고르는데, 이 함수는
**`alive` 인 오브젝트만** 돌려준다 (코드). 에이전트의 하트비트는 **UDP** 로 가고
(코드: `AgentHeartBeat` → `DataProxy.sendHeartBeat` → `UDPDataSendThread`),
[콜] `object_deadtime_ms`(기본 **8초**, 공식: «하트비트가 멈춘 오브젝트를 비활성으로 판정하기까지 기다리는 시간») 안에
안 오면 비활성이 된다.

그러면 그 서버는 **조회에서 통째로 빠지고 빈 팩조차 오지 않는다.** 하트비트가 다시 오면
살아나므로, UDP 가 간헐적으로 유실되는 환경에서는 **초 단위로 떴다 사라졌다** 한다.

**실측** — 에이전트를 멈춰 하트비트를 끊고 1초마다 물었다 (`probe_active_service_heartbeat_gap`).

```
 4초  shop-app=답함/alive      ← 정상
 5초  shop-app=빈팩/dead       ← 멈춘 직후: 물었지만 연결을 못 얻음
 6~17초 shop-app=없음/dead      ← **팩이 아예 안 온다** (조회 대상에서 빠짐)
18초  shop-app=답함/alive      ← 다시 켜니 복귀
```

같은 시각 `order-app` 은 내내 정상이었다 — 콜렉터가 죽은 것이 아니라 **그 서버만** 빠진다.

- 왼쪽 서버 목록의 살아 있음 표시가 같이 깜빡이면 이쪽이다.
- UDP 6100 이 막히거나 유실되는지 본다 (방화벽·보안그룹·NAT·MTU).
- **운영(ECS 등)에서 실제로 이것이 원인인지는 확인하지 못했다.** 위는 하트비트를 강제로
  끊어 만든 것이고, 운영에서 무엇이 하트비트를 끊는지는 그쪽 환경에서 봐야 한다.

### 3.3 세션 설정 (빈 팩 쪽)

| 설정 | 기본 | 공식 설명 | 올리면 | 대가 |
|---|---|---|---|---|
| [콜] `net_tcp_get_agent_connection_wait_ms` | `1000` | Waiting time(ms) for agent session | 빈 응답이 준다 | 콜렉터가 차례로 묻기 때문에, 늦은 에이전트가 여럿이면 한 번 갱신이 «늦은 수 × 대기» 까지 길어진다 |
| [에] `net_collector_tcp_session_count` | `1` | Collector TCP Session Count | 한 에이전트에 겹친 요청을 나눠 받아 ② 가 준다 | 콜렉터가 받는 연결이 «에이전트 수 × 이 값» 으로 는다. ①·③ 에는 효과 없다 |

> 권장값은 적지 않는다. 운영 환경에서 검증한 값이 없다. 조금씩 올리며 로그의 `S501` 이 줄어드는지 본다.

### 3.4 하트비트 설정 (팩 없음 쪽)

| 설정 | 기본 | 공식 설명 |
|---|---|---|
| [콜] `object_deadtime_ms` | `8000` | Waiting time(ms) until stopped heartbeat of object is determined to be inactive |

올리면 하트비트가 한두 번 유실돼도 비활성으로 넘어가지 않는다. 대신 **정말 죽은 서버를
죽었다고 말하는 것도 그만큼 늦어진다.** 근본 해결은 UDP 유실을 없애는 쪽이다.
적용 시점은 확인하지 않았다.

### 3.5 NScouter 가 보여주는 방식

- 못 받은 서버는 상단에 **이름과 이유로** 나눠 알린다 — 「연결을 못 얻어 못 물어본 서버」와
  「콜렉터가 비활성으로 보는 서버」는 고칠 곳이 다르다.
- 그 서버의 행은 지우지 않고 **«지난 값»** 으로 흐리게 **15초까지** 이어 보여준다.
  넘으면 버리고 «못 받음» 만 남긴다. 횟수가 아니라 시간인 이유는 폴링 주기를 고를 수 있어서다 —
  비활성 판정에 기본 8초가 걸리므로 그보다 넉넉히 둔다.
- 쿼리 상세의 바인드 값은 목록이 아니라 **스레드 상세**에서 받는다 (코드: 에이전트 `AgentThread` 가 `SQLActiveBindVar` 로 보냄). 2.3 의 길이 제한을 같이 받는다.
- 짧게 끝나는 쿼리는 순간 스냅샷에 거의 안 잡힌다 — 실측 5초·44표본 중 SQL·외부 호출이 찬 것은 7건.

### 3.6 개발자용 — 재현

테스트 환경(`Test/`)을 띄운 뒤 `src-tauri` 에서:

```sh
# ① 하트비트를 끊으면 콜렉터가 그 서버를 조회에서 빼는가 (탐침이 직접 멈췄다 켠다)
NSCOUTER_PAUSE_CONTAINER=shop-app   cargo test --test live_collector -- --ignored --nocapture probe_active_service_heartbeat_gap

# ② 동시 요청 — 기본 대기(1초)에서는 빈 팩이 없어야 한다
cargo test --test live_collector -- --ignored --nocapture probe_active_service_concurrency

# ③ 대기를 줄이면 빈 팩이 생기는가 — **콜렉터 설정을 바꾸므로 반드시 단독으로**
NSCOUTER_LIVE_CONFIG_WRITE=1   cargo test --test live_collector -- --ignored --nocapture probe_active_service_short_wait
```

③ 은 콜렉터 설정 원문을 읽어 두고 끝나면 되돌린다. 다만 실행 중에는 콜렉터 전체가 영향을 받아
나란히 돌던 다른 테스트가 빈 팩을 받는다 — 실제로 함께 돌렸을 때 ② 가 8건 중 8건 빈 팩이 됐다.
그래서 환경변수를 켰을 때만 돈다.

① 도 같은 이유로 컨테이너 이름을 줄 때만 멈춘다. **손으로 다른 창에서 멈추면 안 된다** —
멈춘 구간과 조회 시점이 어긋나 «멈췄는데도 계속 답함» 으로 보인다 (실제로 두 번 헛짚었다).

---

## 4. Counter · Visualize · 토폴로지

### 4.1 커넥션 풀

풀은 WAS 와 **별개 오브젝트**(종류 `datasource`)로 올라오고, **두 관문이 모두** 열려야 잡힌다. 하나만 열면 에러 없이 0건이다 (실측 F-41).

| 어디 | 설정 | 기본 |
|---|---|---|
| [앱] HikariCP | `spring.datasource.hikari.register-mbeans=true` | `false` |
| [에] | `jmx_counter_enabled=true` | `false` |

- 풀 카운터는 `ConnActive`·`ConnIdle`·`ConnMax` **셋뿐**이다 (코드: counters.xml `datasource`). DB 서버 자체 지표는 없다.
- 풀 이름은 `<WAS 이름>/<풀 이름>` 이다 (코드: 에이전트 `TomcatJMXPerf`). 어느 쿼리가 어느 풀 커넥션을 쓰는지는 알 수 없다.
- NScouter 에서 풀 값은 **왼쪽에서 고른** 오브젝트만 온다. WAS 만 고르고 풀을 안 고르면 비어 있다.

### 4.2 토폴로지

[에] `counter_interaction_enabled` (기본 `false`) — 꺼져 있으면 서버 간 호출 데이터가 **아예 생기지 않는다** (실측 F-40).
원격으로 켜서 데이터가 생기는 것을 확인했다.

### 4.3 `PermPercent` 만 안 온다

Metaspace 는 기본 **상한이 없고**(Java 17 실측), 에이전트는 상한이 있을 때만 백분율을 보낸다.
[JVM] `-XX:MaxMetaspaceSize=256m` 처럼 상한을 주면 온다. `PermUsed` 는 그와 무관하게 온다 (코드·실측 F-43).

### 4.4 설정으로 안 오는 카운터

| 카운터 | 이유 | 근거 |
|---|---|---|
| `ProcCpu` | counters.xml 에 이름만 있고 보내는 코드가 없다 | 코드 F-43 |
| 호스트 `TcpStatSynSent`·`TcpStatSynReceive` | 실시간 팩에는 없고 **5분 집계에만** 담긴다 — NScouter 는 «호스트 · 5분 집계» 에 그린다 | 코드·실측 F-42 |
| 호스트 `NetRxBytes`·`NetTxBytes`·`DiskReadBytes`·`DiskWriteBytes` | 에이전트가 계산만 하고 어디에도 담지 않는다 (2.21.3 미완성 기능) | 코드·실측 F-42 |

---

## 5. 서버 종류와 이름

### 5.1 WAS 로 안 잡힌다

에이전트가 정하는 종류(objType)는 이 순서다 (코드: 에이전트 `Configure`):

1. [에] `monitoring_group_type` 이 있으면 그것
2. 없으면 [에] `obj_type` (공식 문서상 `monitoring_group_type` 의 별칭 · deprecated)
3. 둘 다 없으면 에이전트가 감지한 값 (`tomcat` 등, 못 알아보면 `java`)

#### 커스텀 종류도 WAS 로 잡힌다

`ORDER-JVM` 처럼 시스템 이름을 종류에 넣어도 **콜렉터가 Family 를 안다.** 처음 보는 종류의 에이전트가
붙으면 콜렉터가 에이전트의 `tags.detected`(스스로 감지한 `tomcat` 등)의 Family 를 물려받아 새 종류로
등록하고 사이트 정의(`counters.site.xml`)에 쓴다 (코드: `CounterManager.addObjectTypeIfNotExist`).

NScouter 는 접속할 때 그 표(`GET_XML_COUNTER`)를 받아 WAS·호스트를 가른다. 표에 없으면 에이전트의
`detected` 태그로, 그것도 없으면 이름 목록(`tomcat`·`java`·`jboss`·`jetty`·`resin` / `linux` 등)으로 가른다.

**실측** — 테스트 에이전트에 `monitoring_group_type=SHOP-JVM` 을 걸자 **재시작 없이** 종류가 `SHOP-JVM` 으로
바뀌고, 사이트 정의에 `SHOP-JVM → javaee` 가 생겼다. 그 상태에서 NScouter 는 WAS 종류를 `SHOP-JVM` · `tomcat`
둘로 잡고 종류마다 물어 합친다 (`live_mixed_object_types`).

> 0.5.3 까지는 이름 목록으로만 갈라서 커스텀 종류의 서버가 Active 탭·카운터에서 **통째로 빠졌다.**
> 또 WAS 종류가 여럿이면 **첫 종류 하나만** 물어서, 이름 목록에 있는 종류끼리도(`tomcat`·`java`) 섞이면 나머지가 빠졌다.

#### 종류가 여럿일 때 합치는 방식

종류 단위로만 물을 수 있는 것(요약·토폴로지·액티브·오늘/과거 카운터·5분 집계)은 **종류마다 물어 합친다.**

| 무엇 | 합치는 법 | 근거 |
|---|---|---|
| 서비스·SQL·API 요약 | 같은 id 끼리 호출·에러·시간·CPU·메모리를 **더한다** | 콜렉터도 5분 조각을 합칠 때 같은 칸을 더한다 (코드: `SummaryService` — `iadd`/`ladd`) |
| 에러 요약 | 건수만 더하고 대표 트랜잭션은 먼저 온 것 | 대표는 «이런 건이 있었다» 를 보이는 한 건이다 |
| 액티브 합계·TPS | 더한다 | 콜렉터의 합계도 그 종류의 오브젝트들을 더한 것이다 |
| 오브젝트별 값(액티브·카운터·호출 관계) | 이어 붙인다 | 한 오브젝트는 한 종류에만 있다 |
| **방문자** | 더하되 **«종류별 합»** 이라고 적는다 | 고유 사용자 수라 같은 사용자가 여러 시스템을 거치면 **두 번 센다** — 정확한 수가 아니다 |

### 5.2 이름이 같은 서버

서버를 가리키는 해시(objHash)는 **이름에서만** 만들어진다 (코드: `objHash = HashUtil.hash(objName)`).
개발·운영 콜렉터에 같은 [에] `obj_name` 이 있으면 해시가 같다. NScouter 는 서버를 갈아탈 때 받아 둔 XLog 를 비우므로 화면이 섞이지는 않지만,
**왼쪽에서 고른 서버가 갈아탄 콜렉터에서도 골라진 채로 남는다** — 새 목록에 같은 해시가 있으면 선택을 지우지 않기 때문이다.
환경을 구별하려면 이름을 다르게 둔다.

---

## 6. 과거 조회 · 넓은 검색

### 6.1 넓은 검색이 500건에서 멈춘다

[콜] `req_search_xlog_max_count` (기본 `500`). 여기에 닿으면 콜렉터가 **아무 표시 없이** 멈춘다 —
«500건이 전부» 와 «500건에서 잘림» 이 응답으로는 구별되지 않는다 (코드·실측 F-54).
올리면 한 번에 더 받지만, 콜렉터는 상한까지 구간을 계속 읽고 조건을 단축 평가하지 않으므로 **디스크 읽기가 는다.**
NScouter 는 상한에 닿으면 결과에 경고를 단다.

### 6.2 며칠 지난 데이터가 없다

콜렉터가 자동으로 지운다 (공식).

| 설정 | 기본 |
|---|---|
| [콜] `mgr_purge_profile_keep_days` | `10` 일 — **프로파일이 먼저** 지워진다 |
| [콜] `mgr_purge_xlog_keep_days` | `30` 일 |
| [콜] `mgr_purge_counter_keep_days` | `70` 일 |
| [콜] `mgr_purge_disk_usage_pct` | `80` % — 넘으면 오늘 것을 뺀 프로파일부터 지운다 |

XLog 점은 보이는데 열면 프로파일이 비어 있으면 첫 줄을 의심한다. NScouter 가 되살리려던 상세 탭을 못 여는 것도 이 때문이다.

---

## 7. 오브젝트 작업 (덤프)

스레드 덤프·힙 히스토그램은 에이전트가 JVM attach API 를 쓴다. 앱이 **JRE** 로 돌면 `jdk.attach` 모듈이 없어
파일이 **크기 0** 으로 만들어진다 (실측 F-25 후속: `eclipse-temurin:17-jre` → `17-jdk` 로 바꾸자 47KB).

- 앱을 **JDK** 로 실행한다
- [JVM] `-Djdk.attach.allowAttachSelf=true` (테스트 환경은 원래 걸려 있었다 — 플래그가 아니라 모듈이 없었다)

---

## 8. 콜렉터 운영

### 8.1 JDK 11 이상에서 안 뜬다

번들된 JAXB 가 JDK 11 에서 없어진 API 를 찾다 실패한다. 기동 명령에 붙인다 (실측 F-6):

```
--add-opens=java.base/java.lang=ALL-UNNAMED
--add-exports=java.base/sun.net=ALL-UNNAMED
```

### 8.2 포트

| 포트 | 프로토콜 | 용도 |
|---|---|---|
| 6100 | TCP | NScouter 접속 · 에이전트 |
| 6100 | UDP | 에이전트 성능 지표 |
| 6180 | TCP | 내장 웹 서버. `net_http_server_enabled=false` 여도 **뜬다** |

(실측 F-8)

### 8.3 로그

[콜] `log_dir` (기본 `./logs`) 아래 `server-yyyyMMdd.log`. 보관 기간 `log_keep_days` (기본 31일). (실측·공식)

### 8.4 임계치 알람이 안 생긴다

테스트 환경에서는 알람 규칙 스크립트(`ErrorRate.alert`)가 기동 때 **컴파일에 실패**해 임계치 알람이 생기지 않았다
(로그 `[A1601] error on toClass with javassist`). 원인은 패키지 불일치라 `--add-opens` 로는 풀리지 않았다 (실측 F-16).
서버 켜짐·꺼짐 같은 생명주기 알람은 규칙과 무관하게 정상으로 온다. 운영 환경에서도 같은지는 확인하지 않았다 —
기동 로그에 `A1601` 이 있는지 본다.

---

## 9. NScouter 앱

앱 설정(버퍼 상한·바인딩 표시·글자 크기·자동 연결 등)은 [사용자 가이드 §8](user-guide.md#8-설정-) 에 있다.
여기에는 스카우터 설정과 얽히는 것만 적는다.

| 앱 설정 | 얽히는 것 |
|---|---|
| XLog 버퍼 상한 (기본 100,000 · 약 37MB) | 범위를 넓히고 트래픽이 많으면 먼저 걸린다. 1.1 의 샘플링과 헷갈리지 않게 — 버퍼 상한은 차트에 경고가 뜬다 |
| SQL 바인딩 파라미터 (채우기 기본) | 2.3 의 잘린 값도 그대로 채운다. 복사해 실행하기 전 확인 |
| 자동 연결 | 비밀번호가 `config.json` 에 **평문**으로 남는다 |
