# NScouter Tauri 백엔드 설계서

> **참조 문서**
> - 프로토콜 완전 명세: [`../asis/14-collector-tcp-protocol.md`](../asis/14-collector-tcp-protocol.md)
> - 프론트엔드 설계서: [`./xlog-renderer-prototype.md`](./xlog-renderer-prototype.md)
> - XLog 렌더링 데이터 요구사항: [`../asis/07-client-xlog.md`](../asis/07-client-xlog.md)

---

## 1. 개요

### 1.1 Rust 백엔드가 하는 일

| 책임 영역 | 설명 |
|-----------|------|
| TCP 연결 관리 | Scouter Collector 서버(기본 포트 6100)에 TCP 소켓 연결, 매직 넘버 핸드셰이크, 세션 유지 |
| 바이너리 역직렬화 | `DataOutputX`/`DataInputX` 기반 커스텀 바이너리 포맷 파싱 (Decimal, Blob, Pack 등) |
| 인증 | SHA-256(salt 포함) 비밀번호 해싱 후 LOGIN 요청, 세션 토큰 관리 |
| 실시간 XLog 폴링 | 2초 주기로 `TRANX_REAL_TIME_GROUP` 요청 → XLogPack 역직렬화 → Tauri Event emit |
| 딕셔너리 조회 | 해시 → 텍스트 변환 (`GET_TEXT_100`), 로컬 캐시 관리 |
| Tauri 인터페이스 | Command 처리(동기 제어), Event 발행(비동기 데이터 스트림) |

### 1.2 Rust 백엔드가 하지 않는 일 (프론트엔드 담당)

- XLog 데이터 필터링 (응답 시간 범위, 오브젝트별 필터 등)
- Canvas 렌더링 및 좌표 변환
- 시간 윈도우 관리 및 데이터 버퍼 유지 (`XLogDataStore`)
- UI 상태 관리 (줌, 선택 영역, Y축 모드 등)

### 1.3 파일 구조

```
src-tauri/src/
├── lib.rs                  # Tauri app 진입점, command 등록
├── scouter/
│   ├── mod.rs              # 모듈 선언 및 재수출
│   ├── codec.rs            # DataInputX/DataOutputX (ScouterReader/ScouterWriter)
│   ├── protocol.rs         # 상수 (TcpFlag, NetCafe, PackEnum, ValueEnum, RequestCmd)
│   ├── value.rs            # ScouterValue enum, MapData 타입 alias
│   ├── pack.rs             # XLogPack, MapPack 역직렬화
│   ├── connection.rs       # TCP 연결 + 로그인 + 세션 관리
│   ├── streaming.rs        # 실시간 XLog 폴링 루프
│   └── dictionary.rs       # hash→text 캐시 (DictionaryCache)
└── state.rs                # Tauri managed state (AppState)
```

---

## 2. Cargo.toml 의존성

```toml
[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# 비동기 런타임
tokio = { version = "1", features = ["full"] }

# SHA-256 해싱 (로그인 비밀번호 암호화)
sha2 = "0.10"
hex = "0.4"

# 취소 가능한 비동기 태스크 (폴링 루프 중단)
tokio-util = { version = "0.7", features = ["rt"] }

# 에러 처리
thiserror = "2"

# 로깅
log = "0.4"
```

> **선택 기준:**
> - `sha2`: SHA-256 구현. `ring`은 cross-compile 복잡도가 높아 제외.
> - `tokio`: Tauri 2.x가 tokio 위에서 동작하므로 자연스럽게 채택.
> - `thiserror`: `ScouterError` enum에 `Display` 자동 구현 용도.
> - `tokio-util`의 `CancellationToken`: 폴링 태스크 우아한 종료.

---

## 3. 모듈별 상세 설계

### 3.1 `scouter/codec.rs` — 바이너리 코덱

#### ScouterReader 구조체

```rust
use std::io::Cursor;

pub struct ScouterReader {
    inner: Cursor<Vec<u8>>,
}

impl ScouterReader {
    pub fn new(data: Vec<u8>) -> Self { ... }

    // 기본 타입 읽기
    pub fn read_byte(&mut self) -> Result<i8, ScouterError>
    pub fn read_unsigned_byte(&mut self) -> Result<u8, ScouterError>
    pub fn read_short(&mut self) -> Result<i16, ScouterError>
    pub fn read_unsigned_short(&mut self) -> Result<u16, ScouterError>
    pub fn read_int(&mut self) -> Result<i32, ScouterError>
    pub fn read_long(&mut self) -> Result<i64, ScouterError>
    pub fn read_float(&mut self) -> Result<f32, ScouterError>
    pub fn read_double(&mut self) -> Result<f64, ScouterError>
    pub fn read_bool(&mut self) -> Result<bool, ScouterError>

    // 특수 타입
    pub fn read_int3(&mut self) -> Result<i32, ScouterError>
    pub fn read_long5(&mut self) -> Result<i64, ScouterError>
    pub fn read_decimal(&mut self) -> Result<i64, ScouterError>
    pub fn read_blob(&mut self) -> Result<Vec<u8>, ScouterError>
    pub fn read_text(&mut self) -> Result<String, ScouterError>

    // Pack/Value
    pub fn read_value(&mut self) -> Result<ScouterValue, ScouterError>
    pub fn read_pack(&mut self) -> Result<ScouterPack, ScouterError>

    // 남은 바이트 수 (XLogPack 옵션 필드 체크용)
    pub fn available(&self) -> usize
}
```

#### ScouterWriter 구조체

```rust
pub struct ScouterWriter {
    buf: Vec<u8>,
}

impl ScouterWriter {
    pub fn new() -> Self { ... }
    pub fn into_bytes(self) -> Vec<u8>

    pub fn write_byte(&mut self, v: i8)
    pub fn write_unsigned_byte(&mut self, v: u8)
    pub fn write_short(&mut self, v: i16)
    pub fn write_int(&mut self, v: i32)
    pub fn write_long(&mut self, v: i64)
    pub fn write_float(&mut self, v: f32)
    pub fn write_double(&mut self, v: f64)
    pub fn write_bool(&mut self, v: bool)
    pub fn write_decimal(&mut self, v: i64)
    pub fn write_blob(&mut self, data: &[u8])
    pub fn write_text(&mut self, s: &str)
    pub fn write_value(&mut self, v: &ScouterValue)
    pub fn write_pack(&mut self, p: &ScouterPack)
}
```

#### Decimal 디코딩 알고리즘

> 전체 명세: [`../asis/14-collector-tcp-protocol.md#22-decimal`](../asis/14-collector-tcp-protocol.md)

```rust
pub fn read_decimal(&mut self) -> Result<i64, ScouterError> {
    let len = self.read_byte()?;  // 첫 바이트 = 데이터 길이 코드
    match len {
        0 => Ok(0),
        1 => Ok(self.read_byte()? as i64),          // signed byte
        2 => Ok(self.read_short()? as i64),         // signed short
        3 => Ok(self.read_int3()? as i64),          // 3바이트 부호 있는 정수
        4 => Ok(self.read_int()? as i64),           // 4바이트 int
        5 => Ok(self.read_long5()?),                // 5바이트 long
        _ => Ok(self.read_long()?),                 // 8바이트 long (len == 8)
    }
}

// Int3 읽기: 3바이트 Big-endian, 부호 확장
pub fn read_int3(&mut self) -> Result<i32, ScouterError> {
    let b = self.read_bytes(3)?;
    let ch1 = b[0] as i32 & 0xFF;
    let ch2 = b[1] as i32 & 0xFF;
    let ch3 = b[2] as i32 & 0xFF;
    // 24비트를 32비트로 부호 확장: 상위 8비트 채운 후 산술 우시프트 8
    Ok(((ch1 << 24) + (ch2 << 16) + (ch3 << 8)) >> 8)
}

// Long5 읽기: 5바이트 Big-endian
pub fn read_long5(&mut self) -> Result<i64, ScouterError> {
    let b = self.read_bytes(5)?;
    Ok(((b[0] as i64) << 32)
     | ((b[1] as i64 & 255) << 24)
     | ((b[2] as i64 & 255) << 16)
     | ((b[3] as i64 & 255) << 8)
     | (b[4] as i64 & 255))
}
```

#### Blob 디코딩 알고리즘

> 전체 명세: [`../asis/14-collector-tcp-protocol.md#23-blob`](../asis/14-collector-tcp-protocol.md)

