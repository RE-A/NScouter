# NScouter 결함 목록 (테스트 환경에서 발견)

| ID | 내용 | 상태 |
|---|---|---|
| N-1 | 오브젝트 목록 커맨드명 오류 | 수정됨 |
| N-2 | XLog 요청 `count` 파라미터 누락 | 수정됨 |
| N-3 | TCP 연결 재사용 불가 | 수정됨 |
| N-4 | ObjectPack 필드 순서 오류 | 수정됨 |
| N-5 | PerfCounterPack `time` 타입 오류 | 수정됨 2026-08-30 (mock 회귀 확보) |
| N-6 | AlertPack 필드 순서·타입 오류 4건 | 수정됨 2026-08-15 (실측 검증) |
| N-7 | 카운터 키 이름이 실제 카운터명과 다름 | 수정됨 2026-08-15 |
| N-8 | 카운터 요청 파라미터·응답 팩 타입 오류 | 수정됨 2026-08-15 |
| N-9 | 알람 스트림에 커서 없음 — 같은 알람 무한 중복 | 수정됨 2026-08-15 |
| N-10 | 스트림 3종이 중지 플래그 1개를 공유 | 수정됨 2026-08-15 |
| N-11 | XLogProfilePack 필드 순서 오류 (`time`/`service` 누락) | 수정됨 2026-08-15 |
| N-12 | 프로파일 Step 파싱 — 5종 중 3종 필드 오류 | 수정됨 2026-08-15 |
| N-13 | 스캐터 점 단일 클릭이 미구현 (드래그만 동작) | 수정됨 2026-08-15 |
| N-14 | 상세 패널이 차트 패널 뒤에 가려짐 | 수정됨 2026-08-15 |
| N-15 | 창을 키워도 플로팅 패널이 따라오지 않음 | 수정됨 2026-08-15 |
| N-16 | 프로파일 응답을 `txid` 로 걸러 **전부 버림** | 수정됨 2026-08-15 |
| N-17 | 상세 패널이 차트를 덮어 하단 목록까지 가림 | 수정됨 2026-08-15 |
| N-18 | 텍스트 딕셔너리가 **하나도 안 풀림** (Hexa32 키) | 수정됨 2026-08-15 |
| N-19 | `body` 기본 margin 8px 로 레이아웃이 창 밖으로 밀림 | 수정됨 2026-08-15 |

실제 Scouter Collector 2.21.3 에 붙여서 확인한 것만 기록한다.
근거와 실측 로그는 [PLAN.md](PLAN.md) 1.2.1절 참조.

**상태: 4건 모두 수정 완료 (2026-08-13).** 실서버 대상 테스트로 검증했다.

```
cd Test && .\scripts\up.ps1 && .\scripts\load.ps1
cd src-tauri && cargo test --test live_collector -- --ignored --nocapture
```

---

## N-1. 오브젝트 목록 커맨드명 오류 — 수정됨

| | |
|---|---|
| 파일 | `src-tauri/src/scouter/protocol.rs` |
| 수정 전 | `CMD_GET_OBJECT_LIST_REAL_TIME = "GET_OBJECT_LIST_REAL_TIME"` |
| 수정 후 | `CMD_OBJECT_LIST_REAL_TIME = "OBJECT_LIST_REAL_TIME"` |
| 근거 | `scouter.common` `RequestCmd.java` 에 `GET_` 접두 커맨드는 없음 |
| 증상 | 콜렉터가 응답 없이 TCP 연결 종료 → `get_object_list` 항상 실패 |

`commands.rs`, `mock_server.rs`, `tests/scouter_integration.rs` 의 사용처도 함께 변경.
NScouter가 쓰는 나머지 커맨드 9개는 `RequestCmd.java` 와 전부 일치한다 (대조 완료).

---

## N-2. XLog 요청에 `count` 파라미터 누락 — 수정됨

| | |
|---|---|
| 파일 | `src-tauri/src/scouter/streaming.rs` — `build_request_param()` |
| 수정 전 | `objHash` / `loop` / `index` |
| 수정 후 | `count = 10000` 추가 (`XLOG_RETRIEVE_LIMIT` 상수) |
| 근거 | `scouter.webapp` `XLogConsumer.handleRealTimeXLog()` 의 `firstRetrieveLimit` |

실측 — 다른 조건 동일, 파라미터만 변경:

| 요청 파라미터 | 수신 XLog |
|---|---|
| `objHash` + `loop` + `index` + `count` | **143건** |
| `objHash` + `loop` + `index` | **0건** |

