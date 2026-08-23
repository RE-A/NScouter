// src-tauri/src/scouter/profile.rs
// XLogProfilePack 및 Step 타입 파싱
// 참조: docs/asis/01-common-data-model.md 섹션 1.2 (Step 타입 체계)
// 참조: docs/asis/14-collector-tcp-protocol.md

use std::io;
use super::codec::ScouterReader;
use super::pack::MapPack;
use super::value::ScouterValue;

pub(crate) fn serialize_i64_as_string<S>(val: &i64, s: S) -> Result<S::Ok, S::Error>
where S: serde::Serializer {
    s.serialize_str(&val.to_string())
}

fn deserialize_i64_from_string<'de, D>(d: D) -> Result<i64, D::Error>
where D: serde::Deserializer<'de> {
    use serde::Deserialize;
    let s = String::deserialize(d)?;
    s.parse::<i64>().map_err(serde::de::Error::custom)
}

// ─── Step 공통 기반 ───────────────────────────────────────────

/// StepSingle 공통 필드 (ASIS: scouter.lang.step.StepSingle)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StepBase {
    pub parent: i32,        // 부모 Step index (-1 = 루트)
    pub index: i32,         // 이 Step의 인덱스
    pub start_time: i64,    // 트랜잭션 시작으로부터 상대 시간 (ms)
    pub start_cpu: i32,     // CPU 시간 기준값
}

// ─── Method Step ─────────────────────────────────────────────

/// MethodStep (Type 1) + MethodStep2 (Type 10)
/// elapsed / cputime은 MethodStep(1)이면 0
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MethodProfileStep {
    #[serde(flatten)]
    pub base: StepBase,
    pub hash: i32,      // 메서드명 hash (text_type::METHOD로 조회)
    pub elapsed: i32,   // ms (MethodStep2만 유효)
    pub cputime: i32,   // ms (MethodStep2만 유효)
}

// ─── SQL Step ────────────────────────────────────────────────

/// SqlStep (Type 2) + SqlStep2 (Type 8) + SqlStep3 (Type 16)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SqlProfileStep {
    #[serde(flatten)]
    pub base: StepBase,
    pub hash: i32,      // SQL hash (text_type::SQL로 조회)
    pub param: String,  // SQL 파라미터 (바인딩 값)
    pub elapsed: i32,   // ms
    pub error: i32,     // 에러 hash (0=정상)
    pub updated: i32,   // 영향받은 행 수 (SqlStep2+)
}

// ─── ApiCall Step ────────────────────────────────────────────

/// ApiCallStep (Type 6) + ApiCallStep2 (Type 15)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ApiCallProfileStep {
    #[serde(flatten)]
    pub base: StepBase,
    pub hash: i32,       // API endpoint hash (text_type::APICALL로 조회)
    pub elapsed: i32,    // ms
    pub error: i32,      // 에러 hash (0=정상)
    #[serde(serialize_with = "serialize_i64_as_string")]
    #[serde(deserialize_with = "deserialize_i64_from_string")]
    pub txid: i64,       // 연관 트랜잭션 ID
    pub address: String, // API endpoint 주소 (ApiCallStep2만 유효)
}

// ─── Message Step ────────────────────────────────────────────

/// MessageStep (Type 3): 직접 텍스트
/// HashedMessageStep (Type 9): hash → text 조회 필요
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MessageProfileStep {
    #[serde(flatten)]
    pub base: StepBase,
    pub message: String, // MessageStep 직접 텍스트
    pub hash: i32,       // HashedMessageStep hash (0이면 message 사용)
}

// ─── Socket Step ─────────────────────────────────────────────

/// SocketStep (Type 5)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SocketProfileStep {
    #[serde(flatten)]
    pub base: StepBase,
    pub ipaddr: String,
    pub port: i32,
    pub elapsed: i32,
    pub error: i32,
}

// ─── ThreadCall Step ─────────────────────────────────────────

/// ThreadCallPossibleStep (Type 14)
///
/// "여기서 다른 스레드로 넘어갔을 수 있다" 는 표시다. 실제로 넘어갔으면
/// `threaded` 가 1이고 `txid` 가 **그 스레드의 트랜잭션**을 가리킨다 —
/// 그 txid 로 프로파일을 열면 이어지는 작업이 보인다 (ASIS XLogThreadProfileView).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ThreadCallProfileStep {
    #[serde(flatten)]
    pub base: StepBase,
    /// 넘어간 스레드의 트랜잭션 ID. 0 이면 없다
    #[serde(serialize_with = "serialize_i64_as_string")]
    #[serde(deserialize_with = "deserialize_i64_from_string")]
    pub txid: i64,
    /// 이름 hash (text_type::APICALL 로 조회)
    pub hash: i32,
    pub elapsed: i32,
    /// **실제로 스레드가 떴는가.** 아니면 txid 를 따라가도 빈 프로파일이다
    pub threaded: bool,
}

