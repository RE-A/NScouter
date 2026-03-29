// src-tauri/tests/scouter_integration.rs
// Mock TCP 서버를 사용한 ScouterConnection 통합 테스트
//
// 실행: cargo test --test scouter_integration

use nscouter_lib::scouter::connection::ScouterConnection;
use nscouter_lib::scouter::mock_server::MockServer;
use nscouter_lib::scouter::pack::{AnyPack, MapPack};
use nscouter_lib::scouter::protocol::{
    CMD_GET_OBJECT_LIST_REAL_TIME, CMD_TRANX_REAL_TIME_GROUP_LATEST,
};
use nscouter_lib::scouter::value::ScouterValue;

#[test]
fn test_connect_login_success() {
    let server = MockServer::start().expect("Mock 서버 시작 실패");
    let port = server.port;

    let mut conn = ScouterConnection::connect("127.0.0.1", port)
        .expect("TCP 연결 실패");

    conn.login("admin", "admin")
        .expect("로그인 실패");

    assert_eq!(conn.session, 12345, "세션 ID가 12345이어야 함");
    assert_eq!(conn.server_id, "mock-server", "서버 ID가 'mock-server'이어야 함");

    server.stop();
}

#[test]
fn test_get_object_list() {
    let server = MockServer::start().expect("Mock 서버 시작 실패");
    let port = server.port;

    let mut conn = ScouterConnection::connect("127.0.0.1", port).unwrap();
    conn.login("admin", "admin").unwrap();

    let param = MapPack::new();
    let session = conn.session;
    conn.send_request(CMD_GET_OBJECT_LIST_REAL_TIME, session, &param)
        .expect("오브젝트 목록 요청 실패");

    let mut objects: Vec<MapPack> = Vec::new();
    loop {
        match conn.read_next_pack().unwrap() {
            Some(AnyPack::Map(m)) => objects.push(m),
            Some(_) => {}
            None => break,
        }
    }

    assert!(!objects.is_empty(), "오브젝트가 1개 이상 반환되어야 함");
    let obj = &objects[0];
    assert_eq!(
        obj.get_decimal("objHash"),
        Some(1001),
        "objHash가 1001이어야 함"
    );

    server.stop();
}

#[test]
fn test_xlog_stream_roundtrip() {
    let server = MockServer::start().expect("Mock 서버 시작 실패");
    let port = server.port;

    let mut conn = ScouterConnection::connect("127.0.0.1", port).unwrap();
    conn.login("admin", "admin").unwrap();

    let mut param = MapPack::new();
    param.put(
        "objHash",
        ScouterValue::List(vec![ScouterValue::Decimal(1001)]),
    );
    param.put("loop", ScouterValue::Decimal(0));
    param.put("index", ScouterValue::Decimal(0));

    let session = conn.session;
    conn.send_request(CMD_TRANX_REAL_TIME_GROUP_LATEST, session, &param)
        .expect("XLog 스트리밍 요청 실패");

    let mut xlogs = Vec::new();
    loop {
        match conn.read_next_pack().unwrap() {
            Some(AnyPack::XLog(x)) => xlogs.push(x),
            Some(_) => {}
            None => break,
        }
    }

    assert!(!xlogs.is_empty(), "XLogPack이 1개 이상 반환되어야 함");

    let xlog = &xlogs[0];
    assert_eq!(xlog.obj_hash, 1001, "obj_hash가 1001이어야 함");
    assert_eq!(xlog.elapsed, 150, "elapsed가 150ms이어야 함");
    assert_eq!(xlog.error, 0, "error가 0(정상)이어야 함");
    assert_eq!(xlog.ipaddr, "127.0.0.1", "ipaddr가 127.0.0.1이어야 함");
    assert_eq!(xlog.cpu, 10, "cpu가 10이어야 함");
    assert_eq!(xlog.sql_count, 2, "sql_count가 2이어야 함");

    server.stop();
}
