// src-tauri/src/scouter/pack.rs
// XLogPack, MapPack 역직렬화
// 참조: docs/asis/14-collector-tcp-protocol.md 섹션 7.4 ~ 7.6

use std::collections::HashMap;
use std::io;

use super::codec::{ScouterReader, ScouterWriter};
use super::protocol::*;
use super::value::ScouterValue;

// ─── MapPack ──────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct MapPack {
    pub entries: HashMap<String, ScouterValue>,
}

impl MapPack {
    pub fn new() -> Self {
        Self { entries: HashMap::new() }
    }

    pub fn put(&mut self, key: impl Into<String>, val: ScouterValue) {
        self.entries.insert(key.into(), val);
    }

    pub fn get_decimal(&self, key: &str) -> Option<i64> {
        self.entries.get(key)?.as_decimal()
    }

    pub fn get_text(&self, key: &str) -> Option<&str> {
        self.entries.get(key)?.as_text()
    }

    /// MapPack 역직렬화 (PackType 바이트는 이미 읽힌 상태에서 호출)
    pub fn read(r: &mut ScouterReader) -> io::Result<Self> {
        let count = r.read_decimal()? as usize;
        let mut entries = HashMap::with_capacity(count);
        for _ in 0..count {
            let key = r.read_text()?;
            let val = ScouterValue::read_from(r)?;
            entries.insert(key, val);
        }
        Ok(Self { entries })
    }

    /// MapPack 직렬화 (PackType 바이트 포함)
    pub fn write(&self, w: &mut ScouterWriter) {
        w.write_unsigned_byte(PACK_MAP);
        w.write_decimal(self.entries.len() as i64);
        for (k, v) in &self.entries {
            w.write_text(k);
            v.write_to(w);
        }
    }
}

// ─── XLogPack ─────────────────────────────────────────────────

/// XLog 트랜잭션 데이터
/// txid / caller / gxid는 i64이지만 JS Number.MAX_SAFE_INTEGER를 초과할 수 있으므로
/// 직렬화 시 String으로 변환
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct XLogPack {
    pub end_time: i64,
    pub obj_hash: i32,
    pub service: i32,
    #[serde(serialize_with = "serialize_i64_as_string")]
    #[serde(deserialize_with = "deserialize_i64_from_string")]
    pub txid: i64,
    #[serde(serialize_with = "serialize_i64_as_string")]
    #[serde(deserialize_with = "deserialize_i64_from_string")]
    pub caller: i64,
    #[serde(serialize_with = "serialize_i64_as_string")]
    #[serde(deserialize_with = "deserialize_i64_from_string")]
    pub gxid: i64,
    pub elapsed: i32,
    pub error: i32,
    pub cpu: i32,
    pub sql_count: i32,
    pub sql_time: i32,
    pub ipaddr: String, // "x.x.x.x" 포맷
    pub kbytes: i32,
    pub status: i32,
    pub userid: i64,
    pub user_agent: i32,
    pub referer: i32,
    pub group: i32,
    pub apicall_count: i32,
    pub apicall_time: i32,
    // 아래 필드는 available() > 0 체크 후 선택적으로 존재
    pub country_code: String,
    pub city: i32,
    pub x_type: u8,
    pub login: i32,
    pub desc: i32,
    pub web_hash: i32,
    pub web_time: i32,
    pub has_dump: u8,
    pub thread_name_hash: i32,
    pub text1: String,
    pub text2: String,
    pub queuing_host_hash: i32,
    pub queuing_time: i32,
    pub queuing2nd_host_hash: i32,
    pub queuing2nd_time: i32,
    pub text3: String,
    pub text4: String,
    pub text5: String,
    pub profile_count: i32,
    pub b3_mode: bool,
    pub profile_size: i32,
    pub discard_type: u8,
    pub ignore_global_consequent_sampling: bool,
}