```rust
pub fn read_blob(&mut self) -> Result<Vec<u8>, ScouterError> {
    let first = self.read_unsigned_byte()?;
    match first {
        0 => Ok(vec![]),                                   // 빈 blob
        0xFF => {                                          // 255: 다음 2바이트 = ushort 길이
            let len = self.read_unsigned_short()? as usize;
            self.read_bytes(len)
        }
        0xFE => {                                          // 254: 다음 4바이트 = int 길이
            let len = self.read_int()? as usize;
            self.read_bytes(len)
        }
        n => self.read_bytes(n as usize),                  // 1~253: 직접 길이
    }
}
```

#### 단위 테스트 케이스

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // Decimal 경계값 테스트
    #[test]
    fn test_decimal_zero() {
        // 입력: [0x00] → 출력: 0
        let mut r = ScouterReader::new(vec![0x00]);
        assert_eq!(r.read_decimal().unwrap(), 0);
    }

    #[test]
    fn test_decimal_byte_max() {
        // 입력: [0x01, 0x7F] → 출력: 127
        let mut r = ScouterReader::new(vec![0x01, 0x7F]);
        assert_eq!(r.read_decimal().unwrap(), 127);
    }

    #[test]
    fn test_decimal_byte_min() {
        // 입력: [0x01, 0x80] → 출력: -128 (signed byte)
        let mut r = ScouterReader::new(vec![0x01, 0x80]);
        assert_eq!(r.read_decimal().unwrap(), -128);
    }

    #[test]
    fn test_decimal_negative_one() {
        // -1은 signed byte 범위이므로 [0x01, 0xFF]
        let mut r = ScouterReader::new(vec![0x01, 0xFF]);
        assert_eq!(r.read_decimal().unwrap(), -1);
    }

    #[test]
    fn test_decimal_short_128() {
        // 128은 byte 범위 초과 → short [0x02, 0x00, 0x80]
        let mut r = ScouterReader::new(vec![0x02, 0x00, 0x80]);
        assert_eq!(r.read_decimal().unwrap(), 128);
    }

    // Blob 경계값 테스트
    #[test]
    fn test_blob_empty() {
        let mut r = ScouterReader::new(vec![0x00]);
        assert_eq!(r.read_blob().unwrap(), vec![]);
    }

    #[test]
    fn test_blob_direct_length() {
        // 길이 3, 데이터 [0x01, 0x02, 0x03]
        let mut r = ScouterReader::new(vec![0x03, 0x01, 0x02, 0x03]);
        assert_eq!(r.read_blob().unwrap(), vec![0x01, 0x02, 0x03]);
    }

    #[test]
    fn test_blob_ushort_length() {
        // 0xFF + ushort(256) + data
        let mut data = vec![0xFF, 0x01, 0x00];
        data.extend(vec![0xAB; 256]);
        let mut r = ScouterReader::new(data);
        let result = r.read_blob().unwrap();
        assert_eq!(result.len(), 256);
        assert!(result.iter().all(|&b| b == 0xAB));
    }
}
```

---

### 3.2 `scouter/protocol.rs` — 상수

```rust
// TCP 핸드셰이크 매직 넘버
pub const NET_CAFE_TCP_CLIENT: u32 = 0xCAFE_2001;

// TcpFlag
pub mod tcp_flag {
    pub const OK:              u8 = 0x01;
    pub const NOT_OK:          u8 = 0x02;
    pub const HAS_NEXT:        u8 = 0x03;
    pub const NO_NEXT:         u8 = 0x04;
    pub const FAIL:            u8 = 0x05;
    pub const INVALID_SESSION: u8 = 0x44;
}

// PackEnum
pub mod pack_enum {
    pub const MAP:               u8 = 10;   // 0x0A
    pub const XLOG:              u8 = 21;   // 0x15
    pub const DROPPED_XLOG:      u8 = 22;   // 0x16
    pub const XLOG_PROFILE:      u8 = 26;   // 0x1A
    pub const XLOG_PROFILE2:     u8 = 27;   // 0x1B
    pub const TEXT:              u8 = 50;   // 0x32
    pub const PERF_COUNTER:      u8 = 60;   // 0x3C
    pub const OBJECT:            u8 = 80;   // 0x50
}

// ValueEnum
pub mod value_enum {
    pub const NULL:          u8 =  0;   // 0x00
    pub const BOOLEAN:       u8 = 10;   // 0x0A
    pub const DECIMAL:       u8 = 20;   // 0x14
    pub const FLOAT:         u8 = 30;   // 0x1E
    pub const DOUBLE:        u8 = 40;   // 0x28
    pub const TEXT:          u8 = 50;   // 0x32
    pub const TEXT_HASH:     u8 = 51;   // 0x33
    pub const BLOB:          u8 = 60;   // 0x3C
    pub const IP4ADDR:       u8 = 61;   // 0x3D
    pub const LIST:          u8 = 70;   // 0x46
    pub const ARRAY_INT:     u8 = 71;   // 0x47
    pub const ARRAY_FLOAT:   u8 = 72;   // 0x48
    pub const ARRAY_TEXT:    u8 = 73;   // 0x49
    pub const ARRAY_LONG:    u8 = 74;   // 0x4A
    pub const MAP:           u8 = 80;   // 0x50
}

// RequestCmd 문자열 상수
pub mod request_cmd {
    pub const LOGIN:                        &str = "LOGIN";
    pub const CLOSE:                        &str = "CLOSE";
    pub const TRANX_REAL_TIME_GROUP:        &str = "TRANX_REAL_TIME_GROUP";
    pub const TRANX_REAL_TIME_GROUP_LATEST: &str = "TRANX_REAL_TIME_GROUP_LATEST";
    pub const TRANX_LOAD_TIME_GROUP:        &str = "TRANX_LOAD_TIME_GROUP";
    pub const GET_TEXT:                     &str = "GET_TEXT";
    pub const GET_TEXT_100:                 &str = "GET_TEXT_100";
    pub const OBJECT_LIST_REAL_TIME:        &str = "OBJECT_LIST_REAL_TIME";
}

// 폴링 파라미터 키 상수
pub mod param_key {
    pub const OBJ_HASH: &str = "objHash";
    pub const LOOP:     &str = "loop";
    pub const INDEX:    &str = "index";
    pub const LIMIT:    &str = "limit";
    pub const COUNT:    &str = "count";
    pub const DATE:     &str = "date";
    pub const TYPE:     &str = "type";
    pub const HASH:     &str = "hash";
}

// 소켓 기본값
pub const DEFAULT_PORT: u16 = 6100;
pub const CONNECT_TIMEOUT_MS: u64 = 3000;
pub const DEFAULT_SO_TIMEOUT_MS: u64 = 30_000;
```

---

### 3.3 `scouter/value.rs` — ScouterValue

```rust
use std::collections::HashMap;
use serde::Serialize;

/// MapPack 내부 데이터 타입 alias
pub type MapData = HashMap<String, ScouterValue>;

/// Scouter Value 타입 시스템
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "value")]
pub enum ScouterValue {
    Null,
    Boolean(bool),
    Decimal(i64),
    Float(f32),
    Double(f64),
    Text(String),
    Blob(Vec<u8>),
    Ip4Addr([u8; 4]),
    List(Vec<ScouterValue>),
    Map(MapData),
}

