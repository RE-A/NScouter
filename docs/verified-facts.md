# 실측 검증 사실 (Verified Facts)

> **용도**: Claude 참조용. 실제 Scouter Collector 2.21.3에 붙여서 **직접 확인한 것만** 기록한다.
> 추정·전언은 넣지 않는다. 각 항목은 근거와 재현 방법을 함께 둔다.
>
> **읽는 순서**: 프로토콜 구현/수정 전에 F-1~F-5를 먼저 볼 것. 소스 코드나 ASIS 문서와
> 충돌하면 **이 문서가 우선**한다(여기 있는 건 실물로 확인한 값이다).
>
> 검증 환경: [../Test/README.md](../Test/README.md) — `.\scripts\up.ps1` 로 기동.
> 최종 확인: 2026-08-13, Scouter 2.21.3, PostgreSQL 17.10, Java 17.

---

## 프로토콜

### F-1. Collector는 TCP 연결당 명령을 1개만 처리한다

로그인을 별도 연결에서 하고 세션만 재사용해도 동일하다. 두 번째 명령부터 연결이 끊긴다.

```
같은 연결에서 OBJECT_LIST_REAL_TIME 연속 호출
  1회차: pack 2건 - OK
  2회차: 연결 종료
  3회차: 연결 종료
```

- **세션 토큰은 소켓과 무관하게 재사용 가능하다.**
- 정식 Java 클라이언트가 `TcpProxy` + `ConnectionPool` 구조를 쓰는 이유가 이것이다.
- **구현**: `ScouterConnection::send_request()`가 전송 직전 `reopen()`으로 소켓을 새로 연다.
- 재현: `cargo test --test live_collector live_sequential_requests -- --ignored --nocapture`

### F-2. 오브젝트 목록 커맨드명은 `OBJECT_LIST_REAL_TIME`

`GET_` 접두가 붙은 커맨드는 `scouter.common`의 `RequestCmd.java`에 **존재하지 않는다**.
모르는 커맨드를 받으면 Collector는 응답 없이 TCP 연결을 끊는다.

NScouter가 쓰는 커맨드 10개를 `RequestCmd.java`와 대조한 결과, 이것 하나만 틀렸었다.

| 커맨드 | 상태 |
|---|---|
| `LOGIN`, `TRANX_REAL_TIME_GROUP`, `TRANX_REAL_TIME_GROUP_LATEST`, `GET_TEXT_100`, `TRANX_PROFILE`, `XLOG_READ_BY_TXID`, `COUNTER_REAL_TIME_ALL`, `ALERT_REAL_TIME` | 일치 |
| `OBJECT_LIST_REAL_TIME` | 수정됨 (`GET_` 제거) |

### F-3. XLog 실시간 요청에는 `count` 파라미터가 필수다

없으면 **에러 없이 조용히 0건**이 온다. 스캐터에 점이 하나도 안 찍히는 증상이 된다.

| 요청 파라미터 | 수신 XLog |
|---|---|
| `objHash` + `loop` + `index` + `count` | **143건** |
| `objHash` + `loop` + `index` | **0건** |

- 키 이름은 `ParamConstant.XLOG_COUNT` = `"count"`.
- `scouter.webapp`의 `XLogConsumer.handleRealTimeXLog()`가 `firstRetrieveLimit = 10000`을 넣는다.
- **구현**: `streaming.rs`의 `XLOG_RETRIEVE_LIMIT = 10_000`.

### F-4. ObjectPack 필드 순서

`scouter.lang.pack.ObjectPack.read(DataInputX)` 기준. **Blob 래핑이 없다** (XLogPack과 다름).

```
objType   readText()
objHash   readDecimal()
objName   readText()
address   readText()
version   readText()
alive     readBoolean()
wakeup    readDecimal()      ← 읽지 않으면 스트림이 어긋난다
tags      readValue()        ← MapValue
```

`objType`/`objHash` 순서를 바꾸면 `read_decimal()`이 텍스트 길이 바이트를 길이 지시자로 읽고
`readLong()` 분기를 타면서 8바이트를 삼켜 파싱이 붕괴한다. 뒤쪽 2개를 안 읽으면
오브젝트가 2개 이상일 때 두 번째부터 깨진다.

실제 값 예시:

```
objType=tomcat  objHash=-1585387669  objName=/shop-app/shop-app  address=10.89.2.3
version="2.21.3 2026-02-15 02:08 GMT_ENV_java8plus"  alive=true
```

`objName`은 `/{hostname}/{obj_name}` 형태다.

### F-5. 로그인

- 매직 넘버 `0xCAFE2001`(BE u32) → `writeText("LOGIN")` + `writeLong(0)` + MapPack
- 비밀번호: `SHA256("qwertyuiop!@#$%^&*()zxcvbnm,." + password)` hex
- 기본 계정 `admin` / `admin` (Collector가 `conf/account.xml`을 기동 시 생성)
- 응답 MapPack 키: `session`, `server_id`, `policy`, `menu`, `timezone`, `so_time_out`,
  `client_version`, `type`, `email`, `hostname`, `id`, `pass`, `version`,
  `isSocks`, `socksIp`, `socksPort`, `time`, `ext_link_name`, `ext_link_url_pattern`
- NScouter의 코덱 구현은 실제 응답과 정확히 일치한다 (파싱 후 잔여 바이트 0으로 확인).

### F-15. `COUNTER_REAL_TIME_ALL`은 PerfCounterPack을 돌려주지 않는다

파라미터는 **`objType` + `counter`**(카운터 1개)이고, 응답은 **MapPack 1건**이다.
`objHash`와 `value`가 **같은 순서의 병렬 리스트**로 온다.

| 보낸 파라미터 | 응답 |
|---|---|
| `objType="tomcat"`, `counter="TPS"` | MapPack — `objHash=[-1585387669, 16367847]`, `value=[15.47, 7.8]` |
| `objHash=[...]` (리스트만) | **팩 0건** — 에러 없이 조용히 아무것도 안 온다 |