impl XLogPack {
    /// XLogPack 역직렬화 (PackType 바이트는 이미 읽힌 상태에서 호출)
    /// 내부 데이터 전체가 Blob으로 래핑되어 있음 (XLogPack.write 기준)
    pub fn read(outer: &mut ScouterReader) -> io::Result<Self> {
        let blob = outer.read_blob()?;
        let mut d = ScouterReader::new(blob);
        Self::read_inner(&mut d)
    }

    /// 이미 Blob 언래핑이 완료된 바이트에서 직접 역직렬화
    /// connection.rs에서 스트림으로 blob을 읽은 후 호출
    pub fn read_from_blob(blob: Vec<u8>) -> io::Result<Self> {
        let mut d = ScouterReader::new(blob);
        Self::read_inner(&mut d)
    }

    /// `read_from_blob` 의 거꾸로 — 콜렉터가 보내는 것과 같은 모양(선택 필드까지 다 채운 것)으로 쓴다.
    ///
    /// **로컬 캐시에 담으려고 있다**(`crate::cache`). JSON 으로 담으면 한 건이 600바이트 남짓인데
    /// 이 모양은 100~150바이트다 — 시간당 50만 건 서비스면 그 차이가 그대로 캐시 크기다.
    pub fn to_blob(&self) -> Vec<u8> {
        let mut w = super::codec::ScouterWriter::new();
        w.write_decimal(self.end_time);
        w.write_decimal(self.obj_hash as i64);
        w.write_decimal(self.service as i64);
        w.write_long(self.txid);
        w.write_long(self.caller);
        w.write_long(self.gxid);
        w.write_decimal(self.elapsed as i64);
        w.write_decimal(self.error as i64);
        w.write_decimal(self.cpu as i64);
        w.write_decimal(self.sql_count as i64);
        w.write_decimal(self.sql_time as i64);
        w.write_blob(&ip_to_bytes(&self.ipaddr));
        w.write_decimal(self.kbytes as i64);
        w.write_decimal(self.status as i64);
        w.write_decimal(self.userid);
        w.write_decimal(self.user_agent as i64);
        w.write_decimal(self.referer as i64);
        w.write_decimal(self.group as i64);
        w.write_decimal(self.apicall_count as i64);
        w.write_decimal(self.apicall_time as i64);
        w.write_text(&self.country_code);
        w.write_decimal(self.city as i64);
        w.write_unsigned_byte(self.x_type);
        w.write_decimal(self.login as i64);
        w.write_decimal(self.desc as i64);
        w.write_decimal(self.web_hash as i64);
        w.write_decimal(self.web_time as i64);
        w.write_unsigned_byte(self.has_dump);
        w.write_decimal(self.thread_name_hash as i64);
        w.write_text(&self.text1);
        w.write_text(&self.text2);
        w.write_decimal(self.queuing_host_hash as i64);
        w.write_decimal(self.queuing_time as i64);
        w.write_decimal(self.queuing2nd_host_hash as i64);
        w.write_decimal(self.queuing2nd_time as i64);
        w.write_text(&self.text3);
        w.write_text(&self.text4);
        w.write_text(&self.text5);
        w.write_decimal(self.profile_count as i64);
        w.write_boolean(self.b3_mode);
        w.write_decimal(self.profile_size as i64);
        w.write_unsigned_byte(self.discard_type);
        w.write_boolean(self.ignore_global_consequent_sampling);
        w.into_bytes()
    }

