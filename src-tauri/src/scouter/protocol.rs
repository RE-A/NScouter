// Scouter 프로토콜 상수
// 참조: docs/asis/14-collector-tcp-protocol.md
// ASIS: scouter.common/.../net/NetCafe.java, TcpFlag.java, RequestCmd.java, PackEnum.java, ValueEnum.java

// ─── 연결 매직 ────────────────────────────────────────────────
/// 클라이언트 연결 식별자. 연결 직후 첫 4바이트로 전송 (Big-Endian)
pub const TCP_CLIENT_MAGIC: u32 = 0xCAFE_2001;

// ─── TcpFlag ──────────────────────────────────────────────────
/// 정상 응답, 스트림 종료
pub const FLAG_OK: u8 = 0x01;
/// 오류 응답
pub const FLAG_NOT_OK: u8 = 0x02;
/// 다음 Pack이 있음 → 계속 읽기
pub const FLAG_HAS_NEXT: u8 = 0x03;
/// 스트림 종료 (정상)
pub const FLAG_NO_NEXT: u8 = 0x04;
/// 요청 실패
pub const FLAG_FAIL: u8 = 0x05;
/// 세션 만료 → 재로그인 필요
pub const FLAG_INVALID_SESSION: u8 = 0x44;

// ─── PackEnum ─────────────────────────────────────────────────
pub const PACK_MAP: u8 = 10;
pub const PACK_XLOG: u8 = 21;
pub const PACK_DROPPED_XLOG: u8 = 22;
pub const PACK_XLOG_PROFILE: u8 = 26;
pub const PACK_XLOG_PROFILE2: u8 = 27;
pub const PACK_PERF_COUNTER: u8 = 60;
pub const PACK_ALERT: u8 = 70;
pub const PACK_OBJECT: u8 = 80;
/// 인터랙션 카운터. 에이전트 설정을 켜야 온다 (F-40)
pub const PACK_INTERACTION_COUNTER: u8 = 65;
/// 샘플링으로 모은 스레드 스택 한 장. **본문이 GZIP 이다** (F-45)
pub const PACK_STACK: u8 = 62;

// ─── ValueEnum ────────────────────────────────────────────────
pub const VALUE_NULL: u8 = 0;
pub const VALUE_BOOLEAN: u8 = 10;
pub const VALUE_DECIMAL: u8 = 20;
pub const VALUE_FLOAT: u8 = 30;
pub const VALUE_DOUBLE: u8 = 40;
pub const VALUE_TEXT: u8 = 50;
pub const VALUE_BLOB: u8 = 60;
pub const VALUE_LIST: u8 = 70;
pub const VALUE_MAP: u8 = 80;

// ─── RequestCmd ───────────────────────────────────────────────
pub const CMD_LOGIN: &str = "LOGIN";
pub const CMD_TRANX_REAL_TIME_GROUP: &str = "TRANX_REAL_TIME_GROUP";
pub const CMD_TRANX_REAL_TIME_GROUP_LATEST: &str = "TRANX_REAL_TIME_GROUP_LATEST";
pub const CMD_GET_TEXT_100: &str = "GET_TEXT_100";
/// ASIS: scouter.net.RequestCmd.OBJECT_LIST_REAL_TIME
/// "GET_" 접두가 붙은 커맨드는 존재하지 않는다. 잘못된 이름을 보내면
/// Collector가 응답 없이 TCP 연결을 끊는다.
pub const CMD_OBJECT_LIST_REAL_TIME: &str = "OBJECT_LIST_REAL_TIME";

// 오브젝트 단건 명령 — 콜렉터가 에이전트로 중계한다.
// 응답은 전부 MapPack (실측: probe_object_mappack_keys).
pub const CMD_OBJECT_ENV: &str = "OBJECT_ENV";
pub const CMD_OBJECT_THREAD_LIST: &str = "OBJECT_THREAD_LIST";
pub const CMD_OBJECT_CLASS_LIST: &str = "OBJECT_CLASS_LIST";
pub const CMD_OBJECT_ACTIVE_SERVICE_LIST: &str = "OBJECT_ACTIVE_SERVICE_LIST";

// 덤프 — 파일을 만들고(TRIGGER) 목록을 보고(LIST) 내용을 받는(DETAIL) 3단계다.
// DETAIL 응답만 Pack 이 아니라 **blob 청크 스트림**이다 (F-26).
pub const CMD_OBJECT_HEAPHISTO: &str = "OBJECT_HEAPHISTO";

/// 과거 XLog 시간 범위 조회. V1 과 달리 페이지네이션이 있다 (F-28).
pub const CMD_TRANX_LOAD_TIME_GROUP_V2: &str = "TRANX_LOAD_TIME_GROUP_V2";
pub const CMD_TRIGGER_THREAD_DUMP: &str = "TRIGGER_THREAD_DUMP";
/// 액티브 서비스 목록을 **파일로** 남긴다. 응답은 파일명 하나 (F-35)
pub const CMD_TRIGGER_ACTIVE_SERVICE_LIST: &str = "TRIGGER_ACTIVE_SERVICE_LIST";
pub const CMD_TRIGGER_THREAD_LIST: &str = "TRIGGER_THREAD_LIST";
pub const CMD_TRIGGER_HEAPHISTO: &str = "TRIGGER_HEAPHISTO";