// ─── Profile Step enum ───────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind")]
pub enum ProfileStep {
    Method(MethodProfileStep),
    Sql(SqlProfileStep),
    ApiCall(ApiCallProfileStep),
    Message(MessageProfileStep),
    Socket(SocketProfileStep),
    ThreadCall(ThreadCallProfileStep),
    /// 본문은 **정확히 소비했지만** 화면에 노출하지 않는 Step.
    ///
    /// `base` 를 함께 들고 있어야 한다 — 버리면 제대로 읽힌 Step 이
    /// index=-1 로 보여서 **파싱이 깨진 것과 구별되지 않는다.**
    /// 실제로 그 때문에 프로파일 테스트가 간헐적으로 오진을 냈다.
    ///
    /// StepControl(99) 처럼 base 자체가 없는 종류는 None 이다.
    Unknown {
        step_type: u8,
        base: Option<StepBase>,
    },
}

// ─── XLogProfilePack ─────────────────────────────────────────

/// XLog 프로파일 (PackType: 26 또는 27)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct XLogProfilePack {
    #[serde(serialize_with = "serialize_i64_as_string")]
    #[serde(deserialize_with = "deserialize_i64_from_string")]
    pub txid: i64,
    pub obj_hash: i32,
    pub steps: Vec<ProfileStep>,
}

// ─── 파싱 ────────────────────────────────────────────────────

/// profile blob (byte array)에서 Step 목록 파싱
/// ASIS: XLogProfilePack.read() → Step.readStep(type, DataInputX)
pub fn parse_profile_steps(blob: Vec<u8>) -> Vec<ProfileStep> {
    let mut reader = ScouterReader::new(blob);
    let mut steps = Vec::new();

    while reader.remaining() > 0 {
        match read_step(&mut reader) {
            Ok(step) => steps.push(step),
            Err(e) => {
                log::warn!("프로파일 Step 파싱 오류 (이후 무시): {e}");
                break;
            }
        }
    }

    steps
}