에러 없이 조용히 0건이 온다. 스캐터에 점이 하나도 안 찍히는 증상.

---

## N-3. TCP 연결 재사용 — 수정됨

| | |
|---|---|
| 파일 | `src-tauri/src/scouter/connection.rs` |
| 수정 전 | 연결 1개를 로그인·스트리밍 폴링·텍스트 조회·오브젝트 목록에 계속 재사용 |
| 수정 후 | `send_request()` 가 전송 직전에 소켓을 새로 연다 (`reopen()`) |

**콜렉터는 연결당 명령을 1개만 처리하고 끊는다.** 실측:

```
같은 연결에서 OBJECT_LIST_REAL_TIME 연속 호출
  1회차: pack 2건 - OK
  2회차: 연결 종료
  3회차: 연결 종료
```

로그인을 별도 연결에서 하고 세션만 재사용해도 동일했다.
세션 토큰 자체는 소켓과 무관하게 재사용 가능하다.

**구현 선택**: `ScouterConnection` 에 `host` / `port` 를 들려두고 `send_request()` 안에서
소켓을 다시 연다. 호출부는 `send_request` → `read_next_pack` 루프를 그대로 쓰면 되므로
`commands.rs` / `streaming.rs` / `dictionary.rs` 는 한 줄도 바꾸지 않았다.

---

## N-4. ObjectPack 필드 순서 오류 — 수정됨

**N-1 을 고친 뒤 실제 응답을 받아보고 나서야 드러난 결함이다.**

| | |
|---|---|
| 파일 | `src-tauri/src/scouter/connection.rs` — `read_object_pack()` |
| 수정 전 | `objHash`, `objType`, `objName`, `address`, `version`, `alive` |
| 수정 후 | `objType`, `objHash`, `objName`, `address`, `version`, `alive`, `wakeup`, `tags` |
| 근거 | `scouter.lang.pack.ObjectPack.read(DataInputX)` |

문제가 두 개였다.

1. `objType` 과 `objHash` 의 순서가 뒤바뀌어 있었다.
2. 뒤쪽 `wakeup`(decimal) 과 `tags`(MapValue) 를 읽지 않아 스트림에 바이트가 남았다.
   오브젝트가 2개 이상이면 두 번째부터 파싱이 깨진다.

실제 실패 로그:

```
FromUtf8Error { bytes: [231, 107, 18, 47, 115, 104, 111, 112, 45, 97, 112, 112, ...] }
```

`read_decimal()` 이 첫 바이트 `6`(= "tomcat" 텍스트 길이)을 길이 지시자로 읽고
`readLong()` 분기를 타면서 8바이트를 삼켜 위치가 어긋난 것이다.

**이 결함이 그동안 안 잡힌 이유**: `mock_server.rs` 의 오브젝트 목록 응답이 ObjectPack 이 아니라
MapPack 을 돌려준다. 그래서 `tests/scouter_integration.rs` 의 `test_get_object_list` 는
통과하면서도 실제 ObjectPack 파싱 경로를 전혀 검증하지 못했다.

---

## N-5. PerfCounterPack `time` 필드 타입 오류 — 수정됨 (2026-08-30)

**N-4 와 같은 계열.** ASIS 소스 대조로 발견했다.

| | |
|---|---|
| 파일 | `src-tauri/src/scouter/connection.rs` — `read_perf_counter_pack()` |
| 근거 | [`PerfCounterPack.java`](../ASIS/scouter-master/scouter.common/src/main/java/scouter/lang/pack/PerfCounterPack.java) `read(DataInputX)` |

| 필드 | ASIS | NScouter | 판정 |
|---|---|---|---|
| `time` | `readLong()` — **고정 8바이트** | `read_decimal()` — **가변 길이** | **불일치** |
| `objName` | `readText()` | `read_text()` | 일치 |
| `timetype` | `readByte()` | `read_byte()` | 일치 |
| `data` | `readValue()` | `read_value()` | 일치 |

`readDecimal()` 은 `[길이 1바이트][값 N바이트]` 구조라 8바이트 고정값을 읽으면 위치가 어긋난다.
**첫 필드가 깨지므로 팩 전체가 무의미해진다.** 카운터 차트가 값을 못 받거나 쓰레기값을 받는다.

### 실서버 없이 재현했다

«유닛 테스트를 하려면 파싱과 소켓을 떼어야 한다» 고 적어 뒀지만, **떼지 않고도**
mock 서버로 세울 수 있었다 — 실제 콜렉터가 쓰는 것과 같은 바이트를 보내면 된다.