impl ScouterValue {
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            ScouterValue::Decimal(v) => Some(*v),
            ScouterValue::Boolean(b) => Some(if *b { 1 } else { 0 }),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            ScouterValue::Text(s) => Some(s.as_str()),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            ScouterValue::Boolean(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_f32(&self) -> Option<f32> {
        match self {
            ScouterValue::Float(v) => Some(*v),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            ScouterValue::Double(v) => Some(*v),
            _ => None,
        }
    }

    pub fn as_list(&self) -> Option<&Vec<ScouterValue>> {
        match self {
            ScouterValue::List(v) => Some(v),
            _ => None,
        }
    }

    pub fn as_map(&self) -> Option<&MapData> {
        match self {
            ScouterValue::Map(m) => Some(m),
            _ => None,
        }
    }

    pub fn as_ip_string(&self) -> Option<String> {
        match self {
            ScouterValue::Ip4Addr(b) => {
                Some(format!("{}.{}.{}.{}", b[0], b[1], b[2], b[3]))
            }
            _ => None,
        }
    }
}
```

#### Serde 직렬화 전략

- `ScouterValue::Decimal`의 경우 i64는 JSON Number로 직렬화 시 JavaScript의 `Number.MAX_SAFE_INTEGER`(2^53-1)를 초과하는 txid/gxid 값을 잃는다. 따라서 **XLogPack의 txid/gxid는 `ScouterValue`를 거치지 않고 `XLogPack` 구조체에서 직접 String으로 변환하여 직렬화한다** (섹션 3.4 참조).
- `ScouterValue::Map`은 `HashMap<String, ScouterValue>`를 그대로 JSON Object로 직렬화.

---

### 3.4 `scouter/pack.rs` — Pack 역직렬화

#### XLogPack 구조체

```rust
use serde::Serialize;

/// 프론트엔드로 전달되는 XLog 데이터 구조체
/// txid, gxid, caller는 i64 범위를 초과할 수 있으므로 String으로 직렬화
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XLogPack {
    pub end_time:       i64,
    pub obj_hash:       i32,
    pub service:        i32,       // 서비스 해시 (딕셔너리 조회 필요)
    #[serde(serialize_with = "serialize_i64_as_string")]
    pub txid:           i64,
    #[serde(serialize_with = "serialize_i64_as_string")]
    pub caller:         i64,
    #[serde(serialize_with = "serialize_i64_as_string")]
    pub gxid:           i64,
    pub elapsed:        i32,
    pub error:          i32,       // 에러 해시 (0=정상, 딕셔너리 조회 필요)
    pub cpu:            i32,
    pub sql_count:      i32,
    pub sql_time:       i32,
    pub ipaddr:         String,    // Rust에서 "x.x.x.x" 변환 완료
    pub kbytes:         i32,
    pub status:         i32,
    pub userid:         i64,
    pub user_agent:     i32,
    pub referer:        i32,
    pub group:          i32,
    pub apicall_count:  i32,
    pub apicall_time:   i32,
    // 옵션 필드 (구버전 서버 호환)
    pub country_code:   Option<String>,
    pub city:           Option<i32>,
    pub x_type:         Option<u8>,
    pub login:          Option<i32>,
    pub desc:           Option<i32>,
    pub web_hash:       Option<i32>,
    pub web_time:       Option<i32>,
    pub has_dump:       Option<u8>,
    pub thread_name_hash: Option<i32>,
    pub text1:          Option<String>,
    pub text2:          Option<String>,
    pub queuing_host_hash:     Option<i32>,
    pub queuing_time:          Option<i32>,
    pub queuing2nd_host_hash:  Option<i32>,
    pub queuing2nd_time:       Option<i32>,
    pub text3:          Option<String>,
    pub text4:          Option<String>,
    pub text5:          Option<String>,
    pub profile_count:  Option<i32>,
    pub b3_mode:        Option<bool>,
    pub profile_size:   Option<i32>,
    pub discard_type:   Option<u8>,
    pub ignore_global_consequent_sampling: Option<bool>,
}

fn serialize_i64_as_string<S>(v: &i64, s: S) -> Result<S::Ok, S::Error>
where S: serde::Serializer {
    s.serialize_str(&v.to_string())
}
```

#### read_xlog_pack 함수

> 상세 필드 순서: [`../asis/14-collector-tcp-protocol.md#76-xlogpack`](../asis/14-collector-tcp-protocol.md)

```rust
/// XLogPack 역직렬화
/// 핵심: 전체 데이터가 Blob으로 래핑되어 있으므로 Blob을 먼저 읽고
/// 내부를 별도 ScouterReader로 파싱한다.
pub fn read_xlog_pack(reader: &mut ScouterReader) -> Result<XLogPack, ScouterError> {
    // 1단계: 외부 Blob 언래핑
    let blob = reader.read_blob()?;
    let mut d = ScouterReader::new(blob);

    // 2단계: 필수 필드 읽기 (1~20번 필드, 순서 고정)
    let end_time      = d.read_decimal()? as i64;
    let obj_hash      = d.read_decimal()? as i32;
    let service       = d.read_decimal()? as i32;
    let txid          = d.read_long()?;
    let caller        = d.read_long()?;
    let gxid          = d.read_long()?;
    let elapsed       = d.read_decimal()? as i32;
    let error         = d.read_decimal()? as i32;
    let cpu           = d.read_decimal()? as i32;
    let sql_count     = d.read_decimal()? as i32;
    let sql_time      = d.read_decimal()? as i32;
    let ipaddr_bytes  = d.read_blob()?;
    let kbytes        = d.read_decimal()? as i32;
    let status        = d.read_decimal()? as i32;
    let userid        = d.read_decimal()? as i64;
    let user_agent    = d.read_decimal()? as i32;
    let referer       = d.read_decimal()? as i32;
    let group         = d.read_decimal()? as i32;
    let apicall_count = d.read_decimal()? as i32;
    let apicall_time  = d.read_decimal()? as i32;

    // IP 주소 변환 (Rust에서 처리, 프론트엔드로는 문자열 전달)
    let ipaddr = bytes_to_ipv4_string(&ipaddr_bytes);

    // 3단계: 옵션 필드 읽기 (available() > 0 체크)
    let country_code = if d.available() > 0 { Some(d.read_text()?) } else { None };
    let city         = if d.available() > 0 { Some(d.read_decimal()? as i32) } else { None };
    let x_type       = if d.available() > 0 { Some(d.read_unsigned_byte()?) } else { None };
    let login        = if d.available() > 0 { Some(d.read_decimal()? as i32) } else { None };
    let desc         = if d.available() > 0 { Some(d.read_decimal()? as i32) } else { None };
    let web_hash     = if d.available() > 0 { Some(d.read_decimal()? as i32) } else { None };
    let web_time     = if d.available() > 0 { Some(d.read_decimal()? as i32) } else { None };
    let has_dump     = if d.available() > 0 { Some(d.read_unsigned_byte()?) } else { None };
    let thread_name_hash = if d.available() > 0 { Some(d.read_decimal()? as i32) } else { None };
    let text1        = if d.available() > 0 { Some(d.read_text()?) } else { None };
    let text2        = if d.available() > 0 { Some(d.read_text()?) } else { None };
    let queuing_host_hash    = if d.available() > 0 { Some(d.read_decimal()? as i32) } else { None };
    let queuing_time         = if d.available() > 0 { Some(d.read_decimal()? as i32) } else { None };
    let queuing2nd_host_hash = if d.available() > 0 { Some(d.read_decimal()? as i32) } else { None };
    let queuing2nd_time      = if d.available() > 0 { Some(d.read_decimal()? as i32) } else { None };
    let text3        = if d.available() > 0 { Some(d.read_text()?) } else { None };
    let text4        = if d.available() > 0 { Some(d.read_text()?) } else { None };
    let text5        = if d.available() > 0 { Some(d.read_text()?) } else { None };
    let profile_count = if d.available() > 0 { Some(d.read_decimal()? as i32) } else { None };
    let b3_mode      = if d.available() > 0 { Some(d.read_bool()?) } else { None };
    let profile_size = if d.available() > 0 { Some(d.read_decimal()? as i32) } else { None };
    let discard_type = if d.available() > 0 { Some(d.read_unsigned_byte()?) } else { None };
    let ignore_global_consequent_sampling =
        if d.available() > 0 { Some(d.read_bool()?) } else { None };

    Ok(XLogPack {
        end_time, obj_hash, service, txid, caller, gxid,
        elapsed, error, cpu, sql_count, sql_time, ipaddr,
        kbytes, status, userid, user_agent, referer, group,
        apicall_count, apicall_time,
        country_code, city, x_type, login, desc,
        web_hash, web_time, has_dump, thread_name_hash,
        text1, text2,
        queuing_host_hash, queuing_time, queuing2nd_host_hash, queuing2nd_time,
        text3, text4, text5, profile_count, b3_mode,
        profile_size, discard_type, ignore_global_consequent_sampling,
    })
}

fn bytes_to_ipv4_string(bytes: &[u8]) -> String {
    if bytes.len() == 4 {
        format!("{}.{}.{}.{}", bytes[0], bytes[1], bytes[2], bytes[3])
    } else {
        String::new()
    }
}
```

#### read_map_pack 함수

```rust
pub fn read_map_pack(reader: &mut ScouterReader) -> Result<MapData, ScouterError> {
    let count = reader.read_decimal()? as usize;
    let mut map = HashMap::with_capacity(count);
    for _ in 0..count {
        let key = reader.read_text()?;
        let val = reader.read_value()?;
        map.insert(key, val);
    }
    Ok(map)
}
```

#### read_pack 디스패처

```rust
pub enum ScouterPack {
    Map(MapData),
    XLog(XLogPack),
    Unknown(u8),
}

pub fn read_pack(reader: &mut ScouterReader) -> Result<ScouterPack, ScouterError> {
    let pack_type = reader.read_unsigned_byte()?;
    match pack_type {
        pack_enum::MAP   => Ok(ScouterPack::Map(read_map_pack(reader)?)),
        pack_enum::XLOG  => Ok(ScouterPack::XLog(read_xlog_pack(reader)?)),
        t                => {
            log::warn!("알 수 없는 PackType: 0x{:02X}", t);
            Ok(ScouterPack::Unknown(t))
        }
    }
}
```

---

### 3.5 `scouter/connection.rs` — TCP 연결 + 로그인

#### ScouterConnection 구조체

```rust
use tokio::net::TcpStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};

pub struct ScouterConnection {
    reader: BufReader<tokio::io::ReadHalf<TcpStream>>,
    writer: BufWriter<tokio::io::WriteHalf<TcpStream>>,
    pub session: i64,
    pub server_id: String,
    pub server_version: String,
    pub so_timeout_ms: u64,
}
```

#### connect 함수

```rust
pub async fn connect(host: &str, port: u16) -> Result<ScouterConnection, ScouterError> {
    use std::time::Duration;
    use tokio::time::timeout;

    // 1. TCP 연결 (3초 타임아웃)
    let stream = timeout(
        Duration::from_millis(CONNECT_TIMEOUT_MS),
        TcpStream::connect(format!("{}:{}", host, port)),
    ).await
    .map_err(|_| ScouterError::ConnectionTimeout)?
    .map_err(ScouterError::Io)?;

    // 2. 소켓 옵션 설정
    stream.set_nodelay(true)?;
    // keepalive는 socket2 크레이트 또는 플랫폼별 API로 설정

    let (read_half, write_half) = tokio::io::split(stream);
    let mut writer = BufWriter::new(write_half);

    // 3. 매직 넘버 전송 (4바이트 Big-endian: 0xCAFE2001)
    writer.write_all(&NET_CAFE_TCP_CLIENT.to_be_bytes()).await?;
    writer.flush().await?;

    Ok(ScouterConnection {
        reader: BufReader::new(read_half),
        writer,
        session: 0,
        server_id: String::new(),
        server_version: String::new(),
        so_timeout_ms: DEFAULT_SO_TIMEOUT_MS,
    })
}
```

#### login 함수

```rust
pub async fn login(
    conn: &mut ScouterConnection,
    user: &str,
    pass: &str,
) -> Result<ServerInfo, ScouterError> {
    // 1. 비밀번호 SHA-256(with salt) 해싱
    let hashed_pass = sha256_with_salt(pass);

    // 2. 요청 MapPack 구성
    let mut param = MapData::new();
    param.insert("id".to_string(),       ScouterValue::Text(user.to_string()));
    param.insert("pass".to_string(),     ScouterValue::Text(hashed_pass));
    param.insert("version".to_string(),  ScouterValue::Text("NScouter/1.0".to_string()));
    param.insert("hostname".to_string(), ScouterValue::Text(get_hostname()));
    param.insert("isSocks".to_string(),  ScouterValue::Boolean(false));
    param.insert("socksIp".to_string(),  ScouterValue::Text(String::new()));
    param.insert("socksPort".to_string(),ScouterValue::Decimal(0));
    param.insert("ip".to_string(),       ScouterValue::Text(get_local_ip()));

    // 3. 요청 전송 (session = 0)
    send_request(conn, request_cmd::LOGIN, 0, &ScouterPack::Map(param)).await?;

    // 4. 응답 수신 (HasNEXT + MapPack + NoNEXT 패턴)
    let response_map = receive_single_map_pack(conn).await?;

    // 5. 세션 파싱 및 에러 검사
    let session = response_map.get("session")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let error_msg = response_map.get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if !error_msg.is_empty() && session == 0 {
        return Err(ScouterError::AuthFailed(error_msg));
    }

    // 6. 세션 및 서버 정보 저장
    conn.session = session;
    conn.server_id = response_map.get("server_id")
        .and_then(|v| v.as_str()).unwrap_or("").to_string();
    conn.server_version = response_map.get("version")
        .and_then(|v| v.as_str()).unwrap_or("").to_string();
    conn.so_timeout_ms = response_map.get("so_time_out")
        .and_then(|v| v.as_i64())
        .map(|v| v as u64)
        .unwrap_or(DEFAULT_SO_TIMEOUT_MS);

    Ok(ServerInfo {
        server_id: conn.server_id.clone(),
        version: conn.server_version.clone(),
        session,
    })
}
```

#### SHA-256 with Salt 구현

```rust
use sha2::{Sha256, Digest};

/// salt = "qwertyuiop!@#$%^&*()zxcvbnm,."
/// 알고리즘: sha256.update(salt_bytes) → sha256.finalize_with(password_bytes)
/// Java의 getBytes()는 시스템 기본 인코딩이나 일반적으로 UTF-8로 가정
fn sha256_with_salt(password: &str) -> String {
    const SALT: &str = "qwertyuiop!@#$%^&*()zxcvbnm,.";
    let mut hasher = Sha256::new();
    hasher.update(SALT.as_bytes());
    hasher.update(password.as_bytes());
    let result = hasher.finalize();
    hex::encode(result)   // 소문자 16진수 64자 문자열
}
```

> **주의:** Java `sha256.update(salt)` + `sha256.digest(password)` 방식은 내부적으로 `salt_bytes || password_bytes`를 연결한 후 한 번에 해싱한 것과 동일하다.

#### INVALID_SESSION 감지 후 재로그인 흐름

```
1. 응답 스트리밍 중 TcpFlag == 0x44 수신
2. conn.session = 0 으로 초기화
3. AppState에서 연결 상태를 Disconnected로 변경
4. Tauri Event "scouter://disconnected" emit (reason: "session_expired")
5. 재연결은 프론트엔드가 connect_scouter Command를 다시 호출하는 방식으로 처리
   (자동 재연결보다 명시적 재연결이 사용자 UX에 유리)
```

---

### 3.6 `scouter/streaming.rs` — 실시간 XLog 폴링

#### 폴링 루프 설계

```rust
use tokio::time::{interval, Duration};
use tokio_util::sync::CancellationToken;
use tauri::AppHandle;

pub struct StreamingCursor {
    pub loop_val:  i64,
    pub index_val: i64,
    pub is_first:  bool,
}

impl Default for StreamingCursor {
    fn default() -> Self {
        Self { loop_val: 0, index_val: 0, is_first: true }
    }
}

pub async fn run_xlog_polling_loop(
    app_handle: AppHandle,
    conn: Arc<Mutex<Option<ScouterConnection>>>,
    obj_hashes: Vec<i32>,
    cancel_token: CancellationToken,
) {
    let mut ticker = interval(Duration::from_secs(2));
    let mut cursor = StreamingCursor::default();

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                log::info!("XLog 폴링 루프 종료");
                break;
            }
            _ = ticker.tick() => {
                match poll_once(&app_handle, &conn, &obj_hashes, &mut cursor).await {
                    Ok(()) => {}
                    Err(ScouterError::InvalidSession) => {
                        app_handle.emit("scouter://disconnected",
                            DisconnectPayload { reason: "session_expired".to_string() }
                        ).ok();
                        break;
                    }
                    Err(e) => {
                        log::error!("폴링 오류: {:?}", e);
                        app_handle.emit("scouter://error",
                            ErrorPayload { message: e.to_string() }
                        ).ok();
                        break;
                    }
                }
            }
        }
    }
}
```

#### poll_once 함수 — 요청 구성 및 응답 처리

```rust
async fn poll_once(
    app_handle: &AppHandle,
    conn: &Arc<Mutex<Option<ScouterConnection>>>,
    obj_hashes: &[i32],
    cursor: &mut StreamingCursor,
) -> Result<(), ScouterError> {
    // 1. 요청 커맨드 결정 (최초: LATEST, 이후: 일반)
    let cmd = if cursor.is_first {
        request_cmd::TRANX_REAL_TIME_GROUP_LATEST
    } else {
        request_cmd::TRANX_REAL_TIME_GROUP
    };

    // 2. 요청 파라미터 MapPack 구성
    let mut param = MapData::new();
    let hash_list: Vec<ScouterValue> = obj_hashes.iter()
        .map(|&h| ScouterValue::Decimal(h as i64))
        .collect();
    param.insert(param_key::OBJ_HASH.to_string(), ScouterValue::List(hash_list));
    param.insert(param_key::LOOP.to_string(),  ScouterValue::Decimal(cursor.loop_val));
    param.insert(param_key::INDEX.to_string(), ScouterValue::Decimal(cursor.index_val));
    param.insert(param_key::COUNT.to_string(), ScouterValue::Decimal(10000));

    // 3. 요청 전송 및 스트리밍 응답 처리
    let mut guard = conn.lock().await;
    let conn_ref = guard.as_mut().ok_or(ScouterError::NotConnected)?;
    let session = conn_ref.session;

    send_request(conn_ref, cmd, session, &ScouterPack::Map(param)).await?;

    // 4. 스트림 루프: HasNEXT(0x03)이 올 때까지 Pack 읽기
    loop {
        let flag = conn_ref.read_byte().await?;
        match flag {
            tcp_flag::HAS_NEXT => {
                let pack = read_pack_from_conn(conn_ref).await?;
                match pack {
                    // MapPack: 커서 갱신
                    ScouterPack::Map(map) => {
                        if let (Some(l), Some(i)) = (
                            map.get(param_key::LOOP).and_then(|v| v.as_i64()),
                            map.get(param_key::INDEX).and_then(|v| v.as_i64()),
                        ) {
                            cursor.loop_val  = l;
                            cursor.index_val = i;
                            cursor.is_first  = false;
                        }
                    }
                    // XLogPack: 프론트엔드로 emit
                    ScouterPack::XLog(xlog) => {
                        app_handle.emit("scouter://xlog", &xlog).ok();
                    }
                    ScouterPack::Unknown(_) => {}
                }
            }
            tcp_flag::NO_NEXT => break,   // 스트림 정상 종료
            tcp_flag::INVALID_SESSION => {
                conn_ref.session = 0;
                return Err(ScouterError::InvalidSession);
            }
            other => {
                return Err(ScouterError::Protocol(
                    format!("예기치 않은 TcpFlag: 0x{:02X}", other)
                ));
            }
        }
    }

    Ok(())
}
```

---

### 3.7 `scouter/dictionary.rs` — 딕셔너리 캐시

#### TextType enum

> 17개 텍스트 타입 — [`../asis/14-collector-tcp-protocol.md#9-dictionary`](../asis/14-collector-tcp-protocol.md)

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum TextType {
    Error,
    Apicall,
    Method,
    Service,
    Sql,
    Object,
    Referer,
    UserAgent,
    Group,
    City,
    SqlTables,
    Maria,
    Login,
    Desc,
    Web,
    HashMsg,
    StackElement,
}

impl TextType {
    pub fn as_str(&self) -> &'static str {
        match self {
            TextType::Error         => "error",
            TextType::Apicall       => "apicall",
            TextType::Method        => "method",
            TextType::Service       => "service",
            TextType::Sql           => "sql",
            TextType::Object        => "object",
            TextType::Referer       => "referer",
            TextType::UserAgent     => "ua",
            TextType::Group         => "group",
            TextType::City          => "city",
            TextType::SqlTables     => "table",
            TextType::Maria         => "maria",
            TextType::Login         => "login",
            TextType::Desc          => "desc",
            TextType::Web           => "web",
            TextType::HashMsg       => "hmsg",
            TextType::StackElement  => "stackelem",
        }
    }
}
```

#### DictionaryCache 구조체

```rust
use std::collections::HashMap;