    fn read_inner(d: &mut ScouterReader) -> io::Result<Self> {
        let end_time = d.read_decimal()?;
        let obj_hash = d.read_decimal()? as i32;
        let service = d.read_decimal()? as i32;
        let txid = d.read_long()?;
        let caller = d.read_long()?;
        let gxid = d.read_long()?;
        let elapsed = d.read_decimal()? as i32;
        let error = d.read_decimal()? as i32;
        let cpu = d.read_decimal()? as i32;
        let sql_count = d.read_decimal()? as i32;
        let sql_time = d.read_decimal()? as i32;
        let ipaddr_bytes = d.read_blob()?;
        let ipaddr = bytes_to_ip(&ipaddr_bytes);
        let kbytes = d.read_decimal()? as i32;
        let status = d.read_decimal()? as i32;
        let userid = d.read_decimal()?;
        let user_agent = d.read_decimal()? as i32;
        let referer = d.read_decimal()? as i32;
        let group = d.read_decimal()? as i32;
        let apicall_count = d.read_decimal()? as i32;
        let apicall_time = d.read_decimal()? as i32;

        // available() > 0 체크 후 선택적 필드 읽기
        let mut country_code = String::new();
        let mut city = 0i32;
        if d.remaining() > 0 {
            country_code = d.read_text()?;
            city = d.read_decimal()? as i32;
        }

        let mut x_type = 0u8;
        if d.remaining() > 0 {
            x_type = d.read_unsigned_byte()?;
        }

        let mut login = 0i32;
        let mut desc = 0i32;
        if d.remaining() > 0 {
            login = d.read_decimal()? as i32;
            desc = d.read_decimal()? as i32;
        }

        let mut web_hash = 0i32;
        let mut web_time = 0i32;
        if d.remaining() > 0 {
            web_hash = d.read_decimal()? as i32;
            web_time = d.read_decimal()? as i32;
        }

        let mut has_dump = 0u8;
        if d.remaining() > 0 {
            has_dump = d.read_unsigned_byte()?;
        }

        let mut thread_name_hash = 0i32;
        if d.remaining() > 0 {
            thread_name_hash = d.read_decimal()? as i32;
        }

        let mut text1 = String::new();
        let mut text2 = String::new();
        if d.remaining() > 0 {
            text1 = d.read_text()?;
            text2 = d.read_text()?;
        }

        let mut queuing_host_hash = 0i32;
        let mut queuing_time = 0i32;
        let mut queuing2nd_host_hash = 0i32;
        let mut queuing2nd_time = 0i32;
        if d.remaining() > 0 {
            queuing_host_hash = d.read_decimal()? as i32;
            queuing_time = d.read_decimal()? as i32;
            queuing2nd_host_hash = d.read_decimal()? as i32;
            queuing2nd_time = d.read_decimal()? as i32;
        }

        let mut text3 = String::new();
        let mut text4 = String::new();
        let mut text5 = String::new();
        if d.remaining() > 0 {
            text3 = d.read_text()?;
            text4 = d.read_text()?;
            text5 = d.read_text()?;
        }

        let mut profile_count = 0i32;
        if d.remaining() > 0 {
            profile_count = d.read_decimal()? as i32;
        }

        let mut b3_mode = false;
        if d.remaining() > 0 {
            b3_mode = d.read_boolean()?;
        }

        let mut profile_size = 0i32;
        let mut discard_type = 0u8;
        let mut ignore_global_consequent_sampling = false;
        if d.remaining() > 0 {
            profile_size = d.read_decimal()? as i32;
            discard_type = d.read_unsigned_byte()?;
            ignore_global_consequent_sampling = d.read_boolean()?;
        }

        Ok(XLogPack {
            end_time,
            obj_hash,
            service,
            txid,
            caller,
            gxid,
            elapsed,
            error,
            cpu,
            sql_count,
            sql_time,
            ipaddr,
            kbytes,
            status,
            userid,
            user_agent,
            referer,
            group,
            apicall_count,
            apicall_time,
            country_code,
            city,
            x_type,
            login,
            desc,
            web_hash,
            web_time,
            has_dump,
            thread_name_hash,
            text1,
            text2,
            queuing_host_hash,
            queuing_time,
            queuing2nd_host_hash,
            queuing2nd_time,
            text3,
            text4,
            text5,
            profile_count,
            b3_mode,
            profile_size,
            discard_type,
            ignore_global_consequent_sampling,
        })
    }
}

// ─── ObjectPack ───────────────────────────────────────────────

