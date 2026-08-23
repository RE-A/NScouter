// src-tauri/tests/scouter_integration.rs
// Mock TCP 서버를 사용한 ScouterConnection 통합 테스트
//
// 실행: cargo test --test scouter_integration

use nscouter_lib::scouter::connection::ScouterConnection;
use nscouter_lib::scouter::mock_server::MockServer;
use nscouter_lib::scouter::pack::{AnyPack, MapPack};
use nscouter_lib::scouter::protocol::{
    CMD_OBJECT_LIST_REAL_TIME, CMD_TRANX_REAL_TIME_GROUP_LATEST,
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

/// 오브젝트 목록은 **ObjectPack(타입 80)** 으로 온다.
///
/// 이전 mock 은 MapPack 으로 답했다. 파싱 경로가 실서버와 달라서
/// 통과해도 아무것도 보장하지 못했다 (O-2). 이제 실제 필드 순서로 보낸다.
#[test]
fn test_get_object_list() {
    let server = MockServer::start().expect("Mock 서버 시작 실패");
    let port = server.port;

    let mut conn = ScouterConnection::connect("127.0.0.1", port).unwrap();
    conn.login("admin", "admin").unwrap();

    let param = MapPack::new();
    let session = conn.session;
    conn.send_request(CMD_OBJECT_LIST_REAL_TIME, session, &param)
        .expect("오브젝트 목록 요청 실패");

    let mut objects = Vec::new();
    loop {
        match conn.read_next_pack().unwrap() {
            Some(AnyPack::Object(o)) => objects.push(o),
            Some(_) => {}
            None => break,
        }
    }

    assert_eq!(objects.len(), 1, "ObjectPack 1건이 와야 한다");
    let obj = &objects[0];
    // 필드 하나만 보면 순서가 밀려도 통과할 수 있다. 전부 확인한다.
    assert_eq!(obj.obj_type, "tomcat");
    assert_eq!(obj.obj_hash, 1001);
    assert_eq!(obj.obj_name, "/mock-host/mock-app");
    assert_eq!(obj.address, "127.0.0.1");
    assert_eq!(obj.version, "2.21.3");
    assert!(obj.alive);

    server.stop();
}

/// O-5: 모르는 Pack 타입을 만나면 **에러여야 한다.**
///
/// 이 프로토콜은 팩 길이를 앞에 두지 않는다. 본문을 읽지 않고 넘어가면
/// 다음 팩의 시작 위치가 어긋나 이후 전부가 쓰레기가 된다.
/// 조용히 망가진 데이터를 내놓는 것보다 멈추는 게 낫다.
#[test]
fn 모르는_팩_타입은_조용히_넘어가지_않는다() {
    let server = MockServer::start().expect("Mock 서버 시작 실패");
    let port = server.port;

    let mut conn = ScouterConnection::connect("127.0.0.1", port).unwrap();
    conn.login("admin", "admin").unwrap();

    let session = conn.session;
    conn.send_request("MOCK_UNKNOWN_PACK", session, &MapPack::new())
        .expect("요청 실패");

    let msg = match conn.read_next_pack() {
        Err(e) => e.to_string(),
        Ok(_) => panic!("모르는 팩인데 성공을 돌려줬다 — 스트림이 조용히 어긋난다"),
    };
    // 무엇이 문제인지 메시지에 팩 타입이 있어야 다음 구현 대상을 안다.
    assert!(msg.contains("0xEE"), "에러 메시지에 팩 타입이 없다: {msg}");

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