/// 단일 Step 파싱
///
/// **필드 순서·타입 근거는 ASIS `scouter.lang.step.*` 의 `read(DataInputX)` 다.**
/// 상속 체인을 그대로 펼쳐야 한다 (예: SqlStep3 = SqlStep + xtype + updated).
/// 한 Step 이라도 바이트 수를 틀리면 **이후 Step 전부가 쓰레기**가 된다.
///
/// 실측 검증: `live_xlog_profile_steps`
fn read_step(r: &mut ScouterReader) -> io::Result<ProfileStep> {
    let step_type = r.read_unsigned_byte()?;

    // StepControl 은 StepSummary 상속이라 StepSingle base 가 없다.
    // ASIS: message(text) → code(decimal) 순서다.
    if step_type == 99 {
        let _message = r.read_text()?;
        let _code = r.read_decimal()?;
        return Ok(ProfileStep::Unknown { step_type, base: None });
    }

    let base = read_step_base(r)?;

    match step_type {
        // ─ MethodStep (1) : hash, elapsed, cputime ─────────────────
        1 => {
            let hash = r.read_decimal()? as i32;
            let elapsed = r.read_decimal()? as i32;
            let cputime = r.read_decimal()? as i32;
            Ok(ProfileStep::Method(MethodProfileStep { base, hash, elapsed, cputime }))
        }
        // ─ MethodStep2 (10) : MethodStep + error ───────────────────
        10 => {
            let hash = r.read_decimal()? as i32;
            let elapsed = r.read_decimal()? as i32;
            let cputime = r.read_decimal()? as i32;
            let _error = r.read_decimal()?;
            Ok(ProfileStep::Method(MethodProfileStep { base, hash, elapsed, cputime }))
        }
        // ─ SqlStep(2) / SqlStep2(8) / SqlStep3(16) ─────────────────
        // SqlStep  : hash, elapsed, cputime, param, error
        // SqlStep2 : + xtype(byte)
        // SqlStep3 : + updated(decimal)
        2 | 8 | 16 => {
            let hash = r.read_decimal()? as i32;
            let elapsed = r.read_decimal()? as i32;
            let _cputime = r.read_decimal()?;
            let param = r.read_text()?;
            let error = r.read_decimal()? as i32;
            if step_type == 8 || step_type == 16 {
                let _xtype = r.read_byte()?;
            }
            let updated = if step_type == 16 { r.read_decimal()? as i32 } else { 0 };
            Ok(ProfileStep::Sql(SqlProfileStep { base, hash, param, elapsed, error, updated }))
        }
        // ─ MessageStep (3) : message ───────────────────────────────
        3 => {
            let message = r.read_text()?;
            Ok(ProfileStep::Message(MessageProfileStep { base, message, hash: 0 }))
        }
        // ─ HashedMessageStep (9) : hash, time, value ───────────────
        9 => {
            let hash = r.read_decimal()? as i32;
            let _time = r.read_decimal()?;
            let _value = r.read_decimal()?;
            Ok(ProfileStep::Message(MessageProfileStep { base, message: String::new(), hash }))
        }
        // ─ ParameterizedMessageStep (17) : hash, elapsed, level, param ─
        17 => {
            let hash = r.read_decimal()? as i32;
            let _elapsed = r.read_decimal()?;
            let _level = r.read_decimal()?;
            let param_string = r.read_text()?;
            Ok(ProfileStep::Message(MessageProfileStep { base, message: param_string, hash }))
        }
        // ─ ApiCallStep(6) / ApiCallStep2(15) ───────────────────────
        // txid 가 **맨 앞**이고 readDecimal(가변)이다. readLong 이 아니다.
        // opt==1 일 때만 address 가 따라온다.
        6 | 15 => {
            let txid = r.read_decimal()?;
            let hash = r.read_decimal()? as i32;
            let elapsed = r.read_decimal()? as i32;
            let _cputime = r.read_decimal()?;
            let error = r.read_decimal()? as i32;
            let opt = r.read_byte()?;
            let address = if opt == 1 { r.read_text()? } else { String::new() };
            if step_type == 15 {
                let _async_flag = r.read_byte()?;
            }
            Ok(ProfileStep::ApiCall(ApiCallProfileStep {
                base, hash, elapsed, error, txid, address,
            }))
        }
        // ─ SocketStep (5) : ipaddr, port, elapsed, error ───────────
        5 => {
            let ipaddr_bytes = r.read_blob()?;
            let ipaddr = bytes_to_ip(&ipaddr_bytes);
            let port = r.read_decimal()? as i32;
            let elapsed = r.read_decimal()? as i32;
            let error = r.read_decimal()? as i32;
            Ok(ProfileStep::Socket(SocketProfileStep { base, ipaddr, port, elapsed, error }))
        }
        // ─ DispatchStep (13) : ApiCallStep 과 동일 구조 ────────────
        13 => {
            let _txid = r.read_decimal()?;
            let _hash = r.read_decimal()?;
            let _elapsed = r.read_decimal()?;
            let _cputime = r.read_decimal()?;
            let _error = r.read_decimal()?;
            let opt = r.read_byte()?;
            if opt == 1 {
                let _address = r.read_text()?;
            }
            Ok(ProfileStep::Unknown { step_type, base: Some(base) })
        }
        // ─ ThreadSubmitStep (7) : txid, hash, elapsed, cputime, error ─
        7 => {
            let _txid = r.read_decimal()?;
            let _hash = r.read_decimal()?;
            let _elapsed = r.read_decimal()?;
            let _cputime = r.read_decimal()?;
            let _error = r.read_decimal()?;
            Ok(ProfileStep::Unknown { step_type, base: Some(base) })
        }
        // ─ ThreadCallPossibleStep (14) : txid, hash, elapsed, threaded ─
        14 => {
            let txid = r.read_decimal()?;
            let hash = r.read_decimal()? as i32;
            let elapsed = r.read_decimal()? as i32;
            let threaded = r.read_byte()? != 0;
            Ok(ProfileStep::ThreadCall(ThreadCallProfileStep {
                base,
                txid,
                hash,
                elapsed,
                threaded,
            }))
        }
        // ─ DumpStep (12) ───────────────────────────────────────────
        12 => {
            let n = r.read_decimal()? as usize; // stacks: int[]
            for _ in 0..n {
                let _ = r.read_int()?;
            }
            let _thread_id = r.read_long()?;
            let _thread_name = r.read_text()?;
            let _thread_state = r.read_text()?;
            let _lock_owner_id = r.read_long()?;
            let _lock_name = r.read_text()?;
            let _lock_owner_name = r.read_text()?;
            Ok(ProfileStep::Unknown { step_type, base: Some(base) })
        }
        // ─ 미구현 타입 ─────────────────────────────────────────────
        // 본문 길이를 모르므로 **여기서 멈춰야 한다.**
        // 그냥 Unknown 을 돌려주면 다음 Step 부터 전부 쓰레기가 된다.
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("미구현 Step 타입 {step_type} — 본문 길이를 몰라 이후 파싱 불가"),
        )),
    }
}