`MOCK_PERF_COUNTER` 응답을 mock 에 넣고(`writeLong` 으로 `time` 을 씀) L3 테스트를
붙이자 고치기 전에 이렇게 깨졌다:

```
알 수 없는 ValueEnum 타입 코드: 0xA0
```

`time` 한 필드가 밀리면서 뒤의 `objName`·`timetype` 을 지나 값 타입 코드 자리까지
어긋난 것이다. `read_decimal()` → `read_long()` 으로 고치니 통과한다.

- 회귀: `perf_counter_pack_의_time_은_8바이트다` (`tests/scouter_integration.rs`)
- **이 경로는 여전히 앱에서 안 쓴다**(N-8 이후 카운터는 MapPack 으로 온다).
  다시 쓰게 될 때 틀린 채로 남아 있지 않도록 고쳐 둔다.

---

## N-6. AlertPack 필드 순서·타입 오류 (4건) — 수정됨 (2026-08-15)

**N-4 와 같은 계열이며 더 심하다.**

| | |
|---|---|
| 파일 | `src-tauri/src/scouter/connection.rs` — `read_alert_pack()` |
| 근거 | [`AlertPack.java`](../ASIS/scouter-master/scouter.common/src/main/java/scouter/lang/pack/AlertPack.java) `read(DataInputX)` |

| 순서 | ASIS | NScouter | 판정 |
|---|---|---|---|
| 1 | `time` = `readLong()` (8바이트 고정) | `time` = `read_decimal()` | **타입 불일치** |
| 2 | `level` = `readByte()` | `objType` = `read_text()` | **순서 뒤바뀜** |
| 3 | `objType` = `readText()` | `objHash` = `read_decimal()` | **순서 뒤바뀜** |
| 4 | `objHash` = `readInt()` (4바이트 고정) | `level` = `read_byte()` | **순서+타입 불일치** |
| 5 | `title` = `readText()` | `title` = `read_text()` | 일치 |
| 6 | `message` = `readText()` | `message` = `read_text()` | 일치 |
| 7 | `tags` = `readValue()` | **읽지 않음** | **누락** |

`tags` 누락은 N-4 의 `wakeup`/`tags` 누락과 정확히 같은 문제다.

### 실서버에서 그대로 터졌다

사용자가 접속하자 앱 로그에 2초마다 찍혔다.

```
[WARN] 알림 폴링 오류: invalid utf-8 sequence of 1 bytes from index 0
```

RED 테스트(`live_alert_pack_fields`)가 같은 오류를 재현했고, 실패 바이트가 구조를 그대로 보여줬다.

```
[0, 7,'s','c','o','u','t','e','r', 0,249,192,231, 15,'I','N','A','C','T',...]
 ^  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^  ^^  ^^^^^^^^^^^^^^^^^^
 level     objType (len 7)          objHash int   len  title
```

`0,249,192,231` = BE i32 = 16367847 = order-app 의 objHash.

수정 후:

```
[alert] time=1786721179122 level=0 objType=scouter objHash=16367847 title="INACTIVE_OBJECT"
[alert] time=1786721272482 level=0 objType=scouter objHash=16367847 title="ACTIVATED_OBJECT"
=> 알람 2건 정상 파싱
```

### 알람을 만드는 법 — F-16 정정

처음엔 "이 환경은 알람을 못 만든다"고 적었는데 **틀렸다.**
`ALERT_REAL_TIME` 에 `objType=tomcat` 을 줘서 걸러졌던 것이다.
오브젝트 생명주기 알람은 **`objType=scouter`**(콜렉터 자신)로 온다.

```powershell
podman stop order-app    # → INACTIVE_OBJECT
podman start order-app   # → ACTIVATED_OBJECT
```

임계치 알람(ErrorRate)은 여전히 규칙 컴파일 실패로 안 나온다(F-16).
하지만 **프로토콜 검증에는 생명주기 알람으로 충분하다.**

## N-8. 카운터 요청 파라미터·응답 팩 타입 오류 — 수정됨 (2026-08-15)

**N-5/N-6 을 조사하다 드러난 더 큰 결함.** 카운터 기능이 통째로 동작하지 않았다.

| | |
|---|---|
| 파일 | `src-tauri/src/commands.rs` — `poll_counter_once()` |
| 근거 | [verified-facts.md F-15](../docs/verified-facts.md) (실서버 실측) |

| | 수정 전 | 수정 후 (ASIS) |
|---|---|---|
| 요청 파라미터 | `objHash` 리스트 | `objType` + `counter` (카운터 1개) |
| 기대 응답 | `PerfCounterPack` (type 60) | `MapPack` — `objHash[]` / `value[]` 병렬 리스트 |
| 실제 수신 | **0건** | 오브젝트 수만큼 |

