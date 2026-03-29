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
pub const CMD_GET_OBJECT_LIST_REAL_TIME: &str = "GET_OBJECT_LIST_REAL_TIME";
pub const CMD_TRANX_PROFILE: &str = "TRANX_PROFILE";
pub const CMD_XLOG_READ_BY_TXID: &str = "XLOG_READ_BY_TXID";
pub const CMD_COUNTER_REAL_TIME_ALL: &str = "COUNTER_REAL_TIME_ALL";
pub const CMD_ALERT_REAL_TIME: &str = "ALERT_REAL_TIME";

// ─── TextType ─────────────────────────────────────────────────
/// GET_TEXT_100 요청 시 사용하는 텍스트 종류 (ASIS: TextTypes.java)
pub mod text_type {
    pub const SERVICE: &str = "service";
    pub const SQL: &str = "sql";
    pub const METHOD: &str = "method";
    pub const ERROR: &str = "error";
    pub const APICALL: &str = "apicall";
    pub const OBJECT: &str = "obj";
    pub const REFERER: &str = "referer";
    pub const USER_AGENT: &str = "ua";
    pub const GROUP: &str = "group";
    pub const LOGIN: &str = "login";
    pub const DESC: &str = "desc";
    pub const THREAD_NAME: &str = "threadName";
    pub const WEB: &str = "web";
    pub const CITY: &str = "city";
    pub const SQL_TABLES: &str = "sqlTable";
    pub const HASH_MSG: &str = "hashMsg";
    pub const STACK: &str = "stack";
}

// ─── 기타 상수 ────────────────────────────────────────────────
/// Collector 기본 TCP 포트
pub const DEFAULT_COLLECTOR_PORT: u16 = 6100;
/// TCP 연결 타임아웃 (ms) — ASIS: ClientTCP.java
pub const CONNECT_TIMEOUT_MS: u64 = 3000;
/// SHA-256 솔트 — ASIS: CipherUtil.java
pub const PASSWORD_SALT: &str = "qwertyuiop!@#$%^&*()zxcvbnm,.";
