// src-tauri/src/scouter/profile.rs
// XLogProfilePack 및 Step 타입 파싱
// 참조: docs/asis/01-common-data-model.md 섹션 1.2 (Step 타입 체계)
// 참조: docs/asis/14-collector-tcp-protocol.md

use std::io;
use super::codec::ScouterReader;

fn serialize_i64_as_string<S>(val: &i64, s: S) -> Result<S::Ok, S::Error>
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

// ─── Profile Step enum ───────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind")]
pub enum ProfileStep {
    Method(MethodProfileStep),
    Sql(SqlProfileStep),
    ApiCall(ApiCallProfileStep),
    Message(MessageProfileStep),
    Socket(SocketProfileStep),
    Unknown { step_type: u8 },
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
fn read_step(r: &mut ScouterReader) -> io::Result<ProfileStep> {
    let step_type = r.read_unsigned_byte()?;

    // StepSingle 계열 공통 기반 (StepSummary / StepControl은 포함 안 됨)
    // ASIS: StepSingle.read() = readDecimal×4
    let base = read_step_base(r)?;

    match step_type {
        // ─ MethodStep (Type 1) ──────────────────────────────────────
        1 => {
            let hash = r.read_decimal()? as i32;
            Ok(ProfileStep::Method(MethodProfileStep {
                base,
                hash,
                elapsed: 0,
                cputime: 0,
            }))
        }
        // ─ MethodStep2 (Type 10) ────────────────────────────────────
        10 => {
            let hash = r.read_decimal()? as i32;
            let elapsed = r.read_decimal()? as i32;
            let cputime = r.read_decimal()? as i32;
            Ok(ProfileStep::Method(MethodProfileStep { base, hash, elapsed, cputime }))
        }
        // ─ SqlStep (Type 2) ─────────────────────────────────────────
        2 => {
            let hash = r.read_decimal()? as i32;
            let param = r.read_text()?;
            let elapsed = r.read_decimal()? as i32;
            let error = r.read_decimal()? as i32;
            Ok(ProfileStep::Sql(SqlProfileStep { base, hash, param, elapsed, error, updated: 0 }))
        }
        // ─ SqlStep2 (Type 8) ────────────────────────────────────────
        8 => {
            let hash = r.read_decimal()? as i32;
            let param = r.read_text()?;
            let elapsed = r.read_decimal()? as i32;
            let error = r.read_decimal()? as i32;
            let updated = r.read_decimal()? as i32;
            Ok(ProfileStep::Sql(SqlProfileStep { base, hash, param, elapsed, error, updated }))
        }
        // ─ SqlStep3 (Type 16) ───────────────────────────────────────
        16 => {
            let hash = r.read_decimal()? as i32;
            let param = r.read_text()?;
            let elapsed = r.read_decimal()? as i32;
            let error = r.read_decimal()? as i32;
            let updated = r.read_decimal()? as i32;
            let _sql_crud = r.read_text()?; // 무시 (SqlStep3 확장 필드)
            Ok(ProfileStep::Sql(SqlProfileStep { base, hash, param, elapsed, error, updated }))
        }
        // ─ MessageStep (Type 3) ─────────────────────────────────────
        3 => {
            let message = r.read_text()?;
            Ok(ProfileStep::Message(MessageProfileStep { base, message, hash: 0 }))
        }
        // ─ HashedMessageStep (Type 9) ───────────────────────────────
        9 => {
            let hash = r.read_decimal()? as i32;
            let _time = r.read_decimal()?;
            let _value = r.read_decimal()?;
            Ok(ProfileStep::Message(MessageProfileStep { base, message: String::new(), hash }))
        }
        // ─ ParameterizedMessageStep (Type 17) ───────────────────────
        17 => {
            let hash = r.read_decimal()? as i32;
            let _elapsed = r.read_decimal()?;
            let param_string = r.read_text()?;
            Ok(ProfileStep::Message(MessageProfileStep { base, message: param_string, hash }))
        }
        // ─ ApiCallStep (Type 6) ─────────────────────────────────────
        6 => {
            let hash = r.read_decimal()? as i32;
            let elapsed = r.read_decimal()? as i32;
            let error = r.read_decimal()? as i32;
            let txid = r.read_long()?;
            Ok(ProfileStep::ApiCall(ApiCallProfileStep {
                base,
                hash,
                elapsed,
                error,
                txid,
                address: String::new(),
            }))
        }
        // ─ ApiCallStep2 (Type 15) ───────────────────────────────────
        15 => {
            let hash = r.read_decimal()? as i32;
            let elapsed = r.read_decimal()? as i32;
            let error = r.read_decimal()? as i32;
            let txid = r.read_long()?;
            let address = r.read_text()?;
            Ok(ProfileStep::ApiCall(ApiCallProfileStep { base, hash, elapsed, error, txid, address }))
        }
        // ─ SocketStep (Type 5) ──────────────────────────────────────
        5 => {
            let ipaddr_bytes = r.read_blob()?;
            let ipaddr = bytes_to_ip(&ipaddr_bytes);
            let port = r.read_decimal()? as i32;
            let elapsed = r.read_decimal()? as i32;
            let error = r.read_decimal()? as i32;
            Ok(ProfileStep::Socket(SocketProfileStep { base, ipaddr, port, elapsed, error }))
        }
        // ─ DispatchStep (Type 13) / ThreadSubmitStep (Type 7) ───────
        // hash, elapsed, error, txid (long)
        13 | 7 => {
            let _hash = r.read_decimal()?;
            let _elapsed = r.read_decimal()?;
            let _error = r.read_decimal()?;
            let _txid = r.read_long()?;
            Ok(ProfileStep::Unknown { step_type })
        }
        // ─ ThreadCallPossibleStep (Type 14) ─────────────────────────
        14 => {
            let _hash = r.read_decimal()?;
            let _elapsed = r.read_decimal()?;
            let _txid = r.read_long()?;
            Ok(ProfileStep::Unknown { step_type })
        }
        // ─ StepControl (Type 99) ────────────────────────────────────
        // StepControl은 StepSingle을 상속하지 않음 → base 읽기 불필요
        // 하지만 이미 read_step_base()를 호출한 상태이므로 추가 필드만 처리
        99 => {
            let _code = r.read_text()?;
            let _message = r.read_text()?;
            Ok(ProfileStep::Unknown { step_type })
        }
        // ─ 기타 미구현 Step 타입 ─────────────────────────────────────
        _ => Ok(ProfileStep::Unknown { step_type }),
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