pub struct DictionaryCache {
    /// (TextType, hash) → 텍스트 문자열
    cache: HashMap<(TextType, i32), String>,
}

impl DictionaryCache {
    pub fn new() -> Self {
        Self { cache: HashMap::new() }
    }

    pub fn get(&self, text_type: &TextType, hash: i32) -> Option<&str> {
        self.cache.get(&(text_type.clone(), hash)).map(|s| s.as_str())
    }

    pub fn insert(&mut self, text_type: TextType, hash: i32, text: String) {
        self.cache.insert((text_type, hash), text);
    }

    /// 캐시에 없는 해시만 필터링하여 반환
    pub fn missing_hashes(&self, text_type: &TextType, hashes: &[i32]) -> Vec<i32> {
        hashes.iter()
            .filter(|&&h| h != 0 && !self.cache.contains_key(&(text_type.clone(), h)))
            .cloned()
            .collect()
    }
}
```

#### resolve_batch 함수

```rust
/// GET_TEXT_100: 최대 100개씩 청크로 나눠 서버에 요청
pub async fn resolve_batch(
    conn: &mut ScouterConnection,
    cache: &mut DictionaryCache,
    text_type: TextType,
    hashes: &[i32],
    date: &str,   // "yyyymmdd" 포맷
) -> Result<(), ScouterError> {
    let missing = cache.missing_hashes(&text_type, hashes);
    if missing.is_empty() {
        return Ok(());
    }

    // 최대 100개씩 청크 처리
    for chunk in missing.chunks(100) {
        let mut param = MapData::new();
        param.insert(param_key::DATE.to_string(), ScouterValue::Text(date.to_string()));
        param.insert(param_key::TYPE.to_string(), ScouterValue::Text(text_type.as_str().to_string()));
        let hash_list: Vec<ScouterValue> = chunk.iter()
            .map(|&h| ScouterValue::Decimal(h as i64))
            .collect();
        param.insert(param_key::HASH.to_string(), ScouterValue::List(hash_list));

        send_request(conn, request_cmd::GET_TEXT_100, conn.session, &ScouterPack::Map(param)).await?;

        // 응답: MapPack (키=Hexa32 인코딩 해시, 값=텍스트)
        loop {
            let flag = conn.read_byte().await?;
            match flag {
                tcp_flag::HAS_NEXT => {
                    let pack = read_pack_from_conn(conn).await?;
                    if let ScouterPack::Map(map) = pack {
                        for (hexa32_key, val) in &map {
                            if let Some(text) = val.as_str() {
                                // Hexa32 디코딩: 8자리 16진수 문자열 → i32
                                if let Ok(hash) = i32::from_str_radix(hexa32_key, 16) {
                                    cache.insert(text_type.clone(), hash, text.to_string());
                                }
                            }
                        }
                    }
                }
                tcp_flag::NO_NEXT => break,
                tcp_flag::INVALID_SESSION => {
                    conn.session = 0;
                    return Err(ScouterError::InvalidSession);
                }
                _ => break,
            }
        }
    }

    Ok(())
}
```

#### XLog 수신 시 자동 조회 트리거

```
XLogPack 수신 후 즉시 딕셔너리 조회 대상 해시를 배치:
  - service      → TextType::Service
  - error (≠ 0) → TextType::Error
  - thread_name_hash → TextType::Method (스레드명)