실측 비교 (`Test/scripts/capture_fixtures.py`):

```
[1] objType=tomcat + counter=TPS  → MapPack objHash=[-1585387669, 16367847]
                                              value=[15.47, 7.8]
[2] objHash 리스트만             → 팩 0건 (에러 없음)
```

**F-3 과 같은 실패 양식이다** — 파라미터가 틀리면 에러가 아니라 조용한 0건이다.

수정 범위:
- `src-tauri/src/scouter/counter.rs` 신설 — `build_counter_param()` / `parse_counter_values()`
- `start_counter_stream(objType, counters)` 로 시그니처 변경, 카운터별로 요청
- `counter-data` 이벤트 페이로드를 `CounterUpdate { time, counter, values[] }` 로 교체
- 프론트: `CounterChart` 가 `counter` prop 을 받고 `objHash` 기준으로 계열 분리

### 수정 중 자체 리뷰로 잡은 회귀 2건

**(a) objType 을 오브젝트 목록의 첫 번째에서 집으면 안 된다.**
카운터는 Family 단위로 정의되므로 호스트 에이전트(`linux`)가 함께 붙어 있으면
`TPS` 요청이 조용히 0건이 된다. counters.xml `<Types>` 기준으로 javaee 계열
5종(`tomcat` `java` `jboss` `jetty` `resin`)만 고르도록 고쳤다.
검증: `src/features/xlog/types/counter.test.ts`

**(b) 카운터 시작을 `AgentSelectorPanel` 에 의존하면 안 된다.**
이 패널은 **XLog 탭에서만 마운트**된다. 처음 수정본은 패널의 `onAgentsLoaded` 로
objType 을 받았는데, 그러면 다른 탭에서 접속했을 때 카운터가 영영 시작되지 않는다.
`App` 이 접속 시 `getObjectList()` 를 직접 호출하도록 바꿨다.

> 폴링 비용: 카운터 4개 × 2초 = 초당 TCP 연결 2회. F-1(연결당 명령 1개) 때문에
> 요청마다 소켓을 새로 연다. 카운터를 늘리면 비례해 늘어난다.

### N-7. 카운터 키 이름이 Scouter 실제 카운터명과 다름 — 수정됨 (2026-08-15)

`src/features/xlog/types/counter.ts` 의 `CounterKey`:

| NScouter | Scouter 실제 (counters.xml) | 판정 |
|---|---|---|
| `'tps'` | `TPS` | 대소문자 불일치 |
| `'cpu'` | `Cpu` | 대소문자 불일치 |
| `'heap_used'` | `HeapUsed` | 표기 불일치 |
| `'gc_count'` | `GcCount` | 표기 불일치 |
| `'error_rate'` | `ErrorRate` | 표기 불일치 |
| `'elapsed_avg'` / `'elapsed_max'` | `ElapsedTime` / `Elapsed90%` | **존재하지 않는 이름** |
| `'activespeed'` | — | **카운터가 아님** (ActiveSpeed 는 *뷰* 이름) |

**수정**: `src/features/xlog/types/counter.ts` 에 counters.xml 의 javaee 카운터 19개를
`JAVAEE_COUNTERS` 상수로 옮기고 `CounterName` 타입으로 고정했다. 오타는 컴파일 에러가 된다.

실측으로 대소문자 민감성을 확인했다 (`live_counter_name_is_case_sensitive`):

```
=> TPS=2건, tps=0건
```

확정 목록: [15-inventory-source-of-truth.md](../docs/asis/15-inventory-source-of-truth.md)

---

## N-9. 알람 스트림에 커서가 없다 — 수정됨 (2026-08-15)

**사용자가 접속한 화면에서 드러났다.** 알람 배지가 14인데 실제 알람은 2건뿐이었다.

