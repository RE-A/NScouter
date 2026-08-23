// src-tauri/src/scouter/mock_server.rs
// Mock Scouter Collector TCP 서버 — 통합 테스트 전용
//
// 실제 Scouter TCP 프로토콜(0xCAFE2001 매직, Big-Endian, MapPack/XLogPack)을 구현하여
// 실제 Collector 없이 ScouterConnection 통합 테스트를 실행할 수 있게 한다.

use std::collections::HashMap;
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use super::codec::{ScouterReader, ScouterWriter};
use super::pack::MapPack;
use super::protocol::*;
use super::value::ScouterValue;

// ─── MockServer ───────────────────────────────────────────────

pub struct MockServer {
    pub port: u16,
    shutdown_tx: mpsc::Sender<()>,
}

impl MockServer {
    /// 포트 0으로 바인딩 → OS가 충돌 없는 임의 포트 할당
    pub fn start() -> io::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();

        thread::spawn(move || {
            listener.set_nonblocking(true).ok();
            loop {
                if shutdown_rx.try_recv().is_ok() {
                    break;
                }
                match listener.accept() {
                    Ok((stream, _)) => {
                        stream.set_nonblocking(false).ok();
                        thread::spawn(|| handle_client(stream));
                    }
                    Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(Self { port, shutdown_tx })
    }

    pub fn stop(self) {
        let _ = self.shutdown_tx.send(());
    }
}

// ─── 클라이언트 연결 핸들러 ──────────────────────────────────

struct MockClientHandler {
    reader: BufReader<TcpStream>,
    writer: BufWriter<TcpStream>,
}

impl MockClientHandler {
    fn new(stream: TcpStream) -> io::Result<Self> {
        Ok(Self {
            reader: BufReader::new(stream.try_clone()?),
            writer: BufWriter::new(stream),
        })
    }

    // ─ 읽기 헬퍼 (connection.rs와 동일한 프로토콜) ─────────────

    fn read_byte(&mut self) -> io::Result<u8> {
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

    fn read_value(&mut self) -> io::Result<ScouterValue> {
        let type_code = self.read_byte()?;
        match type_code {
            VALUE_NULL    => Ok(ScouterValue::Null),
            VALUE_BOOLEAN => Ok(ScouterValue::Boolean(self.read_byte()? != 0)),
            VALUE_DECIMAL => Ok(ScouterValue::Decimal(self.read_decimal()?)),
            VALUE_FLOAT   => {
                let bits = self.read_int()?;
                Ok(ScouterValue::Float(f32::from_bits(bits as u32)))
            }
            VALUE_DOUBLE  => {
                let bits = self.read_long()?;
                Ok(ScouterValue::Double(f64::from_bits(bits as u64)))
            }
            VALUE_TEXT    => Ok(ScouterValue::Text(self.read_text()?)),
            VALUE_BLOB    => Ok(ScouterValue::Blob(self.read_blob()?)),
            VALUE_LIST    => {
                let count = self.read_decimal()? as usize;
                let mut list = Vec::with_capacity(count);
                for _ in 0..count {
                    list.push(self.read_value()?);
                }
                Ok(ScouterValue::List(list))
            }
            VALUE_MAP     => {
                let count = self.read_decimal()? as usize;
                let mut map = HashMap::new();
                for _ in 0..count {
                    let k = self.read_text()?;
                    let v = self.read_value()?;
                    map.insert(k, v);
                }
                Ok(ScouterValue::Map(map))
            }
            _ => Ok(ScouterValue::Null), // 알 수 없는 타입은 Null로 처리
        }
    }

    fn read_map_pack(&mut self) -> io::Result<MapPack> {
        let count = self.read_decimal()? as usize;
        let mut pack = MapPack::new();
        for _ in 0..count {
            let k = self.read_text()?;
            let v = self.read_value()?;
            pack.put(k, v);
        }
        Ok(pack)
    }

    fn send(&mut self, data: &[u8]) -> io::Result<()> {
        self.writer.write_all(data)?;
        self.writer.flush()
    }
}

/// 클라이언트 연결 1개 처리
fn handle_client(stream: TcpStream) {
    let mut h = match MockClientHandler::new(stream) {
        Ok(h) => h,
        Err(_) => return,
    };

    // 1. 매직 넘버 확인 (0xCAFE2001)
    let mut magic = [0u8; 4];
    if h.reader.read_exact(&mut magic).is_err() {
        return;
    }
    if u32::from_be_bytes(magic) != TCP_CLIENT_MAGIC {
        return;
    }

    // 2. 요청 루프
    loop {
        // cmd = text (blob 포맷)
        let cmd = match h.read_text() {
            Ok(c) => c,
            Err(_) => break,
        };
        // session = long (8바이트)
        if h.read_long().is_err() {
            break;
        }
        // PACK_MAP 바이트
        match h.read_byte() {
            Ok(b) if b == PACK_MAP => {}
            _ => break,
        }
        // MapPack 파라미터
        let param = match h.read_map_pack() {
            Ok(m) => m,
            Err(_) => break,
        };

        // 3. 요청별 응답 생성
        let response = match cmd.as_str() {
            CMD_LOGIN => make_login_response(),
            CMD_OBJECT_LIST_REAL_TIME => make_object_list_response(),
            CMD_TRANX_REAL_TIME_GROUP | CMD_TRANX_REAL_TIME_GROUP_LATEST => {
                make_xlog_stream_response()
            }
            CMD_GET_TEXT_100 => make_get_text_response(&param),
            // 테스트 전용 — 실제 콜렉터에는 없는 명령이다 (O-5 재현)
            "MOCK_UNKNOWN_PACK" => make_unknown_pack_response(),
            _ => {
                let mut w = ScouterWriter::new();
                w.write_unsigned_byte(FLAG_NO_NEXT);
                w.into_bytes()
            }
        };

        if h.send(&response).is_err() {
            break;
        }
    }
}

// ─── 응답 생성 함수 ───────────────────────────────────────────

/// LOGIN 응답: session=12345, server_id="mock-server"
fn make_login_response() -> Vec<u8> {
    let mut resp = MapPack::new();
    resp.put("session", ScouterValue::Decimal(12345));
    resp.put("server_id", ScouterValue::Text("mock-server".to_string()));

    let mut w = ScouterWriter::new();
    w.write_unsigned_byte(FLAG_HAS_NEXT);
    resp.write(&mut w);
    w.write_unsigned_byte(FLAG_NO_NEXT);
    w.into_bytes()
}

/// 오브젝트 목록 응답: 1개의 mock 오브젝트
fn make_object_list_response() -> Vec<u8> {
    let mut w = ScouterWriter::new();
    w.write_unsigned_byte(FLAG_HAS_NEXT);
    w.write_unsigned_byte(PACK_OBJECT);
    write_object_pack_body(&mut w, "tomcat", 1001, "/mock-host/mock-app");
    w.write_unsigned_byte(FLAG_NO_NEXT);
    w.into_bytes()
}

/// ObjectPack 본문. **필드 순서와 길이 종류가 실제와 같아야 한다** — 그래야
/// 이 mock 이 회귀를 잡는다.
///
/// 이전에는 MapPack(`objHash`/`objName`/`objType` 키)으로 응답했다. 실제 콜렉터는
/// PackType 80 의 ObjectPack 을 보내므로, mock 은 통과하는데 실서버에서 깨지는
/// 상태였다 — F-4 회귀를 잡지 못했다 (O-2).
///
/// ASIS: `scouter.lang.pack.ObjectPack.write(DataOutputX)`
fn write_object_pack_body(w: &mut ScouterWriter, obj_type: &str, obj_hash: i32, obj_name: &str) {
    w.write_text(obj_type);
    w.write_decimal(obj_hash as i64);
    w.write_text(obj_name);
    w.write_text("127.0.0.1");
    w.write_text("2.21.3");
    w.write_boolean(true);
    w.write_decimal(0); // wakeup
    ScouterValue::Map(HashMap::new()).write_to(w); // tags
}

/// O-5 재현용: 파서가 모르는 PackType 을 보낸다.
///
/// 이 프로토콜은 팩 길이를 앞에 두지 않아 **모르는 팩은 건너뛸 수 없다.**
/// 조용히 넘어가면 이후 스트림 전체가 어긋나므로 에러여야 한다.
fn make_unknown_pack_response() -> Vec<u8> {
    let mut w = ScouterWriter::new();
    w.write_unsigned_byte(FLAG_HAS_NEXT);
    w.write_unsigned_byte(0xEE); // 정의되지 않은 타입
    w.write_text("본문이 있지만 길이를 알 수 없다");
    w.write_unsigned_byte(FLAG_NO_NEXT);
    w.into_bytes()
}

/// XLog 스트리밍 응답: cursor MapPack + XLogPack 1개
fn make_xlog_stream_response() -> Vec<u8> {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    // 커서 MapPack
    let mut cursor = MapPack::new();
    cursor.put("loop", ScouterValue::Decimal(1));
    cursor.put("index", ScouterValue::Decimal(1));

    // XLogPack 내부 바이트
    let xlog_bytes = build_xlog_inner_bytes(now_ms);

    let mut w = ScouterWriter::new();

    // [FLAG_HAS_NEXT][PACK_MAP cursor]
    w.write_unsigned_byte(FLAG_HAS_NEXT);
    cursor.write(&mut w);

    // [FLAG_HAS_NEXT][PACK_XLOG][blob(xlog)]
    w.write_unsigned_byte(FLAG_HAS_NEXT);
    w.write_unsigned_byte(PACK_XLOG);
    w.write_blob(&xlog_bytes);

    // [FLAG_NO_NEXT]
    w.write_unsigned_byte(FLAG_NO_NEXT);

    w.into_bytes()
}

/// GET_TEXT_100 응답: service hash → "MockService"
fn make_get_text_response(_param: &MapPack) -> Vec<u8> {
    let mut resp = MapPack::new();
    // 0x12345678 = 305419896
    resp.put("305419896", ScouterValue::Text("MockService".to_string()));

    let mut w = ScouterWriter::new();
    w.write_unsigned_byte(FLAG_HAS_NEXT);
    resp.write(&mut w);
    w.write_unsigned_byte(FLAG_NO_NEXT);
    w.into_bytes()
}

/// XLogPack 내부 바이트 직렬화 (read_inner와 대칭)
/// 필수 필드 20개만 포함 (optional 필드 없음 → remaining()==0)
fn build_xlog_inner_bytes(now_ms: i64) -> Vec<u8> {
    let mut w = ScouterWriter::new();
    w.write_decimal(now_ms);          // end_time
    w.write_decimal(1001i64);         // obj_hash
    w.write_decimal(0x12345678i64);   // service hash
    w.write_long(0x0001_0002_0003i64);// txid
    w.write_long(0i64);               // caller
    w.write_long(0i64);               // gxid
    w.write_decimal(150i64);          // elapsed (150ms)
    w.write_decimal(0i64);            // error (0=정상)
    w.write_decimal(10i64);           // cpu
    w.write_decimal(2i64);            // sql_count
    w.write_decimal(30i64);           // sql_time
    w.write_blob(&[127, 0, 0, 1]);   // ipaddr (127.0.0.1)
    w.write_decimal(0i64);            // kbytes
    w.write_decimal(200i64);          // status
    w.write_decimal(0i64);            // userid
    w.write_decimal(0i64);            // user_agent
    w.write_decimal(0i64);            // referer
    w.write_decimal(0i64);            // group
    w.write_decimal(0i64);            // apicall_count
    w.write_decimal(0i64);            // apicall_time
    // optional 필드 없음 → remaining() == 0 → 기본값 적용
    w.into_bytes()
}

// ─── ScouterReader 헬퍼 ───────────────────────────────────────

/// 테스트용: ScouterReader에서 MapPack 역직렬화
#[allow(dead_code)]
pub fn read_map_pack_from_bytes(data: Vec<u8>) -> io::Result<MapPack> {
    let mut r = ScouterReader::new(data);
    MapPack::read(&mut r)
}