/// 모니터링 대상 에이전트/인스턴스 정보 (PackType: 80)
/// ASIS: scouter.lang.pack.ObjectPack
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ObjectPack {
    pub obj_hash: i32,
    pub obj_type: String,
    pub obj_name: String,
    pub address: String,
    pub version: String,
    pub alive: bool,
    /// 에이전트가 마지막으로 살아 있음을 알린 시각 (epoch ms). 0이면 알린 적이 없다
    pub wakeup: i64,
    /// 에이전트가 붙여 보내는 부가 정보. 키는 에이전트/버전마다 다르다.
    ///
    /// **고정 스키마가 아니다.** 특정 키를 구조체 필드로 뽑으면 없는 환경에서 조용히 빈다 —
    /// 온 것을 온 대로 보여준다 (ASIS `ObjectPropertiesDialog` 도 tags 를 통째로 편다).
    pub tags: Vec<(String, String)>,
}

// ─── StackPack ────────────────────────────────────────────────

/// 샘플링으로 뜬 스레드 스택 한 장 (PackType: 62)
///
/// ASIS: `scouter.lang.pack.StackPack`
///
/// **본문이 GZIP 으로 눌려 있다** (`CompressUtil.doZip`). blob 을 그대로 문자열로
/// 읽으면 깨진 바이트가 나온다 — 풀어야 한다 (F-45).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct StackPack {
    pub time: i64,
    pub obj_hash: i32,
    /// 푼 뒤의 스택 원문
    pub stack: String,
}

// ─── PerfCounterPack ──────────────────────────────────────────

/// 성능 카운터 데이터 (PackType: 60)
/// ASIS: scouter.lang.pack.PerfCounterPack
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PerfCounterPack {
    pub time: i64,
    pub obj_name: String,
    pub timetype: u8,
    pub data: std::collections::HashMap<String, f64>,
}

// ─── AlertPack ────────────────────────────────────────────────

/// 알림 데이터 (PackType: 70)
/// ASIS: scouter.lang.pack.AlertPack
/// level: 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR, 4=FATAL
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AlertPack {
    pub time: i64,
    pub obj_type: String,
    pub obj_hash: i32,
    pub level: u8,
    pub title: String,
    pub message: String,
}

/// 인터랙션(토폴로지) 카운터 — `PackEnum.PERF_INTERACTION_COUNTER`(65).
///
/// **"누가 누구를 부르나"** 를 5분 단위로 집계한 것이다. XLog 가 트랜잭션 하나하나라면
/// 이건 호출 관계 자체를 센다.
///
/// 에이전트가 기본으로 수집하지 않는다 — `counter_interaction_enabled=true` 가 필요하다 (F-40).
///
/// `read()` 필드 순서. **`time`·`totalElapsed` 는 8바이트 고정(readLong),
/// `fromHash`~`errorCount` 는 4바이트 고정(readInt)이다.** readDecimal 이 아니다 (F-17 과 같은 함정).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct InteractionCounterPack {
    pub time: i64,
    pub obj_name: String,
    /// `INTR_API_OUTGOING` 등 10종 중 하나
    pub interaction_type: String,
    /// 호출한 쪽. objHash 이거나 외부 대상 해시다
    pub from_hash: i32,
    /// 불린 쪽
    pub to_hash: i32,
    /// 집계 구간(초)
    pub period: i32,
    pub count: i32,
    pub error_count: i32,
    pub total_elapsed: i64,
}

// ─── Pack 디스패처 ────────────────────────────────────────────

/// 스트리밍 수신 시 PackType에 따라 분기
pub enum AnyPack {
    Map(MapPack),
    XLog(XLogPack),
    Object(ObjectPack),
    Profile(Box<crate::scouter::profile::XLogProfilePack>),
    PerfCounter(PerfCounterPack),
    Alert(AlertPack),
    Interaction(InteractionCounterPack),
    Stack(StackPack),
}

// ─── 헬퍼 ────────────────────────────────────────────────────