// ─── 부수효과가 있는 명령 ─────────────────────────────────────
// 눌러 놓고 되돌릴 수 없다. 호출부가 사용자 확인을 받아야 한다.
/// 에이전트 JVM 에 Full GC. **응답이 없다** (F-35)
pub const CMD_OBJECT_SYSTEM_GC: &str = "OBJECT_SYSTEM_GC";
/// 에이전트 텍스트 캐시 비우기. 응답이 없다
pub const CMD_OBJECT_RESET_CACHE: &str = "OBJECT_RESET_CACHE";
/// 스택 샘플링 켜기/끄기. `time` 이 있으면 켜기, 없으면 끄기
pub const CMD_PSTACK_ON: &str = "PSTACK_ON";

/// 실행 중인 트랜잭션 한 건의 상세 — **스택 트레이스가 여기 있다**.
/// 파라미터는 objHash / id(스레드) / txid 셋이다 (F-46)
pub const CMD_OBJECT_THREAD_DETAIL: &str = "OBJECT_THREAD_DETAIL";

/// 모인 스택의 **시각 목록**. 응답이 Pack 이 아니라 **raw long 나열**이다 (F-45)
pub const CMD_GET_STACK_INDEX: &str = "GET_STACK_INDEX";
/// 한 구간의 스택 원문. 응답은 StackPack(62) 스트림
pub const CMD_GET_STACK_ANALYZER: &str = "GET_STACK_ANALYZER";
/// 힙 덤프. **`fName`·`time` 이 없으면 조용히 빈 응답이다** (F-35)
pub const CMD_OBJECT_CALL_HEAP_DUMP: &str = "OBJECT_CALL_HEAP_DUMP";
pub const CMD_OBJECT_DUMP_FILE_LIST: &str = "OBJECT_DUMP_FILE_LIST";
pub const CMD_OBJECT_DUMP_FILE_DETAIL: &str = "OBJECT_DUMP_FILE_DETAIL";
/// **명령 문자열이 이름과 다르다.** `"OBJECT_SOCKET"` 이 아니라 `"SOCKET"` 이다.
pub const CMD_OBJECT_SOCKET: &str = "SOCKET";
pub const CMD_TRANX_PROFILE: &str = "TRANX_PROFILE";
/// 상한 없는(`max=-1`) 프로파일. 응답이 Pack 이 아니라 **blob 청크 스트림**이다 (F-30).
pub const CMD_TRANX_PROFILE_FULL: &str = "TRANX_PROFILE_FULL";
pub const CMD_XLOG_READ_BY_TXID: &str = "XLOG_READ_BY_TXID";
/// gxid 로 연관 XLog 전부. **`date`+`gxid`** 를 읽는다.
/// 이름이 비슷한 `XLOG_LOAD_BY_GXID` 는 `stime`/`etime` 을 읽으므로 서로 바꿔 쓰면 0건이 온다.
pub const CMD_XLOG_READ_BY_GXID: &str = "XLOG_READ_BY_GXID";
pub const CMD_COUNTER_REAL_TIME_ALL: &str = "COUNTER_REAL_TIME_ALL";
/// 카운터 여러 개를 요청 1회로. 응답은 objHash/counter/value 병렬 리스트다.
/// ASIS: CounterConsumer.java:283
pub const CMD_COUNTER_REAL_TIME_ALL_MULTI: &str = "COUNTER_REAL_TIME_ALL_MULTI";
pub const CMD_ALERT_REAL_TIME: &str = "ALERT_REAL_TIME";

// ─── objType 단위 (우클릭 메뉴) ───────────────────────────────
// 파라미터는 전부 `objType` 하나다. 실측 결과는 F-32.
/// 오브젝트별 액티브 서비스 (Vertical EQ)
pub const CMD_ACTIVESPEED_REAL_TIME: &str = "ACTIVESPEED_REAL_TIME";
/// 타입 전체 합계 + TPS (ActiveSpeed)
pub const CMD_ACTIVESPEED_REAL_TIME_GROUP: &str = "ACTIVESPEED_REAL_TIME_GROUP";

/// 서비스 그룹(TPS / Elapsed) — **파라미터가 objHash 목록이다.** objType 이 아니다 (F-44)
pub const CMD_REALTIME_SERVICE_GROUP: &str = "REALTIME_SERVICE_GROUP";
/// 오늘 하루 누적 카운터. 응답은 오브젝트당 `time[]`/`value[]`
pub const CMD_COUNTER_TODAY_ALL: &str = "COUNTER_TODAY_ALL";
/// 지정 날짜 누적 카운터
pub const CMD_COUNTER_PAST_DATE_ALL: &str = "COUNTER_PAST_DATE_ALL";
/// 오늘 방문자 수. **Pack 이 아니라 Value 하나가 온다** (F-32)
pub const CMD_VISITOR_REALTIME_TOTAL: &str = "VISITOR_REALTIME_TOTAL";

