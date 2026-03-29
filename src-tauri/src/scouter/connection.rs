// src-tauri/src/scouter/connection.rs
// TCP 연결 + 로그인 + 세션 관리
// 참조: docs/asis/14-collector-tcp-protocol.md 섹션 3~6

use std::collections::HashMap;
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use sha2::{Digest, Sha256};

use super::codec::ScouterWriter;
use super::pack::{AlertPack, AnyPack, MapPack, ObjectPack, PerfCounterPack, XLogPack};
use super::profile::{parse_profile_steps, XLogProfilePack};
use super::protocol::*;
use super::value::ScouterValue;

// ─── ScouterConnection ────────────────────────────────────────

pub struct ScouterConnection {
    reader: BufReader<TcpStream>,
    writer: BufWriter<TcpStream>,
    pub session: i64,
    pub server_id: String,
}

impl ScouterConnection {
    /// Collector에 TCP 연결 후 매직 넘버 전송
    pub fn connect(host: &str, port: u16) -> io::Result<Self> {
        let addr: SocketAddr = format!("{host}:{port}")
            .parse()
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, format!("주소 파싱 실패: {e}")))?;

        log::debug!("TCP 연결 시도: {host}:{port}");
        let stream = TcpStream::connect_timeout(&addr, Duration::from_millis(CONNECT_TIMEOUT_MS))?;
        stream.set_nodelay(true)?;

        let reader = BufReader::new(stream.try_clone()?);
        let mut writer = BufWriter::new(stream);

        // 연결 직후 매직 넘버 4바이트 전송 (CAFE2001 Big-endian)
        writer.write_all(&TCP_CLIENT_MAGIC.to_be_bytes())?;
        writer.flush()?;

        log::info!("TCP 연결 성공: {host}:{port}");
        Ok(Self {
            reader,
            writer,
            session: 0,
            server_id: String::new(),
        })
    }

    /// 로그인 요청 전송 및 세션 ID 수신
    pub fn login(&mut self, user: &str, password: &str) -> io::Result<()> {
        log::debug!("로그인 요청: user={user}");
        let pass_hash = sha256_with_salt(password);
        let hostname = get_hostname();

        let mut param = MapPack::new();
        param.put("id", ScouterValue::Text(user.to_string()));
        param.put("pass", ScouterValue::Text(pass_hash));
        param.put("version", ScouterValue::Text("Nscouter-1.0".to_string()));
        param.put("hostname", ScouterValue::Text(hostname));
        param.put("isSocks", ScouterValue::Boolean(false));
        param.put("socksIp", ScouterValue::Text(String::new()));
        param.put("socksPort", ScouterValue::Decimal(0));

        self.send_request(CMD_LOGIN, 0, &param)?;

        // 응답 수신: [HasNEXT][MapPack]...[NoNEXT]
        let mut result_pack: Option<MapPack> = None;
        loop {
            let flag = self.read_flag()?;
            match flag {
                FLAG_HAS_NEXT => {
                    let pack_type = self.read_byte()?;
                    if pack_type == PACK_MAP {
                        result_pack = Some(self.read_map_pack()?);
                    }
                }
                FLAG_NO_NEXT => break,
                FLAG_INVALID_SESSION => {
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "세션 만료 (로그인 전 INVALID_SESSION)",
                    ));
                }
                _ => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("로그인 응답 중 예상치 못한 TcpFlag: 0x{flag:02X}"),
                    ));
                }
            }
        }

        let map = result_pack.ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "로그인 응답 MapPack 없음")
        })?;

        let session = map.get_decimal("session").unwrap_or(0);
        let error_msg = map.get_text("error").unwrap_or("").to_string();
        let server_id = map.get_text("server_id").unwrap_or("").to_string();

        if session == 0 {
            let msg = if error_msg.is_empty() {
                "인증 실패 (세션 ID = 0)".to_string()
            } else {
                format!("인증 실패: {error_msg}")
            };
            log::warn!("로그인 실패: {msg}");
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, msg));
        }

        self.session = session;
        self.server_id = server_id.clone();
        log::info!("로그인 성공: session={session}, server_id={server_id}");
        Ok(())
    }

    /// 요청 패킷 전송: writeText(cmd) + writeLong(session) + writePack(MapPack)
    pub fn send_request(&mut self, cmd: &str, session: i64, param: &MapPack) -> io::Result<()> {
        let mut w = ScouterWriter::new();
        w.write_text(cmd);
        w.write_long(session);
        param.write(&mut w);
        self.writer.write_all(w.as_bytes())?;
        self.writer.flush()?;
        Ok(())
    }

    /// TcpFlag 1바이트 읽기
    pub fn read_flag(&mut self) -> io::Result<u8> {
        self.read_byte()
    }

    /// 다음 Pack 읽기. None이면 NoNEXT (스트림 종료)
    /// INVALID_SESSION이면 session을 0으로 초기화 후 에러 반환
    pub fn read_next_pack(&mut self) -> io::Result<Option<AnyPack>> {
        let flag = self.read_flag()?;
        match flag {
            FLAG_HAS_NEXT => {
                let pack_type = self.read_byte()?;
                let pack = match pack_type {
                    PACK_MAP => AnyPack::Map(self.read_map_pack()?),
                    PACK_XLOG | PACK_DROPPED_XLOG => AnyPack::XLog(self.read_xlog_pack()?),
                    PACK_OBJECT => AnyPack::Object(self.read_object_pack()?),
                    PACK_XLOG_PROFILE | PACK_XLOG_PROFILE2 => {
                        AnyPack::Profile(Box::new(self.read_xlog_profile_pack(pack_type)?))
                    }
                    PACK_PERF_COUNTER => AnyPack::PerfCounter(self.read_perf_counter_pack()?),
                    PACK_ALERT => AnyPack::Alert(self.read_alert_pack()?),
                    _ => {
                        log::trace!("알 수 없는 Pack 타입 무시: 0x{pack_type:02X}");
                        AnyPack::Unknown(pack_type)
                    }
                };
                Ok(Some(pack))
            }
            FLAG_NO_NEXT => Ok(None),
            FLAG_INVALID_SESSION => {
                self.session = 0;
                log::warn!("세션 만료 (INVALID_SESSION)");
                Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "세션 만료 (INVALID_SESSION) — 재로그인 필요",
                ))
            }
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("예상치 못한 TcpFlag: 0x{flag:02X}"),
            )),
        }
    }

    // ─── 스트림 직접 읽기 (BufReader 기반) ──────────────────────

    pub fn read_byte(&mut self) -> io::Result<u8> {
        let mut buf = [0u8; 1];
        self.reader.read_exact(&mut buf)?;
        Ok(buf[0])
    }

    fn read_short(&mut self) -> io::Result<i16> {
        let mut buf = [0u8; 2];
        self.reader.read_exact(&mut buf)?;
        Ok(i16::from_be_bytes(buf))
    }

    fn read_int(&mut self) -> io::Result<i32> {
        let mut buf = [0u8; 4];
        self.reader.read_exact(&mut buf)?;
        Ok(i32::from_be_bytes(buf))
    }

    fn read_long(&mut self) -> io::Result<i64> {
        let mut buf = [0u8; 8];
        self.reader.read_exact(&mut buf)?;
        Ok(i64::from_be_bytes(buf))
    }

    fn read_int3(&mut self) -> io::Result<i32> {
        let mut buf = [0u8; 3];
        self.reader.read_exact(&mut buf)?;
        let v = ((buf[0] as i32) << 24) + ((buf[1] as i32) << 16) + ((buf[2] as i32) << 8);
        Ok(v >> 8)
    }

    fn read_long5(&mut self) -> io::Result<i64> {
        let mut buf = [0u8; 5];
        self.reader.read_exact(&mut buf)?;
        Ok(((buf[0] as i8 as i64) << 32)
            + ((buf[1] as i64 & 0xff) << 24)
            + ((buf[2] as i64 & 0xff) << 16)
            + ((buf[3] as i64 & 0xff) << 8)
            + (buf[4] as i64 & 0xff))
    }

    fn read_decimal(&mut self) -> io::Result<i64> {
        let len = self.read_byte()? as i8;
        match len {
            0 => Ok(0),
            1 => Ok(self.read_byte()? as i8 as i64),
            2 => Ok(self.read_short()? as i64),
            3 => Ok(self.read_int3()? as i64),
            4 => Ok(self.read_int()? as i64),
            5 => Ok(self.read_long5()?),
            _ => Ok(self.read_long()?),
        }
    }

    fn read_blob(&mut self) -> io::Result<Vec<u8>> {
        let base = self.read_byte()?;
        let len = match base {
            0 => return Ok(Vec::new()),
            255 => {
                let mut buf = [0u8; 2];
                self.reader.read_exact(&mut buf)?;
                u16::from_be_bytes(buf) as usize
            }
            254 => self.read_int()? as usize,
            n => n as usize,
        };
        let mut data = vec![0u8; len];
        self.reader.read_exact(&mut data)?;
        Ok(data)
    }

    fn read_text(&mut self) -> io::Result<String> {
        let blob = self.read_blob()?;
        String::from_utf8(blob).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }

    fn read_boolean(&mut self) -> io::Result<bool> {
        Ok(self.read_byte()? != 0)
    }

    fn read_float(&mut self) -> io::Result<f32> {
        Ok(f32::from_bits(self.read_int()? as u32))
    }

    fn read_double(&mut self) -> io::Result<f64> {
        Ok(f64::from_bits(self.read_long()? as u64))
    }

    fn read_value(&mut self) -> io::Result<ScouterValue> {
        let type_code = self.read_byte()?;
        self.read_value_body(type_code)
    }

    fn read_value_body(&mut self, type_code: u8) -> io::Result<ScouterValue> {
        match type_code {
            VALUE_NULL => Ok(ScouterValue::Null),
            VALUE_BOOLEAN => Ok(ScouterValue::Boolean(self.read_boolean()?)),
            VALUE_DECIMAL => Ok(ScouterValue::Decimal(self.read_decimal()?)),
            VALUE_FLOAT => Ok(ScouterValue::Float(self.read_float()?)),
            VALUE_DOUBLE => Ok(ScouterValue::Double(self.read_double()?)),
            VALUE_TEXT => Ok(ScouterValue::Text(self.read_text()?)),
            VALUE_BLOB => Ok(ScouterValue::Blob(self.read_blob()?)),
            VALUE_LIST => {
                let count = self.read_decimal()? as usize;
                let mut items = Vec::with_capacity(count);
                for _ in 0..count {
                    items.push(self.read_value()?);
                }
                Ok(ScouterValue::List(items))
            }
            VALUE_MAP => {
                let count = self.read_decimal()? as usize;
                let mut map = HashMap::with_capacity(count);
                for _ in 0..count {
                    let key = self.read_text()?;
                    let val = self.read_value()?;
                    map.insert(key, val);
                }
                Ok(ScouterValue::Map(map))
            }
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("알 수 없는 ValueEnum 타입 코드: 0x{type_code:02X}"),
            )),
        }
    }

    fn read_map_pack(&mut self) -> io::Result<MapPack> {
        let count = self.read_decimal()? as usize;
        let mut entries = HashMap::with_capacity(count);
        for _ in 0..count {
            let key = self.read_text()?;
            let val = self.read_value()?;
            entries.insert(key, val);
        }
        Ok(MapPack { entries })
    }

    /// XLogPack: 외부 Blob 언래핑 후 ScouterReader로 내부 파싱
    fn read_xlog_pack(&mut self) -> io::Result<XLogPack> {
        let blob = self.read_blob()?;
        XLogPack::read_from_blob(blob)
    }

    /// ObjectPack (Type 80) 파싱
    /// ASIS: ObjectPack.read(DataInputX)
    fn read_object_pack(&mut self) -> io::Result<ObjectPack> {
        let obj_hash = self.read_decimal()? as i32;
        let obj_type = self.read_text()?;
        let obj_name = self.read_text()?;
        let address = self.read_text()?;
        let version = self.read_text()?;
        let alive = self.read_boolean()?;
        Ok(ObjectPack { obj_hash, obj_type, obj_name, address, version, alive })
    }

    /// XLogProfilePack (Type 26) / XLogProfilePack2 (Type 27) 파싱
    /// ASIS: XLogProfilePack.read(DataInputX)
    fn read_xlog_profile_pack(&mut self, pack_type: u8) -> io::Result<XLogProfilePack> {
        let txid = self.read_long()?;
        let obj_hash = self.read_decimal()? as i32;
        let profile_blob = self.read_blob()?;

        // XLogProfilePack2는 추가 필드 존재 (분할 전송용)
        if pack_type == PACK_XLOG_PROFILE2 {
            let _elapsed_time = self.read_decimal()?;
            let _count = self.read_decimal()?;
            let _total = self.read_decimal()?;
        }

        let steps = parse_profile_steps(profile_blob);
        Ok(XLogProfilePack { txid, obj_hash, steps })
    }

    /// PerfCounterPack (Type 60) 파싱
    /// ASIS: PerfCounterPack.read(DataInputX)
    fn read_perf_counter_pack(&mut self) -> io::Result<PerfCounterPack> {
        let time = self.read_decimal()? as i64;
        let obj_name = self.read_text()?;
        let timetype = self.read_byte()?;

        // data: MapValue (타입 코드 포함) → ScouterValue::Map
        let mut data = std::collections::HashMap::new();
        let val = self.read_value()?;
        if let ScouterValue::Map(map) = val {
            for (k, v) in map {
                let f = match v {
                    ScouterValue::Float(f) => f as f64,
                    ScouterValue::Double(d) => d,
                    ScouterValue::Decimal(d) => d as f64,
                    _ => 0.0,
                };
                data.insert(k, f);
            }
        }

        Ok(PerfCounterPack { time, obj_name, timetype, data })
    }

    /// AlertPack (Type 70) 파싱
    /// ASIS: AlertPack.read(DataInputX)
    fn read_alert_pack(&mut self) -> io::Result<AlertPack> {
        let time = self.read_decimal()? as i64;
        let obj_type = self.read_text()?;
        let obj_hash = self.read_decimal()? as i32;
        let level = self.read_byte()?;
        let title = self.read_text()?;
        let message = self.read_text()?;
        Ok(AlertPack { time, obj_type, obj_hash, level, title, message })
    }
}

// ─── SHA-256 with Salt ────────────────────────────────────────

/// SHA-256: update(salt) 후 digest(password) → hex 소문자 64자
/// ASIS: CipherUtil.sha256
pub fn sha256_with_salt(password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(PASSWORD_SALT.as_bytes());
    hasher.update(password.as_bytes());
    hex::encode(hasher.finalize())
}

fn get_hostname() -> String {
    std::process::Command::new("hostname")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256_with_salt_length() {
        let hash = sha256_with_salt("admin");
        assert_eq!(hash.len(), 64);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_sha256_deterministic() {
        let h1 = sha256_with_salt("admin");
        let h2 = sha256_with_salt("admin");
        assert_eq!(h1, h2);
        let h3 = sha256_with_salt("other");
        assert_ne!(h1, h3);
    }
}