| | |
|---|---|
| 파일 | `src-tauri/src/commands.rs` — `poll_alert_once()` |
| 근거 | ASIS [`AlertConsumer.java:40`](../ASIS/scouter-master/scouter.webapp/src/main/java/scouterx/webapp/layer/consumer/AlertConsumer.java#L40) |

```rust
let param = MapPack::new();   // 수정 전: loop/index 없음 → 매번 처음부터
```

응답 MapPack 에 `loop`/`index` 가 오는데 버리고 있었다. XLog 에는 `StreamCursor` 가
있는데 알람에만 빠져 있었다. **2초마다 같은 알람이 다시 와서 화면에 무한 누적된다.**

수정: `src-tauri/src/scouter/alert.rs` 신설, `build_alert_param(cursor)` 로 커서 전달.

```
1회차 알람 2건, 커서 loop=0 index=2
2회차 알람 0건 (커서 index=2)
```

> `objType` 파라미터는 **일부러 넣지 않는다.** 넣으면 그 타입 알람만 오는데
> 오브젝트 생명주기 알람은 `objType=scouter` 라서 사라진다 (F-16).

---

## N-10. 스트림 3종이 중지 플래그 1개를 공유 — 수정됨 (2026-08-15)

| | |
|---|---|
| 파일 | `src-tauri/src/state.rs`, `commands.rs` |

`AppState.stream_stop` 하나를 XLog/카운터/알람이 같이 봤다. 문제 두 가지.

1. **`stop_xlog_stream()` 이 카운터·알람까지 멈춘다.**
2. **같은 스트림을 두 번 시작하면 태스크가 둘 다 산다.** 이전 것을 멈출 방법이 없다.

2번이 실제로 일어나고 있었다. `main.tsx` 의 `React.StrictMode` 가 dev 에서 effect 를
두 번 실행해 **모든 로그가 정확히 2번씩 찍히고 TCP 연결이 8회** 열렸다.

수정: `StreamTokens` 도입. `take_token(kind)` 가 **이전 토큰을 중지시키고** 새 토큰을 준다.

```rust
let stop_flag = state.streams.take_token(StreamKind::Counter).await;
```

검증: `cargo test --lib state::` 3건
(이전 토큰 중지 / 스트림 독립성 / `stop_all`)

---

## N-11. XLogProfilePack 필드 순서 오류 — 수정됨 (2026-08-15)

| | |
|---|---|
| 파일 | `src-tauri/src/scouter/connection.rs` — `read_xlog_profile_pack()` |
| 근거 | [`XLogProfilePack.java`](../ASIS/scouter-master/scouter.common/src/main/java/scouter/lang/pack/XLogProfilePack.java) |

```
ASIS      time(decimal), objHash(decimal), service(decimal), txid(long), profile(blob)
수정 전    txid(long), objHash(decimal), profile(blob)
```

`time` 과 `service` 를 안 읽어 **팩 경계가 어긋났다.** 증상은 다음 팩에서 터진다.

```
프로파일 응답 파싱 실패: "예상치 못한 TcpFlag: 0x00"
```

`XLogProfilePack2`(27)의 추가 필드도 틀렸다.
ASIS 는 `gxid(long), xType(byte), discardType(byte), ignoreGlobalConsequentSampling(bool)`
인데 `elapsed/count/total` 3개 decimal 로 읽고 있었다.

---

## N-12. 프로파일 Step 파싱 — 실제 오는 5종 중 3종이 틀림 — 수정됨 (2026-08-15)

| | |
|---|---|
| 파일 | `src-tauri/src/scouter/profile.rs` — `read_step()` |
| 근거 | ASIS [`scouter.lang.step.*`](../ASIS/scouter-master/scouter.common/src/main/java/scouter/lang/step/) `read(DataInputX)` |

실측(`Test/scripts/profile_check.py`)상 실제로 오는 타입과 판정:

| Step | ASIS 필드 | 수정 전 | 판정 |
|---|---|---|---|
| METHOD (1) | hash, elapsed, cputime | hash 만 | **2개 미읽음** |
| HASHED_MESSAGE (9) | hash, time, value | 동일 | 정상 |
| SQL3 (16) | hash, elapsed, **cputime**, param, error, xtype(byte), updated | hash, param, elapsed, error, updated, sql_crud(text) | **순서·타입 전부** |
| MESSAGE (3) | message | 동일 | 정상 |
| APICALL (6) | **txid(decimal)**, hash, elapsed, cputime, error, opt(byte), [address] | hash, elapsed, error, txid(**long**) | **순서·타입 전부** |

두 번째 Step(METHOD)부터 어긋나므로 **프로파일 전체가 쓰레기**였다.

핵심 함정 3가지.

1. **상속 체인을 펼쳐야 한다.** `SqlStep3 → SqlStep2 → SqlStep` 이라 부모 필드가 먼저 온다.
2. **`txid` 는 `readDecimal`(가변)이다.** `readLong`(8바이트 고정)이 아니다 — N-5/N-6 과 같은 계열.
3. **`opt` 바이트가 1일 때만 `address` 가 따라온다.** 무조건 읽으면 어긋난다.

### 미구현 타입은 에러로 만들었다

수정 전에는 모르는 타입에 `Ok(Unknown)` 을 돌려주고 **본문을 소비하지 않았다.**
그러면 다음 Step 부터 전부 깨지는데 조용히 넘어간다. 이제 명시적으로 실패시킨다.

```rust
_ => Err(io::Error::new(
    io::ErrorKind::InvalidData,
    format!("미구현 Step 타입 {step_type} — 본문 길이를 몰라 이후 파싱 불가"),
)),
```

DumpStep(12) / DispatchStep(13) / ThreadSubmitStep(7) / ThreadCallPossibleStep(14) /
StepControl(99) 은 값은 안 쓰더라도 **바이트는 정확히 소비**하도록 채웠다.
SPAN(51)/SPANCALL(52) 은 미구현이라 위 에러로 걸린다.

---

## N-13. 스캐터 점 단일 클릭이 미구현 — 수정됨 (2026-08-15)

| | |
|---|---|
| 파일 | `src/features/xlog/hooks/useXLogCanvas.ts` — `onMouseUp()` |

드래그 영역 선택은 되는데 **점 하나를 클릭하면 아무 일도 안 났다.**
프로파일을 여는 유일한 경로가 막혀 있었던 셈이다.

```js
// 수정 전
if (renderer && Math.abs(x-startX) > 3 && Math.abs(y-startY) > 3) {
    /* 드래그 */
} else {
    setSelection(null);
    setSelectedXLogs([]);   // ← 클릭은 선택을 비우기만 한다
}
```

문제 두 가지.

1. **클릭 분기가 없다.** 점을 찾는 코드 자체가 없었다.
   `getXLogIndexAt()` 은 **정확히 같은 픽셀**만 조회해서 클릭에는 쓸 수 없다
   (점이 2~4px 이라 정확히 맞출 수 없다).
2. **드래그 판정이 `&&`.** 가로로만 끌면 드래그로 인식되지 않았다. `||` 로 고쳤다.

수정: `src/features/xlog/engine/pixelQuery.ts` 의 `findNearestPixel()` 신설 —
반경 안에서 **가장 가까운** 점을 고른다. 캔버스가 필요 없는 순수 함수라 L1 로 검증한다
(`pixelQuery.test.ts` 7건). 클릭 1건 선택 시 `App.handleXLogSelect` 가
이미 `fetchDetail()` 을 호출하므로 프로파일이 바로 열린다.

경계 처리도 테스트로 고정했다 — 캔버스 왼쪽 끝에서 `x-radius` 가 음수가 되면
픽셀키가 **이웃 행의 오른쪽 끝**을 가리켜 엉뚱한 점이 잡힌다.

---

## N-14. 상세 패널이 차트 패널 뒤에 가려짐 — 수정됨 (2026-08-15)

| | |
|---|---|
| 파일 | `src/App.tsx` — `openDetail()` |

점을 클릭해도 프로파일이 안 보였다. 두 가지가 겹쳤다.

1. **두 패널이 완전히 겹친다.**
   차트 `x: 225 ~ wsSize.w-5`, 상세 `x: wsSize.w-325 ~ wsSize.w-5` — 상세가 차트 영역 안이다.
2. **클릭이 차트를 앞으로 보낸다.**
   `FloatingPanel` 의 `onMouseDown={onFocus}` 가 **바깥 div 전체**에 걸려 있어
   캔버스를 클릭해도 `bringToFront('chart')` 가 돈다.

```
점 클릭 → mousedown → bringToFront('chart')  → 차트 z=12, 상세 z=11
        → mouseup  → fetchDetail            → 상세가 열리자마자 차트 뒤로
```

**수정**: 상세를 여는 경로(`openDetail`)에서 `bringToFront('detail')` 을 함께 호출한다.
mousedown 이 먼저, mouseup 이 나중이라 순서가 보장된다.

> 처음엔 `onFocus` 가 제목 표시줄에만 걸린 줄 알았다. 바깥 div 에도 있어서
> **본문 클릭이 전부 트리거**였다. 이걸 확인하지 않았으면 원인을 못 찾았다.

---

## N-15. 창을 키워도 패널이 따라오지 않음 — 수정됨 (2026-08-15)

| | |
|---|---|
| 파일 | `src/App.tsx`, `src/components/FloatingPanel.tsx`, `rescaleRect.ts` |

`wsSizeSet.current` 가드로 워크스페이스를 **최초 1회만** 측정했다.
창을 키우면 패널이 옛 크기 그대로라 우측·하단에 빈 공간이 남는다.

단순히 가드를 없애면 안 된다. 패널 `key` 에 `wsSize.h` 가 들어 있어
**리사이즈마다 리마운트 → `useXLogStream` 재생성 → 스트림 끊김 + 누적 점 전부 소실**이다.

**수정**: `key` 를 고정하고 `workspace` prop 으로 크기를 넘긴다.
`FloatingPanel` 이 `rescaleRect()` 로 rect 만 비례 조정한다 — 리마운트 없음.

`rescaleRect` 는 순수 함수라 L1 로 검증한다 (7건). 경계 조건 3가지를 테스트로 고정했다.

| 조건 | 안 지키면 |
|---|---|
| 최소 크기 하한 | 패널이 사라진다 |
| 워크스페이스 경계 안으로 | 밖으로 밀려나 잡을 수 없다 |
| 이전 크기 0 방어 | 0으로 나눠 NaN → 화면에서 사라진다 |

---

## N-16. 프로파일 응답을 `txid` 로 걸러 전부 버림 — 수정됨 (2026-08-15)

**N-11/N-12 로 파싱을 다 고쳤는데도 화면에는 "프로파일 없음"이 떴다.**

| | |
|---|---|
| 파일 | `src-tauri/src/commands.rs` — `get_xlog_profile()` |

```rust
Some(AnyPack::Profile(p)) => {
    if p.txid == txid_i64 {   // ← 여기서 전부 탈락
```

**콜렉터는 프로파일 응답의 헤더 필드를 채우지 않는다.** 실측:

```
packType=26 time=0 objHash=0 service=0
  응답 txid = 0
  요청 txid = 6390450414896274341
  일치? False        ← blob 은 52바이트로 정상 수신
```

요청 자체가 txid 단위라 응답도 그 txid 것이 맞다.
ASIS `ProfileConsumer.retrieveProfilePack()` 도 검사하지 않는다.

**수정**: 필터 제거. 응답에 없는 `txid`/`objHash` 는 요청 값으로 채운다.
검증: `live_profile_pack_header_is_empty`

> **L4 테스트가 있었는데도 놓쳤다.** `live_xlog_profile_steps` 는 팩을 직접 읽어
> steps 를 세는데, 프로덕션 경로에만 있는 txid 필터를 지나지 않았다.
> **테스트가 프로덕션과 다른 길을 가면 그 차이만큼 구멍이 남는다.**

---

## N-17. 상세 패널이 차트를 덮어 하단 목록까지 가림 — 수정됨 (2026-08-15)

N-14 로 z-order 는 고쳤지만 **겹치는 구조 자체는 그대로**여서
상세를 열면 차트 우측과 하단 XLog 목록이 가려졌다.

**수정**: 배치 계산을 `App` 의 `layout` 하나로 모으고,
`FloatingPanel` 에 `layoutRect` prop 을 추가해 App 이 배치를 지시한다.

```
상세 닫힘: [Services 220][      Chart      ]
상세 열림: [Services 220][ Chart ][Detail 320]
```

`workspace`(리사이즈 비례 조정)와 역할이 다르다.

| prop | 역할 |
|---|---|
| `workspace` | 창 크기 변화에 맞춰 **사용자가 옮긴 위치를 유지한 채** 비례 조정 |
| `layoutRect` | App 이 지시하는 배치. 값이 바뀔 때만 적용 |

---

## N-18. 텍스트 딕셔너리가 하나도 안 풀림 — 수정됨 (2026-08-15)

화면에 서비스명·SQL·메서드가 전부 `[0x-17ebcaf0]` 같은 해시로 나왔다.

| | |
|---|---|
| 파일 | `src-tauri/src/scouter/dictionary.rs` — `fetch_chunk()` |
| 근거 | [F-21](../docs/verified-facts.md), ASIS `scouter.util.Hexa32` |

**서버는 텍스트를 제대로 보내고 있었다.** 응답 키가 Hexa32 인데 10진수로 파싱했다.

```rust
if let Ok(hash) = key.parse::<i32>() {   // "z1pa9p0" → 항상 Err → 전부 버림
```

```
{'z1pa9p0': '/shop/api/products/{id}<GET>', 'x1jrf6b3': '/shop/lab/error<GET>'}
```

수정: `hexa32_to_i64()` 신설 (L2 5건). 실서버 응답 키를 그대로 테스트에 박았다.

### 프론트 결함 2건도 함께

1. **`service` 를 아예 조회하지 않았다.** `useXLogDetail` 이 method/sql/apicall/error 만 불렀다.
   XLog 목록도 `getCached('service')` 만 써서 **누가 채워주지 않으면 영원히 해시**였다.
2. **`HashedMessageStep` 을 `method` 타입으로 조회했다.**
   ASIS `TextTypes.HASH_MSG` = **`hmsg`** 다. 주석에는 "hashMsg 타입으로 조회"라고
   적혀 있었는데 코드는 `method` 로 넣고 있었다.

---

## N-19. `body` 기본 margin 으로 레이아웃이 창 밖으로 밀림 — 수정됨 (2026-08-15)

**"하단 XLog 목록이 차트 뒤에 가려진다"의 진짜 원인.**

`src/App.css` 가 **어디에서도 import 되지 않아** 브라우저 기본값이 적용됐다.

```
body { margin: 8px }      ← 브라우저 기본
appStyle { height: 100vh }
```

`100vh` + 상하 8px = 실제 높이가 창보다 16px 크다. 결과:

- 화면이 우/하로 밀려 좌측 `SERVICES` 가 `ERVICES` 로 잘림
- 스크롤바 발생
- **패널 하단(XLog 목록)이 창 밖으로 나감**

수정: `index.html` 에 `html, body, #root { margin:0; padding:0; height:100%; overflow:hidden }`.

목록 높이도 고정 220px → `min(260, max(120, 패널높이×0.35))` 로 바꿨다.
고정값이면 창이 작아질 때 또 잘린다.

> **같은 증상을 세 번 다르게 진단했다.** z-order(N-14) → 겹치는 배치(N-17) → 실제로는 CSS.
> 앞의 둘도 진짜 결함이라 고친 건 낭비가 아니지만,
> **스크린샷에서 "글자가 잘렸다 / 스크롤바가 있다"는 신호를 더 빨리 읽었어야 했다.**

---

## 검증

`src-tauri/tests/live_collector.rs` 추가 (기본 실행에서는 `#[ignore]`).

| 테스트 | 검증 대상 | 결과 |
|---|---|---|
| `live_object_list` | N-1, N-4 | 오브젝트 2건 정상 수신 |
| `live_sequential_requests` | N-3 | 같은 연결로 3회 연속 요청 성공 |
| `live_xlog_stream` | N-2, N-3 | XLog 10000건 수신, 커서 `loop=2 index=3841` |
| `live_counter_real_time_all` | N-8 | TPS 2건 수신 (`objHash` 가 오브젝트 목록과 일치) |
| `live_counter_name_is_case_sensitive` | N-7 | `TPS`=2건 / `tps`=0건 |
| `live_alert_pack_fields` | N-6 | 알람 2건 정상 파싱 |
| `live_alert_cursor_advances` | N-9 | 1회차 2건 → 2회차 0건 |
| `live_xlog_profile_steps` | N-11, N-12 | 프로파일 5건 / Step 120개 정상 파싱 |
| `live_profile_pack_header_is_empty` | N-16 | 응답 txid=0 확인 (필터 금지 근거) |
| `live_counter_multi` | 카운터 MULTI | 요청 1회로 5종 × 2오브젝트 |
| `live_text_dictionary_types` | N-18 | service 해시 5개 → 텍스트 5개 |

전체 스위트: L1 62건 + L2 18건 + L3 3건 통과, L4 8건은 기본 ignore (실행 시 8건 통과).

> **알람 테스트 2건은 알람 이력이 있어야 통과한다.** 콜렉터를 재생성하면 초기화된다.
> `podman stop order-app; podman start order-app` 으로 다시 만든다.

### 남은 것

**N-6 (AlertPack)** 은 그 뒤 실측으로 닫혔다 — 생명주기 알람(`podman stop/start`)으로
실물 응답을 받아 `live_alert_pack_fields` 가 통과한다. 임계치 알람만 이 환경에서
못 만든다 (F-16).

**N-5 (PerfCounterPack)** 도 mock 회귀로 닫혔다(위). 팩 파싱을 소켓과 분리하는
리팩터링은 **하지 않았다** — mock 이 같은 바이트를 보내 주므로 필요가 없었다.

---

## 남은 관찰 (수정 안 함)

- `open_socket()` 이 `format!("{host}:{port}").parse::<SocketAddr>()` 를 쓴다.
  IP 리터럴만 되고 호스트명(`localhost`, `collector.internal`)은 파싱에 실패한다.
  기존부터 있던 제약이라 이번 수정 범위에 넣지 않았다.
  고치려면 `ToSocketAddrs` 로 바꾸면 된다.
- `mock_server.rs` 의 오브젝트 목록 응답이 실제 ObjectPack 포맷이 아니다 (N-4 참조).
  mock 을 실제 포맷으로 맞추면 live 서버 없이도 회귀를 잡을 수 있다.