/// `bytes_to_ip` 의 거꾸로. 못 읽는 글이면 빈 바이트 (읽으면 빈 문자열로 돌아온다)
pub fn ip_to_bytes(ip: &str) -> Vec<u8> {
    let parts: Vec<u8> = ip.split('.').filter_map(|p| p.parse::<u8>().ok()).collect();
    if parts.len() == 4 && ip.split('.').count() == 4 { parts } else { Vec::new() }
}

pub fn bytes_to_ip(bytes: &[u8]) -> String {
    if bytes.len() == 4 {
        format!("{}.{}.{}.{}", bytes[0], bytes[1], bytes[2], bytes[3])
    } else {
        String::new()
    }
}

pub fn serialize_i64_as_string<S>(val: &i64, s: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    s.serialize_str(&val.to_string())
}

/// txid 처럼 JS 정밀도를 넘는 i64 를 문자열로 보내되, 없으면 null 로 둔다.
pub fn serialize_opt_i64_as_string<S>(val: &Option<i64>, s: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    match val {
        Some(v) => s.serialize_str(&v.to_string()),
        None => s.serialize_none(),
    }
}

pub fn deserialize_i64_from_string<'de, D>(d: D) -> Result<i64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    let s = String::deserialize(d)?;
    s.parse::<i64>().map_err(serde::de::Error::custom)
}

#[cfg(test)]
mod blob_tests {
    use super::*;

    /// 캐시에 넣었다 꺼낸 것이 콜렉터에서 받은 것과 **칸 하나까지** 같아야 한다 —
    /// 하나라도 어긋나면 캐시에서 연 화면이 콜렉터에서 연 화면과 달라진다
    #[test]
    fn 쓴_것을_읽으면_그대로다() {
        let x = XLogPack {
            end_time: 1_793_528_820_123,
            obj_hash: -1_585_387_669,
            service: 12345,
            txid: -8_773_066_139_519_071_540,
            caller: 1_138_513_244_748_652_012,
            gxid: i64::MIN + 7,
            elapsed: 4051,
            error: -60_106_528,
            cpu: 12,
            sql_count: 120,
            sql_time: 337,
            ipaddr: "10.89.2.17".into(),
            kbytes: 3,
            status: 200,
            userid: -42,
            user_agent: 9,
            referer: 8,
            group: 7,
            apicall_count: 1,
            apicall_time: 1104,
            country_code: "KR".into(),
            city: 5,
            x_type: 3,
            login: 77,
            desc: 78,
            web_hash: 79,
            web_time: 80,
            has_dump: 1,
            thread_name_hash: 81,
            text1: "가나다".into(),
            text2: String::new(),
            queuing_host_hash: 82,
            queuing_time: 83,
            queuing2nd_host_hash: 84,
            queuing2nd_time: 85,
            text3: "t3".into(),
            text4: "x".repeat(300),
            text5: "t5".into(),
            profile_count: 202,
            b3_mode: true,
            profile_size: 4096,
            discard_type: 2,
            ignore_global_consequent_sampling: true,
        };
        let blob = x.to_blob();
        assert!(blob.len() < 600, "{} 바이트", blob.len());
        let back = XLogPack::read_from_blob(blob).unwrap();
        assert_eq!(serde_json::to_value(&back).unwrap(), serde_json::to_value(&x).unwrap());
    }

    #[test]
    fn 평범한_한_건은_작다() {
        let x = XLogPack { end_time: 1_793_528_820_123, txid: 123_456_789_012, ipaddr: "127.0.0.1".into(), elapsed: 15, ..XLogPack::default() };
        let n = x.to_blob().len();
        assert!(n <= 100, "{n} 바이트 — 캐시 크기가 곧 이 값 × 건수다");
    }

    #[test]
    fn ip_는_네_칸일_때만_바이트가_된다() {
        assert_eq!(ip_to_bytes("10.0.0.1"), vec![10, 0, 0, 1]);
        assert!(ip_to_bytes("").is_empty());
        assert!(ip_to_bytes("1.2.3").is_empty());
        assert!(ip_to_bytes("1.2.3.999").is_empty());
    }
}