/// StepSingle 공통 base 읽기 (ASIS: StepSingle.read())
fn read_step_base(r: &mut ScouterReader) -> io::Result<StepBase> {
    let parent = r.read_decimal()? as i32;
    let index = r.read_decimal()? as i32;
    let start_time = r.read_decimal()? as i64;
    let start_cpu = r.read_decimal()? as i32;
    Ok(StepBase { parent, index, start_time, start_cpu })
}

fn bytes_to_ip(bytes: &[u8]) -> String {
    if bytes.len() == 4 {
        format!("{}.{}.{}.{}", bytes[0], bytes[1], bytes[2], bytes[3])
    } else {
        String::new()
    }
}

// ─── 전체 프로파일 요청 ───────────────────────────────────────

/// `TRANX_PROFILE_FULL` 파라미터.
///
/// `TRANX_PROFILE` 과의 차이 (콜렉터 2.21.3 XLogService 바이트코드 확인):
///
/// | | 읽는 키 | max | 응답 |
/// |---|---|---|---|
/// | `TRANX_PROFILE` | date · txid · gxid · xlogType · **max** | 요청값 | XLogProfilePack |
/// | `TRANX_PROFILE_FULL` | date · txid · gxid · xlogType | **-1 고정** | `[3][blob]` 청크 스트림 |
///
/// `gxid`/`xlogType` 을 비워 보내면 콜렉터가 txid 로 XLog 를 찾아 채운다.
/// 그래서 date·txid 만 준다 (ASIS XLogProxy.getFullProfile 과 동일).
pub fn build_full_profile_param(date: &str, txid: i64) -> MapPack {
    let mut param = MapPack::new();
    param.put("date", ScouterValue::Text(date.to_string()));
    param.put("txid", ScouterValue::Decimal(txid));
    param
}

#[cfg(test)]
mod full_profile_tests {
    use super::*;

    #[test]
    fn full_profile_param_has_date_and_txid() {
        let p = build_full_profile_param("20260817", -735646748055516174);
        assert_eq!(p.get_text("date"), Some("20260817"));
        assert_eq!(p.get_decimal("txid"), Some(-735646748055516174));
        // max 를 보내면 안 된다 — FULL 은 서버가 -1 로 고정한다.
        assert!(p.entries.get("max").is_none());
    }
}

#[cfg(test)]
mod thread_call_tests {
    use super::*;
    use super::super::codec::ScouterWriter;

    /// StepSingle base + ThreadCallPossibleStep 본문
    fn thread_call_blob(txid: i64, hash: i32, elapsed: i32, threaded: i8) -> Vec<u8> {
        let mut w = ScouterWriter::new();
        w.write_unsigned_byte(14);
        // base: parent, index, start_time, start_cpu
        w.write_decimal(-1);
        w.write_decimal(0);
        w.write_decimal(120);
        w.write_decimal(0);
        // 본문
        w.write_decimal(txid);
        w.write_decimal(hash as i64);
        w.write_decimal(elapsed as i64);
        w.write_byte(threaded);
        w.into_bytes()
    }

    #[test]
    fn thread_call_step_keeps_txid() {
        // 이 txid 가 있어야 그 스레드의 프로파일을 열 수 있다 (ThreadProfile).
        // 예전에는 본문만 소비하고 값을 버려서 화면에서 아무것도 못 했다.
        let steps = parse_profile_steps(thread_call_blob(4516550232655921395, 777, 42, 1));

        assert_eq!(steps.len(), 1);
        match &steps[0] {
            ProfileStep::ThreadCall(t) => {
                assert_eq!(t.txid, 4516550232655921395);
                assert_eq!(t.hash, 777);
                assert_eq!(t.elapsed, 42);
                assert!(t.threaded, "threaded=1 이면 실제로 스레드가 떴다는 뜻이다");
                assert_eq!(t.base.start_time, 120);
            }
            other => panic!("ThreadCall 이 아니다: {other:?}"),
        }
    }

    #[test]
    fn not_threaded_is_marked() {
        // threaded=0 이면 **스레드가 뜨지 않았다.** 링크를 걸면 빈 프로파일로 간다.
        let steps = parse_profile_steps(thread_call_blob(0, 1, 0, 0));
        match &steps[0] {
            ProfileStep::ThreadCall(t) => {
                assert!(!t.threaded);
                assert_eq!(t.txid, 0);
            }
            other => panic!("ThreadCall 이 아니다: {other:?}"),
        }
    }

    #[test]
    fn thread_call_does_not_break_following_steps() {
        // 본문 길이를 하나라도 틀리면 **이후 스텝 전부가 쓰레기**가 된다.
        let mut blob = thread_call_blob(9, 1, 2, 1);
        blob.extend(thread_call_blob(10, 2, 3, 0));

        let steps = parse_profile_steps(blob);
        assert_eq!(steps.len(), 2, "두 번째 스텝을 못 읽었다");
    }
}
