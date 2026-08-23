// src-tauri/src/scouter/connection.rs
// TCP 연결 + 로그인 + 세션 관리
// 참조: docs/asis/14-collector-tcp-protocol.md 섹션 3~6

use std::collections::HashMap;
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;

use sha2::{Digest, Sha256};

use super::codec::ScouterWriter;
use super::pack::{
    AlertPack, AnyPack, InteractionCounterPack, MapPack, ObjectPack, PerfCounterPack, StackPack,
    XLogPack,
};
use super::profile::{parse_profile_steps, XLogProfilePack};
use super::protocol::*;
use super::value::ScouterValue;

// ─── ScouterConnection ────────────────────────────────────────

pub struct ScouterConnection {
    /// 요청마다 소켓을 다시 열어야 하므로 접속 정보를 들고 있는다
    host: String,
    port: u16,
    reader: BufReader<TcpStream>,
    writer: BufWriter<TcpStream>,
    pub session: i64,
    pub server_id: String,
}

/// 호스트를 주소로 해석한다.
///
/// 이전에는 `"host:port".parse::<SocketAddr>()` 를 썼다. 이건 **IP 리터럴만** 받아서
/// `localhost` 나 컨테이너 이름(`scouter-collector`)을 넣으면 연결 시도조차 못 하고
/// "주소 파싱 실패" 로 끝났다 (O-1).
///
/// `connect_timeout` 이 `SocketAddr` 를 요구하므로 해석은 우리가 하고 첫 주소를 쓴다.
fn resolve_addr(host: &str, port: u16) -> io::Result<SocketAddr> {
    (host, port)
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("호스트를 해석할 수 없습니다: {host}:{port}"),
            )
        })
}

impl ScouterConnection {
    /// Collector에 TCP 연결 후 매직 넘버 전송
    pub fn connect(host: &str, port: u16) -> io::Result<Self> {
        let (reader, writer) = Self::open_socket(host, port)?;

        log::info!("TCP 연결 성공: {host}:{port}");
        Ok(Self {
            host: host.to_string(),
            port,
            reader,
            writer,
            session: 0,
            server_id: String::new(),
        })
    }

    /// TCP 연결 + 매직 넘버 전송까지 수행한 소켓 한 쌍을 만든다
    fn open_socket(
        host: &str,
        port: u16,
    ) -> io::Result<(BufReader<TcpStream>, BufWriter<TcpStream>)> {
        let addr = resolve_addr(host, port)?;

        log::trace!("TCP 연결 시도: {host}:{port}");
        let stream = TcpStream::connect_timeout(&addr, Duration::from_millis(CONNECT_TIMEOUT_MS))?;
        stream.set_nodelay(true)?;

        let reader = BufReader::new(stream.try_clone()?);
        let mut writer = BufWriter::new(stream);

        // 연결 직후 매직 넘버 4바이트 전송 (CAFE2001 Big-endian)
        writer.write_all(&TCP_CLIENT_MAGIC.to_be_bytes())?;
        writer.flush()?;

        Ok((reader, writer))
    }