- `PerfCounterPack`(type 60)은 이 응답에 **등장하지 않는다**. 카운터 1개 = 요청 1회다.
- 여러 카운터가 필요하면 `COUNTER_REAL_TIME_ALL_MULTI`를 쓴다
  ([CounterRTAllPairChart2.java:84](../ASIS/scouter-master/scouter.client/src/scouter/client/counter/views/CounterRTAllPairChart2.java#L84)).
- 근거: [CounterRealTimeAllView.java:287-300](../ASIS/scouter-master/scouter.client/src/scouter/client/counter/views/CounterRealTimeAllView.java#L287)
- 재현: `cd Test/scripts && PYTHONIOENCODING=utf-8 python capture_fixtures.py`

> **F-3과 같은 실패 양식이다.** 파라미터가 틀리면 에러가 아니라 **조용한 0건**이다.

### F-17. AlertPack 필드 순서 — 고정 길이 필드가 섞여 있다

`scouter.lang.pack.AlertPack.read(DataInputX)` 기준. 실서버로 확인했다.

```
time      readLong()      ← 8바이트 고정. readDecimal 아님
level     readByte()
objType   readText()
objHash   readInt()       ← 4바이트 고정. readDecimal 아님
title     readText()
message   readText()
tags      readValue()     ← 읽지 않으면 두 번째 알람부터 깨진다
```

실패 시 나오는 바이트 (수정 전 `read_alert_pack`):

```
[0, 7, 's','c','o','u','t','e','r', 0,249,192,231, 15, 'I','N','A','C','T',...]
 ^  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^  ^^  ^^^^^^^^^^^^^^^^^^^
 level      objType (len 7)          objHash int    len  title
```

`0,249,192,231` = BE i32 = **16367847** (order-app 의 objHash 와 일치).

실제 값 예시:

```
time=1786721179122 level=0 objType=scouter objHash=16367847
title="INACTIVE_OBJECT"  message="/order-app/order-app is not running. ..."
```

- **`objType` 은 알람 대상이 아니라 알람 발생 주체다.** 오브젝트 생명주기 알람은
  `objType=scouter`(콜렉터 자신)로 온다.
- 재현: `cargo test --test live_collector live_alert_pack_fields -- --ignored --nocapture`

### F-18. 프로파일은 **콜렉터 타임존 기준 날짜**로 조회한다

콜렉터는 XLog/프로파일을 자기 타임존 기준 날짜 디렉토리에 저장한다.

```
/data/database/20260815/
```

클라이언트는 로컬 날짜(`date` 파라미터)로 조회한다 — ASIS `DateUtil.yyyymmdd` 도
클라이언트 로컬 기준이다. **둘이 어긋나면 에러 없이 0건**이다 (F-3 과 같은 양식).

컨테이너 기본값이 UTC 라 KST 00~09 시에 하루가 밀린다. 실제로 겪었다.

```
로컬(KST) 20260815 로 조회 → 팩 0건
UTC       20260814 로 조회 → 정상
```

**대응**: 테스트 환경 콜렉터를 `Asia/Seoul` 로 고정했다
(`Test/collector/Containerfile` 의 `ENV TZ`).
`compose.yml` 의 `environment:` 로는 podman-compose 1.6.0 이 전달하지 않는다 (F-13 과 같은 계열).

> 운영 환경에서도 **콜렉터와 클라이언트의 타임존이 다르면 같은 증상**이 난다.
> Scouter 원본도 동일한 한계를 가진다.

### F-19. 프로파일 Step 은 상속 체인을 펼쳐 읽어야 한다

실측상 Java WAS 프로파일에 실제로 오는 Step 은 5종이다.

```
METHOD 149 / HASHED_MESSAGE 75 / SQL3 60 / MESSAGE 17 / APICALL 2
```

| Step | 필드 (ASIS `read()`) |
|---|---|
| `MethodStep`(1) | hash, elapsed, cputime |
| `HashedMessageStep`(9) | hash, time, value |
| `SqlStep3`(16) | hash, elapsed, cputime, param, error, xtype(**byte**), updated |
| `MessageStep`(3) | message |
| `ApiCallStep`(6) | **txid(decimal)**, hash, elapsed, cputime, error, opt(byte), [address if opt==1] |

주의점 3가지.

1. **상속을 펼쳐야 한다.** `SqlStep3 → SqlStep2 → SqlStep` 이라 부모 필드가 먼저다.
2. **`txid` 는 `readDecimal`(가변)이다.** `readLong` 이 아니다.
3. **`opt==1` 일 때만 `address` 가 온다.**

모든 Step 앞에는 `StepSingle` base 4개(parent, index, start_time, start_cpu)가 붙는다.
단 **`StepControl`(99)은 `StepSummary` 상속이라 base 가 없다.**

- 재현: `cargo test --test live_collector live_xlog_profile_steps -- --ignored --nocapture`
- 실측 도구: `Test/scripts/profile_check.py`

### F-20. `TRANX_PROFILE` 응답은 헤더 필드를 채우지 않는다

프로파일 blob 만 오고 `time` / `objHash` / `service` / `txid` 는 **전부 0**이다.

```
packType=26 time=0 objHash=0 service=0 txid=0
  blob 52B
```

**응답 `txid` 로 요청 `txid` 를 대조하면 모든 프로파일이 버려진다** (N-16 이 이 함정).
요청 자체가 txid 단위라 응답도 그 txid 것이 맞다.
ASIS `ProfileConsumer.retrieveProfilePack()` 도 검사하지 않는다.

- 파라미터는 `date` + `txid` 면 충분하다. `max`(PROFILE_MAX)나 `objHash` 유무와 무관하게 동일한 blob 이 온다 (실측).
- 재현: `cargo test --test live_collector live_profile_pack_header_is_empty -- --ignored --nocapture`

### F-21. `GET_TEXT_100` 응답의 키는 **Hexa32** 다

10진수로 파싱하면 **전부 실패해서 텍스트를 하나도 못 얻는다** (N-18 이 이 함정).
증상은 화면에 `[0x-17ebcaf0]` 같은 해시가 그대로 남는 것이다.

원본: `scouter.util.Hexa32`

```text
0~9      접두 없이 10진수      "5"
양수     'x' + base32          "x1jrf6b3"
음수     'z' + base32          "z1pa9p0"
i64::MIN "z8000000000000"
```

실측 응답:

```
{'z1pa9p0':  '/shop/api/products/{id}<GET>',
 'x1jrf6b3': '/shop/lab/error<GET>',
 'z173cbsq': '/shop/lab/heavy-sql<GET>'}
```

- **`date` 파라미터는 없어도 된다.** ASIS 는 넣지만 유무와 무관하게 같은 응답이 온다 (실측).
- 텍스트 타입 키는 `scouter.lang.constants.TextTypes` 기준이다.
  특히 `HashedMessageStep` 은 **`hmsg`** 다 — `method` 로 조회하면 조용히 빈 결과가 온다.
- 구현: `dictionary.rs::hexa32_to_i64()`
- 재현: `cargo test --test live_collector live_text_dictionary_types -- --ignored --nocapture`

### F-22. host Family 카운터는 24개 중 18개만 온다

호스트 에이전트(`Test/agent-host`, `obj_type=linux`)를 붙여 24개를 전부 요청한 결과다.

```
Cpu 2.20  SysCpu 0.58  UserCpu 1.17
Mem 14.94  MemA 13494  MemU 2370  MemT 15865
PageIn 0  PageOut 0  Swap 0  SwapT 4096  SwapU 0
NetInBound 5898  NetOutBound 43004
TcpStatEST 1  TcpStatTIM 0  TcpStatFIN 0  TcpStatCLS 0
=> 수신 18/24
```

미수신 6개: `TcpStatSynSent`, `TcpStatSynReceive`, `NetRxBytes`, `NetTxBytes`,
`DiskReadBytes`, `DiskWriteBytes`.

- **값이 0 인 카운터도 온다** (`PageIn`, `TcpStatFIN` …). 따라서 안 오는 것은
  "값이 0이라서"가 아니라 **수집 자체가 없는 것**이다.
- Net RX/TX 와 Disk R/W 는 인터페이스·장치별 sub-object 로 추정한다 (미확인).
- 컨테이너 안에서 돌지만 `/proc` 은 격리되지 않아 sigar 가 읽는 값은
  컨테이너가 아니라 **podman VM** 의 것이다. 이 환경에서 "호스트"는 그 VM 을 말한다.
- 재현: `cargo test --test live_collector live_host_counters -- --ignored --nocapture`

### F-23. MULTI 카운터 요청은 Family 를 섞어도 된다

`objHash` 에 tomcat + linux 를, `counter` 에 javaee + host 카운터를 함께 넣어도
콜렉터가 **맞는 조합만** 골라 준다. host 오브젝트에 `TPS` 가 붙어 오지 않는다.

```
[javaee] TPS       17.20      [host] Cpu   2.12
[javaee] HeapUsed  65.08      [host] MemU  2377
```

- Family 별로 스트림을 나눌 필요가 없다. **연결은 2초당 1회 그대로**다 (F-1).
- 단, 화면은 나눠야 읽힌다 — CPU 와 TPS 를 같은 줄에 놓으면 의미가 없다.
- 재현: `cargo test --test live_collector live_counter_multi_mixed_families -- --ignored --nocapture`

### F-24. 오브젝트 명령(`OBJECT_*`)은 MapPack 으로 답한다

파라미터는 **`objHash` 하나**다. 문서에 명령 이름만 있고 형태가 없어 실물로 확인했다.

| 명령 | flag | packType | 형태 |
|---|---|---|---|
| `OBJECT_ENV` | 3 (HasNEXT) | 10 (Map) | 평평한 key→Text (JVM 시스템 프로퍼티 66건) |
| `OBJECT_THREAD_LIST` | 3 | 10 (Map) | 7개 **병렬 리스트** |
| `OBJECT_HEAPHISTO` | **4 (NoNEXT)** | — | 빈 응답. 파라미터가 더 필요한 것으로 추정 (미확인) |

`OBJECT_THREAD_LIST` 의 병렬 리스트:

```
id       Decimal   스레드 ID
name     Text      스레드 이름
stat     Text      RUNNABLE / WAITING / TIMED_WAITING / BLOCKED
cpu      Decimal   누적 CPU 시간(ms)
elapsed  Decimal   처리 중인 트랜잭션 경과(ms) — 유휴면 Null
service  Decimal   서비스명 해시            — 유휴면 Null
txid     Decimal   트랜잭션 ID              — 유휴면 Null
```

- **유휴 스레드는 뒤 3개가 Null 이다.** 인덱스로 접근하면 밀리지 않게 길이를 맞춰야 한다.
- `OBJECT_ENV` 응답은 MapPack(HashMap)이라 **순서가 없다.** 매 조회마다 순서가 바뀌면
  화면이 흔들리므로 `parse_object_env` 가 이름순으로 정렬해 돌려준다.
- 재현: `cargo test --test live_collector live_object_env live_object_thread_list -- --ignored`
  탐침: `probe_object_commands`, `probe_object_mappack_keys`

### F-25. `SOCKET` / `OBJECT_CLASS_LIST` 응답 구조

둘 다 MapPack 병렬 리스트다. **명령 문자열이 이름과 다른 게 하나 있다.**

| 기능 | 명령 문자열 | 비고 |
|---|---|---|
| 소켓 | **`"SOCKET"`** | `"OBJECT_SOCKET"` 이 아니다 |
| 클래스 목록 | `"OBJECT_CLASS_LIST"` | `page` 파라미터 필요 |

`SOCKET` — 8개 병렬 리스트:

```
key      Decimal  소켓 식별자
host     Blob     **4바이트 IPv4.** 텍스트로 읽으면 깨진다
port     Decimal
count    Decimal  같은 상대로 열린 소켓 수
service  Decimal  0 이면 없음 (상시 연결)
txid     Decimal  0 이면 없음
order    Boolean
stack    Text
```

실측: `10.89.2.3:6100 count=1`(콜렉터), `10.89.2.2:5432 count=123`(PostgreSQL 커넥션 풀).

`OBJECT_CLASS_LIST` — **이 응답만 페이지 단위다.**

```
page       Decimal  ← 스칼라
totalPage  Decimal  ← 스칼라 (실측 171)
index / name / superClass / interfaces / resource / type   각 100건 리스트
```

- 요청에 `page` 를 넣는다. 이름이 틀리면 에러가 아니라 **항상 1페이지**가 온다 —
  그래서 테스트가 2페이지와 1페이지가 다른지까지 확인한다.
- `resource` 는 클래스가 어느 파일에서 왔는지다(`bytes:/...`, `jrt:/java.base`).
  같은 이름 클래스가 여러 jar 에 있을 때 이게 답이다.

`OBJECT_ACTIVE_SERVICE_LIST` — 지금 돌고 있는 트랜잭션. 병렬 리스트다.

```
id / name / stat / elapsed / cpu / ip / login / sql / subcall
service   Text     **해시가 아니라 텍스트다** (사전 조회 불필요)
txid      Text     **Hexa32** (F-21). 10진수로 파싱하면 전부 실패한다
objHash   Decimal  ← 스칼라
```

실측: `http-nio-8081-exec-10 /shop/lab/jitter<GET> 1209ms`.
`sql`/`subcall` 이 채워져 있으면 지금 그걸 붙들고 있다는 뜻이라 원인 판단에 바로 쓴다.

### F-26. 덤프 내용은 Pack 이 아니라 **blob 청크 스트림**이다

`OBJECT_DUMP_FILE_DETAIL` 만 프레이밍이 다르다.

```text
[HasNEXT][blob 4096B][HasNEXT][blob 4096B] … [NoNEXT]
```

`read_next_pack` 으로 읽으면 blob 의 길이 표식 `0xFF` 를 **팩 타입으로 오해**해서
"구현되지 않은 Pack 타입 0xFF" 로 끝난다. (O-5 를 고쳐 두지 않았다면 조용히
스트림이 어긋나 멈췄을 것이다 — 이 에러 덕분에 형식이 다르다는 걸 바로 알았다.)

- 구현: `ScouterConnection::read_blob_stream()`
- 이어붙인 길이가 `OBJECT_DUMP_FILE_LIST` 의 `size` 와 정확히 같아야 한다 (실측 47,206B).
- 파일 이름 파라미터는 **`name`** 이다. `file` 로 보내면 빈 응답이 온다.
- 재현: `cargo test --test live_collector live_thread_dump_roundtrip -- --ignored`

### F-28. 과거 XLog 조회 — 파라미터 이름과 페이지 전진 방식

앱이 "현재"만 보던 제약을 푸는 **선행 조건**이다.
LoadTimeXLog / ZoomTime / 과거 카운터 차트가 전부 여기 의존한다.

파라미터 이름을 전부 실측으로 확정했다. **틀리면 에러가 아니라 0건이 온다.**

| 항목 | 값 | 틀렸을 때 |
|---|---|---|
| 명령 | `TRANX_LOAD_TIME_GROUP_V2` | V1(`TRANX_LOAD_TIME_GROUP`)은 페이지네이션 없이 전량(10분에 13,732건) |
| 시간 키 | **`stime` / `etime`** | `startTime`/`endTime` → 0건 |
| 페이지 크기 | **`pageCount`** | 없으면 → 0건 (`max`/`limit`/`count` 전부 무시됨) |

응답 메타 MapPack: `hasMore` / `lastTxid` / `lastXLogTime`.

**다음 페이지는 `stime` 을 `lastXLogTime` 으로 민다** (조회가 시간 오름차순).
방식별 1페이지와의 겹침을 재서 확정했다:

| 방식 | 겹침 |
|---|---|
| `etime = lastXLogTime` | 96/100 |
| **`stime = lastXLogTime`** | **4/100** |
| `stime` 이동 + `lastTxid` 동반 | 4/100 — 서버가 `lastTxid` 를 **타이브레이크로 쓰지 않는다** |

남은 겹침은 경계 시각이 같은 트랜잭션이다. `stime` 을 +1 하면 그 건들을 **잃으므로**
포함으로 두고 `dedupe_by_txid` 로 거른다 — 없는 것보다 중복이 낫다.

- 구현: `scouter/past.rs`, 커맨드 `load_past_xlog`
- 재현: `cargo test --test live_collector live_past_xlog_paginates -- --ignored`

### F-29. gxid 조회 — 이름이 비슷한 두 커맨드가 **서로 다른 키**를 읽는다

분산 트랜잭션(ApiCall / Flow 뷰)의 선행 조건이다.

| 커맨드 | 읽는 키 |
|---|---|
| `XLOG_READ_BY_GXID` | `date`(text) · `gxid`(long) |
| `XLOG_LOAD_BY_GXID` | **`stime` · `etime`** · `gxid` — 날짜를 stime/etime 에서 **유도**한다 |

LOAD 에 `date` 를 주면 `getLong("stime")` 이 0을 돌려주고 `yyyymmdd(0)` = `19700101`
디렉토리를 뒤져 **조용히 0건**이 온다 (F-15). 실측:

| 요청 | 결과 |
|---|---|
| `XLOG_READ_BY_GXID` + `date`+`gxid` | **2건** |
| `XLOG_LOAD_BY_GXID` + `stime`+`etime`+`gxid` | **2건** |
| `XLOG_LOAD_BY_GXID` + `date`+`gxid` | **0건** |

날짜를 이미 알고 있으므로 READ 를 쓴다.

**`caller != 0` 이라고 앱 간 호출인 것은 아니다.** 같은 `objHash` 안에서 부모-자식이
맺어지는 경우가 실제로 있다(비동기 디스패치 / 백그라운드 스레드). 앱 간 호출을 보려면
gxid 로 묶었을 때 `objHash` 가 둘 이상인 것을 골라야 한다 — 이 함정에 테스트가 한 번 걸렸다.

확인 경로: 콜렉터 2.21.3 `scouter-server-2.21.3.jar` 의
`scouter/server/netio/service/handle/XLogService.class` 를 `javap -c` 로 읽어
`MapPack.getLong("stime")` 호출을 직접 확인한 뒤 실서버로 재현했다.

- 구현: `scouter/trace.rs`, 커맨드 `load_xlog_by_gxid`
- 재현: `cargo test --test live_collector live_xlog_by_gxid -- --ignored`
- 탐침: `probe_xlog_by_gxid` (틀린 파라미터가 0건이 되는 것까지 함께 본다)

### F-30. `TRANX_PROFILE_FULL` 은 Pack 이 아니라 blob 청크로 온다

| | 읽는 키 | max | 응답 |
|---|---|---|---|
| `TRANX_PROFILE` | date · txid · gxid · xlogType · **max** | 요청값(없으면 0 = 무제한) | `XLogProfilePack` |
| `TRANX_PROFILE_FULL` | date · txid · gxid · xlogType | **-1 고정** | `[3][blob]` 청크 스트림 |

FULL 의 응답을 `read_next_pack` 으로 읽으면 blob 길이 첫 바이트를 PackType 으로
오해한다 — F-26(덤프 내용)과 같은 함정이다. `read_blob_stream` 을 쓴다.
각 blob 은 `Step[]` 직렬화라 `parse_profile_steps` 가 그대로 읽는다.

`gxid`/`xlogType` 을 비워 보내면 콜렉터가 txid 로 XLog 를 찾아 채운다.
그래서 `date`+`txid` 만 보내면 된다 (ASIS `XLogProxy.getFullProfile` 과 동일).

**실측 환경에서는 두 경로의 결과가 같다.** SQL 50건짜리 트랜잭션에서 양쪽 모두 202스텝
(FULL 3,558바이트). 차이는 프로파일이 길어져 잘릴 때만 드러나므로, 잘려도 표시가 없는
`TRANX_PROFILE` 대신 FULL 을 상세 패널의 기본 경로로 쓴다.

- 구현: `scouter/profile.rs`(`build_full_profile_param`), 커맨드 `get_xlog_full_profile`
- 재현: `cargo test --test live_collector live_full_profile_matches_profile -- --ignored`
- 탐침: `probe_full_profile` (두 경로의 스텝 수·종류를 나란히 센다)

### F-31. 흐름 그래프의 연결 고리는 ApiCall 스텝의 `txid` 다

앱 간 호출을 그리려면 "이 API 호출이 **어느 트랜잭션**이 됐나"를 알아야 한다.
그 다리가 프로파일 `ApiCallStep.txid` 다 — 호출된 앱 XLog 의 `txid` 와 같다.

실측 (order-app → shop-app):

```
부모 txid=-418543466198526956
  ApiCall(hash=-2059434530, txid=455332941084784219, elapsed=6)
                                   └─ 자식 XLog 의 txid 와 일치
```

`caller` 로도 부모-자식은 알 수 있지만 **어느 호출 지점에서 갈라졌는지는 모른다.**
그래서 흐름 그래프는 ApiCall 스텝을 먼저 보고, 없을 때만 `caller` 로 잇는다
(프로파일 조회 실패·샘플링 누락 시 자식이 화면에서 사라지지 않게).

`txid` 가 0이거나 가리키는 XLog 가 없으면 상대 앱에 에이전트가 없는 것이다.
이때는 API 호출 자체를 잎으로 남긴다 — "무엇을 불렀는지"는 여전히 보여야 한다.

- 구현: `src/features/xlog/trace/flowTree.ts`
- 재현: `cargo test --test live_collector live_flow_apicall_links_child_xlog -- --ignored`

### F-32. objType 단위 커맨드 — 하나는 Pack 이 아니라 **Value** 를 준다

objType 우클릭 메뉴가 쓰는 커맨드들. 파라미터는 전부 `objType` 하나다.

| 커맨드 | 응답 | 실측 |
|---|---|---|
| `ACTIVESPEED_REAL_TIME` | 오브젝트당 MapPack `act1/act2/act3/objHash` | ✅ 2건 |
| `ACTIVESPEED_REAL_TIME_GROUP` | MapPack 1개 `act1/act2/act3/`**`tps`(Float)** | ✅ tps=23.1 |
| `COUNTER_TODAY_ALL` | 오브젝트당 `objHash/time[]/value[]` | ✅ 288포인트 |
| `COUNTER_PAST_DATE_ALL` | 위와 동일 + `date` | ✅ |
| `VISITOR_REALTIME_TOTAL` | **Pack 이 아니라 Value 하나** | ✅ 45,042 |
| `REALTIME_SERVICE_GROUP` | — | ❌ **0건** |

**`VISITOR_REALTIME_TOTAL` 을 Pack 으로 읽으면 안 된다.** Value 타입 바이트
`DECIMAL=20`(0x14)을 PackType 으로 오해해 "구현되지 않은 Pack 타입 0x14" 로 멈춘다.
`PackEnum` 에 20이 없다는 것이 단서였다. ASIS 는 이런 응답에
`TcpProxy.getSingleValue()` 를 쓴다 — 우리 쪽은 `read_single_value()` 를 추가했다.

O-5(모르는 Pack 은 건너뛰지 말고 에러) 덕분에 **멈추는 대신 어느 파서가 없는지**
알 수 있었다. 조용히 넘겼다면 스트림이 어긋난 채 다음 요청까지 망가졌을 것이다.

`REALTIME_SERVICE_GROUP` 0건은 에이전트에 서비스 그룹 설정이 없어서로 추정한다.
**데이터가 없는 화면은 만들지 않는다** — ServiceGroupTPS/Elapsed 는 미착수로 둔다.

`tps` 는 Float 이다. Decimal 로만 읽으면 0이 된다.

- 구현: `scouter/objtype.rs`, 커맨드 `get_active_speed` / `get_active_speed_by_object`
  / `get_today_counter` / `get_today_visitor`
- 재현: `cargo test --test live_collector live_objtype_queries -- --ignored`
- 탐침: `probe_objtype_menu_commands`

### F-33. 값이 **스칼라가 아닌** 카운터가 있다 — 조용히 버려지고 있었다

| 카운터 | 값 | 뜻 |
|---|---|---|
| `TPS` | `Float(16.46)` | 스칼라 |
| `HeapTotUsage` | `List[Float(114.0), Float(72.63)]` | **[총량, 사용량]** (MB) |
| `FdUsage` | `List[Decimal(1048576), Decimal(37)]` | **[상한, 열린 수]** |

ASIS `CounterRTAllPairChart` 가 `lv.get(0)` 을 total 트레이스, `lv.get(1)` 을
active 트레이스로 넣는다. "pair chart" 의 pair 가 이것이다.

**우리 파서는 이 행들을 통째로 버리고 있었다.** `as_f64` 가 `List` 에 `None` 을
돌려주고 `parse_counter_multi` 의 `filter_map` 이 행을 걸렀다. 에러도 로그도 없이
두 차트가 **빈 채로** 남았고, 인벤토리에는 "차트 표시됨(partial)" 으로 적혀 있었다.
F-15(틀리면 0건)와 같은 실패 방식이 **우리 코드 안에서** 재현된 셈이다.

화면 규칙:
- 같은 축에 상한을 놓아도 사용량 추세가 살아 있으면(총량 ≤ 사용량 × 4) 점선 기준선.
- 아니면(FdUsage: 상한이 3만 배) 사용량만 자동 축척하고 **상한은 숫자로** 적는다.
  같은 축에 놓으면 사용량 선이 바닥에 붙어 추세가 통째로 사라진다.

- 구현: `scouter/counter.rs` `as_pair()`, `CounterRow.total` / `CounterValue.total`
- 재현: `cargo test --test live_collector live_pair_counters_are_not_dropped -- --ignored`
- 탐침: `probe_pair_counters`

### F-34. `OBJECT_ACTIVE_SERVICE_LIST` 는 `objType` 하나로 타입 전체를 준다

| 요청 | 결과 |
|---|---|
| `objType` 만 | **pack 2개 (오브젝트당 1개) · 3행** |
| `objType` + `objHash=0` | pack 2개 · 1행 — **0을 넣으면 결과가 달라진다** |
| `objType` + 특정 `objHash` | pack 1개 (그 오브젝트만) |

오브젝트마다 따로 부르면 F-1(연결당 명령 1개) 때문에 **연결이 오브젝트 수만큼** 열린다.
`objHash` 는 좁힐 때만 넣고, 전체를 볼 때는 **아예 넣지 않는다**.

응답 pack 은 스칼라 `objHash` 와 `complete`(Boolean)를 함께 들고 온다.
- `objHash` 를 안 읽으면 타입 전체 목록에서 **행이 뒤섞여** 어느 서버가 막혔는지 알 수 없다.
- `complete=false` 는 그 에이전트의 목록이 **잘렸다**는 뜻이다. 그냥 보여주면
  "지금 한가하다"로 오해하므로 화면에 경고를 남긴다. 키가 아예 없으면 완전한 것으로 본다.

- 구현: `scouter/objtype.rs` `build_active_service_param` / `is_complete`,
  커맨드 `get_type_active_services`
- 재현: `cargo test --test live_collector live_type_active_services -- --ignored`
- 탐침: `probe_active_service_by_objtype`

### F-35. 오브젝트 부수효과 명령 — 응답 방식이 셋으로 갈린다

| 명령 | 파라미터 | 응답 |
|---|---|---|
| `TRIGGER_THREAD_DUMP` | objHash | `name` (파일명) |
| `TRIGGER_ACTIVE_SERVICE_LIST` | objHash | `name` |
| `TRIGGER_THREAD_LIST` | objHash | `name` |
| `TRIGGER_HEAPHISTO` | objHash | `name` |
| `PSTACK_ON` | objHash (+`time`) | 요청을 그대로 되돌려 준다 |
| `OBJECT_SYSTEM_GC` | objHash | **없음** |
| `OBJECT_RESET_CACHE` | objHash | **없음** |
| `OBJECT_CALL_HEAP_DUMP` | objHash + **`fName`** + **`time`** | `{success, msg}` |

**`OBJECT_CALL_HEAP_DUMP` 의 오랜 "빈 응답" 은 파라미터 누락이었다.**
`objHash` 만 보내면 조용히 아무것도 안 온다. ASIS `HeapDumpAction` 은 `fName`(파일명 접두)과
`time`(요청 시각)을 함께 보내고, 셋이 다 있어야 `{success:true, msg:"Successfully request..."}`
가 돌아온다. 이전 세션의 미해결 항목이 여기서 닫힌다.

**에이전트가 힙 덤프를 10초에 한 번으로 막는다.** 연속 요청은
`{success:false, msg:"please wait 10 sec. from last request..."}` 다.
빈 응답(파라미터 오류)과 이건 **다른 상황**이라 화면에서도 다르게 다뤄야 한다.

**스택 샘플링은 켜기·끄기가 같은 명령이다.** `time` 이 있으면 켜기, 없으면 끄기다
(끄기 요청의 응답 에코는 `time=-1`).

**`TRIGGER_*` 는 간헐적으로 빈 MapPack 을 돌려준다.** 실행 중인 트랜잭션 수와도,
직전 덤프 여부와도 무관했고 초반 회차에서 주로 비었다. 원인은 미확인 —
호출부는 이걸 실패로 다루고 다시 시도하게 안내한다. 실서버 테스트도 3회까지 재시도한다.

`OBJECT_SYSTEM_GC` / `OBJECT_RESET_CACHE` 는 **성공 여부를 알려주지 않는다.**
화면은 "요청했다"까지만 말해야 하고, GC 는 Heap 카운터로 확인하도록 안내한다.

- 구현: `scouter/object.rs` `build_heap_dump_param` / `build_pstack_param`,
  커맨드 `trigger_dump` / `object_system_gc` / `object_reset_cache` /
  `object_stack_sampling` / `object_heap_dump`
- 재현: `cargo test --test live_collector live_object_side_effects -- --ignored`
- 탐침: `probe_object_side_effect_commands`, `probe_trigger_active_service_condition`

### F-36. `ThreadCallPossibleStep(14)` 은 이어진 스레드의 txid 를 들고 온다

본문은 `txid(decimal) · hash(decimal) · elapsed(decimal) · threaded(byte)` 다.
예전에는 길이만 맞춰 소비하고 값을 버려서 `Unknown` 으로 남았다 —
바이트는 맞았으므로 파싱은 안 깨졌지만, **화면에서 아무것도 할 수 없었다.**

`threaded` 가 이 스텝의 핵심이다:

| threaded | 뜻 |
|---|---|
| 1 | 실제로 다른 스레드로 넘어갔다. `txid` 로 **그 스레드의 프로파일**을 열 수 있다 |
| 0 | 넘어가지 않았다. txid 를 따라가도 빈 프로파일이다 — 링크로 만들면 안 된다 |

실측(과거 10분 200건 중): 14번 스텝을 가진 트랜잭션 4건, 스텝 2개 모두 `threaded=true`
이고 txid 가 유효했다. 이름 hash 는 **apicall 사전**으로 푼다 (ASIS XLogFlowView 와 동일).

ASIS 는 프로파일 텍스트에서 `thread:...<Hexa32>` 패턴을 정규식처럼 찾아 링크를 만든다
(XLogProfileView). 우리는 텍스트가 아니라 **구조화된 필드**를 쓰므로 표기가 바뀌어도 깨지지 않는다.

- 구현: `scouter/profile.rs` `ThreadCallProfileStep`, 화면은 `ProfileStepList` 의 링크
- 재현: `cargo test --test live_collector live_thread_call_steps -- --ignored`

### F-48. 흐름 보기에 필요한 스텝은 **ThreadCall 하나뿐이다** — Dispatch·ThreadSubmit·Span 은 이 환경에 없다

ASIS `XLogFlowView.stepToElement` 는 스텝 7종을 다룬다(ApiCall·SpanCall·Dispatch·
ThreadCallPossible·ThreadSubmit·Sql·각 Sum). 그중 **무엇이 실제로 오는지**를 먼저 셌다.

과거 15분 XLog 400건 중 프로파일을 순서대로 훑은 결과:

```
스텝 종류: [("ApiCall", 18), ("Message", 530), ("Method", 868), ("Sql", 268), ("ThreadCall", 5)]
Unknown step_type 내역: []        ← 13(Dispatch) · 7(ThreadSubmit) · 51/52(Span) 모두 0개
```

`Dispatch`/`ThreadSubmit` 은 파서가 본문만 소비하고 `Unknown{step_type}` 으로 남기므로,
왔다면 이 집계에 숫자로 찍힌다. **한 건도 없다.** Span 계열(51/52)은 SpanPack 을 쓰는
zipkin 연동에서만 생기고 이 환경에는 연동이 없다. 만들어도 확인할 방법이 없으므로 넣지 않는다.

**넘어간 스레드는 부모와 같은 gxid 그룹으로 들어온다**

```
부모 txid=-6721768440211285900 gxid=-6721768440211285900 threaded=true
     → ThreadCall txid=1407936440640798828 그룹포함=true (그룹 2건)
   txid=-6721768440211285900 caller=0                     elapsed=121 service=1253108614
   txid=1407936440640798828 caller=-6721768440211285900   elapsed=121 service=98164454
```

넘어간 트랜잭션은 **부모 txid 를 `caller` 로** 달고 같은 gxid 그룹에 있다.
그래서 흐름 트리는 ThreadCall 을 잎이 아니라 **그 서비스 노드**로 잇는다
(ASIS 도 serviceMap 에 있으면 서비스를, 없으면 DISPATCH 잎을 붙인다).

`caller` 폴백이 이미 있으므로 **연결 자체는 ThreadCall 분기 없이도 됐다.**
분기가 실제로 바꾼 건 둘이다: 그룹에 없는 스레드를 잎으로 남기는 것,
그리고 같은 곳으로 반복해 넘긴 호출을 접어 횟수를 세는 것.

`threaded=false` 면 스텝 자체를 버린다 — 넘어가지 않았으니 갈래가 없다(F-36).

- 구현: `src/features/xlog/trace/flowTree.ts` `linkOrLeaf`, 잎 종류 `thread`
- 재현: `cargo test --test live_collector live_flow_threadcall_links_child_xlog -- --ignored --nocapture`

### F-47. 설정 저장은 **성공/실패를 예외가 아니라 `result` 텍스트로** 준다

`SET_CONFIGURE_WAS` 는 실패해도 MapPack 을 돌려준다. **"응답이 왔다"를 성공으로 읽으면**
저장되지 않은 설정을 저장됐다고 말하게 된다.

```
저장 응답 result=Some("true")     ← 성공
저장 응답 result=Some("java.io…")  ← 실패 사유가 그 자리에 온다
```

`result` 가 없거나 비어 있어도 성공이 아니다.

**역슬래시를 두 번으로 늘려 보낸다**

에이전트는 받은 텍스트를 `Configure.saveText()` 로 파일에 쓰고 다시 읽는데,
그 읽기가 자바 프로퍼티 규칙이라 역슬래시를 이스케이프 시작으로 본다.
그대로 보내면 윈도우 경로가 저장 후 구분자를 잃는다.
ASIS `ConfigureView.saveConfigurations()` 도 `replaceAll("\\\\", "\\\\\\\\")` 로 같은 처리를 한다.

**원문 전체를 보내야 한다 (F-40 재확인)**

`saveText` 는 파일을 통째로 덮어쓴다. 한 줄만 보내면 나머지 설정이 사라진다.
그래서 화면도 «항목» 표가 아니라 **원문**을 편집하게 하고, 빈 텍스트는 커맨드에서 거절한다.

왕복 검증은 **읽은 원문을 그대로 되돌려 저장**한다 — 설정을 바꾸지 않으면서
저장 경로 전체를 지나고, 되읽어 바이트가 같은지 본다(1,979자 일치).

- 구현: `scouter/configure.rs` `escape_config_text` / `parse_save_result`,
  커맨드 `save_agent_config`, 화면은 `ConfigEditor` (원문 → «편집» → «저장…» → «덮어쓰기»)
- 재현: `cargo test --test live_collector live_agent_config_save_roundtrip -- --ignored --nocapture`

### F-46. 실행 중인 트랜잭션 상세: 키에 **공백**이 있고, `-1` 은 0이 아니다

액티브 서비스 목록은 "무엇이 3초째 안 끝난다"까지만 말한다.
**어디에 멈춰 있나**는 `OBJECT_THREAD_DETAIL` 에만 있다.

파라미터는 셋이다 — `objHash` / `id`(스레드) / `txid`.
스레드 id 만으로는 부족하다: 같은 스레드가 이미 다음 트랜잭션을 잡았을 수 있어서,
txid 로 "그 트랜잭션이 아직 거기 있는가"를 함께 묻는다.

**(1) 응답 키가 사람이 읽는 이름이다**

```
Thread Id        Decimal  = 52          Service Name   Text = com...LabService#countAsync()
Thread Name      Text     = task-4      Service Txid   Text = x3qa2rs7mags69
State            Text     = TIMED_WAITING
Stack Trace      Text     = java.base@17.0.20/java.lang.Thread.sleep(Native Method) …
```

`threadId`/`stackTrace` 같은 camelCase 로 짐작하면 **파서가 전부 빈 값을 만든다**.
에러가 아니라 0으로 찬 화면이 나오므로 알아채기 어렵다.
`SQL`/`SQLActiveBindVar`/`Subcall` 은 해당 없으면 **키 자체가 없다**.

**(2) `Blocked Time` / `Waited Time` / `Lock Owner Id` 가 -1 로 온다**

JMX 스레드 경합 측정이 꺼져 있을 때의 값이다. 0으로 눕히면
**"경합이 전혀 없었다"** 는 거짓이 된다 — 실제로는 아무것도 모르는 상태다.
`Option<i64>` 로 갈라 화면에 «측정 꺼짐» 이라 적는다.
**횟수(`Blocked Count`/`Waited Count`)는 실제 값이다** — 시간만 안 잰다.

```
Blocked Count  Decimal = 0      Blocked Time  Decimal = -1
Waited Count   Decimal = 289    Waited Time   Decimal = -1
```

**(3) 순간 상태다 — 빈 응답이 오류가 아니다**

여는 사이에 트랜잭션이 끝나면 값이 실리지 않는다. 화면은 «이미 끝난 트랜잭션» 이라고 말한다.
테스트는 **끝난 것과 파싱이 깨진 것을 구별해야 한다** — 둘 다 0/빈 문자열로 보이므로,
`"Thread Id"` 키의 존재 여부로 가른다.

- 구현: `scouter/object.rs` `build_thread_detail_param` / `parse_thread_detail`,
  화면은 `ThreadDetailDialog` (액티브 서비스 목록의 행을 누르면 열린다)
- 재현: `cargo test --test live_collector live_thread_detail_contract -- --ignored --nocapture`

### F-45. 스택 분석기의 **읽는 쪽**은 프레이밍이 셋 다 다르다

샘플링을 켜고 끄는 것(`PSTACK_ON`)만 되어 있었다. 모아 놓고 볼 데가 없으면 켤 이유가 없다.
읽는 경로는 ASIS `StackListDialog` / `FetchSingleStackJob` 에 있고, **함정이 셋**이다.

**(1) `GET_STACK_INDEX` 응답은 Pack 이 아니다**

```java
tcp.process(RequestCmd.GET_STACK_INDEX, param, new INetReader() {
    public void process(DataInputX in) { long time = in.readLong(); ... }
});
```

`[HasNEXT][long 8B][HasNEXT][long 8B] … [NoNEXT]` — raw long 나열이다.
`read_next_pack` 으로 읽으면 long 의 첫 바이트를 PackType 으로 오해한다.
F-32(Value 하나)·`read_blob_stream`(blob 청크)과 같은 부류라 읽는 함수를 따로 둔다
(`read_long_stream`).

**(2) 파라미터가 `objHash` 가 아니라 `objName`**

다른 `OBJECT_*` 명령은 전부 objHash 인데 이 둘만 objName 이다. 습관대로 넣으면 0건이다 (F-15).

**(3) StackPack(62) 의 본문은 GZIP**

```java
public void setStack(String s) { this.data = CompressUtil.doZip(s.getBytes()); }
// CompressUtil.doZip → java.util.zip.GZIPOutputStream
```

blob 을 그대로 문자열로 읽으면 바이너리가 나온다. `flate2` 로 푼다.
**한 장이 상해도 에러로 세우지 않는다** — 수백 장 중 하나 때문에 전체를 못 보게 되면 안 된다.
다만 빈 문자열로 돌려주지도 않는다("스택이 비었다"로 읽힌다). 자리에 사유를 남긴다.

**용량 — 구간 전체를 한 번에 받으면 안 된다**

```
GET_STACK_INDEX    → 124건 (10초 간격)
GET_STACK_ANALYZER → 팩 124개 · 총 6,419,425자     ← 하루치
                   → 팩 1개  ·      47,259자       ← 한 장 (from=t, to=t+1)
```

6.4MB 를 IPC 에 실으면 웹뷰가 멎는다(CLAUDE.md 3.3). ASIS `FetchSingleStackJob` 도
`from=time, to=time+1` 로 한 장씩 받는다 — 목록에서 고른 뒤 그 한 장만 가져온다.

- 구현: `scouter/object.rs` `build_stack_range_param`, `connection.rs` `read_long_stream` /
  `read_stack_pack` / `gunzip_text`, 화면은 ObjectInspector 의 «모인 스택»
- 재현: `cargo test --test live_collector live_stack_analyzer_readback -- --ignored --nocapture`

### F-44. 서비스 그룹은 `objType` 이 아니라 **`objHash` 목록**으로 묻는다

`REALTIME_SERVICE_GROUP` 이 오래 "실측 0건 · 에이전트에 서비스 그룹 설정이 없는 것으로 추정"
으로 막혀 있었다. **추정이 틀렸다 — 파라미터가 달랐다.**

ASIS `ServiceGroupTPSView.fetch()`:

```java
MapPack param = new MapPack();
ListValue objLv = param.newList("objHash");          // ← objType 이 아니다
for (AgentObject p : agentMap.values())
    if (p.getObjType().equals(objType)) objLv.add(p.getObjHash());
pack = tcp.getSingle(RequestCmd.REALTIME_SERVICE_GROUP, param);
```

같은 자리에서 두 모양을 나란히 물어 확인했다:

```
[objType]        0개
[objHash 리스트] 키=["error","name","elapsed","count"] 그룹 3개
      "/order" = 213
      "/shop"  = 458
      "/**"    = 21
```

F-15 의 전형적인 사례다 — 파라미터가 틀리면 **에러가 아니라 0건**이 온다.

응답은 네 병렬 리스트(`name`/`count`/`elapsed`/`error`)이고 **`count` 는 최근 30초의 누적**이다.
그대로 TPS 로 그리면 30배 부풀려진다 (ASIS 도 `count / 30.0`). `elapsed` 는 이미 평균이다.
규칙에 안 걸린 요청은 `/**` 로 떨어진다.

- 구현: `scouter/objtype.rs` `build_service_group_param` / `parse_service_group`,
  화면은 `ServiceGroupPanel`
- 재현: `cargo test --test live_collector live_service_group_needs_objhash_list -- --ignored --nocapture`

### F-43. PermPercent 는 Java 17 탓이 아니라 **Metaspace 에 상한이 없어서** 안 왔다. ProcCpu 는 아예 없다

**PermPercent**

"Java 17 에는 PermGen 이 없다" 로 적어 두었지만 반만 맞았다. 에이전트 `PermGen` 태스크는
풀 이름에 `PERM GEN` **또는 `METASPACE`** 가 들어가면 잡는다 — 그래서 Java 17 에서도
`PermUsed` 는 정상적으로 온다. `PermPercent` 에만 한 줄이 더 걸려 있다:

```java
if (usage.getMax() != -1) { pack.put("PermPercent", used * 100 / max); }
```

Metaspace 는 기본이 **상한 없음(-1)** 이다. 즉 환경 제약이 아니라 **JVM 옵션** 문제였다.
`-XX:MaxMetaspaceSize=256m` 를 주자 바로 왔다:

```
obj=-1585387669 PermUsed 81.13   PermPercent 31.69
obj= 16367847   PermUsed 82.54   PermPercent 32.24
```

81.13 / 256 = 31.69% — 자릿수까지 맞는다.

**ProcCpu**

같은 javaee Family 인데 이쪽은 성격이 다르다. 에이전트 jar 에서 카운터명을 grep 하면
수집 태스크가 짝으로 나오는데, ProcCpu 만 나오지 않는다:

```
HeapUsed     → scouter/agent/counter/task/HeapUsage.class
PermUsed     → scouter/agent/counter/task/PermGen.class
PermPercent  → scouter/agent/counter/task/PermGen.class
GcTime       → scouter/agent/counter/task/GCInfo.class
ProcCpu      → scouter/test/ObjectRush.class          ← 테스트용 클래스뿐
```

counters.xml 과 CounterConstants 에 이름만 있고 보내는 코드가 없다 —
F-42 의 Net/Disk 넷과 같은 부류다.

**덤으로 찾은 것: `counters.xml` 의 `total="false"`**

카운터마다 합계(Total) 화면을 만들 수 있는지가 정의에 박혀 있다
(`CounterEngine.getTotalCounterList`). **host Family 는 24개 전부 `total="false"` 다** —
CPU 두 대를 더해 100% 라고 그리는 화면을 ASIS 는 아예 열어 주지 않는다.
javaee 는 6개(RecentUser/GcCount/ServiceCount/ErrorRate/ActiveService/TPS), datasource 는 3개 전부 가능하다.

합계로 접을지 평균으로 접을지는 **별개 규칙**이다 (`CounterUtil.getTotalMode`):
`ErrorRate`/`ElapsedTime`/`Elapsed90%` 이거나 단위가 `%` 면 평균, 아니면 합계.
ErrorRate 는 합계가 가능하면서 평균인 카운터라 두 규칙이 겹치는 유일한 예다.

- 구현: `types/counter.ts` `isTotalCapable` / `JAVAEE_UNCOLLECTED_COUNTERS`,
  `components/counterTotal.ts`, 화면은 CounterSection 의 개별/합계 토글
- 재현: `cargo test --test live_collector live_perm_percent_needs_metaspace_cap -- --ignored --nocapture`

### F-42. 호스트 카운터 6개가 실시간에 안 오는 이유는 **둘로 갈린다**

인벤토리에 "실측 미수신" 으로 묶여 있던 6개를 에이전트
(`vendor/scouter/agent.host/scouter.host.jar`) 바이트코드로 갈랐다.
둘 다 원인이 클라이언트 밖이지만, **한쪽은 받을 수 있고 한쪽은 없다.**

**(1) SYN_SENT / SYN_RECEIVE — 실시간 팩에만 없다. 5분 집계로는 온다**

`HostPerf.process()` 가 같은 주기에 팩을 **두 번** 담는데 두 묶음의 카운터 목록이 다르다:

```
getPack(objName, TimeTypeEnum.REALTIME)  // (byte)1 — 18개, SynSent/SynReceive 없음
getPack(objName, TimeTypeEnum.FIVE_MIN)  // (byte)3 — 20개, SynSent/SynReceive 있음
```

즉 `COUNTER_REAL_TIME_ALL_MULTI` 로는 이름을 아무리 맞춰도 영원히 0건이다.
`COUNTER_TODAY_ALL` 로 물어야 보인다. 값 자체는 `oshi` 의 `getConnections()` 를
`TcpState` 로 분류해 실제로 센다(`tcpstat_ss`/`tcpstat_sr`).

**(2) NetRxBytes / NetTxBytes / DiskReadBytes / DiskWriteBytes — 아무 팩에도 없다**

`HostNetDiskPerf.process(CounterBasket)` 는 **바구니를 쓰지 않는다.**
`netUsage(10)`/`diskIO(10)` 를 부르고, 그 둘은 인터페이스·장치별 델타를 계산해
static 필드에 넣는다. 그리고 그 getter 를 읽는 코드가 에이전트 어디에도 없다:

```
$ grep -rl "getRxTotalBytesPerSec" scouter/
scouter/agent/counter/task/HostNetDiskPerf.class     ← 정의한 자기 자신뿐
```

`PerfCounterPack`/`CounterBasket`/`DataProxy` 를 이 클래스는 한 번도 참조하지 않는다.
counters.xml 에 이름만 있고 전송 경로가 없는, **2.21.3 의 미완성 기능**이다.

**실측 (호스트 에이전트 10분 가동 후)**

| 카운터 | 실시간 | 5분 집계 |
|---|---|---|
| Cpu (기준) | 옴 | 288포인트 |
| TcpStatSynSent | 0건 | **288포인트** |
| TcpStatSynReceive | 0건 | **288포인트** |
| NetRxBytes / NetTxBytes | 0건 | **0포인트** |
| DiskReadBytes / DiskWriteBytes | 0건 | **0포인트** |

**포인트 수만 보면 안 된다.** 5분 집계는 하루치 288 슬롯을 **미래 시각까지 통째로**
0으로 채워 준다 — 12:47 에 조회해도 마지막 포인트가 23:55 다. 그대로 그리면
지금 이후가 바닥에 붙어 "방금 0으로 떨어졌다" 로 읽힌다(`fiveMinSeries.trimFuture`).
SYN 둘은 288슬롯이 **전부 값 0** 인데, 이건 수집 실패가 아니라 SYN 이 순간 상태라
5분 표본에 거의 안 잡히는 것이다 — 화면에도 그렇게 적어 둔다.

- 구현: `types/counter.ts` `HOST_FIVE_MIN_COUNTERS` / `HOST_UNCOLLECTED_COUNTERS`,
  화면은 `FiveMinCounterChart` + App 의 "호스트 · 5분 집계"
- 재현: `cargo test --test live_collector live_host_five_min_counters -- --ignored --nocapture`

### F-41. datasource 카운터는 **관문이 둘**이고, 별도 오브젝트로 올라온다

`ConnActive`/`ConnIdle`/`ConnMax` 가 "sub-object 미구현" 으로 오래 막혀 있었다.
실제로는 클라이언트 구조 문제가 아니라 **데이터가 없었던 것**이다.

에이전트는 커넥션 풀을 **JMX 로 읽어** 부모와 **별개의 오브젝트**로 등록한다.

```
/shop-app/shop-app/HikariPool-1   objType=datasource   hash=-1273694193
/order-app/order-app/HikariPool-1 objType=datasource   hash=563632909
```

> objType 은 `tomcat_ds` 가 **아니다**. 에이전트 바이트코드에 `_ds` 문자열이 있어
> 그렇게 짐작하기 쉬운데, 실측하면 `datasource` 다. 그 문자열은 다른 경로용이다.

#### 두 관문을 모두 열어야 한다

| 어디 | 키 | 기본값 |
|---|---|---|
| 애플리케이션 | `spring.datasource.hikari.register-mbeans` | **false** |
| 에이전트 | `jmx_counter_enabled` | **false** |

하나만 열면 **에러 없이 0건**이다 (F-15 와 같은 침묵형 실패).
HikariCP 가 MBean 을 등록하지 않으면 에이전트가 풀을 못 찾고,
에이전트의 JMX 수집이 꺼져 있으면 MBean 이 있어도 읽지 않는다.

에이전트는 `com.zaxxer.hikari:type=PoolConfig (<name>)` 에서 `PoolName` 을 얻고
`com.zaxxer.hikari:type=Pool (<name>)` 의 `ActiveConnections`·`IdleConnections`·
`TotalConnections` 를 읽는다.

#### 실측

```
ConnActive → 0 , 0
ConnIdle   → 10 , 10
ConnMax    → 10 , 10
활성 0 + 유휴 10 ≤ 상한 10      (maximum-pool-size: 10 과 일치)
```

`활성 + 유휴 ≤ 상한` 은 카운터가 뒤섞이지 않았는지 보는 교차 검증이다.

- 구현: `counter.ts` 의 `DATASOURCE_COUNTERS`, App 의 "커넥션 풀" 섹션
- 재현: `cargo test --test live_collector live_datasource_counters -- --ignored`
- 켜기: `cargo test --test live_collector enable_interaction_counter -- --ignored`
  (인터랙션과 JMX 를 함께 켠다)

### F-40. 인터랙션(토폴로지)은 **에이전트가 기본으로 수집하지 않는다**

`Interaction / Topology` 는 커널이 따로 있는 게 아니라 커맨드 하나다.

```
INTR_COUNTER_REAL_TIME_BY_OBJ
  파라미터: objType(Text) · objHash(List)   ← 리스트를 비우면 콜렉터가 살아 있는 오브젝트로 채운다
  응답: InteractionPerfCounterPack(PackEnum 65) 스트림   ← MapPack 이 아니다
```

**처음 물으면 0건이 온다.** 원인은 에이전트 설정이다:

```
counter_interaction_enabled = false   ← 기본값
```

이걸 켜야 데이터가 생긴다. 껐다 켜는 건 `SET_CONFIGURE_WAS` 로 원격에서 되는데,
에이전트가 `setConfig` 텍스트를 받아 **`saveText()` 로 파일을 통째로 덮어쓴다.**
원문(`GET_CONFIGURE_WAS`)을 먼저 읽어 덧붙이지 않으면 **설정이 날아간다.**

#### 팩 필드 순서

`time`·`totalElapsed` 는 **8바이트 고정**(`readLong`), `fromHash`~`errorCount` 는
**4바이트 고정**(`readInt`)이다. `readDecimal` 이 아니다 — F-17 과 같은 함정이다.

```
time(long) · objName(text) · interactionType(text) · fromHash(int) · toHash(int)
· period(int) · count(int) · errorCount(int) · totalElapsed(long) · customData(value)
```

`customData` 를 안 읽으면 다음 팩부터 어긋난다 (AlertPack 의 `tags` 와 동일).

#### 실측 (30초 구간)

```
INTR_API_INCOMING     16367847 → -1585387669   86건  err0  24,184ms
INTR_NORMAL_INCOMING          0 → -1585387669  379건 err15 46,126ms
INTR_DB_CALL       -1585387669 →  -662702541  1203건 err0     381ms
INTR_NORMAL_OUTGOING   16367847 →   669031003   83건 err6   9,239ms
```

- `from_hash = 0` 은 **외부**다 (에이전트 밖에서 들어온 호출).
- 상대가 에이전트면 `objHash`, 외부 자원이면 해시다.

#### 해시는 `object` 사전으로 푼다 — `obj` 가 아니다

```
-662702541  → "jdbc:postgresql://postgres:5432/shopdb"
 669031003  → "shop-app:8081"
-1838954330 → "jdbc:postgresql://postgres:5432/orderdb"
```

`TextTypes.class` 의 실제 목록은 다음과 같고, **우리 상수 네 개가 틀려 있었다**:

```
error apicall method service sql object referer ua group city table maria login desc web hmsg stackelem
```

| 우리가 쓰던 값 | 실제 |
|---|---|
| `obj` | **`object`** |
| `hashMsg` | `hmsg` |
| `sqlTable` | `table` |
| `stack` | `stackelem` |
| `threadName` | **목록에 없음** — 사전으로는 못 푼다 |

틀린 이름으로 물으면 F-15 처럼 **에러 없이 빈 결과**다. 다행히 이 상수들은 아직
어디에서도 쓰이지 않아 실제 증상은 없었다.

- 구현: `scouter/pack.rs` `InteractionCounterPack`, `connection.rs` `read_interaction_pack`
- 재현: `cargo test --test live_collector probe_interaction_counter -- --ignored`
- 수집 켜기: `cargo test --test live_collector enable_interaction_counter -- --ignored`

### F-39. 에러 요약의 `message` 는 hashMsg 가 아니라 **error 사전**이다

에러 요약(`LOAD_SERVICE_ERROR_SUMMARY`)은 해시를 네 개 준다. 어느 사전으로 푸는지
이름만 보고 정하면 틀린다 — 후보 사전을 전부 던져 **실제로 텍스트가 오는 것**을 확인했다.

| 필드 | 사전 | 실측값 |
|---|---|---|
| `id` | `service` | `/order/lab/timeout<GET>` (= `service` 와 같은 값) |
| `error` | `error` | `java.net.SocketTimeoutException` |
| `service` | `service` | `/order/lab/timeout<GET>` |
| `message` | **`error`** | `Read timed out
 java.net.SocketTimeoutException: ...` (스택 포함) |

`message` 를 이름만 보고 `hashMsg` 로 풀면 **영영 안 나온다**. 화면에는 숫자만 남는다.

두 가지 더:

- `message` 값에는 **스택트레이스가 통째로** 들어 있다. 표에는 첫 줄만 쓰고 나머지는 툴팁으로 돌린다.
- `sql`·`apicall` 은 원인 표시다. `0` 이면 해당 없음이므로 칩을 그리지 않는다.
  실측에서 타임아웃 에러는 `sql=0, apicall≠0` 이었다 — API 호출이 원인이라는 뜻이고,
  대표 `txid` 로 열어 보면 실제로 `shop-app:8081 /shop/lab/slow` 호출에서 끊겼다.

- 구현: `SummaryPanel` 의 에러 탭, `get_error_summary`
- 재현: `cargo test --test live_collector probe_error_summary_dictionaries -- --ignored`

### F-38. 요약(Summary)은 커맨드 여섯 개가 파라미터를 공유한다

`TypeSummary`(ASIS SummaryDialog)가 어느 커맨드를 쓰는지 미조사로 남아 있었다.
`SummaryService.class` 를 읽어 닫았다.

파라미터는 **여섯 개 모두 같다** — `date`(Text) · `stime`(long) · `etime`(long) ·
`objType`(Text) · `objHash`(int). `objHash=0` 이면 타입 전체다.

세 커맨드(`LOAD_SERVICE_SUMMARY`·`LOAD_SQL_SUMMARY`·`LOAD_APICALL_SUMMARY`)는
서버에서 **한 메서드**(`load(byte, …)`)를 `SummaryEnum` 으로 갈라 쓴다
(APP=1 · SQL=2 · APICALL=5). 응답은 전부 병렬 리스트 MapPack 이다.

| 커맨드 | 리스트 | 실측(6시간) |
|---|---|---|
| `LOAD_SERVICE_SUMMARY` | id · count · error · elapsed · **cpu · mem** | 14행 / 215,575호출 |
| `LOAD_SQL_SUMMARY` | id · count · error · elapsed | 13행 |
| `LOAD_APICALL_SUMMARY` | id · count · error · elapsed | 201행 |
| `LOAD_IP_SUMMARY` | id · count | 7행 |
| `LOAD_UA_SUMMARY` | id · count | 2행 |
| `LOAD_SERVICE_ERROR_SUMMARY` | id · error · service · message · count · txid · sql · apicall · fullstack | 1행 |

주의할 점 셋.

1. **`cpu`·`mem` 은 서비스 요약에만 붙는다.** 바이트코드에서 `iload_1 / iconst_1 /
   if_icmpne` 로 `SummaryEnum.APP` 일 때만 리스트를 만든다. 나머지 요약에서 이 값을
   0 으로 채우면 "CPU 를 0ms 썼다" 는 **없던 사실**이 생긴다. `Option` 으로 둔다.
   같은 이유로 IP·UA 요약의 `elapsed`·`error` 도 None 이어야 한다.
2. **`id` 는 해시다.** 종류별 사전으로 풀어야 이름이 나온다
   (service / sql / apicall / ip / ua).
3. 에러 요약만 리스트 구성이 다르고, **대표 `txid`** 를 준다 — 그 트랜잭션을 바로 열 수 있다.
   i64 라 프론트에는 문자열로 넘긴다. 실측값 `-4159901529493293911`.

- 구현: `scouter/summary.rs`, 커맨드 `get_summary` / `get_error_summary`
- 재현: `cargo test --test live_collector live_summary_shapes -- --ignored`

### F-37. 설정 조회는 커맨드가 **원문과 목록으로 나뉘어** 있다

`ConfigureService.class` 를 읽어 확인했다. 네 커맨드가 짝을 이룬다.

| 커맨드 | 파라미터 | 응답 키 | 실측 |
|---|---|---|---|
| `GET_CONFIGURE_WAS` | `objHash` | `agentConfig`(Text 전문) · `configKey`(List) | 1,185자 / 306키 |
| `LIST_CONFIGURE_WAS` | `objHash` | `key` · `value` · `default` 세 List | 306개 |
| `GET_CONFIGURE_SERVER` | **없음** | `serverConfig`(Text 전문) · `configKey`(List) | 760자 / 138키 |
| `LIST_CONFIGURE_SERVER` | **없음** | `key` · `value` · `default` 세 List | 138개 |

세 가지가 중요하다.

1. **전문과 목록은 서로 다른 커맨드다.** `GET_*` 은 설정 파일을 문자열로 그대로 주고
   `LIST_*` 는 실효값(기본값 포함)을 준다. 파일에 없는 설정도 `LIST_*` 에는 나온다 —
   화면에서 "무엇이 기본값과 다른가"를 답하려면 `LIST_*` 가 있어야 한다.
   실측 306개 중 기본값과 다른 항목은 **13개**였다.
2. **WAS 쪽 둘은 콜렉터가 에이전트에 되물어본다** (`AgentCall.call`). 에이전트가 없거나
   답이 null 이면 콜렉터는 `writePack` 자체를 하지 않는다 — 오류가 아니라 **빈 응답**이다.
   F-15 와 같은 침묵형 실패라 0건을 성공으로 넘기면 안 된다.
3. **호스트 에이전트도 답한다.** javaee 전용이 아니다 — `linux` 오브젝트로도 41개가 왔다.
   메뉴를 JVM 에이전트로 제한할 이유가 없다.

`value`/`default` 는 타입이 섞여 온다(Text·Decimal·Boolean·**Null**). Null 을 `"null"` 로
쓰면 없는 설정이 생기므로 빈 문자열로 둔다. 세 List 의 길이가 어긋나면 짧은 쪽에 맞춰
자른다 — 인덱스로만 짝지으면 빈 자리가 "기본값이 비었다 → 바뀐 설정"으로 둔갑한다.

쓰기 쪽(`SET_CONFIGURE_WAS`, `REDEFINE_CLASSES`)은 같은 자리에 있으나 구현하지 않았다.

- 구현: `scouter/configure.rs`, 화면은 `ObjectInspector` 의 `config`
- 재현: `cargo test --test live_collector live_agent_config live_server_config -- --ignored`

### F-27. `OBJECT_HEAPHISTO` 는 서식이 잡힌 텍스트 줄로 온다

`heaphisto` → Text 리스트다. 값이 아니라 **`jmap -histo` 출력 그대로**다.

```text
   2:        238522        5724528  java.lang.String (java.base@17.0.19)
   3:        100749        4351720  [Ljava.lang.Object; (java.base@17.0.19)
```

- 실측 **7,027행**. 그대로 뿌리면 "무엇이 메모리를 먹는가" 로 정렬할 수 없어 열로 나눈다.
- 첫 토큰이 `2:` 처럼 콜론으로 끝난다. 머리글(`num #instances …`)·구분선·`Total` 줄은
  이 형식이 아니라 자연히 걸러진다.
- 클래스명 뒤에 모듈 표기가 붙는다(`(java.base@17.0.19)`) — 공백이 있으므로
  마지막 토큰만 취하면 안 되고 나머지 전부를 이어야 한다.
- `TRIGGER_HEAPHISTO` 는 파일도 만든다(`scouter.heaphisto.*.dump`).
- 재현: `cargo test --test live_collector live_object_heap_histogram -- --ignored`

### F-25 후속: 원인은 **JRE 이미지에 `jdk.attach` 가 없어서**였다

`podman exec shop-app java --list-modules` 로 확인했다 — temurin **JRE** 이미지는
모듈이 50개뿐이고 `jdk.attach` 가 없다. Scouter 의 스레드 덤프/힙 히스토그램은
attach API 를 쓰므로 파일이 size=0 으로 만들어졌다.

앱 컨테이너 베이스를 `eclipse-temurin:17-jre` → **`17-jdk`** 로 바꾸자
같은 덤프가 47KB 로 나온다. `-Djdk.attach.allowAttachSelf=true` 는 원래부터 걸려 있었다 —
플래그는 맞았고 모듈이 없었던 것이다.

### 이 환경에서 **덤프 계열이 비어 있다** (해결됨 — 위 참조)

`OBJECT_THREAD_DUMP` 와 `OBJECT_HEAPHISTO` 는 MapPack 으로 응답은 오지만
`threadDump` / `heaphisto` 가 **빈 리스트**다. 덤프는 2단계였다:

```
TRIGGER_THREAD_DUMP      → name="scouter.threaddump.20260816100034.dump"  (파일 생성)
OBJECT_DUMP_FILE_LIST    → name/size/last_modified 리스트 … **size=0**
OBJECT_DUMP_FILE_DETAIL  → 빈 응답 (파라미터 name/file 둘 다)
```

파일은 만들어지는데 **크기가 0** 이다. 세 기능이 같은 증상이고 모두 JVM tools 경로를
쓰므로 원인이 하나로 보이지만(JRE 이미지라 attach/tools 불가 추정) **확인하지 못했다.**
`eclipse-temurin:17-jre` 를 `-jdk` 로 바꿔 재현해 보는 것이 다음 단계다.

- 재현: `cargo test --test live_collector live_object_sockets live_object_class_list_paginates -- --ignored`

---

## 미해결 / 관찰만 한 것 (추가)

| ID | 내용 | 상태 |
|---|---|---|
| O-5 | `read_next_pack` 이 모르는 팩 타입을 만나면 **본문을 읽지 않고** `Unknown` 을 돌려줘 이후 스트림이 어긋난다 | **수정됨.** 건너뛸 수 없으므로 에러로 멈춘다. `AnyPack::Unknown` 제거 |

### 스트림이 어긋나면 **에러가 아니라 멈춘다**

O-5 를 고치면서 확인한 것이다. `read_object_pack` 의 `read_decimal` 을 `read_int` 로
바꿔(길이 오독 재현) 통합 테스트를 돌리면 **실패하지 않고 무한 대기한다.**

어긋난 파서가 쓰레기 바이트를 길이로 해석하면 있지도 않은 본문을 기다리며
소켓에서 블록되기 때문이다. 타임아웃이 없으면 화면이 조용히 멈춘 것처럼 보인다.

- 그래서 모르는 팩을 "무시하고 계속"은 최악의 선택이다 — 에러로 끊는 게 맞다.
- 재현: `read_object_pack` 의 `let obj_hash = self.read_decimal()? as i32;` 를
  `self.read_int()?` 로 바꾸고 `cargo test --test scouter_integration`

### F-16. 알람 규칙은 컴파일에 실패하지만, 오브젝트 생명주기 알람은 나온다

콜렉터 기동 로그:

```
[A1601] error on toClass with javassist. try to fallback for java8 below.
  err:scouter.server.alert.impl.ErrorRate not in same package as lookup class:
      scouter.server.plugin.impl.Neighbor has no permission to define the class
[S215] Alert rule detected : ErrorRate.alert
```

유일한 알람 규칙(`ErrorRate.alert`)이 **런타임 컴파일에 실패한다.** javassist가
`MethodHandles.Lookup.defineClass`로 폴백하는데 패키지가 달라 거부된다.
`--add-opens`로는 해결되지 않는다(접근 권한이 아니라 패키지 불일치다).

**따라서 임계치 기반 알람(ErrorRate 등)은 이 환경에서 발생하지 않는다.**

**그러나 오브젝트 생명주기 알람은 별개다.** 규칙 스크립트와 무관하게 콜렉터가 직접 만든다.

```
podman stop order-app    → INACTIVE_OBJECT
podman start order-app   → ACTIVATED_OBJECT
```

이 알람으로 F-17(AlertPack 필드 순서)을 실측 검증했다.
**알람 기능을 테스트하려면 오브젝트를 껐다 켜면 된다.**

> 처음에는 "이 환경은 알람을 만들지 못한다"고 적었는데 **틀렸다.**
> `ALERT_REAL_TIME` 요청에 `objType=tomcat` 을 줘서 걸러진 것이었다 —
> 생명주기 알람은 `objType=scouter` 로 온다. **파라미터를 빼면 다 온다.**

---

## Collector 운영

### F-6. JDK 11+ 에서 기동하려면 `--add-opens`가 필요하다

릴리스의 `server/startup.sh` 커맨드를 그대로 쓰면 **기동에 실패한다**.

```
java.security.PrivilegedActionException: java.lang.NoSuchMethodException:
    sun.misc.Unsafe.defineClass(...)
  at com.sun.xml.bind.v2.runtime.reflect.opt.Injector.<clinit>
Exception in thread "main" java.lang.ExceptionInInitializerError
  at scouter.server.Configure.<clinit>(Configure.java:78)
```

번들된 JAXB RI 2.x가 JDK 11에서 제거된 `sun.misc.Unsafe.defineClass`를 먼저 찾고,
폴백인 `ClassLoader.defineClass` 리플렉션이 JDK 16+ 강한 캡슐화에 막힌다.

```
--add-opens=java.base/java.lang=ALL-UNNAMED
--add-exports=java.base/sun.net=ALL-UNNAMED
```

### F-7. 바이트코드 버전 — Java 17로 전부 동작한다

| jar | major | 대응 JDK |
|-----|-------|----------|
| `server/scouter-server-boot.jar` | 52 | Java 8 |
| `server/lib/scouter-server-2.21.3.jar` | 50 | Java 6 (Scala 2.11) |
| `agent.java/scouter.agent.jar` | **52** | **Java 8** |
| `agent.java21plus/scouter.agent.jar` | 65 | Java 21 전용 |

릴리스 노트의 "Minimum Java version increased from 17 to 21"은 **Eclipse RCP 클라이언트에만**
해당한다. NScouter가 그 클라이언트를 대체하므로 무관하다.

### F-8. Collector가 여는 포트

| 포트 | 프로토콜 | 용도 |
|------|----------|------|
| 6100 | TCP | 클라이언트 / 에이전트 ← NScouter 접속 대상 |
| 6100 | UDP | 에이전트 성능 메트릭 |
| 6180 | TCP | 내장 Jetty. `net_http_server_enabled=false`를 줘도 **뜬다** |

---

## 에이전트 / 신호 생성

### F-9. Scouter 기본 JDBC 후킹 대상에 SQLite는 없다

기본 대상: Oracle / MariaDB / MySQL / **PostgreSQL** / jTDS / SQLServer / Tibero /
HSQLDB / H2 / CUBRID / Altibase
(`JDBCPreparedStatementASM.class`, `JDBCStatementASM.class` 상수 풀에서 확인)

SQLite를 쓰면 `sqlCount`/`sqlTime`이 항상 0이고 프로파일에 SQL 스텝이 안 남는다.
`hook_jdbc_{pstmt,stmt,rs}_classes`로 직접 지정하면 동작하지만,
**테스트 환경은 PostgreSQL로 교체해 이 우회를 제거했다.**

### F-10. `error` 필드는 실제로 던져진 예외만 기록한다

각 유형 10회 호출 후 XLog `error != 0` 증가분:

| 예외 | 증가 |
|---|---|
| `NullPointerException` | **+10** |
| `IllegalStateException` | **+10** |
| `ResponseStatusException(500)` | **+0** |

Spring 예외 리졸버가 처리하는 예외는 서블릿까지 전파되지 않아 응답이 500이어도
XLog는 정상으로 남는다. **빨간 점을 만들려면 실제 예외를 던져야 한다.**

### F-11. XLog 전송 하한 설정

둘 다 0이 아니면 빠른 트랜잭션이 전송되지 않아 스캐터가 비어 보인다.

| 위치 | 키 |
|---|---|
| Collector `conf/scouter.conf` | `xlog_realtime_lower_bound_ms`, `xlog_pasttime_lower_bound_ms` |
| Agent conf | `xlog_lower_bound_time_ms` |

에이전트 쪽 `xlog_sampling_enabled=false`도 함께 둬야 표본 추출로 누락되지 않는다.

### F-12. 존재하지 않는 에이전트 설정 키

계획 초안에 적었다가 `javap -p scouter.agent.Configure`로 확인해보니 **없는 키**였다.

- `profile_sql_enabled` — 없음
- `profile_apicall_enabled` — 없음

SQL·apicall 프로파일은 `profile_off`가 마스터 스위치이고 기본 수집된다.
**에이전트/서버 설정 키는 반드시 `javap -p`로 실제 public 필드를 확인하고 쓸 것.**

---

## 도구 / 환경

### F-13. podman-compose는 Windows에서 `build:` 섹션이 동작하지 않는다

`is_context_git_url()`이 드라이브 문자 절대경로를 git URL로 오인한다
(`urlparse("E:\\...")`가 `E`를 scheme으로 파싱).

```
'.'                                    -> is_git_url = False
'E:\Programming\Project\NScouter\Test' -> is_git_url = True
```

`-f`가 podman에 전달되지 않아 실패한다. **대응**: `compose.yml`에 `build:`를 쓰지 않고
`Test/scripts/build.ps1`이 `podman build`를 직접 호출한다.

`profiles:`, `depends_on: condition: service_healthy`는 정상 동작한다 (podman-compose 1.6.0).

### F-14. podman machine 이름

이 머신의 machine 이름은 `podman-machine`이다. 기본값(`podman-machine-default`)이 아니므로
`podman machine start podman-machine`처럼 이름을 명시해야 한다.

---

## 미해결 / 관찰만 한 것

| ID | 내용 | 상태 |
|---|---|---|
| O-1 | `open_socket()`이 `parse::<SocketAddr>()`를 써서 IP 리터럴만 받는다. `localhost` 등 호스트명 불가 | **수정됨.** `resolve_addr()` 가 `ToSocketAddrs` 로 해석한다 |
| O-2 | `mock_server.rs`가 오브젝트 목록을 ObjectPack이 아닌 MapPack으로 응답. F-4 회귀를 잡지 못함 | **수정됨.** PackType 80 실제 필드 순서로 응답 |
| O-3 | Collector `net_http_server_enabled=false`가 실제로는 Jetty를 막지 못함 | 영향 없음 (호스트 미퍼블리시) |
| O-4 | 알람 규칙(`ErrorRate.alert`) 컴파일 실패 (F-16) | 미해결. 임계치 알람은 못 만든다. 생명주기 알람은 정상이라 프로토콜 검증은 가능했다 |