방식: XLogPack emit 직후 DictionaryCache.missing_hashes() 체크 →
      캐시 미스가 있으면 resolve_batch() 비동기 호출 (별도 tokio::spawn) →
      완료 후 "scouter://dict-update" Event emit (선택적)
```

---

## 4. Tauri State 설계 (`state.rs`)

```rust
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

pub struct AppState {
    /// 싱글 TCP 커넥션 (None = 미연결)
    pub connection: Mutex<Option<ScouterConnection>>,

    /// 딕셔너리 캐시
    pub dict_cache: Mutex<DictionaryCache>,

    /// 실시간 폴링 태스크 핸들
    pub streaming_task: Mutex<Option<JoinHandle<()>>>,

    /// 폴링 루프 취소 토큰
    pub streaming_cancel: Mutex<Option<CancellationToken>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            connection: Mutex::new(None),
            dict_cache: Mutex::new(DictionaryCache::new()),
            streaming_task: Mutex::new(None),
            streaming_cancel: Mutex::new(None),
        }
    }
}
```

---

## 5. Tauri Command 인터페이스

### 5.1 connect_scouter

```rust
#[tauri::command]
pub async fn connect_scouter(
    host: String,
    port: u16,
    user: String,
    pass: String,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<ServerInfo, String>
```

**파라미터:**

| 이름 | 타입 | 설명 |
|------|------|------|
| `host` | `String` | Collector 호스트명 또는 IP |
| `port` | `u16` | 포트 번호 (기본 6100) |
| `user` | `String` | Scouter 사용자 ID |
| `pass` | `String` | 평문 비밀번호 (Rust에서 SHA-256 처리) |

**반환:** `Result<ServerInfo, String>`

```rust
pub struct ServerInfo {
    pub server_id: String,
    pub version: String,
    pub session: i64,   // 디버그용, 프론트엔드에서 저장 불필요
}
```

**동작:**
1. 기존 연결이 있으면 폴링 중단 후 연결 종료
2. `connect()` → `login()` 순서 실행
3. 성공 시 `AppState.connection`에 저장
4. `"scouter://connected"` Event emit

**에러 케이스:**
- 연결 타임아웃 (3초 초과): `"연결 시간 초과: {host}:{port}"`
- 인증 실패: `"인증 실패: {error_message}"`
- 소켓 오류: `"소켓 오류: {io_error}"`

---

### 5.2 disconnect_scouter

```rust
#[tauri::command]
pub async fn disconnect_scouter(
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), String>
```

**동작:**
1. 폴링 태스크 취소 (`CancellationToken::cancel()`)
2. `JoinHandle::await`로 태스크 완전 종료 대기 (타임아웃 2초)
3. TCP 연결에 `"CLOSE"` 전송 후 소켓 종료
4. `AppState.connection = None`
5. `"scouter://disconnected"` Event emit (`reason: "user_requested"`)

---

### 5.3 start_xlog_stream

```rust
#[tauri::command]
pub async fn start_xlog_stream(
    obj_hashes: Vec<i32>,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), String>
```

**파라미터:**

| 이름 | 타입 | 설명 |
|------|------|------|
| `obj_hashes` | `Vec<i32>` | 모니터링할 오브젝트 해시 목록 |

**동작:**
1. 이미 실행 중인 폴링 태스크가 있으면 중단 후 재시작
2. `CancellationToken::new()` 생성
3. `tokio::spawn(run_xlog_polling_loop(...))` 실행
4. `AppState.streaming_task`, `streaming_cancel`에 핸들 저장

**에러 케이스:**
- 연결 없음: `"연결되지 않은 상태입니다"`

---

### 5.4 stop_xlog_stream

```rust
#[tauri::command]
pub async fn stop_xlog_stream(
    state: tauri::State<'_, AppState>,
) -> Result<(), String>
```

**동작:** `CancellationToken::cancel()` → 태스크 종료 대기

---

### 5.5 get_object_list

```rust
#[tauri::command]
pub async fn get_object_list(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ScouterObject>, String>
```

**반환:**

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScouterObject {
    pub obj_hash:  i32,
    pub obj_name:  String,
    pub obj_type:  String,
    pub host_name: String,
    pub alive:     bool,
}
```

**동작:** `OBJECT_LIST_REAL_TIME` 커맨드 전송 → ObjectPack 목록 수신

---

### 5.6 resolve_texts

```rust
#[tauri::command]
pub async fn resolve_texts(
    text_type: String,      // "service", "error", "sql" 등
    hashes: Vec<i32>,
    date: Option<String>,   // "yyyymmdd", None이면 오늘 날짜
    state: tauri::State<'_, AppState>,
) -> Result<HashMap<String, String>, String>
```

**반환:** `{ "해시값(십진수 문자열)": "텍스트" }` 매핑

**동작:**
1. `text_type` 문자열 → `TextType` enum 변환
2. 캐시 히트 항목은 즉시 반환 (서버 요청 없음)
3. 캐시 미스 항목만 `resolve_batch()` 호출
4. 전체 결과 HashMap 반환

---

## 6. Tauri Event 인터페이스

### scouter://connected

**발생 조건:** `connect_scouter` Command 성공 후

**Payload (TypeScript):**
```typescript
interface ConnectedPayload {
  serverId: string;
  version: string;
}
```

---

### scouter://disconnected

**발생 조건:** 연결 종료 (사용자 요청, 세션 만료, 소켓 오류)

**Payload (TypeScript):**
```typescript
interface DisconnectedPayload {
  reason: "user_requested" | "session_expired" | "io_error";
  message?: string;
}
```

---

### scouter://xlog

**발생 조건:** 폴링 루프에서 XLogPack 수신 시마다 emit

**Payload (TypeScript):**
```typescript
interface XLogPayload {
  endTime:      number;
  objHash:      number;
  service:      number;       // 서비스 해시 (딕셔너리 조회 필요)
  txid:         string;       // i64를 string으로 전달 (정밀도 보존)
  caller:       string;
  gxid:         string;
  elapsed:      number;
  error:        number;       // 에러 해시 (0=정상)
  cpu:          number;
  sqlCount:     number;
  sqlTime:      number;
  ipaddr:       string;       // "x.x.x.x" 변환 완료
  kbytes:       number;
  status:       number;
  userid:       number;
  userAgent:    number;
  referer:      number;
  group:        number;
  apicallCount: number;
  apicallTime:  number;
  // 옵션 필드
  countryCode?:    string;
  city?:           number;
  xType?:          number;    // 0=WEB, 1=APP, 2=BACKGROUND
  login?:          number;
  desc?:           number;
  hasDump?:        number;
  threadNameHash?: number;
  text1?: string; text2?: string;
  text3?: string; text4?: string; text5?: string;
  profileCount?: number;
  profileSize?:  number;
  discardType?:  number;
}
```

---

### scouter://error

**발생 조건:** 폴링 루프 내 복구 불가능한 오류

**Payload (TypeScript):**
```typescript
interface ErrorPayload {
  message: string;
}
```

---

## 7. 프론트엔드와의 인터페이스 계약

### 7.1 Rust → TypeScript 타입 매핑 테이블

| Rust 타입 | TypeScript 타입 | 변환 방식 | 비고 |
|-----------|-----------------|-----------|------|
| `i32` | `number` | 직접 변환 | JSON number |
| `i64` (일반) | `number` | 직접 변환 | MAX_SAFE_INTEGER 이하 필드 |
| `i64` (txid/gxid/caller) | `string` | `.to_string()` → JSON string | 정밀도 손실 방지 |
| `f32` / `f64` | `number` | 직접 변환 | |
| `bool` | `boolean` | 직접 변환 | |
| `String` | `string` | 직접 변환 | |
| `Option<T>` | `T \| undefined` | `None` → `undefined` | serde의 `skip_serializing_if = "Option::is_none"` |
| `Vec<T>` | `T[]` | 직접 변환 | |
| `HashMap<String, V>` | `Record<string, V>` | 직접 변환 | |

### 7.2 txid/gxid 정밀도 이슈

JavaScript `Number`는 IEEE 754 배정밀도로 2^53-1(약 9천조)을 초과하는 정수를 정확히 표현하지 못한다. Scouter의 txid는 64비트 전체 범위를 사용하므로 반드시 `string`으로 전달한다.

**프론트엔드 수신 코드:**
```typescript
// scouter://xlog 이벤트 핸들러에서
const txid: bigint = BigInt(payload.txid);
```

### 7.3 IP 주소 변환

`XLogPack.ipaddr`는 Rust 역직렬화 시 `bytes_to_ipv4_string()` 함수로 `"x.x.x.x"` 문자열로 변환하여 전달한다. 프론트엔드에서는 추가 변환 불필요.

### 7.4 서비스/에러 텍스트 해시

XLogPack의 `service`(i32), `error`(i32) 필드는 정수 해시다. 실제 텍스트가 필요한 경우 `resolve_texts` Command를 호출한다. 폴링 루프 내부에서도 백그라운드로 자동 조회가 트리거되지만, 딕셔너리 업데이트는 별도 `"scouter://dict-update"` Event(선택적 구현)로 통보한다.

---

## 8. 에러 처리 전략

### 8.1 ScouterError enum

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ScouterError {
    #[error("IO 오류: {0}")]
    Io(#[from] std::io::Error),

    #[error("연결 시간 초과")]
    ConnectionTimeout,

    #[error("인증 실패: {0}")]
    AuthFailed(String),

    #[error("세션 만료")]
    InvalidSession,

    #[error("연결되지 않은 상태")]
    NotConnected,

    #[error("프로토콜 오류: {0}")]
    Protocol(String),

    #[error("UTF-8 디코딩 오류: {0}")]
    Utf8(#[from] std::string::FromUtf8Error),
}
```

### 8.2 Tauri Command에서 Result<T, String> 반환

Tauri Command는 `Result<T, String>` 형태를 요구한다. `ScouterError`를 `String`으로 변환하는 일관된 패턴:

```rust
pub async fn connect_scouter(...) -> Result<ServerInfo, String> {
    connect_internal(...).await.map_err(|e| e.to_string())
}
```

### 8.3 재연결 정책

| 상황 | 처리 방식 | 근거 |
|------|-----------|------|
| `INVALID_SESSION` 수신 | 즉시 폴링 중단, Event emit, 사용자 수동 재연결 | 세션 만료는 서버 재시작 등 중요한 상황일 수 있음 |
| IO 오류 (소켓 끊김) | 즉시 폴링 중단, `scouter://error` emit | 자동 재시도 루프는 무한 CPU 소모 위험 |
| 커넥션 타임아웃 | Command 즉시 실패 반환 | 사용자가 상태 인지 후 재시도 |

**자동 재시도를 채택하지 않는 이유:** Tauri 데스크톱 앱 특성상 사용자가 명시적으로 재연결을 선택하는 것이 상태 불일치 버그를 줄인다.

---

## 9. 동시성 설계

### 9.1 tokio::spawn 백그라운드 폴링

```
[Tauri Command 핸들러] (tokio task)
        |
        | start_xlog_stream()
        |
        ↓
[run_xlog_polling_loop] ← tokio::spawn (독립 task)
        |
        | 2초마다
        ↓
[poll_once] → conn.lock().await (짧은 시간만 락 점유)
            → app_handle.emit("scouter://xlog", xlog)
```

### 9.2 Mutex 사용 위치와 데드락 방지 원칙

| State 필드 | Mutex 타입 | 락 점유 기간 |
|------------|------------|-------------|
| `connection` | `tokio::sync::Mutex` | TCP 요청/응답 전체 (I/O 완료까지) |
| `dict_cache` | `tokio::sync::Mutex` | HashMap 읽기/쓰기 (μs 수준) |
| `streaming_task` | `tokio::sync::Mutex` | JoinHandle 저장/취소 (μs 수준) |

**데드락 방지 원칙:**
1. `connection` 락과 `dict_cache` 락을 동시에 잡지 않는다. 딕셔너리 조회는 별도 연결(또는 락 해제 후) 수행.
2. 폴링 태스크 내에서 `connection` 락을 잡은 상태로 `streaming_task` 락을 잡지 않는다.
3. Command 핸들러는 락 획득 실패 시 `try_lock()`으로 빠른 실패를 선택적으로 사용.

### 9.3 스트리밍 태스크 ↔ Command 핸들러 간 상태 공유

```
AppState (Arc로 Tauri managed state에 등록)
    ├── connection: Mutex<Option<ScouterConnection>>
    │       ↑ Command 핸들러: connect/disconnect
    │       ↑ 폴링 태스크: poll_once 내에서 락 점유
    ├── dict_cache: Mutex<DictionaryCache>
    │       ↑ 폴링 태스크: XLog 수신 후 자동 조회
    │       ↑ resolve_texts Command: 직접 조회
    └── streaming_cancel: Mutex<Option<CancellationToken>>
            ↑ stop_xlog_stream Command: cancel() 호출
```

---

## 10. 구현 순서 및 검증 방법

### Phase 1: 코덱 기반 구조 (1~2일)

- [ ] `codec.rs` — `ScouterReader` / `ScouterWriter` 구현
  - [ ] 기본 타입 (byte, short, int, long, float, double, bool)
  - [ ] Decimal read/write
  - [ ] Blob read/write
  - [ ] Text read/write (UTF-8 변환)
  - [ ] Int3 / Long5
- [ ] `value.rs` — `ScouterValue` enum
- [ ] 단위 테스트 (`cargo test`)
  - [ ] Decimal 경계값 (0, ±127, ±128, ±32767, ±32768, Int3 범위, i32 범위, i64)
  - [ ] Blob 경계값 (0바이트, 253바이트, 254바이트, 65535바이트)
  - [ ] Text round-trip (ASCII, 한글, 이모지)

**검증:** `cargo test` 전체 통과

---

### Phase 2: 프로토콜 상수 + Pack 역직렬화 (1~2일)

- [ ] `protocol.rs` — 상수 정의
- [ ] `pack.rs` — `read_map_pack`, `read_xlog_pack`, `read_pack`
  - [ ] MapPack 역직렬화
  - [ ] XLogPack Blob 언래핑 + 필드별 역직렬화
  - [ ] `available() > 0` 옵션 필드 처리
- [ ] XLogPack → JSON 직렬화 검증
  - [ ] txid/gxid가 string으로 직렬화되는지 확인

**검증:** 실제 XLogPack 바이너리 샘플로 역직렬화 후 JSON 비교 (hex dump 기반)

---

### Phase 3: TCP 연결 + 로그인 (1~2일)

- [ ] `connection.rs` — `connect()`, `login()`
  - [ ] 매직 넘버 전송
  - [ ] `sha256_with_salt()` 구현
  - [ ] LOGIN MapPack 전송 및 응답 파싱
  - [ ] `so_timeout` 적용
- [ ] `state.rs` — `AppState`
- [ ] `lib.rs` — Tauri app 빌더에 `AppState` 등록
- [ ] `connect_scouter` / `disconnect_scouter` Command 구현

**검증:**
```bash
# Scouter Collector 실행 후
# 프론트엔드 콘솔에서:
await invoke("connect_scouter", { host: "localhost", port: 6100, user: "admin", pass: "admin" })
# → ServerInfo 반환 확인
```

---

### Phase 4: 실시간 폴링 (1~2일)

- [ ] `streaming.rs` — `run_xlog_polling_loop`, `poll_once`
  - [ ] 커서 상태 관리 (최초 LATEST, 이후 갱신)
  - [ ] MapPack/XLogPack 분기 처리
  - [ ] `CancellationToken` 기반 중단
- [ ] `start_xlog_stream` / `stop_xlog_stream` Command 구현
- [ ] `scouter://xlog` Event emit

**검증:**
```typescript
// 프론트엔드에서 이벤트 리스너 등록 후
await listen("scouter://xlog", (event) => {
  console.log("XLog 수신:", event.payload);
});
await invoke("start_xlog_stream", { objHashes: [objHash] });
// → 2초마다 XLog 수신 확인
```

---

### Phase 5: 딕셔너리 캐시 (1일)

- [ ] `dictionary.rs` — `DictionaryCache`, `TextType`, `resolve_batch`
  - [ ] Hexa32 키 디코딩 (`i32::from_str_radix(key, 16)`)
  - [ ] 100개 청크 분할
- [ ] `resolve_texts` Command 구현
- [ ] 폴링 루프 내 자동 딕셔너리 조회 트리거

**검증:**
```typescript
const texts = await invoke("resolve_texts", {
  textType: "service",
  hashes: [serviceHash],
  date: "20260328"
});
console.log(texts); // { "12345678": "/api/user/list" }
```

---

### Phase 6: 전체 통합 및 에러 시나리오 검증 (1일)

- [ ] 세션 만료 (`INVALID_SESSION`) 시 `"scouter://disconnected"` emit 확인
- [ ] 네트워크 단절 시 폴링 루프 정상 종료 확인
- [ ] 인증 실패 시 Command 에러 반환 확인
- [ ] `disconnect_scouter` 후 `start_xlog_stream` 시 에러 반환 확인

---

## 11. 테스트 명세

### 11.1 단위 테스트 — `codec.rs`

실제 Collector 없이 `cargo test`로 실행 가능한 테스트.
입력 바이트 배열 → 기대 출력값을 hex로 명시.

#### Decimal 디코딩

| 테스트명 | 입력 (hex) | 기대값 | 설명 |
|----------|-----------|--------|------|
| `decimal_zero` | `00` | `0` | 0 특수 케이스 |
| `decimal_byte_pos_max` | `01 7F` | `127` | byte 범위 최대 |
| `decimal_byte_neg_min` | `01 80` | `-128` | byte 범위 최소 (부호 확장) |
| `decimal_byte_neg_one` | `01 FF` | `-1` | |
| `decimal_short_128` | `02 00 80` | `128` | short 범위 진입 |
| `decimal_short_neg` | `02 FF 7F` | `-129` | |
| `decimal_int3_max` | `03 7F FF FF` | `8388607` | Int3 최대 |
| `decimal_int3_min` | `03 80 00 00` | `-8388608` | Int3 최소 (부호 확장) |
| `decimal_int_max` | `04 7F FF FF FF` | `2147483647` | i32 최대 |
| `decimal_int_neg` | `04 FF FF FF FF` | `-1` | |
| `decimal_long_max` | `08 7F FF FF FF FF FF FF FF` | `9223372036854775807` | i64 최대 |

#### Decimal 인코딩 (write → read round-trip)

| 값 | 기대 출력 (hex) |
|----|----------------|
| `0` | `00` |
| `127` | `01 7F` |
| `-128` | `01 80` |
| `128` | `02 00 80` |
| `8388607` | `03 7F FF FF` |
| `-8388608` | `03 80 00 00` |
| `2147483647` | `04 7F FF FF FF` |

#### Blob 디코딩

| 테스트명 | 입력 (hex) | 기대값 | 설명 |
|----------|-----------|--------|------|
| `blob_empty` | `00` | `[]` | 빈 배열 |
| `blob_1byte` | `01 AB` | `[0xAB]` | 최소 직접 길이 |
| `blob_253bytes` | `FD [253바이트]` | 253바이트 배열 | 직접 길이 최대 |
| `blob_254bytes` | `FF 00 FE [254바이트]` | 254바이트 배열 | ushort 길이 진입 |
| `blob_65535bytes` | `FF FF FF [65535바이트]` | 65535바이트 배열 | ushort 길이 최대 |
| `blob_65536bytes` | `FE 00 01 00 00 [65536바이트]` | 65536바이트 배열 | int 길이 진입 |

#### Text (UTF-8)

| 테스트명 | 입력 (hex) | 기대값 |
|----------|-----------|--------|
| `text_empty` | `00` | `""` |
| `text_ascii` | `05 48 65 6C 6C 6F` | `"Hello"` |
| `text_korean` | `09 EC 95 88 EB 85 95 ED 95 98` | `"안녕하"` (9바이트 UTF-8) |

#### 기본 타입

| 테스트명 | 입력 (hex) | 기대값 |
|----------|-----------|--------|
| `read_byte` | `FF` | `-1i8` |
| `read_short` | `00 80` | `128i16` |
| `read_int` | `FF FF FF FF` | `-1i32` |
| `read_long` | `00 00 00 00 00 00 00 01` | `1i64` |
| `read_bool_true` | `01` | `true` |
| `read_bool_false` | `00` | `false` |

---

### 11.2 단위 테스트 — `pack.rs`

#### MapPack 역직렬화

```
입력 (hex):
  02          ← entry 수 = 2 (Decimal: 01 02)
  04 6C 6F 6F 70     ← key = "loop" (blob: len=4, "loop")
  14 01 05           ← value = DecimalValue(5): type=0x14(Decimal), 01=byte_tag, 05=값
  05 69 6E 64 65 78  ← key = "index"
  14 01 64           ← value = DecimalValue(100)

기대값:
  MapPack { "loop": Decimal(5), "index": Decimal(100) }
```

#### XLogPack 역직렬화

Blob 래핑 구조 검증:
```
입력: [blob_header][내부_바이트...]
  내부 바이트 순서 (최소 필드만):
    end_time:  Decimal(1711598400000)  ← 2024-03-28 00:00:00 KST
    obj_hash:  Decimal(-123456789)
    service:   Decimal(987654321)
    txid:      Long(0x0011223344556677)
    caller:    Long(0)
    gxid:      Long(0x0011223344556677)
    elapsed:   Decimal(1234)           ← 1234ms
    error:     Decimal(0)              ← 정상
    cpu:       Decimal(50)
    sql_count: Decimal(3)
    sql_time:  Decimal(100)
    ipaddr:    Blob([192, 168, 1, 1])
    kbytes:    Decimal(512)
    status:    Decimal(0)
    userid:    Decimal(0)
    user_agent: Decimal(0)
    referer:   Decimal(0)
    group:     Decimal(0)
    apicall_count: Decimal(0)
    apicall_time:  Decimal(0)
    ← available() == 0 이면 이후 필드 없음

기대 JSON:
  {
    "end_time": 1711598400000,
    "txid": "4822678189205111",   ← String (정밀도 보존)
    "elapsed": 1234,
    "error": 0,
    "service": 987654321,
    "ipaddr": "192.168.1.1",
    ...
  }
```

#### txid String 직렬화 검증

| 입력 i64 | 기대 JSON 값 | 이유 |
|----------|-------------|------|
| `9007199254740993` | `"9007199254740993"` | JS MAX_SAFE_INTEGER(2^53) 초과 |
| `1` | `"1"` | 항상 String |
| `-1` | `"-1"` | 음수도 String |

---

### 11.3 단위 테스트 — `connection.rs`

#### SHA-256 with salt

| 입력 비밀번호 | 기대 hex (64자) |
|--------------|-----------------|
| `"admin"` | `sha256("admin" + "qwertyuiop!@#$%^&*()zxcvbnm,.")` 계산값 |
| `""` (빈 문자열) | `sha256("" + SALT)` 계산값 |

> 구현 전 `sha256("admin" + SALT)` 를 별도 도구(Python 등)로 미리 계산해 테스트에 하드코딩.

#### 요청 직렬화 검증 (오프라인)

LOGIN 요청 패킷을 실제 네트워크 없이 바이트 배열로 생성 후 구조 검증:
```
assert_eq!(&bytes[0..4], &[0xCA, 0xFE, 0x20, 0x01]);  // 매직 넘버
// 이후 bytes를 ScouterReader로 다시 읽어 역직렬화 round-trip 검증
```

---

### 11.4 통합 테스트 — 실제 Collector 필요

> **전제**: Scouter Collector가 `localhost:6100`에서 실행 중이어야 함.
> CI에서는 skip, 로컬에서만 실행: `#[ignore]` 태그 사용.

#### TC-01: 로그인 성공

```
조건: 유효한 host/port/user/pass
invoke("connect_scouter", { host: "localhost", port: 6100, user: "admin", pass: "admin" })
기대: Ok(ServerInfo { server_id: "...", version: "..." })
```

#### TC-02: 로그인 실패 — 잘못된 비밀번호

```
조건: 잘못된 password
invoke("connect_scouter", { ..., pass: "wrong" })
기대: Err("로그인 실패: ...")
```

#### TC-03: 로그인 실패 — 연결 불가

```
조건: Collector가 실행되지 않은 포트
invoke("connect_scouter", { port: 19999, ... })
기대: Err("연결 실패: ...")
  또는 3초 이내 타임아웃 후 에러 반환 (connect timeout = 3000ms)
```

#### TC-04: 실시간 XLog 수신

```
조건: 로그인 완료 후, 모니터링 대상 서비스에 HTTP 요청 발생 중
invoke("start_xlog_stream", { objHashes: [objHash] })
listen("scouter://xlog", handler)
기대: 2초 이내 첫 번째 XLog 수신 (elapsed > 0, txid != "0")
```

#### TC-05: 커서 연속성 — 중복 수신 없음

```
조건: XLog 스트리밍 중
10초간 수신된 XLog의 txid 집합에 중복 없어야 함
```

#### TC-06: 딕셔너리 조회

```
조건: XLog 수신 후 service hash 확보
invoke("resolve_texts", { textType: "service", hashes: [serviceHash], date: "20260328" })
기대: { "[serviceHash hex]": "/some/api/path" }  (빈 문자열 아님)
```

#### TC-07: 세션 만료 처리

```
조건: 로그인 후 서버에서 세션 강제 만료 (또는 soTimeout 초과)
기대: "scouter://disconnected" 이벤트 수신
      이후 start_xlog_stream 호출 시 Err("연결되지 않음") 반환
```

#### TC-08: 스트리밍 중단 후 재시작

```
invoke("start_xlog_stream", { objHashes })
// 5초 대기
invoke("stop_xlog_stream")
// 2초 대기 — 이 사이에 xlog 이벤트 수신 없어야 함
invoke("start_xlog_stream", { objHashes })
// 다시 정상 수신 확인
```

---

### 11.5 에러 케이스 명세

| 케이스 | 입력 조건 | 기대 동작 |
|--------|----------|----------|
| 미연결 상태에서 `start_xlog_stream` | `connect_scouter` 미호출 | `Err("연결되지 않음")` |
| 미연결 상태에서 `resolve_texts` | 동일 | `Err("연결되지 않음")` |
| `start_xlog_stream` 중복 호출 | 이미 스트리밍 중 | 기존 태스크 abort 후 새 태스크 시작 (재시작) |
| 잘못된 `text_type` 문자열 | 존재하지 않는 TextType | `Err("알 수 없는 TextType: ...")` |
| 빈 `obj_hashes` | `[]` 전달 | `Err("objHashes 최소 1개 필요")` 또는 빈 결과 수신 (서버 동작 확인 필요) |
| Collector 강제 종료 중 폴링 | `read_byte()` IO 에러 | `"scouter://disconnected"` emit, 폴링 루프 종료 |