    /// 소켓을 새로 연다.
    ///
    /// Collector는 **연결 하나당 명령을 1개만 처리하고 끊는다.** 로그인을 별도 연결에서 하고
    /// 세션만 재사용해도 마찬가지다. 따라서 요청마다 소켓을 새로 열어야 한다.
    /// 세션 토큰은 소켓과 무관하게 계속 재사용할 수 있다.
    /// (정식 Java 클라이언트가 TcpProxy + ConnectionPool 구조를 쓰는 이유가 이것이다.)
    fn reopen(&mut self) -> io::Result<()> {
        let (reader, writer) = Self::open_socket(&self.host, self.port)?;
        self.reader = reader;
        self.writer = writer;
        Ok(())
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
    ///
    /// Collector가 연결당 명령 1개만 처리하므로 전송 직전에 소켓을 새로 연다.
    /// 이 덕분에 호출부는 `send_request` → `read_next_pack` 루프를 그대로 반복해도 된다.
    pub fn send_request(&mut self, cmd: &str, session: i64, param: &MapPack) -> io::Result<()> {
        self.reopen()?;

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

    /// **Pack 이 아니라 blob 청크가 오는 응답**을 끝까지 읽어 잇는다.
    ///
    /// `OBJECT_DUMP_FILE_DETAIL` 같은 파일 전송이 이 형식이다:
    ///
    /// ```text
    /// [HasNEXT][blob 4096B][HasNEXT][blob 4096B] … [NoNEXT]
    /// ```
    ///
    /// `read_next_pack` 으로 읽으면 blob 의 첫 바이트(길이 표식 0xFF)를
    /// **팩 타입으로 오해**해서 "구현되지 않은 Pack 타입 0xFF" 로 끝난다.
    /// 프레이밍이 다르므로 읽는 쪽도 달라야 한다.
    pub fn read_blob_stream(&mut self) -> io::Result<Vec<u8>> {
        let mut out = Vec::new();
        loop {
            match self.read_flag()? {
                FLAG_HAS_NEXT => out.extend_from_slice(&self.read_blob()?),
                FLAG_NO_NEXT => return Ok(out),
                FLAG_INVALID_SESSION => {
                    self.session = 0;
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "세션 만료 (INVALID_SESSION) — 재로그인 필요",
                    ));
                }
                flag => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("blob 스트림 중 예상치 못한 TcpFlag: 0x{flag:02X}"),
                    ))
                }
            }
        }
    }

    /// **Pack 도 blob 도 아니고 raw long 이 나열되는 응답**을 읽는다.
    ///
    /// `GET_STACK_INDEX` 가 그렇다 — ASIS `StackListDialog` 는 `in.readLong()` 만 부른다.
    /// 팩으로 읽으려 들면 long 의 첫 바이트를 PackType 으로 오해한다
    /// (read_single_value / read_blob_stream 과 같은 부류의 함정, F-45).
    pub fn read_long_stream(&mut self) -> io::Result<Vec<i64>> {
        let mut out = Vec::new();
        loop {
            match self.read_flag()? {
                FLAG_HAS_NEXT => out.push(self.read_long()?),
                FLAG_NO_NEXT => return Ok(out),
                FLAG_INVALID_SESSION => {
                    self.session = 0;
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "세션 만료 (INVALID_SESSION) — 재로그인 필요",
                    ));
                }
                flag => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("long 스트림 중 예상치 못한 TcpFlag: 0x{flag:02X}"),
                    ))
                }
            }
        }
    }

    /// **Pack 이 아니라 Value 하나가 오는 응답**을 읽는다.
    ///
    /// `VISITOR_REALTIME_TOTAL` 이 그렇다. Pack 으로 읽으려 들면
    /// Value 타입 바이트(DECIMAL=20)를 PackType 으로 오해해 "Pack 타입 0x14" 로 멈춘다 (F-32).
    /// ASIS 는 이런 응답에 `TcpProxy.getSingleValue()` 를 쓴다.
    pub fn read_single_value(&mut self) -> io::Result<Option<ScouterValue>> {
        match self.read_flag()? {
            FLAG_HAS_NEXT => {
                let v = self.read_value()?;
                // 뒤따르는 NoNEXT 를 비워야 다음 요청이 어긋나지 않는다.
                let _ = self.read_flag();
                Ok(Some(v))
            }
            FLAG_NO_NEXT => Ok(None),
            FLAG_INVALID_SESSION => {
                self.session = 0;
                Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "세션 만료 (INVALID_SESSION) — 재로그인 필요",
                ))
            }
            flag => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Value 응답에 예상치 못한 TcpFlag: 0x{flag:02X}"),
            )),
        }
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
                    PACK_INTERACTION_COUNTER => {
                        AnyPack::Interaction(self.read_interaction_pack()?)
                    }
                    PACK_STACK => AnyPack::Stack(self.read_stack_pack()?),
                    // 모르는 팩은 **건너뛸 수 없다.** 이 프로토콜은 팩 길이를
                    // 앞에 두지 않아서, 본문을 읽지 않고 넘어가면 다음 팩의 시작 위치가
                    // 어긋나 이후 전부가 쓰레기가 된다 (O-5).
                    // 조용히 망가진 데이터를 내놓느니 여기서 멈춘다.
                    _ => {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidData,
                            format!(
                                "구현되지 않은 Pack 타입 0x{pack_type:02X} — \
                                 길이를 알 수 없어 건너뛸 수 없다. 파서를 추가할 것"
                            ),
                        ))
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
    /// 필드 순서는 ObjectPack.read(DataInputX) 그대로여야 한다.
    ///   objType, objHash, objName, address, version, alive, wakeup, tags
    /// objType 과 objHash 의 순서를 바꾸거나 뒤쪽 wakeup/tags 를 읽지 않으면
    /// 스트림 위치가 어긋나 다음 Pack 파싱까지 깨진다.
    fn read_object_pack(&mut self) -> io::Result<ObjectPack> {
        let obj_type = self.read_text()?;
        let obj_hash = self.read_decimal()? as i32;
        let obj_name = self.read_text()?;
        let address = self.read_text()?;
        let version = self.read_text()?;
        let alive = self.read_boolean()?;
        let wakeup = self.read_decimal()?;
        // tags 는 MapValue 다. 값 타입이 섞여 오므로(Decimal/Text/Boolean)
        // 화면에 낼 문자열로 눕혀 둔다 — ASIS 도 `CastUtil.cString` 으로 편다.
        let tags = match self.read_value()? {
            ScouterValue::Map(m) => {
                let mut v: Vec<(String, String)> =
                    m.into_iter().map(|(k, val)| (k, val.to_display())).collect();
                // HashMap 이라 순서가 없다. 매 조회마다 줄이 뒤바뀌면 못 읽는다.
                v.sort_by(|a, b| a.0.cmp(&b.0));
                v
            }
            _ => Vec::new(),
        };
        Ok(ObjectPack { obj_hash, obj_type, obj_name, address, version, alive, wakeup, tags })
    }

    /// StackPack (Type 62) 파싱.
    ///
    /// `time`/`objHash` 는 readDecimal(가변), 본문은 blob 이다.
    /// **blob 은 GZIP 이다** — 풀지 않으면 스택 대신 깨진 바이트가 나온다 (F-45).
    /// 못 풀면 에러로 세우지 않는다: 스택 한 장이 상해도 나머지는 볼 값이 있다.
    fn read_stack_pack(&mut self) -> io::Result<StackPack> {
        let time = self.read_decimal()?;
        let obj_hash = self.read_decimal()? as i32;
        let data = self.read_blob()?;
        Ok(StackPack { time, obj_hash, stack: gunzip_text(&data) })
    }

    /// XLogProfilePack (Type 26) / XLogProfilePack2 (Type 27) 파싱
    /// ASIS: XLogProfilePack.read(DataInputX)
    /// XLogProfilePack (Type 26) / XLogProfilePack2 (Type 27) 파싱
    ///
    /// ASIS: `scouter.lang.pack.XLogProfilePack.read(DataInputX)`
    /// 실측 검증: `live_xlog_profile_steps`
    ///
    /// **`time` 과 `service` 를 빼먹으면 스트림 전체가 어긋난다.**
    /// `txid` 는 readLong(8바이트 고정)이고 나머지는 readDecimal(가변)이다.
    fn read_xlog_profile_pack(&mut self, pack_type: u8) -> io::Result<XLogProfilePack> {
        let _time = self.read_decimal()?;
        let obj_hash = self.read_decimal()? as i32;
        let _service = self.read_decimal()?;
        let txid = self.read_long()?;
        let profile_blob = self.read_blob()?;

        // XLogProfilePack2 = XLogProfilePack + gxid/xType/discardType/ignore 플래그
        if pack_type == PACK_XLOG_PROFILE2 {
            let _gxid = self.read_long()?;
            let _x_type = self.read_byte()?;
            let _discard_type = self.read_byte()?;
            let _ignore_sampling = self.read_boolean()?;
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
    ///
    /// ASIS: `scouter.lang.pack.AlertPack.read(DataInputX)`
    /// 실측 검증: verified-facts.md F-17 / `live_alert_pack_fields`
    ///
    /// **고정 길이 필드에 주의.** `time` 은 readLong(8바이트), `objHash` 는
    /// readInt(4바이트)다. 가변 길이인 readDecimal 로 읽으면 스트림이 어긋난다.
    fn read_alert_pack(&mut self) -> io::Result<AlertPack> {
        let time = self.read_long()?;
        let level = self.read_byte()?;
        let obj_type = self.read_text()?;
        let obj_hash = self.read_int()?;
        let title = self.read_text()?;
        let message = self.read_text()?;
        let _tags = self.read_value()?; // 안 읽으면 다음 알람부터 깨진다
        Ok(AlertPack { time, obj_type, obj_hash, level, title, message })
    }

    /// 인터랙션 카운터 (F-40).
    ///
    /// **`customData` 를 안 읽으면 다음 팩부터 깨진다** — AlertPack 의 `tags` 와 같다.
    fn read_interaction_pack(&mut self) -> io::Result<InteractionCounterPack> {
        let time = self.read_long()?;
        let obj_name = self.read_text()?;
        let interaction_type = self.read_text()?;
        let from_hash = self.read_int()?;
        let to_hash = self.read_int()?;
        let period = self.read_int()?;
        let count = self.read_int()?;
        let error_count = self.read_int()?;
        let total_elapsed = self.read_long()?;
        let _custom = self.read_value()?;
        Ok(InteractionCounterPack {
            time,
            obj_name,
            interaction_type,
            from_hash,
            to_hash,
            period,
            count,
            error_count,
            total_elapsed,
        })
    }
}

// ─── GZIP ─────────────────────────────────────────────────────

/// GZIP blob 을 문자열로 푼다.
///
/// StackPack 의 본문이 이 모양이다 (ASIS `CompressUtil.doZip` = `GZIPOutputStream`).
///
/// **실패해도 에러로 세우지 않는다.** 스택은 한 요청에 수백 장이 오는데
/// 그중 한 장이 상했다고 전체를 버리면 볼 수 있었던 것까지 못 본다.
/// 대신 무슨 일이 있었는지는 자리에 남긴다 — 빈 문자열이면 "스택이 비었다"로 읽힌다.
pub fn gunzip_text(data: &[u8]) -> String {
    if data.is_empty() {
        return String::new();
    }
    use std::io::Read;
    let mut out = String::new();
    match flate2::read::GzDecoder::new(data).read_to_string(&mut out) {
        Ok(_) => out,
        Err(e) => format!("<스택을 풀지 못했습니다: {e}>"),
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

    #[test]
    fn gzip_을_원문으로_되돌린다() {
        use std::io::Write;
        let text = "Full thread dump OpenJDK 64-Bit Server VM
	- locked <0x1>";
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(text.as_bytes()).unwrap();
        assert_eq!(gunzip_text(&enc.finish().unwrap()), text);
    }

    #[test]
    fn 빈_blob_은_빈_문자열이다() {
        // 스택이 안 실린 팩이 섞여 온다. 여기서 에러를 내면 스트림 전체가 멎는다.
        assert_eq!(gunzip_text(&[]), "");
    }

    #[test]
    fn 못_푸는_바이트는_에러가_아니라_자리에_남긴다() {
        // 한 장이 상했다고 나머지 수백 장을 못 보게 만들면 안 된다.
        // 다만 **빈 문자열로 돌려주면 안 된다** — "스택이 비었다"로 읽힌다.
        let out = gunzip_text(&[0x00, 0x01, 0x02, 0x03]);
        assert!(out.starts_with("<스택을 풀지 못했습니다"), "out={out}");
    }

    // O-1: 이전 구현은 `"host:port".parse::<SocketAddr>()` 라 IP 리터럴만 받았다.
    #[test]
    fn ip_리터럴을_해석한다() {
        let addr = resolve_addr("127.0.0.1", 6100).expect("IP 리터럴 해석 실패");
        assert_eq!(addr.port(), 6100);
        assert!(addr.ip().is_loopback());
    }

    // 이게 회귀 테스트다. 예전 구현은 여기서 "주소 파싱 실패" 로 끝났다.
    #[test]
    fn 호스트명을_해석한다() {
        let addr = resolve_addr("localhost", 6100).expect("localhost 해석 실패");
        assert_eq!(addr.port(), 6100);
        assert!(addr.ip().is_loopback());
    }

    #[test]
    fn 해석할_수_없는_호스트는_에러다() {
        // .invalid 는 RFC 2606 예약 TLD 라 어떤 DNS 에서도 해석되지 않는다.
        assert!(resolve_addr("nonexistent.invalid", 6100).is_err());
    }
}