// ─── 설정 조회 ────────────────────────────────────────────────
// WAS 쪽 둘은 콜렉터가 **에이전트에 되물어본다**. 에이전트가 답하지 않으면
// 콜렉터는 아무것도 쓰지 않는다 — 오류가 아니라 빈 응답이다 (F-37).
/// 에이전트 설정 파일 원문. `objHash` 필요
pub const CMD_GET_CONFIGURE_WAS: &str = "GET_CONFIGURE_WAS";
/// 에이전트 설정 key/value/default 목록. `objHash` 필요
pub const CMD_LIST_CONFIGURE_WAS: &str = "LIST_CONFIGURE_WAS";
/// 콜렉터 설정 파일 원문. 파라미터 없음
pub const CMD_GET_CONFIGURE_SERVER: &str = "GET_CONFIGURE_SERVER";
/// 콜렉터 설정 key/value/default 목록. 파라미터 없음
pub const CMD_LIST_CONFIGURE_SERVER: &str = "LIST_CONFIGURE_SERVER";
/// 에이전트 설정 **저장**. `objHash` + `setConfig`(전문).
/// **부수효과**: 에이전트가 파일을 통째로 덮어쓰고 reload 한다 (F-40)
pub const CMD_SET_CONFIGURE_WAS: &str = "SET_CONFIGURE_WAS";

// ─── 인터랙션 (토폴로지) ──────────────────────────────────────
/// 오브젝트별 호출 관계. `objType`(Text) + `objHash`(List, 비우면 타입 전체).
/// 응답은 MapPack 이 아니라 `InteractionCounterPack`(65) 스트림이다 (F-40)
pub const CMD_INTR_COUNTER_REAL_TIME_BY_OBJ: &str = "INTR_COUNTER_REAL_TIME_BY_OBJ";

// ─── 요약 (SummaryDialog) ─────────────────────────────────────
// 여섯 커맨드가 파라미터를 공유한다: `date`·`stime`·`etime`·`objType`·`objHash`.
// `objHash=0` 이면 타입 전체. 응답은 병렬 리스트이고 `id` 는 **해시**다 (F-38).
/// 서비스별 요약. **`cpu`·`mem` 이 붙는 유일한 커맨드다**
pub const CMD_LOAD_SERVICE_SUMMARY: &str = "LOAD_SERVICE_SUMMARY";
pub const CMD_LOAD_SQL_SUMMARY: &str = "LOAD_SQL_SUMMARY";
pub const CMD_LOAD_APICALL_SUMMARY: &str = "LOAD_APICALL_SUMMARY";
/// 호출자 IP별. `id`·`count` 뿐이다
pub const CMD_LOAD_IP_SUMMARY: &str = "LOAD_IP_SUMMARY";
/// User-Agent별. `id`·`count` 뿐이다
pub const CMD_LOAD_UA_SUMMARY: &str = "LOAD_UA_SUMMARY";
/// 에러 요약. 리스트 구성이 아예 다르다 (service·message·txid 까지 온다)
pub const CMD_LOAD_SERVICE_ERROR_SUMMARY: &str = "LOAD_SERVICE_ERROR_SUMMARY";

// ─── TextType ─────────────────────────────────────────────────
/// GET_TEXT_100 요청 시 사용하는 텍스트 종류 (ASIS: TextTypes.java)
pub mod text_type {
    pub const SERVICE: &str = "service";
    pub const SQL: &str = "sql";
    pub const METHOD: &str = "method";
    pub const ERROR: &str = "error";
    pub const APICALL: &str = "apicall";
    /// **`"obj"` 가 아니라 `"object"` 다.** TextTypes.class 로 확인했다 (F-40).
    /// 틀린 이름으로 물으면 F-15 처럼 조용히 빈 결과가 온다.
    pub const OBJECT: &str = "object";
    pub const REFERER: &str = "referer";
    pub const USER_AGENT: &str = "ua";
    pub const GROUP: &str = "group";
    pub const LOGIN: &str = "login";
    pub const DESC: &str = "desc";
    /// **TextTypes 에 없다.** 스레드 이름은 별도 경로로 온다 — 사전 조회에 쓰면 빈 결과다
    pub const THREAD_NAME: &str = "threadName";
    pub const WEB: &str = "web";
    pub const CITY: &str = "city";
    /// TextTypes 표기는 `table` 이다
    pub const SQL_TABLES: &str = "table";
    /// TextTypes 표기는 `hmsg` 다
    pub const HASH_MSG: &str = "hmsg";
    /// TextTypes 표기는 `stackelem` 이다
    pub const STACK: &str = "stackelem";
}

// ─── 기타 상수 ────────────────────────────────────────────────
/// Collector 기본 TCP 포트
pub const DEFAULT_COLLECTOR_PORT: u16 = 6100;
/// TCP 연결 타임아웃 (ms) — ASIS: ClientTCP.java
pub const CONNECT_TIMEOUT_MS: u64 = 3000;
/// SHA-256 솔트 — ASIS: CipherUtil.java
pub const PASSWORD_SALT: &str = "qwertyuiop!@#$%^&*()zxcvbnm,.";
