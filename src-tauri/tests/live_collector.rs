// 실제 Scouter Collector 대상 통합 테스트
//
// Mock 서버 테스트(scouter_integration.rs)와 달리 진짜 콜렉터에 붙는다.
// Test/ 의 테스트 환경이 떠 있어야 한다.
//
//   cd Test && .\scripts\up.ps1
//   cd src-tauri && cargo test --test live_collector -- --ignored --nocapture
//
// 환경 의존적이라 기본 실행에서는 제외(#[ignore])한다.

use nscouter_lib::scouter::connection::ScouterConnection;
use nscouter_lib::scouter::pack::{AnyPack, MapPack};
use nscouter_lib::scouter::protocol::{
    CMD_ACTIVESPEED_REAL_TIME, CMD_ACTIVESPEED_REAL_TIME_GROUP, CMD_COUNTER_TODAY_ALL,
    CMD_VISITOR_REALTIME_TOTAL,
    CMD_GET_STACK_ANALYZER, CMD_GET_STACK_INDEX, CMD_OBJECT_THREAD_DETAIL,
    CMD_OBJECT_CALL_HEAP_DUMP, CMD_OBJECT_RESET_CACHE, CMD_OBJECT_SYSTEM_GC, CMD_PSTACK_ON,
    CMD_TRIGGER_ACTIVE_SERVICE_LIST, CMD_TRIGGER_HEAPHISTO, CMD_TRIGGER_THREAD_LIST,
    CMD_ALERT_REAL_TIME, CMD_COUNTER_REAL_TIME_ALL, CMD_COUNTER_REAL_TIME_ALL_MULTI,
    CMD_OBJECT_ACTIVE_SERVICE_LIST, CMD_OBJECT_CLASS_LIST, CMD_OBJECT_DUMP_FILE_DETAIL,
    CMD_OBJECT_DUMP_FILE_LIST, CMD_OBJECT_ENV, CMD_OBJECT_HEAPHISTO, CMD_OBJECT_LIST_REAL_TIME,
    CMD_OBJECT_SOCKET,
    CMD_OBJECT_THREAD_LIST, CMD_TRANX_LOAD_TIME_GROUP_V2, CMD_TRIGGER_THREAD_DUMP,
    CMD_TRANX_PROFILE, CMD_TRANX_PROFILE_FULL, CMD_TRANX_REAL_TIME_GROUP,
    CMD_TRANX_REAL_TIME_GROUP_LATEST,
    CMD_XLOG_READ_BY_GXID,
    CMD_GET_CONFIGURE_SERVER, CMD_GET_CONFIGURE_WAS, CMD_LIST_CONFIGURE_SERVER,
    CMD_LIST_CONFIGURE_WAS, CMD_SET_CONFIGURE_WAS, CMD_INTR_COUNTER_REAL_TIME_BY_OBJ,
    CMD_LOAD_APICALL_SUMMARY, CMD_LOAD_IP_SUMMARY, CMD_LOAD_SERVICE_ERROR_SUMMARY,
    CMD_LOAD_SERVICE_SUMMARY, CMD_LOAD_SQL_SUMMARY, CMD_LOAD_UA_SUMMARY,
};
use nscouter_lib::scouter::configure::{parse_config_entries, parse_config_text};
use nscouter_lib::scouter::object::build_object_param;
use nscouter_lib::scouter::summary::{build_summary_param, parse_error_summary, parse_summary};
use nscouter_lib::scouter::value::ScouterValue;
use nscouter_lib::scouter::streaming::{build_request_param, StreamCursor};

const HOST: &str = "127.0.0.1";
const PORT: u16 = 6100;
const USER: &str = "admin";
const PASS: &str = "admin";

fn login() -> ScouterConnection {
    let mut conn = ScouterConnection::connect(HOST, PORT)
        .expect("콜렉터 연결 실패 — Test 환경이 떠 있는지 확인할 것");
    conn.login(USER, PASS).expect("로그인 실패");
    assert_ne!(conn.session, 0, "세션이 0이면 인증 실패");
    conn
}

/// javaee Family 오브젝트만 고른다.
///
/// **목록의 첫 번째를 집으면 안 된다.** 호스트 에이전트가 붙은 뒤로는
/// `objs[0]` 이 `linux` 라서 `TPS` 요청이 조용히 0건이 된다 (F-15).
/// 실제로 이 테스트들이 그렇게 깨졌다.
fn javaee_objects(objs: &[(String, i32)]) -> Vec<(String, i32)> {
    objs.iter()
        .filter(|(t, _)| matches!(t.as_str(), "tomcat" | "java" | "jboss" | "jetty" | "resin"))
        .cloned()
        .collect()
}

/// 오브젝트 목록에서 (objType, objHash) 를 모두 가져온다.
fn fetch_objects(conn: &mut ScouterConnection) -> Vec<(String, i32)> {
    let session = conn.session;
    conn.send_request(CMD_OBJECT_LIST_REAL_TIME, session, &MapPack::new())
        .expect("오브젝트 목록 요청 실패");

    let mut out = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("오브젝트 응답 수신 실패") {
        if let AnyPack::Object(obj) = pack {
            out.push((obj.obj_type, obj.obj_hash));
        }
    }
    out
}

fn fetch_object_hashes(conn: &mut ScouterConnection) -> Vec<i32> {
    let session = conn.session;
    conn.send_request(CMD_OBJECT_LIST_REAL_TIME, session, &MapPack::new())
        .expect("오브젝트 목록 요청 실패");

    let mut hashes = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("오브젝트 응답 수신 실패") {
        if let AnyPack::Object(obj) = pack {
            println!("  오브젝트: {} (type={}, hash={})", obj.obj_name, obj.obj_type, obj.obj_hash);
            hashes.push(obj.obj_hash);
        }
    }
    hashes
}

/// N-1 검증: 커맨드명이 맞으면 오브젝트 목록이 실제로 온다.
#[test]
#[ignore]
fn live_object_list() {
    let mut conn = login();
    println!("로그인 성공: server_id={}", conn.server_id);

    let hashes = fetch_object_hashes(&mut conn);
    assert!(
        !hashes.is_empty(),
        "오브젝트가 0건이다. 에이전트가 붙은 앱이 떠 있는지 확인할 것"
    );
    println!("=> 오브젝트 {}건", hashes.len());
}

/// N-3 검증: 같은 ScouterConnection 으로 명령을 연속 실행해도 모두 성공해야 한다.
/// (수정 전에는 두 번째 요청부터 연결이 끊겨 실패했다.)
#[test]
#[ignore]
fn live_sequential_requests() {
    let mut conn = login();

    for i in 1..=3 {
        let hashes = fetch_object_hashes(&mut conn);
        assert!(!hashes.is_empty(), "{i}번째 요청에서 오브젝트 0건");
        println!("=> {i}번째 오브젝트 목록 요청 성공 ({}건)", hashes.len());
    }
}

/// N-8 검증: COUNTER_REAL_TIME_ALL 은 objType + counter 를 받고 MapPack 을 돌려준다.
///
/// 수정 전 구현은 objHash 리스트만 보내고 PerfCounterPack 을 기다렸다.
/// 실서버는 그 요청에 **에러 없이 0건**으로 답한다 (F-15). 즉 카운터가 영영 안 온다.
#[test]
#[ignore]
fn live_counter_real_time_all() {
    let mut conn = login();
    let objs = javaee_objects(&fetch_objects(&mut conn));
    assert!(!objs.is_empty(), "javaee 오브젝트가 없어 카운터 조회 불가");

    let obj_type = objs[0].0.clone();
    let expected_hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();
    println!("objType={obj_type}, 오브젝트 {}건", expected_hashes.len());

    // counters.xml 의 javaee Family 에 실제로 있는 이름이어야 한다.
    // 'tps' 같은 소문자 키로는 아무것도 매칭되지 않는다 (N-7).
    let param = nscouter_lib::scouter::counter::build_counter_param(&obj_type, "TPS");
    let session = conn.session;
    conn.send_request(CMD_COUNTER_REAL_TIME_ALL, session, &param)
        .expect("카운터 요청 실패");

    let mut values: Vec<(i32, f64)> = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("카운터 응답 수신 실패") {
        if let AnyPack::Map(map) = pack {
            values = nscouter_lib::scouter::counter::parse_counter_values(&map);
        }
    }

    println!("=> 수신 카운터: {values:?}");
    assert!(
        !values.is_empty(),
        "카운터 0건. objType/counter 파라미터가 맞는지 확인할 것 (F-15)"
    );
    for (hash, _) in &values {
        assert!(
            expected_hashes.contains(hash),
            "응답의 objHash {hash} 가 오브젝트 목록에 없다 — 파싱이 어긋났다"
        );
    }
    assert_eq!(
        values.len(),
        expected_hashes.len(),
        "objHash 와 value 리스트 길이가 오브젝트 수와 달라야 할 이유가 없다"
    );
}

/// 카운터 여러 개를 요청 1회로 받는다 (COUNTER_REAL_TIME_ALL_MULTI).
///
/// 카운터당 요청 1회면 19개 띄울 때 2초마다 연결을 19번 연다 (F-1: 연결당 명령 1개).
/// MULTI 는 `objHash` / `counter` / `value` 3개 **병렬 리스트**로 한 번에 준다.
///
/// 주의: 요청한 카운터가 전부 오지는 않는다. 값이 없는 카운터는 빠진다.
/// 그래서 순서로 매칭하면 안 되고 `counter` 리스트를 같이 읽어야 한다.
#[test]
#[ignore]
fn live_counter_multi() {
    let mut conn = login();
    let objs = fetch_objects(&mut conn);
    assert!(!objs.is_empty(), "오브젝트가 없어 카운터 조회 불가");
    let hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();

    let wanted = ["TPS", "ElapsedTime", "ActiveService", "HeapUsed", "GcCount"];
    let param = nscouter_lib::scouter::counter::build_counter_multi_param(&hashes, &wanted);
    let session = conn.session;
    conn.send_request(CMD_COUNTER_REAL_TIME_ALL_MULTI, session, &param)
        .expect("MULTI 카운터 요청 실패");

    let mut rows = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
        if let AnyPack::Map(map) = pack {
            rows = nscouter_lib::scouter::counter::parse_counter_multi(&map);
        }
    }

    println!("=> {}행 수신", rows.len());
    for r in rows.iter().take(6) {
        println!("   objHash={} counter={} value={}", r.obj_hash, r.counter, r.value);
    }

    assert!(!rows.is_empty(), "MULTI 응답이 비었다");
    for r in &rows {
        assert!(
            hashes.contains(&r.obj_hash),
            "응답의 objHash {} 가 오브젝트 목록에 없다 — 리스트 정렬이 어긋났다",
            r.obj_hash
        );
        assert!(
            wanted.contains(&r.counter.as_str()),
            "요청하지 않은 카운터 {} 가 왔다 — counter 리스트를 잘못 읽었다",
            r.counter
        );
    }

    // TPS 는 부하가 있으면 반드시 온다.
    assert!(
        rows.iter().any(|r| r.counter == "TPS"),
        "TPS 가 없다. 부하가 도는지 확인할 것 (load.ps1)"
    );
}

/// N-7 검증: 카운터 이름은 counters.xml 표기 그대로여야 한다.
/// 소문자/스네이크 표기('tps')는 실서버에서 값을 못 받는다.
#[test]
#[ignore]
fn live_counter_name_is_case_sensitive() {
    let mut conn = login();
    let objs = javaee_objects(&fetch_objects(&mut conn));
    assert!(!objs.is_empty(), "javaee 오브젝트가 없어 카운터 조회 불가");
    let obj_type = objs[0].0.clone();

    let mut fetch = |counter: &str| -> usize {
        let param = nscouter_lib::scouter::counter::build_counter_param(&obj_type, counter);
        let session = conn.session;
        conn.send_request(CMD_COUNTER_REAL_TIME_ALL, session, &param)
            .expect("카운터 요청 실패");
        let mut n = 0;
        while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
            if let AnyPack::Map(map) = pack {
                n = nscouter_lib::scouter::counter::parse_counter_values(&map).len();
            }
        }
        n
    };

    let correct = fetch("TPS");
    let wrong = fetch("tps");
    println!("=> TPS={correct}건, tps={wrong}건");

    assert!(correct > 0, "정확한 이름 'TPS' 로도 0건이면 환경 문제다");
    assert_eq!(wrong, 0, "소문자 'tps' 가 값을 돌려주면 안 된다");
}

/// 호스트 에이전트(agent.host)가 보내는 host Family 카운터.
///
/// 자바 에이전트와 **Family 가 다르다** — `Cpu` 를 tomcat 오브젝트에 물으면
/// 에러 없이 0건이 온다(F-15). 반대도 마찬가지다.
/// 그래서 objType 을 목록에서 골라 오는 게 아니라 `linux` 를 직접 지정한다.
///
/// 컨테이너 안에서 돌지만 /proc 은 격리되지 않아 sigar 가 읽는 값은
/// 컨테이너가 아니라 podman VM 의 것이다. 이 환경에서 "호스트"는 그 VM 을 말한다.
///
/// 환경: Test/agent-host (scouter-host-agent 컨테이너)
#[test]
#[ignore]
fn live_host_counters() {
    let mut conn = login();
    let objs = fetch_objects(&mut conn);

    let host_hashes: Vec<i32> = objs
        .iter()
        .filter(|(t, _)| t == "linux")
        .map(|(_, h)| *h)
        .collect();
    assert!(
        !host_hashes.is_empty(),
        "linux 오브젝트가 없다. scouter-host-agent 컨테이너가 떠 있는지 확인할 것"
    );
    println!("호스트 오브젝트 {}건: {host_hashes:?}", host_hashes.len());

    // counters.xml host Family 24개 전부. 표기 그대로여야 한다.
    // **전부 오지는 않는다** — 값이 없는 카운터는 응답에서 빠진다.
    // 어떤 게 실제로 오는지가 인벤토리의 근거이므로 전수로 묻고 결과를 찍는다.
    let wanted = [
        "Cpu", "SysCpu", "UserCpu",
        "Mem", "MemA", "MemU", "MemT",
        "PageIn", "PageOut", "Swap", "SwapT", "SwapU",
        "NetInBound", "NetOutBound",
        "TcpStatSynSent", "TcpStatSynReceive", "TcpStatEST",
        "TcpStatTIM", "TcpStatFIN", "TcpStatCLS",
        "NetRxBytes", "NetTxBytes",
        "DiskReadBytes", "DiskWriteBytes",
    ];
    let param = nscouter_lib::scouter::counter::build_counter_multi_param(&host_hashes, &wanted);
    let session = conn.session;
    conn.send_request(CMD_COUNTER_REAL_TIME_ALL_MULTI, session, &param)
        .expect("호스트 카운터 요청 실패");

    let mut rows = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
        if let AnyPack::Map(map) = pack {
            rows = nscouter_lib::scouter::counter::parse_counter_multi(&map);
        }
    }

    for r in &rows {
        println!("   {:<18} {}", r.counter, r.value);
    }
    let missing: Vec<&str> = wanted
        .iter()
        .filter(|w| !rows.iter().any(|r| r.counter == **w))
        .copied()
        .collect();
    println!("=> 수신 {}/{} · 미수신: {missing:?}", rows.len(), wanted.len());

    assert!(
        !rows.is_empty(),
        "호스트 카운터가 0건이다. 카운터명이 counters.xml host Family 표기와 맞는지 확인할 것"
    );
    for r in &rows {
        assert!(
            host_hashes.contains(&r.obj_hash),
            "응답의 objHash {} 가 호스트 오브젝트가 아니다",
            r.obj_hash
        );
    }

    // Cpu 는 머신이 돌고 있으면 반드시 온다. 이게 없으면 sigar 가 못 읽은 것이다.
    assert!(
        rows.iter().any(|r| r.counter == "Cpu"),
        "Cpu 가 없다 — sigar 네이티브 로드나 /proc 접근을 확인할 것"
    );
}

/// 호스트 카운터 중 **실시간에 안 오는 것들**을 5분 집계로 다시 묻는다.
///
/// `live_host_counters` 에서 6개가 미수신이었고, 그걸 "표본에 안 잡힌다"로
/// 적어 둔 것은 **추정이었다**. 에이전트 바이트코드를 열어 보면
/// `HostPerf.domain()` 이 팩을 **두 번** 담는다.
///
///   getPack(objName, TimeTypeEnum.REALTIME)  → SynSent/SynReceive 가 **없다**
///   getPack(objName, TimeTypeEnum.FIVE_MIN)  → SynSent/SynReceive 가 **있다**
///
/// 즉 실시간으로는 영원히 안 온다. 5분 집계(=`COUNTER_TODAY_ALL`)로
/// 물어야 보인다. 이 테스트가 그 근거다.
///
/// 반면 Net/Disk 4개는 집계에도 없다 — `HostNetDiskPerf` 가 값을 계산해
/// static 필드에 넣기만 하고 **그 getter 를 읽는 코드가 2.21.3 에 없다**.
/// 팩에 실리지 않으니 클라이언트가 무엇을 하든 받을 수 없다.
///
/// 환경: Test/agent-host. 집계가 쌓히려면 호스트 에이전트가 **5분 이상** 돌았어야 한다.
#[test]
#[ignore]
fn live_host_five_min_counters() {
    // 실시간에서 빠졌던 6개. 앞의 둘은 오고, 뒤의 넷은 안 온다는 게 이 테스트의 주장이다.
    let expected = ["TcpStatSynSent", "TcpStatSynReceive"];
    let dead = ["NetRxBytes", "NetTxBytes", "DiskReadBytes", "DiskWriteBytes"];

    let mut got: Vec<(&str, usize)> = Vec::new();
    for counter in expected.iter().chain(dead.iter()) {
        // F-1: 요청 하나에 연결 하나
        let mut conn = login();
        let session = conn.session;
        conn.send_request(
            CMD_COUNTER_TODAY_ALL,
            session,
            &nscouter_lib::scouter::objtype::build_today_counter_param(counter, "linux"),
        )
        .expect("COUNTER_TODAY_ALL 요청 실패");

        let mut points = 0usize;
        let mut nonzero = 0usize;
        let mut max = 0.0f32;
        let mut span = (i64::MAX, i64::MIN);
        while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
            if let AnyPack::Map(map) = pack {
                let s = nscouter_lib::scouter::objtype::parse_counter_series(&map);
                points += s.times.len();
                nonzero += s.values.iter().filter(|v| **v != 0.0).count();
                for v in &s.values {
                    if *v > max {
                        max = *v;
                    }
                }
                if let (Some(a), Some(b)) = (s.times.first(), s.times.last()) {
                    span = (span.0.min(*a), span.1.max(*b));
                }
            }
        }
        // **포인트 수만 보면 안 된다.** 하루치 슬롯이 통째로 오므로 288 은 늘 288이다.
        // 실제로 수집됐는지는 0 아닌 값이 있느냐로 갈린다.
        println!("   {counter:<18} {points}포인트 · 값있음 {nonzero} · 최대 {max} · {span:?}");
        got.push((counter, points));
    }

    // 기준점: 집계 자체가 쌓였는가. Cpu 가 0이면 환경 문제라
    // 아래 단정들이 전부 무의미해진다.
    let mut conn = login();
    let session = conn.session;
    conn.send_request(
        CMD_COUNTER_TODAY_ALL,
        session,
        &nscouter_lib::scouter::objtype::build_today_counter_param("Cpu", "linux"),
    )
    .expect("Cpu 요청 실패");
    let mut cpu_points = 0usize;
    while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
        if let AnyPack::Map(map) = pack {
            cpu_points += nscouter_lib::scouter::objtype::parse_counter_series(&map).times.len();
        }
    }
    println!("=> 기준 Cpu {cpu_points}포인트");
    assert!(
        cpu_points > 0,
        "Cpu 집계가 0포인트다 — 호스트 에이전트가 5분 이상 돌았는지 확인할 것"
    );

    for c in expected {
        let n = got.iter().find(|(k, _)| *k == c).map(|(_, n)| *n).unwrap_or(0);
        assert!(
            n > 0,
            "{c} 가 5분 집계에도 없다. HostPerf 가 FIVE_MIN 팩에 넣는 게 맞는지 다시 볼 것"
        );
    }
    for c in dead {
        let n = got.iter().find(|(k, _)| *k == c).map(|(_, n)| *n).unwrap_or(0);
        assert_eq!(
            n, 0,
            "{c} 가 온다. 에이전트가 이제 보낸다는 뜻이니 인벤토리의 '미수신' 판정을 되돌릴 것"
        );
    }
}

/// MULTI 요청에 서로 다른 Family 를 **섞어도 되는가**.
///
/// 이게 되면 스트림 하나로 javaee + host 를 함께 받는다.
/// 안 되면(한쪽이 통째로 사라지면) 스트림을 Family 별로 나눠야 한다.
///
/// 응답이 (objHash, counter, value) 3중 병렬 리스트라 서버가 objHash × counter 를
/// 훑으면서 값이 있는 조합만 담는 구조로 보이지만, **추측으로 두면 안 된다** —
/// 파라미터가 틀리면 에러 없이 0건이 오는 게 이 프로토콜의 실패 방식이다(F-15).
#[test]
#[ignore]
fn live_counter_multi_mixed_families() {
    let mut conn = login();
    let objs = fetch_objects(&mut conn);

    let host: Vec<i32> = objs.iter().filter(|(t, _)| t == "linux").map(|(_, h)| *h).collect();
    let javaee: Vec<i32> = objs.iter().filter(|(t, _)| t == "tomcat").map(|(_, h)| *h).collect();
    assert!(!host.is_empty(), "linux 오브젝트가 없다 — scouter-host-agent 확인");
    assert!(!javaee.is_empty(), "tomcat 오브젝트가 없다 — shop/order-app 확인");

    let all_hashes: Vec<i32> = javaee.iter().chain(host.iter()).copied().collect();
    let wanted = ["TPS", "HeapUsed", "Cpu", "MemU"];

    let param = nscouter_lib::scouter::counter::build_counter_multi_param(&all_hashes, &wanted);
    let session = conn.session;
    conn.send_request(CMD_COUNTER_REAL_TIME_ALL_MULTI, session, &param)
        .expect("혼합 MULTI 요청 실패");

    let mut rows = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
        if let AnyPack::Map(map) = pack {
            rows = nscouter_lib::scouter::counter::parse_counter_multi(&map);
        }
    }
    for r in &rows {
        let fam = if host.contains(&r.obj_hash) { "host" } else { "javaee" };
        println!("   [{fam}] {:<10} {}", r.counter, r.value);
    }

    let got_javaee = rows.iter().any(|r| javaee.contains(&r.obj_hash) && r.counter == "TPS");
    let got_host = rows.iter().any(|r| host.contains(&r.obj_hash) && r.counter == "Cpu");
    println!("=> javaee TPS={got_javaee}, host Cpu={got_host}");

    assert!(got_javaee, "혼합 요청에서 javaee 카운터가 사라졌다 — Family 별로 나눠 요청해야 한다");
    assert!(got_host, "혼합 요청에서 host 카운터가 사라졌다 — Family 별로 나눠 요청해야 한다");

    // 다른 Family 의 카운터가 엉뚱한 오브젝트에 붙어 오면 안 된다.
    for r in &rows {
        if host.contains(&r.obj_hash) {
            assert!(
                !matches!(r.counter.as_str(), "TPS" | "HeapUsed"),
                "host 오브젝트에 javaee 카운터 {} 가 붙었다",
                r.counter
            );
        }
    }
}

/// OBJECT_ENV — 에이전트 JVM 의 시스템 프로퍼티.
///
/// 응답은 평평한 key→Text MapPack 이다 (실측).
#[test]
#[ignore]
fn live_object_env() {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    assert!(!objs.is_empty(), "javaee 오브젝트가 없다");
    let obj_hash = objs[0].1;

    let mut conn = login();
    let session = conn.session;
    let param = nscouter_lib::scouter::object::build_object_param(obj_hash);
    conn.send_request(CMD_OBJECT_ENV, session, &param)
        .expect("OBJECT_ENV 요청 실패");

    let mut env = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
        if let AnyPack::Map(m) = pack {
            env = nscouter_lib::scouter::object::parse_object_env(&m);
        }
    }

    println!("=> {}건", env.len());
    for e in env.iter().take(5) {
        println!("   {} = {}", e.key, e.value);
    }
    assert!(!env.is_empty(), "ENV 가 0건이다. objHash 파라미터를 확인할 것 (F-15)");

    // 에이전트가 붙은 JVM 이면 반드시 있는 값들.
    let find = |k: &str| env.iter().find(|e| e.key == k).map(|e| e.value.as_str());
    assert!(find("java.version").is_some(), "java.version 이 없다 — 응답이 JVM 프로퍼티가 아니다");
    assert_eq!(find("scouter.objtype"), Some("tomcat"), "scouter.objtype 이 다르다");

    // 정렬 계약: 매 조회마다 순서가 바뀌면 화면이 흔들린다.
    let keys: Vec<&String> = env.iter().map(|e| &e.key).collect();
    let mut sorted = keys.clone();
    sorted.sort();
    assert_eq!(keys, sorted, "이름순 정렬이 깨졌다");
}

/// OBJECT_THREAD_LIST — 에이전트 JVM 의 스레드 목록.
///
/// 7개 병렬 리스트로 온다. 트랜잭션 처리 중인 스레드만
/// `elapsed`/`service`/`txid` 가 채워지고 유휴 스레드는 Null 이다 (실측).
#[test]
#[ignore]
fn live_object_thread_list() {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_hash = objs[0].1;

    let mut conn = login();
    let session = conn.session;
    let param = nscouter_lib::scouter::object::build_object_param(obj_hash);
    conn.send_request(CMD_OBJECT_THREAD_LIST, session, &param)
        .expect("OBJECT_THREAD_LIST 요청 실패");

    let mut threads = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
        if let AnyPack::Map(m) = pack {
            threads = nscouter_lib::scouter::object::parse_thread_list(&m);
        }
    }

    println!("=> 스레드 {}개", threads.len());
    for t in threads.iter().take(6) {
        println!(
            "   #{:<4} {:<34} {:<14} cpu={} elapsed={:?}",
            t.id, t.name, t.stat, t.cpu, t.elapsed
        );
    }
    assert!(!threads.is_empty(), "스레드 0건이다. objHash 파라미터를 확인할 것 (F-15)");

    for t in &threads {
        assert!(t.id > 0, "스레드 id 가 0 이하다 — 리스트가 어긋났다");
        assert!(!t.name.is_empty(), "이름이 비었다 — name 리스트가 어긋났다");
        // stat 은 Thread.State 이름이다. 깨진 문자열이면 파싱이 밀린 것이다.
        assert!(
            t.stat.chars().all(|c| c.is_ascii_uppercase() || c == '_'),
            "stat={:?} 이 Thread.State 형식이 아니다",
            t.stat
        );
    }

    // 에이전트 자신의 스레드는 항상 떠 있다 — 응답이 이 JVM 의 것인지 확인.
    assert!(
        threads.iter().any(|t| t.name.starts_with("Scouter-")),
        "Scouter 에이전트 스레드가 없다 — 다른 JVM 의 응답이다"
    );
}

/// SOCKET — 에이전트가 열고 있는 소켓 목록.
///
/// `host` 가 **Blob 4바이트(IPv4)** 로 온다. 텍스트로 읽으면 깨진다.
#[test]
#[ignore]
fn live_object_sockets() {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_hash = objs[0].1;

    let mut conn = login();
    let session = conn.session;
    let param = nscouter_lib::scouter::object::build_object_param(obj_hash);
    conn.send_request(CMD_OBJECT_SOCKET, session, &param)
        .expect("SOCKET 요청 실패");

    let mut socks = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
        if let AnyPack::Map(m) = pack {
            socks = nscouter_lib::scouter::object::parse_socket_list(&m);
        }
    }

    for s in &socks {
        println!("   {}:{} count={} service={:?}", s.host, s.port, s.count, s.service);
    }
    assert!(!socks.is_empty(), "소켓이 0건이다 — 파라미터를 확인할 것 (F-15)");

    for s in &socks {
        // Blob 을 텍스트로 읽으면 여기서 깨진 문자열이 잡힌다.
        assert!(
            s.host.split('.').count() == 4 && s.host.split('.').all(|o| o.parse::<u8>().is_ok()),
            "host={:?} 가 IPv4 가 아니다 — Blob 을 텍스트로 읽고 있다",
            s.host
        );
        assert!(s.port > 0 && s.port <= 65535, "port={} 가 범위를 벗어났다", s.port);
    }

    // 특정 포트가 반드시 있다고 단정하지 않는다.
    // 소켓 목록은 **순간 스냅샷**이라 콜렉터 TCP(6100)조차 그 순간 없을 수 있다
    // (에이전트는 평소 UDP 를 쓰고 TCP 는 필요할 때 연다).
    // 실제로 그렇게 단정했다가 간헐적으로 깨졌다. 검증은 형태로만 한다.
}

/// OBJECT_CLASS_LIST — 로드된 클래스 목록.
///
/// **이 응답만 페이지 단위다.** 17,000개가 넘어 한 번에 오지 않는다.
/// 파라미터 이름(`page`)이 틀리면 에러가 아니라 **항상 같은 페이지**가 온다 —
/// 그래서 2페이지가 1페이지와 다른지까지 확인한다.
#[test]
#[ignore]
fn live_object_class_list_paginates() {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_hash = objs[0].1;

    let fetch = |page: i32| {
        let mut conn = login();
        let session = conn.session;
        let param = nscouter_lib::scouter::object::build_class_list_param(obj_hash, page);
        conn.send_request(CMD_OBJECT_CLASS_LIST, session, &param)
            .expect("클래스 목록 요청 실패");
        let mut out = None;
        while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
            if let AnyPack::Map(m) = pack {
                if out.is_none() {
                    out = Some(nscouter_lib::scouter::object::parse_class_list(&m));
                }
            }
        }
        out.expect("클래스 목록 응답 없음")
    };

    let p1 = fetch(1);
    println!("1페이지: {}/{} · {}건", p1.page, p1.total_page, p1.classes.len());
    for c in p1.classes.iter().take(3) {
        println!("   {} <- {}", c.name, c.super_class);
    }
    assert!(!p1.classes.is_empty(), "클래스가 0건이다 (F-15)");
    assert!(p1.total_page > 1, "총 페이지가 1이면 페이지네이션을 확인할 수 없다");

    let p2 = fetch(2);
    println!("2페이지: {}/{} · {}건", p2.page, p2.total_page, p2.classes.len());
    assert_eq!(p2.page, 2, "응답의 page 가 2가 아니다 — 파라미터 이름이 틀렸다");

    let n1: Vec<&String> = p1.classes.iter().map(|c| &c.name).collect();
    let n2: Vec<&String> = p2.classes.iter().map(|c| &c.name).collect();
    assert_ne!(n1, n2, "2페이지가 1페이지와 같다 — page 파라미터가 무시되고 있다");
}

/// 탐침: 오브젝트 명령(OBJECT_*)의 응답 구조를 **원시 바이트로** 확인한다.
///
/// 문서(02-common-network-protocol.md)에 명령 이름은 있지만 파라미터와 응답
/// 팩 형태는 없다. 이 프로토콜은 파라미터가 틀리면 에러 없이 빈 응답이 오므로
/// (F-15) 추측으로 구현하면 원인을 못 찾는다.
///
/// `read_next_pack` 을 쓰지 않는 이유: 모르는 팩 타입을 만나면 **본문을 읽지 않고**
/// `AnyPack::Unknown` 을 돌려줘서 이후 스트림이 어긋난다(O-5).
/// 여기서는 플래그와 타입만 읽고 나머지를 그대로 덤프한다.
#[test]
#[ignore]
fn probe_object_commands() {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    assert!(!objs.is_empty(), "javaee 오브젝트가 없다");
    let obj_hash = objs[0].1;
    println!("대상 objHash={obj_hash} ({})\n", objs[0].0);

    // 주의: 소켓 조회의 명령 문자열은 "OBJECT_SOCKET" 이 아니라 "SOCKET" 이다
    // (02-common-network-protocol.md 179행).
    for cmd in [
        "OBJECT_ACTIVE_SERVICE_LIST",
        "OBJECT_THREAD_DUMP",
        "TRIGGER_THREAD_DUMP",
    ] {
        let mut conn = login();
        let session = conn.session;
        let mut param = MapPack::new();
        param.put("objHash", ScouterValue::Decimal(obj_hash as i64));

        if conn.send_request(cmd, session, &param).is_err() {
            println!("── {cmd}: 요청 실패\n");
            continue;
        }

        // 플래그 + 팩 타입만 읽고 나머지는 원시 덤프.
        let Ok(flag) = conn.read_flag() else {
            println!("── {cmd}: 응답 없음(즉시 종료)\n");
            continue;
        };
        // NoNEXT 는 0 이 아니라 4 다 (protocol.rs FLAG_NO_NEXT).
        if flag == 4 {
            println!("── {cmd}: NoNEXT — 빈 응답. 파라미터가 틀렸을 수 있다\n");
            continue;
        }
        let pack_type = conn.read_byte().unwrap_or(0);

        let mut body = Vec::new();
        while body.len() < 400 {
            match conn.read_byte() {
                Ok(b) => body.push(b),
                Err(_) => break,
            }
        }

        let ascii: String = body
            .iter()
            .map(|&b| if (0x20..0x7f).contains(&b) { b as char } else { '.' })
            .collect();
        println!("── {cmd}: flag={flag} packType={pack_type} 본문 {}바이트", body.len());
        println!("   ascii: {ascii}");
        println!("   hex  : {}\n", body.iter().take(64)
            .map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(" "));
    }
}

/// 탐침 2: MapPack 으로 오는 오브젝트 명령의 **키 구성**을 본다.
/// 구조체를 만들기 전에 어떤 필드가 실제로 오는지 알아야 한다.
#[test]
#[ignore]
fn probe_object_mappack_keys() {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_hash = objs[0].1;

    for cmd in ["OBJECT_HEAPHISTO", "TRIGGER_HEAPHISTO", "OBJECT_CALL_HEAP_DUMP"] {
        let mut conn = login();
        let session = conn.session;
        let mut param = MapPack::new();
        param.put("objHash", ScouterValue::Decimal(obj_hash as i64));
        conn.send_request(cmd, session, &param).expect("요청 실패");

        println!("── {cmd}");
        while let Some(pack) = conn.read_next_pack().expect("응답 파싱 실패") {
            if let AnyPack::Map(m) = pack {
                let mut keys: Vec<&String> = m.entries.keys().collect();
                keys.sort();
                for k in keys {
                    match &m.entries[k] {
                        ScouterValue::List(items) => {
                            let sample: Vec<String> =
                                items.iter().take(3).map(|v| format!("{v:?}")).collect();
                            println!("   {k:<14} List({}) {}", items.len(), sample.join(", "));
                        }
                        other => println!("   {k:<14} {other:?}"),
                    }
                }
            }
        }
        println!();
    }
}

/// OBJECT_ACTIVE_SERVICE_LIST — 지금 돌고 있는 트랜잭션.
///
/// 스레드 목록과 달리 **서비스명이 이미 텍스트**고, `txid` 는 Hexa32 다 (F-21).
///
/// 부하가 없으면 0건이 정상이라 "0건이면 실패"로 둘 수 없다.
/// 대신 **온 데이터의 형태**를 검증한다.
#[test]
#[ignore]
fn live_object_active_services() {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_hash = objs[0].1;

    // 순간 스냅샷이라 한 번에 안 잡힐 수 있다. 몇 번 본다.
    let mut list = Vec::new();
    for _ in 0..8 {
        let mut conn = login();
        let session = conn.session;
        let param = nscouter_lib::scouter::object::build_object_param(obj_hash);
        conn.send_request(CMD_OBJECT_ACTIVE_SERVICE_LIST, session, &param)
            .expect("활성 서비스 요청 실패");
        while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
            if let AnyPack::Map(m) = pack {
                list = nscouter_lib::scouter::object::parse_active_services(&m);
            }
        }
        if !list.is_empty() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
    }

    println!("=> 활성 {}건", list.len());
    for a in list.iter().take(5) {
        println!("   #{} {} {} {}ms txid={:?}", a.id, a.name, a.service, a.elapsed, a.txid);
    }
    assert!(
        !list.is_empty(),
        "활성 서비스 0건 — 부하가 도는지 확인할 것 (load.ps1)"
    );

    for a in &list {
        // 서비스명이 해시로 오면(사전 조회 필요) 설계가 달라진다. 텍스트여야 한다.
        assert!(!a.service.is_empty(), "service 가 비었다");
        assert!(
            a.service.starts_with('/') || a.service.contains('.'),
            "service={:?} 가 서비스명 형태가 아니다 — 해시가 오고 있다",
            a.service
        );
        assert!(a.elapsed >= 0, "elapsed 가 음수다 — 리스트가 어긋났다");
        // Hexa32 를 10진수로 파싱했다면 전부 None 이 된다.
        assert!(a.txid.is_some(), "txid 를 못 풀었다 — Hexa32 로 읽고 있는지 확인 (F-21)");
    }
}

/// 과거 XLog 시간 범위 조회 + 페이지네이션 (`TRANX_LOAD_TIME_GROUP_V2`).
///
/// 이후 작업(LoadTimeXLog / ZoomTime / 과거 카운터)의 **선행 조건**이다.
///
/// 실측으로 확정한 계약 (F-28):
///   - 시간 키는 `stime`/`etime` — `startTime`/`endTime` 은 0건
///   - **`pageCount` 가 없으면 0건** (에러가 아니다)
///   - 다음 페이지는 응답의 `lastTxid`/`lastXLogTime` 을 그대로 넣는다
#[test]
#[ignore]
fn live_past_xlog_paginates() {
    use nscouter_lib::scouter::past::{
        build_past_xlog_param, dedupe_by_txid, parse_past_cursor, PastCursor,
    };

    let mut conn = login();
    let objs = fetch_objects(&mut conn);
    let hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let from = now - 10 * 60 * 1000;
    let date = yyyymmdd_local(now);
    const PAGE: i32 = 100;

    let mut fetch = |cursor: &PastCursor| -> (Vec<(i64, i64)>, PastCursor) {
        let param = build_past_xlog_param(&hashes, &date, from, now, PAGE, cursor);
        let s = conn.session;
        conn.send_request(CMD_TRANX_LOAD_TIME_GROUP_V2, s, &param)
            .expect("과거 XLog 요청 실패");

        let mut rows = Vec::new();
        let mut next = PastCursor::default();
        while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
            match pack {
                AnyPack::XLog(x) => rows.push((x.txid, x.end_time)),
                AnyPack::Map(m) => next = parse_past_cursor(&m),
                _ => {}
            }
        }
        (rows, next)
    };

    let (p1, c1) = fetch(&PastCursor::default());
    println!("1페이지 {}건 · hasMore={} lastTime={}", p1.len(), c1.has_more, c1.last_xlog_time);
    assert!(!p1.is_empty(), "과거 XLog 0건 — stime/etime 과 pageCount 를 확인할 것 (F-15)");
    assert_eq!(p1.len(), PAGE as usize, "pageCount 만큼 오지 않았다");
    assert!(c1.has_more, "10분치가 100건일 리 없다 — hasMore 를 못 읽었다");

    // 범위 밖이 섞이면 stime/etime 이 안 먹은 것이다.
    for (_, t) in &p1 {
        assert!(*t >= from && *t <= now, "endTime={t} 이 요청 범위 밖이다");
    }

    let (p2, c2) = fetch(&c1);
    println!("2페이지 {}건 · hasMore={} lastTime={}", p2.len(), c2.has_more, c2.last_xlog_time);
    assert!(!p2.is_empty(), "2페이지가 비었다 — 커서를 잘못 넘겼다");
    assert!(c2.last_xlog_time > c1.last_xlog_time, "커서가 전진하지 않았다");

    // 경계 시각이 같은 건은 다시 온다 — 그래서 stime 을 포함으로 두고 txid 로 거른다.
    // **대부분이 겹치면** 커서 방식이 틀린 것이다 (etime 을 당기면 96/100 이 겹쳤다).
    let t1: std::collections::HashSet<i64> = p1.iter().map(|(t, _)| *t).collect();
    let overlap = p2.iter().filter(|(t, _)| t1.contains(t)).count();
    println!("겹침 {overlap}/{}", p2.len());
    assert!(
        overlap * 5 < p2.len(),
        "2페이지의 {overlap}/{}건이 1페이지와 겹친다 — 커서 전진 방식이 틀렸다",
        p2.len()
    );

    // 걸러내면 실제로 새 데이터가 남아야 한다.
    let mut seen: std::collections::HashSet<i64> = std::collections::HashSet::new();
    let fresh1 = dedupe_by_txid(&mut seen, p1.clone(), |r| r.0);
    let fresh2 = dedupe_by_txid(&mut seen, p2.clone(), |r| r.0);
    println!("중복 제거 후: 1페이지 {}건, 2페이지 {}건", fresh1.len(), fresh2.len());
    assert_eq!(fresh1.len(), p1.len(), "1페이지 안에 중복이 있다");
    assert!(!fresh2.is_empty(), "중복을 걸렀더니 2페이지에 새 데이터가 없다");
}

/// OBJECT_HEAPHISTO — 클래스별 인스턴스 수와 점유 바이트.
///
/// 응답은 `jmap -histo` 형식의 **텍스트 줄 목록**이라 열로 나눠야 정렬할 수 있다.
///
/// **앱 컨테이너가 JDK 여야 한다.** JRE 는 `jdk.attach` 가 없어 빈 목록이 온다 (F-25).
#[test]
#[ignore]
fn live_object_heap_histogram() {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_hash = objs[0].1;

    let mut conn = login();
    let session = conn.session;
    let param = nscouter_lib::scouter::object::build_object_param(obj_hash);
    conn.send_request(CMD_OBJECT_HEAPHISTO, session, &param)
        .expect("힙 히스토그램 요청 실패");

    let mut rows = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
        if let AnyPack::Map(m) = pack {
            rows = nscouter_lib::scouter::object::parse_heap_histogram(&m);
        }
    }

    println!("=> {}행", rows.len());
    for r in rows.iter().take(5) {
        println!("   #{:<4} {:>10} {:>12}  {}", r.rank, r.instances, r.bytes, r.class_name);
    }
    assert!(
        !rows.is_empty(),
        "히스토그램이 비었다 — 앱 컨테이너에 jdk.attach 가 있는지 확인할 것 (F-25)"
    );

    for r in &rows {
        assert!(r.rank > 0, "rank 가 0 이하다 — 머리글을 행으로 읽었다");
        assert!(r.instances > 0, "instances 가 0 이하다");
        assert!(r.bytes > 0, "bytes 가 0 이하다");
        assert!(!r.class_name.is_empty(), "클래스명이 비었다");
    }

    // 어떤 JVM 이든 String 은 상위에 있다. 열 매핑이 어긋나면 여기서 걸린다.
    assert!(
        rows.iter().take(30).any(|r| r.class_name.starts_with("java.lang.String")),
        "상위 30행에 java.lang.String 이 없다 — 열 매핑을 확인할 것"
    );

    // rank 는 1부터 증가한다. 정렬이 아니라 원본 순서 검증이다.
    assert!(rows[0].rank <= rows[1].rank, "rank 가 증가 순서가 아니다");
}

/// 스레드 덤프 3단계 — 생성 → 목록 → 내용.
///
/// 내용 응답만 **Pack 이 아니라 blob 청크 스트림**이다 (F-26).
/// `read_next_pack` 으로 읽으면 blob 길이 표식 0xFF 를 팩 타입으로 오해한다.
///
/// **앱 컨테이너가 JDK 여야 한다.** JRE 이미지에는 `jdk.attach` 모듈이 없어
/// 덤프 파일이 size=0 으로 만들어진다 (F-25).
#[test]
#[ignore]
fn live_thread_dump_roundtrip() {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_hash = objs[0].1;

    // 1) 생성
    let created = {
        let mut conn = login();
        let session = conn.session;
        let param = nscouter_lib::scouter::object::build_object_param(obj_hash);
        conn.send_request(CMD_TRIGGER_THREAD_DUMP, session, &param)
            .expect("덤프 생성 실패");
        let mut n = String::new();
        while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
            if let AnyPack::Map(m) = pack {
                if let Some(v) = m.get_text("name") {
                    n = v.to_string();
                }
            }
        }
        n
    };
    println!("생성: {created}");
    assert!(!created.is_empty(), "덤프 파일 이름이 없다");

    // 2) 목록
    let files = {
        let mut conn = login();
        let session = conn.session;
        let param = nscouter_lib::scouter::object::build_object_param(obj_hash);
        conn.send_request(CMD_OBJECT_DUMP_FILE_LIST, session, &param)
            .expect("덤프 목록 실패");
        let mut f = Vec::new();
        while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
            if let AnyPack::Map(m) = pack {
                f = nscouter_lib::scouter::object::parse_dump_file_list(&m);
            }
        }
        f
    };
    let target = files
        .iter()
        .find(|f| f.name == created)
        .expect("방금 만든 덤프가 목록에 없다");
    println!("목록 {}건, 대상 size={}", files.len(), target.size);

    // JRE 이미지면 여기서 0 이 나온다 — 원인을 바로 알 수 있게 메시지에 적는다.
    assert!(
        target.size > 0,
        "덤프 크기가 0이다 — 앱 컨테이너에 jdk.attach 가 있는지 확인할 것 (JRE 이미지면 없다)"
    );
    // **"내 파일이 맨 앞"이라고 단정하면 안 된다.** 덤프 파일명은 초 단위 타임스탬프라
    // 다른 테스트가 같은 초에 덤프를 뜨면 순서가 갈린다(러스트 테스트는 기본 병렬).
    // 확인해야 할 것은 **정렬이 최신순인가** 자체다.
    let names: Vec<&str> = files.iter().map(|f| f.name.as_str()).collect();
    let mut sorted = names.clone();
    // 파일명에 박힌 yyyymmddHHMMSS 가 내림차순이어야 한다
    sorted.sort_by(|a, b| stamp_of(b).cmp(&stamp_of(a)));
    assert_eq!(names, sorted, "목록이 최신순이 아니다");
    assert_eq!(
        stamp_of(&files[0].name),
        stamp_of(&created),
        "방금 만든 덤프와 맨 앞 항목의 시각이 다르다 — 최신순이 깨졌다"
    );

    // 3) 내용
    let content = {
        let mut conn = login();
        let session = conn.session;
        let param = nscouter_lib::scouter::object::build_dump_file_param(obj_hash, &created);
        conn.send_request(CMD_OBJECT_DUMP_FILE_DETAIL, session, &param)
            .expect("덤프 내용 요청 실패");
        conn.read_blob_stream().expect("blob 스트림 수신 실패")
    };

    println!("내용 {}바이트 (목록 size={})", content.len(), target.size);
    // 청크를 하나라도 놓치면 여기서 어긋난다. 4096B 씩 오므로 실수가 잘 드러난다.
    assert_eq!(
        content.len() as i64,
        target.size,
        "이어붙인 길이가 목록의 size 와 다르다 — 청크를 놓쳤다"
    );

    let text = String::from_utf8_lossy(&content);
    assert!(
        text.contains("Full thread dump"),
        "스레드 덤프 내용이 아니다: {:?}",
        &text[..text.len().min(120)]
    );
    assert!(
        text.contains("http-nio-8081-exec-"),
        "톰캣 워커 스레드가 없다 — 다른 JVM 의 덤프다"
    );
    println!("   첫 줄: {}", text.lines().nth(1).unwrap_or(""));
}

/// 탐침 5: **과거 XLog 조회**. 이후 작업 여러 개의 선행 조건이다.
///
/// 지금 앱은 "현재"만 본다. LoadTimeXLog / ZoomTime / 과거 카운터 차트가 전부
/// 시간 범위 조회를 전제로 하므로 이게 되는지부터 확인한다.
///
/// 파라미터 이름을 모르므로 후보를 돌려본다. 틀리면 에러가 아니라 0건이 온다 (F-15).
#[test]
#[ignore]
fn probe_past_xlog() {
    let mut conn = login();
    let objs = fetch_objects(&mut conn);
    let hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let from = now - 10 * 60 * 1000; // 10분 전
    let date = yyyymmdd_local(now);
    println!("date={date} from={from} to={now}");

    for cmd in ["TRANX_LOAD_TIME_GROUP_V2", "TRANX_LOAD_TIME_GROUP", "TRANX_LOAD_TIME"] {
        for (k_start, k_end) in [("stime", "etime"), ("startTime", "endTime")] {
            let mut c = login();
            let s = c.session;
            let mut p = MapPack::new();
            p.put("date", ScouterValue::Text(date.clone()));
            p.put(k_start, ScouterValue::Decimal(from));
            p.put(k_end, ScouterValue::Decimal(now));
            p.put(
                "objHash",
                ScouterValue::List(
                    hashes.iter().map(|h| ScouterValue::Decimal(*h as i64)).collect(),
                ),
            );

            if c.send_request(cmd, s, &p).is_err() {
                println!("── {cmd} ({k_start}/{k_end}): 요청 실패");
                continue;
            }

            let mut xlogs = 0usize;
            let mut maps = Vec::new();
            loop {
                match c.read_next_pack() {
                    Ok(Some(AnyPack::XLog(_))) => xlogs += 1,
                    Ok(Some(AnyPack::Map(m))) => {
                        let mut keys: Vec<&String> = m.entries.keys().collect();
                        keys.sort();
                        maps.push(
                            keys.iter()
                                .map(|k| format!("{k}={:?}", m.entries[*k]))
                                .collect::<Vec<_>>()
                                .join(" "),
                        );
                    }
                    Ok(Some(_)) => {}
                    Ok(None) => break,
                    Err(e) => {
                        println!("── {cmd} ({k_start}/{k_end}): 에러 {e}");
                        break;
                    }
                }
            }
            println!("── {cmd} ({k_start}/{k_end}) → XLog {xlogs}건");
            for m in maps.iter().take(2) {
                println!("   meta: {}", &m[..m.len().min(200)]);
            }
        }
    }
}

/// 탐침 6: `TRANX_LOAD_TIME_GROUP_V2` 의 페이지네이션 파라미터를 찾는다.
///
/// V1 은 10분에 13,732건을 **한 번에** 준다. 1시간이면 8만 건이라
/// 페이지네이션이 있는 V2 를 쓰는 게 맞다. 그런데 V2 는 같은 파라미터로 0건이다 —
/// 뭔가가 더 필요하다.
#[test]
#[ignore]
fn probe_past_xlog_v2_params() {
    let mut conn = login();
    let objs = fetch_objects(&mut conn);
    let hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let from = now - 10 * 60 * 1000;
    let date = yyyymmdd_local(now);

    // V2 에만 추가로 필요할 법한 키 후보들
    let extras: [(&str, ScouterValue); 6] = [
        ("max", ScouterValue::Decimal(100)),
        ("limit", ScouterValue::Decimal(100)),
        ("count", ScouterValue::Decimal(100)),
        ("pageCount", ScouterValue::Decimal(100)),
        ("lastTxid", ScouterValue::Decimal(0)),
        ("lastXLogTime", ScouterValue::Decimal(0)),
    ];

    for (key, val) in extras {
        let mut c = login();
        let s = c.session;
        let mut p = MapPack::new();
        p.put("date", ScouterValue::Text(date.clone()));
        p.put("stime", ScouterValue::Decimal(from));
        p.put("etime", ScouterValue::Decimal(now));
        p.put(
            "objHash",
            ScouterValue::List(hashes.iter().map(|h| ScouterValue::Decimal(*h as i64)).collect()),
        );
        p.put(key, val);

        if c.send_request("TRANX_LOAD_TIME_GROUP_V2", s, &p).is_err() {
            continue;
        }
        let mut xlogs = 0usize;
        let mut meta = String::new();
        loop {
            match c.read_next_pack() {
                Ok(Some(AnyPack::XLog(_))) => xlogs += 1,
                Ok(Some(AnyPack::Map(m))) => {
                    let mut keys: Vec<&String> = m.entries.keys().collect();
                    keys.sort();
                    meta = keys
                        .iter()
                        .map(|k| format!("{k}={:?}", m.entries[*k]))
                        .collect::<Vec<_>>()
                        .join(" ");
                }
                Ok(Some(_)) => {}
                Ok(None) => break,
                Err(_) => break,
            }
        }
        println!("── +{key} → XLog {xlogs}건 · {meta}");
    }
}

/// 탐침 7: V2 의 **다음 페이지 지정 방식**을 찾는다.
///
/// 응답 키(`lastTxid`/`lastXLogTime`)를 요청에 그대로 넣으면 1페이지가 또 온다.
/// 시간 내림차순이면 `etime` 을 옮기는 방식일 수 있다.
#[test]
#[ignore]
fn probe_past_xlog_v2_next_page() {
    use nscouter_lib::scouter::past::{build_past_xlog_param, parse_past_cursor, PastCursor};

    let mut conn = login();
    let objs = fetch_objects(&mut conn);
    let hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let from = now - 10 * 60 * 1000;
    let date = yyyymmdd_local(now);

    // 1페이지
    let p1 = build_past_xlog_param(&hashes, &date, from, now, 100, &PastCursor::default());
    let s = conn.session;
    conn.send_request(CMD_TRANX_LOAD_TIME_GROUP_V2, s, &p1).unwrap();
    let mut first: Vec<i64> = Vec::new();
    let mut cur = PastCursor::default();
    while let Some(pack) = conn.read_next_pack().unwrap() {
        match pack {
            AnyPack::XLog(x) => first.push(x.txid),
            AnyPack::Map(m) => cur = parse_past_cursor(&m),
            _ => {}
        }
    }
    println!("1페이지 {}건, 커서 txid={} time={}", first.len(), cur.last_txid, cur.last_xlog_time);
    let set1: std::collections::HashSet<i64> = first.iter().copied().collect();

    // 후보별로 2페이지를 받아 겹침을 센다.
    let mut variants: Vec<(&str, MapPack)> = Vec::new();

    // (a) etime 을 lastXLogTime 으로 당긴다
    let mut a = MapPack::new();
    a.put("date", ScouterValue::Text(date.clone()));
    a.put("stime", ScouterValue::Decimal(from));
    a.put("etime", ScouterValue::Decimal(cur.last_xlog_time));
    a.put("pageCount", ScouterValue::Decimal(100));
    a.put("objHash", ScouterValue::List(hashes.iter().map(|h| ScouterValue::Decimal(*h as i64)).collect()));
    variants.push(("etime=lastXLogTime", a));

    // (b) etime 이동 + lastTxid 동반 (동시각 타이브레이크)
    let mut b = MapPack::new();
    b.put("date", ScouterValue::Text(date.clone()));
    b.put("stime", ScouterValue::Decimal(from));
    b.put("etime", ScouterValue::Decimal(cur.last_xlog_time));
    b.put("pageCount", ScouterValue::Decimal(100));
    b.put("lastTxid", ScouterValue::Decimal(cur.last_txid));
    b.put("objHash", ScouterValue::List(hashes.iter().map(|h| ScouterValue::Decimal(*h as i64)).collect()));
    variants.push(("etime 이동 + lastTxid", b));

    // (c) stime 을 lastXLogTime 으로 민다 (오름차순 가정)
    let mut c = MapPack::new();
    c.put("date", ScouterValue::Text(date.clone()));
    c.put("stime", ScouterValue::Decimal(cur.last_xlog_time));
    c.put("etime", ScouterValue::Decimal(now));
    c.put("pageCount", ScouterValue::Decimal(100));
    c.put("objHash", ScouterValue::List(hashes.iter().map(|h| ScouterValue::Decimal(*h as i64)).collect()));
    variants.push(("stime=lastXLogTime", c));

    // (d) stime 이동 + lastTxid — 같은 시각 타이브레이크가 이것인지 확인
    let mut d = MapPack::new();
    d.put("date", ScouterValue::Text(date.clone()));
    d.put("stime", ScouterValue::Decimal(cur.last_xlog_time));
    d.put("etime", ScouterValue::Decimal(now));
    d.put("pageCount", ScouterValue::Decimal(100));
    d.put("lastTxid", ScouterValue::Decimal(cur.last_txid));
    d.put("lastXLogTime", ScouterValue::Decimal(cur.last_xlog_time));
    d.put("objHash", ScouterValue::List(hashes.iter().map(|h| ScouterValue::Decimal(*h as i64)).collect()));
    variants.push(("stime 이동 + lastTxid/lastXLogTime", d));

    for (label, param) in variants {
        let mut cc = login();
        let s = cc.session;
        if cc.send_request(CMD_TRANX_LOAD_TIME_GROUP_V2, s, &param).is_err() {
            continue;
        }
        let mut rows: Vec<i64> = Vec::new();
        let mut next = PastCursor::default();
        while let Some(pack) = cc.read_next_pack().unwrap_or(None) {
            match pack {
                AnyPack::XLog(x) => rows.push(x.txid),
                AnyPack::Map(m) => next = parse_past_cursor(&m),
                _ => {}
            }
        }
        let overlap = rows.iter().filter(|t| set1.contains(t)).count();
        println!(
            "── {label}: {}건 · 겹침 {overlap} · hasMore={} nextTime={}",
            rows.len(), next.has_more, next.last_xlog_time
        );
    }
}

/// 탐침 4: 프로파일 Step 의 `index` 가 -1 로 나오는 경우를 찾는다.
///
/// `live_xlog_profile_steps` 가 **간헐적으로** "Step 1 의 index 가 -1" 로 깨진다.
/// 둘 중 하나다:
///   (a) 앞 Step 의 바이트 수를 잘못 읽어 이후가 밀린다 — 파서 버그
///   (b) 어떤 Step 종류는 index 를 안 채운다 — 테스트의 단정이 틀렸다
///
/// 이상이 **특정 Step 종류 뒤에서만** 나오면 (a) 다.
#[test]
#[ignore]
fn probe_profile_index_anomaly() {
    let mut conn = login();
    let objs = fetch_objects(&mut conn);
    let hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();

    let cursor = StreamCursor::default();
    let param = build_request_param(&hashes, &cursor);
    let session = conn.session;
    conn.send_request(CMD_TRANX_REAL_TIME_GROUP_LATEST, session, &param)
        .expect("XLog 요청 실패");

    let mut targets: Vec<(i64, i32, i64)> = Vec::new(); // (txid, objHash, endTime)
    while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
        if let AnyPack::XLog(x) = pack {
            targets.push((x.txid, x.obj_hash, x.end_time));
        }
    }
    println!("XLog {}건 확보", targets.len());

    let mut checked = 0;
    let mut anomalies = 0;
    for (txid, obj_hash, end_time) in targets.iter().take(60) {
        let mut p = MapPack::new();
        p.put("date", ScouterValue::Text(yyyymmdd_local(*end_time)));
        p.put("txid", ScouterValue::Decimal(*txid));
        p.put("objHash", ScouterValue::Decimal(*obj_hash as i64));
        let s = conn.session;
        if conn.send_request(CMD_TRANX_PROFILE, s, &p).is_err() {
            continue;
        }
        let mut steps = Vec::new();
        while let Ok(Some(pack)) = conn.read_next_pack() {
            if let AnyPack::Profile(pf) = pack {
                steps = pf.steps.clone();
            }
        }
        if steps.is_empty() {
            continue;
        }
        checked += 1;

        for (i, st) in steps.iter().enumerate() {
            let (_parent, index) = step_base(st);
            if index == -1 {
                anomalies += 1;
                let prev = if i > 0 { format!("{:?}", steps[i - 1]) } else { "(없음)".into() };
                println!("── txid={txid} step[{i}] index=-1");
                println!("   앞 Step: {}", &prev[..prev.len().min(150)]);
                let cur = format!("{st:?}");
                println!("   해당 Step: {}", &cur[..cur.len().min(150)]);
                break;
            }
        }
    }
    println!("=> 프로파일 {checked}건 검사, index=-1 발견 {anomalies}건");
}

/// 탐침 3: 스레드 덤프는 **2단계**다.
///
/// `OBJECT_THREAD_DUMP` 는 빈 리스트를 준다. 실제 덤프는
/// `TRIGGER_THREAD_DUMP` 가 **파일을 만들고 이름을 돌려주는** 방식이다.
/// 그 내용을 어떤 명령으로 가져오는지 확인한다.
#[test]
#[ignore]
fn probe_thread_dump_flow() {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_hash = objs[0].1;

    // 1단계: 덤프 생성
    let name = {
        let mut conn = login();
        let session = conn.session;
        let param = nscouter_lib::scouter::object::build_object_param(obj_hash);
        conn.send_request("TRIGGER_THREAD_DUMP", session, &param)
            .expect("덤프 생성 요청 실패");
        let mut n = String::new();
        while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
            if let AnyPack::Map(m) = pack {
                if let Some(v) = m.get_text("name") {
                    n = v.to_string();
                }
            }
        }
        n
    };
    println!("생성된 덤프 파일: {name:?}");
    assert!(!name.is_empty(), "덤프 파일 이름이 없다");

    // 2-a단계: 내용 조회는 MapPack 이 아니다 (팩 타입 0xFF). 원시 바이트로 본다.
    {
        let mut conn = login();
        let session = conn.session;
        let mut param = nscouter_lib::scouter::object::build_object_param(obj_hash);
        param.put("name", ScouterValue::Text(name.clone()));
        conn.send_request("OBJECT_DUMP_FILE_DETAIL", session, &param)
            .expect("요청 실패");

        println!("── OBJECT_DUMP_FILE_DETAIL 원시 덤프");
        let flag = conn.read_flag().unwrap_or(0);
        let pack_type = conn.read_byte().unwrap_or(0);
        let mut body = Vec::new();
        while body.len() < 300 {
            match conn.read_byte() {
                Ok(b) => body.push(b),
                Err(_) => break,
            }
        }
        let ascii: String = body
            .iter()
            .map(|&b| if (0x20..0x7f).contains(&b) { b as char } else { '.' })
            .collect();
        println!("   flag={flag} packType=0x{pack_type:02X} 본문 {}바이트", body.len());
        println!("   ascii: {ascii}");
        println!(
            "   hex  : {}\n",
            body.iter().take(48).map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(" ")
        );
    }

    // 2-b단계: 목록과 파라미터 후보를 돌려본다.
    for (cmd, key) in [
        ("OBJECT_DUMP_FILE_LIST", ""),
        ("OBJECT_DUMP_FILE_DETAIL", "file"),
    ] {
        let mut conn = login();
        let session = conn.session;
        let mut param = nscouter_lib::scouter::object::build_object_param(obj_hash);
        if !key.is_empty() {
            param.put(key, ScouterValue::Text(name.clone()));
        }
        conn.send_request(cmd, session, &param).expect("요청 실패");

        println!("── {cmd} (param={key:?})");
        let mut got = false;
        loop {
            match conn.read_next_pack() {
                Ok(Some(AnyPack::Map(m))) => {
                    got = true;
                    let mut keys: Vec<&String> = m.entries.keys().collect();
                    keys.sort();
                    for k in keys {
                        match &m.entries[k] {
                            ScouterValue::List(items) => {
                                let sample: Vec<String> =
                                    items.iter().take(3).map(|v| format!("{v:?}")).collect();
                                println!("   {k:<12} List({}) {}", items.len(), sample.join(", "));
                            }
                            other => {
                                let s = format!("{other:?}");
                                println!("   {k:<12} {}", &s[..s.len().min(160)]);
                            }
                        }
                    }
                }
                Ok(Some(_)) => got = true,
                Ok(None) => break,
                Err(e) => {
                    println!("   에러: {e}");
                    break;
                }
            }
        }
        if !got {
            println!("   빈 응답");
        }
        println!();
    }
}

/// N-6 검증: AlertPack 필드 순서·타입.
///
/// 알람이 없으면 검증할 수 없다. 오브젝트를 껐다 켜면 콜렉터가
/// INACTIVE_OBJECT / ACTIVATED_OBJECT 알람을 만든다:
///   podman stop order-app; podman start order-app
///
/// 주의: `objType` 파라미터를 주면 그 타입의 알람만 온다.
/// 오브젝트 생명주기 알람은 `objType=scouter` 라서 `tomcat` 으로 거르면 안 나온다.
#[test]
#[ignore]
fn live_alert_pack_fields() {
    let mut conn = login();
    let session = conn.session;
    conn.send_request(CMD_ALERT_REAL_TIME, session, &MapPack::new())
        .expect("알람 요청 실패");

    let mut alerts = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("알람 응답 파싱 실패") {
        if let AnyPack::Alert(a) = pack {
            println!(
                "  [alert] time={} level={} objType={} objHash={} title={:?}",
                a.time, a.level, a.obj_type, a.obj_hash, a.title
            );
            alerts.push(a);
        }
    }

    assert!(
        !alerts.is_empty(),
        "알람 0건. 오브젝트를 껐다 켜서 알람을 만들 것 (podman stop/start order-app)"
    );

    for a in &alerts {
        // time 은 epoch ms 다. readLong(8바이트 고정)으로 읽어야 한다.
        // readDecimal 로 읽으면 첫 바이트를 길이로 해석해 값이 붕괴한다.
        assert!(
            a.time > 1_600_000_000_000 && a.time < 4_000_000_000_000,
            "time={} 이 epoch ms 범위를 벗어났다 — readLong 이 아니라 readDecimal 로 읽고 있다",
            a.time
        );
        // objType 은 텍스트다. 순서가 어긋나면 UTF-8 깨진 문자열이 나온다.
        assert!(
            a.obj_type.is_ascii() && !a.obj_type.is_empty(),
            "objType={:?} 이 정상 텍스트가 아니다 — 필드 순서가 어긋났다",
            a.obj_type
        );
        assert!(!a.title.is_empty(), "title 이 비어 있다");
    }
    println!("=> 알람 {}건 정상 파싱", alerts.len());
}

/// N-9 검증: 알람도 커서(loop/index)를 이어받아야 한다.
///
/// 커서 없이 매번 빈 MapPack 을 보내면 **같은 알람이 폴링마다 다시 온다**.
/// 화면에는 중복이 무한히 쌓이고 알람 배지 숫자가 거짓이 된다.
#[test]
#[ignore]
fn live_alert_cursor_advances() {
    let mut conn = login();
    let session = conn.session;
    let mut cursor = StreamCursor::default();

    let poll = |conn: &mut ScouterConnection, cursor: &mut StreamCursor| -> usize {
        let param = nscouter_lib::scouter::alert::build_alert_param(cursor);
        conn.send_request(CMD_ALERT_REAL_TIME, session, &param)
            .expect("알람 요청 실패");
        let mut n = 0;
        while let Some(pack) = conn.read_next_pack().expect("알람 응답 파싱 실패") {
            match pack {
                AnyPack::Alert(_) => n += 1,
                AnyPack::Map(map) => cursor.update_from(&map),
                _ => {}
            }
        }
        n
    };

    let first = poll(&mut conn, &mut cursor);
    println!("1회차 알람 {first}건, 커서 loop={} index={}", cursor.loop_val, cursor.index);
    assert!(
        first > 0,
        "알람 0건. 오브젝트를 껐다 켜서 알람을 만들 것 (podman stop/start order-app)"
    );
    assert!(cursor.index > 0, "커서가 전진하지 않았다 — 응답 offset 을 못 읽고 있다");

    let second = poll(&mut conn, &mut cursor);
    println!("2회차 알람 {second}건 (커서 index={})", cursor.index);
    assert_eq!(
        second, 0,
        "커서를 이어받았는데 같은 알람이 또 왔다 — 중복 수신이 계속된다"
    );
}

/// N-12 검증: 프로파일 Step 파싱.
///
/// 실측(`Test/scripts/profile_check.py`) 결과 실제로 오는 타입은
/// METHOD(1) / HASHED_MESSAGE(9) / SQL3(16) / MESSAGE(3) / APICALL(6) 5종이다.
///
/// 한 Step 이라도 필드 수를 틀리면 **그 뒤 전부가 쓰레기**가 된다.
/// 그래서 "파싱 에러 없음"으로는 부족하고, 값이 말이 되는지까지 본다.
#[test]
#[ignore]
fn live_xlog_profile_steps() {
    use nscouter_lib::scouter::profile::ProfileStep;

    let mut conn = login();
    let objs = fetch_objects(&mut conn);
    assert!(!objs.is_empty(), "오브젝트가 없어 XLog 조회 불가");
    let hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();

    // 최신 XLog 확보
    let cursor = StreamCursor::default();
    let param = build_request_param(&hashes, &cursor);
    let session = conn.session;
    conn.send_request(CMD_TRANX_REAL_TIME_GROUP_LATEST, session, &param)
        .expect("XLog 요청 실패");

    let mut xlogs = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("XLog 수신 실패") {
        if let AnyPack::XLog(x) = pack {
            xlogs.push((x.txid, x.obj_hash, x.end_time));
        }
    }
    assert!(!xlogs.is_empty(), "XLog 0건 — load.ps1 로 부하를 걸 것");

    // 프로파일이 있는 XLog 를 찾을 때까지 몇 건 시도
    let mut total_steps = 0usize;
    let mut checked = 0usize;
    #[allow(unused_mut)]
    for (txid, obj_hash, end_time) in xlogs.iter().take(20) {
        let date = yyyymmdd_local(*end_time);
        let mut p = MapPack::new();
        p.put("date", ScouterValue::Text(date));
        p.put("txid", ScouterValue::Decimal(*txid));
        p.put("objHash", ScouterValue::Decimal(*obj_hash as i64));

        let session = conn.session;
        conn.send_request(CMD_TRANX_PROFILE, session, &p)
            .expect("프로파일 요청 실패");

        let mut steps = Vec::new();
        while let Some(pack) = conn.read_next_pack().expect("프로파일 응답 파싱 실패") {
            if let AnyPack::Profile(prof) = pack {
                steps.extend(prof.steps);
            }
        }
        if steps.is_empty() {
            continue;
        }
        checked += 1;
        total_steps += steps.len();

        // index 는 0 부터 1씩 증가한다. 어긋나면 앞 Step 의 필드 수가 틀린 것이다.
        for (i, s) in steps.iter().enumerate() {
            let (parent, index) = step_base(s);
            assert_eq!(
                index, i as i32,
                "Step {i} 의 index 가 {index} — 앞 Step 에서 바이트 수를 잘못 읽었다"
            );
            assert!(parent >= -1, "Step {i} 의 parent={parent} 가 비정상");
        }

        // `Unknown` 이 있는 것 자체는 정상이다.
        //
        // 진짜 미구현 타입은 `read_step` 이 **Err 로 끊는다** (본문 길이를 모르므로).
        // 따라서 목록에 남은 `Unknown` 은 본문을 정확히 소비한 종류(7/12/13/14)뿐이고,
        // 그 증거가 `base` 다 — base 가 없으면 read_step_base 를 안 거쳤다는 뜻이다.
        // (StepControl 99 만 예외로 base 가 없다.)
        for (i, s) in steps.iter().enumerate() {
            if let ProfileStep::Unknown { step_type, base } = s {
                assert!(
                    *step_type == 99 || base.is_some(),
                    "Step {i} (타입 {step_type}) 가 base 없이 Unknown 이다 — 본문을 안 읽었다"
                );
            }
        }

        if checked == 1 {
            println!("첫 프로파일: step {}개", steps.len());
            for s in steps.iter().take(6) {
                println!("  {s:?}");
            }
        }
        if checked >= 5 {
            break;
        }
    }

    assert!(checked > 0, "프로파일이 있는 XLog 를 못 찾았다 (날짜/타임존 확인)");
    println!("=> 프로파일 {checked}건, Step 총 {total_steps}개 정상 파싱");
}

/// N-16 검증: TRANX_PROFILE 응답의 `txid` / `time` / `objHash` 는 **0으로 온다**.
///
/// 콜렉터가 프로파일 blob 만 채우고 나머지 헤더 필드는 비운다.
/// 그래서 `pack.txid == 요청txid` 로 거르면 **모든 프로파일이 버려진다.**
/// ASIS `ProfileConsumer.retrieveProfilePack()` 도 txid 검사를 하지 않는다.
#[test]
#[ignore]
fn live_profile_pack_header_is_empty() {
    let mut conn = login();
    let objs = fetch_objects(&mut conn);
    assert!(!objs.is_empty(), "오브젝트가 없다");
    let hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();

    let cursor = StreamCursor::default();
    let param = build_request_param(&hashes, &cursor);
    let session = conn.session;
    conn.send_request(CMD_TRANX_REAL_TIME_GROUP_LATEST, session, &param)
        .expect("XLog 요청 실패");
    let mut xlogs = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("XLog 수신 실패") {
        if let AnyPack::XLog(x) = pack {
            xlogs.push((x.txid, x.obj_hash, x.end_time));
        }
    }
    assert!(!xlogs.is_empty(), "XLog 0건 — load.ps1 확인");

    for (txid, obj_hash, end_time) in xlogs.iter().take(20) {
        let mut p = MapPack::new();
        p.put("date", ScouterValue::Text(yyyymmdd_local(*end_time)));
        p.put("txid", ScouterValue::Decimal(*txid));
        p.put("objHash", ScouterValue::Decimal(*obj_hash as i64));

        let session = conn.session;
        conn.send_request(CMD_TRANX_PROFILE, session, &p)
            .expect("프로파일 요청 실패");

        while let Some(pack) = conn.read_next_pack().expect("프로파일 응답 파싱 실패") {
            if let AnyPack::Profile(prof) = pack {
                if prof.steps.is_empty() {
                    continue;
                }
                println!(
                    "요청 txid={txid} → 응답 txid={} (step {}개)",
                    prof.txid,
                    prof.steps.len()
                );
                assert_eq!(
                    prof.txid, 0,
                    "응답 txid 가 0이 아니다. 그렇다면 요청 txid 로 걸러도 되는지 재검토할 것"
                );
                return; // 1건 확인이면 충분
            }
        }
    }
    panic!("step 이 있는 프로파일을 못 찾았다 (날짜/타임존 확인)");
}

/// N-18 검증: 텍스트 딕셔너리 타입 키.
///
/// 해시를 사람이 읽는 문자열로 바꾸는 경로다. 타입 키가 틀리면
/// **에러 없이 빈 결과**가 와서 화면에 `[0x-17ebcaf0]` 같은 해시가 그대로 남는다.
///
/// ASIS `TextTypes` 기준 — `service` / `method` / `sql` / `apicall` / `error` / **`hmsg`**.
#[test]
#[ignore]
fn live_text_dictionary_types() {
    use nscouter_lib::scouter::dictionary::{fetch_texts, TextCache};

    let mut conn = login();
    let objs = fetch_objects(&mut conn);
    assert!(!objs.is_empty(), "오브젝트가 없다");
    let hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();

    // 실제 XLog 에서 service 해시를 얻는다.
    let cursor = StreamCursor::default();
    let param = build_request_param(&hashes, &cursor);
    let session = conn.session;
    conn.send_request(CMD_TRANX_REAL_TIME_GROUP_LATEST, session, &param)
        .expect("XLog 요청 실패");
    let mut services = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("XLog 수신 실패") {
        if let AnyPack::XLog(x) = pack {
            if x.service != 0 && !services.contains(&x.service) {
                services.push(x.service);
            }
        }
    }
    assert!(!services.is_empty(), "service 해시가 없다 — load.ps1 확인");
    services.truncate(5);

    let mut cache = TextCache::new();
    fetch_texts(&mut conn, &mut cache, "service", &services).expect("service 조회 실패");

    let resolved: Vec<&str> = services.iter().filter_map(|h| cache.get("service", *h)).collect();
    println!("service 해시 {}개 → 텍스트 {}개", services.len(), resolved.len());
    for t in &resolved {
        println!("   {t}");
    }
    assert!(
        !resolved.is_empty(),
        "service 타입으로 아무것도 못 풀었다. 타입 키가 맞는지 확인할 것"
    );
    // 서비스명은 URL 형태다. 해시가 그대로 오면 이 검사에 걸린다.
    assert!(
        resolved.iter().any(|t| t.contains('/')),
        "서비스명이 URL 형태가 아니다: {resolved:?}"
    );
}

/// XLog endTime → "yyyyMMdd" (로컬 타임존).
/// ASIS `DateUtil.yyyymmdd` 와 같은 기준이다.
fn yyyymmdd_local(end_time_ms: i64) -> String {
    use std::time::{Duration, UNIX_EPOCH};
    let secs = (end_time_ms / 1000) as u64;
    let dt: chrono::DateTime<chrono::Local> = (UNIX_EPOCH + Duration::from_secs(secs)).into();
    dt.format("%Y%m%d").to_string()
}

fn step_base(s: &nscouter_lib::scouter::profile::ProfileStep) -> (i32, i32) {
    use nscouter_lib::scouter::profile::ProfileStep as P;
    match s {
        P::Method(m) => (m.base.parent, m.base.index),
        P::Sql(q) => (q.base.parent, q.base.index),
        P::ApiCall(a) => (a.base.parent, a.base.index),
        P::Message(m) => (m.base.parent, m.base.index),
        P::Socket(k) => (k.base.parent, k.base.index),
        P::ThreadCall(t) => (t.base.parent, t.base.index),
        // Unknown 도 base 를 들고 있다. 여기서 (-1,-1) 로 뭉개면
        // **제대로 읽힌 Step 과 깨진 Step 이 구별되지 않아** 오진이 난다.
        P::Unknown { base, .. } => base
            .as_ref()
            .map(|b| (b.parent, b.index))
            .unwrap_or((-1, -1)),
    }
}

/// N-2 검증: count 파라미터가 있어야 XLog 가 실제로 온다.
/// 부하가 없으면 0건일 수 있으므로 Test/scripts/load.ps1 을 켠 상태에서 실행할 것.
#[test]
#[ignore]
fn live_xlog_stream() {
    let mut conn = login();
    let hashes = fetch_object_hashes(&mut conn);
    assert!(!hashes.is_empty(), "오브젝트가 없어 XLog 조회 불가");

    let mut cursor = StreamCursor::default();
    let param = build_request_param(&hashes, &cursor);
    let session = conn.session;
    conn.send_request(CMD_TRANX_REAL_TIME_GROUP_LATEST, session, &param)
        .expect("XLog 요청 실패");

    let mut xlogs = 0usize;
    while let Some(pack) = conn.read_next_pack().expect("XLog 응답 수신 실패") {
        match pack {
            AnyPack::XLog(_) => xlogs += 1,
            AnyPack::Map(map) => cursor.update_from(&map),
            _ => {}
        }
    }

    println!("=> XLog {xlogs}건, 커서 loop={} index={}", cursor.loop_val, cursor.index);
    assert!(
        xlogs > 0,
        "XLog 0건. count 파라미터 누락이거나 트래픽이 없다 (load.ps1 확인)"
    );

    // 커서를 이어받아 후속 폴링도 같은 연결에서 되는지 확인 (N-2 + N-3 동시 검증)
    let param2 = build_request_param(&hashes, &cursor);
    conn.send_request(CMD_TRANX_REAL_TIME_GROUP, session, &param2)
        .expect("후속 XLog 요청 실패");

    let mut xlogs2 = 0usize;
    while let Some(pack) = conn.read_next_pack().expect("후속 XLog 응답 수신 실패") {
        match pack {
            AnyPack::XLog(_) => xlogs2 += 1,
            AnyPack::Map(map) => cursor.update_from(&map),
            _ => {}
        }
    }
    println!("=> 후속 폴링 XLog {xlogs2}건 (커서 index={})", cursor.index);
}

/// 탐침: `XLOG_LOAD_BY_GXID` 의 파라미터 이름과 응답 모양.
///
/// ApiCall/Flow 뷰는 **하나의 분산 트랜잭션에 속한 XLog 전부**를 필요로 한다.
/// 이 커맨드가 그걸 준다 — 다만 이름이 틀리면 조용히 0건이므로(F-15) 먼저 본다.
///
/// order-app → shop-app 호출이 돌고 있어(`trace_interservice_enabled`)
/// caller != 0 인 XLog 가 실제로 존재한다.
#[test]
#[ignore]
fn probe_xlog_by_gxid() {
    use nscouter_lib::scouter::past::{build_past_xlog_param, PastCursor};

    // 1) 최근 10분에서 gxid != 0 인 트랜잭션을 하나 고른다.
    let mut conn = login();
    let hashes: Vec<i32> = fetch_objects(&mut conn).iter().map(|(_, h)| *h).collect();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let date = yyyymmdd_local(now);

    let param = build_past_xlog_param(&hashes, &date, now - 10 * 60 * 1000, now, 500, &PastCursor::default());
    let s = conn.session;
    conn.send_request(CMD_TRANX_LOAD_TIME_GROUP_V2, s, &param).expect("과거 XLog 요청 실패");

    let mut linked: Vec<(i64, i64, i64, i32)> = Vec::new(); // gxid, txid, caller, objHash
    while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
        if let AnyPack::XLog(x) = pack {
            if x.gxid != 0 {
                linked.push((x.gxid, x.txid, x.caller, x.obj_hash));
            }
        }
    }
    println!("gxid != 0 인 XLog {}건", linked.len());
    assert!(!linked.is_empty(), "분산 트랜잭션이 없다 — order-app 이 shop 을 부르고 있는지 확인");

    // 같은 gxid 가 2건 이상인 것을 고른다. 그래야 "연관 조회"가 의미 있다.
    let mut by_gxid: std::collections::HashMap<i64, Vec<(i64, i64, i32)>> = std::collections::HashMap::new();
    for (g, t, c, o) in &linked {
        by_gxid.entry(*g).or_default().push((*t, *c, *o));
    }
    let (gxid, members) = by_gxid
        .iter()
        .max_by_key(|(_, v)| v.len())
        .map(|(g, v)| (*g, v.clone()))
        .unwrap();
    println!("가장 많이 묶인 gxid={gxid} → 과거조회 안에서 {}건", members.len());
    for (t, c, o) in &members {
        println!("   txid={t} caller={c} objHash={o}");
    }

    // 2) 두 커맨드는 **읽는 키가 다르다** (콜렉터 2.21.3 XLogService 바이트코드 확인):
    //      XLOG_READ_BY_GXID  → getText("date"),  getLong("gxid")
    //      XLOG_LOAD_BY_GXID  → getLong("stime"), getLong("etime"), getLong("gxid")
    //                           날짜는 stime/etime 에서 유도한다. date 를 주면
    //                           stime=0 → 19700101 을 뒤져 **조용히 0건**이 된다 (F-15).
    let variants: [(&str, &str, Vec<(&str, ScouterValue)>); 3] = [
        (
            "READ: date+gxid",
            "XLOG_READ_BY_GXID",
            vec![("date", ScouterValue::Text(date.clone())), ("gxid", ScouterValue::Decimal(gxid))],
        ),
        (
            "LOAD: stime+etime+gxid",
            "XLOG_LOAD_BY_GXID",
            vec![
                ("stime", ScouterValue::Decimal(now - 10 * 60 * 1000)),
                ("etime", ScouterValue::Decimal(now)),
                ("gxid", ScouterValue::Decimal(gxid)),
            ],
        ),
        (
            "LOAD: date만 (틀린 예)",
            "XLOG_LOAD_BY_GXID",
            vec![("date", ScouterValue::Text(date.clone())), ("gxid", ScouterValue::Decimal(gxid))],
        ),
    ];

    for (label, cmd, keys) in variants {
        let mut c = login();
        let sess = c.session;
        let mut p = MapPack::new();
        for (k, v) in keys {
            p.put(k, v);
        }
        if c.send_request(cmd, sess, &p).is_err() {
            println!("── {label} → 요청 실패");
            continue;
        }
        let mut rows = Vec::new();
        let mut other = 0usize;
        loop {
            match c.read_next_pack() {
                Ok(Some(AnyPack::XLog(x))) => rows.push((x.txid, x.caller, x.gxid, x.obj_hash, x.elapsed)),
                Ok(Some(_)) => other += 1,
                Ok(None) => break,
                Err(e) => {
                    println!("── {label} → 수신 오류: {e}");
                    break;
                }
            }
        }
        println!("── {label} → XLog {}건 (기타 pack {other})", rows.len());
        for (t, cl, g, o, el) in rows.iter().take(10) {
            println!("     txid={t} caller={cl} gxid={g} objHash={o} elapsed={el}");
        }
    }
}

/// `XLOG_READ_BY_GXID` — 분산 트랜잭션 묶어 오기.
///
/// order-app 이 shop-app 을 부르므로 한 요청이 XLog 2건으로 남는다.
/// 목록에서는 남남으로 보이지만 gxid 가 같으면 한 요청이고, `caller` 가 부모의 `txid` 다.
#[test]
#[ignore]
fn live_xlog_by_gxid() {
    use nscouter_lib::scouter::past::{build_past_xlog_param, PastCursor};
    use nscouter_lib::scouter::trace::build_gxid_param;

    // 최근 10분에서 자식이 딸린(caller != 0) 트랜잭션을 하나 고른다.
    let mut conn = login();
    let hashes: Vec<i32> = fetch_objects(&mut conn).iter().map(|(_, h)| *h).collect();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let date = yyyymmdd_local(now);

    let param =
        build_past_xlog_param(&hashes, &date, now - 10 * 60 * 1000, now, 500, &PastCursor::default());
    let s = conn.session;
    conn.send_request(CMD_TRANX_LOAD_TIME_GROUP_V2, s, &param).expect("과거 XLog 요청 실패");

    // **아무 자식이나 집으면 안 된다.** caller != 0 인 XLog 에는 같은 앱 안의
    // 비동기/디스패치 트랜잭션도 섞여 있다. 앱 간 호출을 보려면 gxid 로 묶었을 때
    // objHash 가 둘 이상인 것을 골라야 한다.
    let mut by_gxid: std::collections::HashMap<i64, std::collections::HashSet<i32>> =
        std::collections::HashMap::new();
    while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
        if let AnyPack::XLog(x) = pack {
            if x.gxid != 0 {
                by_gxid.entry(x.gxid).or_default().insert(x.obj_hash);
            }
        }
    }
    let child_gxid = by_gxid
        .iter()
        .find(|(_, objs)| objs.len() >= 2)
        .map(|(g, _)| *g)
        .unwrap_or(0);
    assert_ne!(child_gxid, 0, "앱 간 분산 트랜잭션이 없다 — order-app 이 shop 을 부르는지 확인");

    // gxid 로 되짚어 오면 부모까지 함께 와야 한다.
    let mut c = login();
    let sess = c.session;
    c.send_request(CMD_XLOG_READ_BY_GXID, sess, &build_gxid_param(&date, child_gxid))
        .expect("연관 XLog 요청 실패");

    let mut rows = Vec::new();
    while let Some(pack) = c.read_next_pack().expect("연관 XLog 수신 실패") {
        if let AnyPack::XLog(x) = pack {
            rows.push(x);
        }
    }

    println!("gxid={child_gxid} → {}건", rows.len());
    for x in &rows {
        println!("   txid={} caller={} objHash={} elapsed={}", x.txid, x.caller, x.obj_hash, x.elapsed);
    }

    assert!(rows.len() >= 2, "자식만 왔다 — 부모를 못 찾으면 흐름을 못 그린다");
    for x in &rows {
        assert_eq!(x.gxid, child_gxid, "요청한 gxid 와 다른 트랜잭션이 섞였다");
    }

    // 부모-자식이 실제로 이어져야 한다. 안 이어지면 caller 를 잘못 읽은 것이다.
    let txids: std::collections::HashSet<i64> = rows.iter().map(|x| x.txid).collect();
    let linked = rows.iter().filter(|x| x.caller != 0 && txids.contains(&x.caller)).count();
    assert!(linked >= 1, "caller 로 이어지는 쌍이 없다 — 트리를 세울 수 없다");

    // 서로 다른 앱에 걸쳐 있어야 분산 트랜잭션이다.
    let objs: std::collections::HashSet<i32> = rows.iter().map(|x| x.obj_hash).collect();
    assert!(objs.len() >= 2, "같은 앱 안에서만 묶였다 — 앱 간 전파를 확인할 것");
}

/// 탐침: `TRANX_PROFILE_FULL` 이 `TRANX_PROFILE` 과 무엇이 다른가.
///
/// 바이트코드상 두 커맨드는 이렇게 다르다 (XLogService):
///
/// | | 읽는 키 | max | 응답 |
/// |---|---|---|---|
/// | `TRANX_PROFILE` | date · txid · gxid · xlogType · **max** | 요청값(없으면 0) | XLogProfilePack |
/// | `TRANX_PROFILE_FULL` | date · txid · gxid · xlogType | **-1 고정** | `[3][blob]` 청크 스트림 |
///
/// 같은 txid 로 둘 다 불러 스텝 수를 비교한다. **차이가 없으면 굳이 만들 이유가 없다.**
#[test]
#[ignore]
fn probe_full_profile() {
    use nscouter_lib::scouter::past::{build_past_xlog_param, PastCursor};
    use nscouter_lib::scouter::profile::parse_profile_steps;

    // 스텝이 많이 나올 만한 트랜잭션을 고른다 — 느린 것일수록 프로파일이 길다.
    let mut conn = login();
    let hashes: Vec<i32> = fetch_objects(&mut conn).iter().map(|(_, h)| *h).collect();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let date = yyyymmdd_local(now);

    let param =
        build_past_xlog_param(&hashes, &date, now - 10 * 60 * 1000, now, 500, &PastCursor::default());
    let s = conn.session;
    conn.send_request(CMD_TRANX_LOAD_TIME_GROUP_V2, s, &param).expect("과거 XLog 요청 실패");

    // **elapsed 가 긴 것을 고르면 안 된다.** 6초짜리는 대개 sleep 이라 스텝이 2개뿐이다.
    // 프로파일이 길 만한 것은 SQL·API 호출이 많은 트랜잭션이다.
    let mut best: Option<(i64, i32, i32)> = None; // txid, objHash, sql+api 건수
    while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
        if let AnyPack::XLog(x) = pack {
            let weight = x.sql_count + x.apicall_count;
            if best.map_or(true, |(_, _, w)| weight > w) {
                best = Some((x.txid, x.obj_hash, weight));
            }
        }
    }
    let (txid, obj_hash, weight) = best.expect("XLog 가 없다");
    println!("대상 txid={txid} objHash={obj_hash} sql+api={weight}건");

    // 1) 기존 경로 — XLogProfilePack
    let mut c = login();
    let sess = c.session;
    let mut p = MapPack::new();
    p.put("txid", ScouterValue::Decimal(txid));
    p.put("date", ScouterValue::Text(date.clone()));
    p.put("objHash", ScouterValue::Decimal(obj_hash as i64));
    c.send_request(CMD_TRANX_PROFILE, sess, &p).expect("프로파일 요청 실패");

    let mut normal = 0usize;
    while let Some(pack) = c.read_next_pack().expect("프로파일 수신 실패") {
        if let AnyPack::Profile(pp) = pack {
            normal += pp.steps.len();
        }
    }

    // 2) FULL — blob 청크 스트림이라 Pack 으로 읽으면 안 된다 (F-26 과 같은 모양)
    let mut c2 = login();
    let sess2 = c2.session;
    let mut p2 = MapPack::new();
    p2.put("date", ScouterValue::Text(date.clone()));
    p2.put("txid", ScouterValue::Decimal(txid));
    c2.send_request("TRANX_PROFILE_FULL", sess2, &p2).expect("FULL 프로파일 요청 실패");

    let blob = c2.read_blob_stream().expect("FULL 프로파일 수신 실패");
    let full = parse_profile_steps(blob.clone());

    println!("TRANX_PROFILE      → 스텝 {normal}개");
    println!("TRANX_PROFILE_FULL → {}바이트 · 스텝 {}개", blob.len(), full.len());

    // 종류별로 세어 본다. 스텝 수가 같아도 종류가 다를 수 있다.
    let mut kinds: std::collections::BTreeMap<&str, usize> = std::collections::BTreeMap::new();
    for st in &full {
        *kinds.entry(step_kind_name(st)).or_default() += 1;
    }
    println!("FULL 스텝 종류: {kinds:?}");
}

fn step_kind_name(s: &nscouter_lib::scouter::profile::ProfileStep) -> &'static str {
    use nscouter_lib::scouter::profile::ProfileStep as P;
    match s {
        P::Method(_) => "Method",
        P::Sql(_) => "Sql",
        P::ApiCall(_) => "ApiCall",
        P::Message(_) => "Message",
        P::Socket(_) => "Socket",
        P::ThreadCall(_) => "ThreadCall",
        P::Unknown { .. } => "Unknown",
    }
}

/// `TRANX_PROFILE_FULL` — 상한 없는 프로파일.
///
/// 상세 패널이 이 경로를 쓴다. 기존 `TRANX_PROFILE` 과 **결과가 같아야** 한다 —
/// 다르면 조용히 스텝을 잃거나 중복해서 세고 있다는 뜻이다.
///
/// 응답이 Pack 이 아니라 `[3][blob]` 청크 스트림이라 `read_next_pack` 으로 읽으면
/// 첫 바이트를 PackType 으로 오해한다 (F-26 과 같은 함정).
#[test]
#[ignore]
fn live_full_profile_matches_profile() {
    use nscouter_lib::scouter::past::{build_past_xlog_param, PastCursor};
    use nscouter_lib::scouter::profile::{build_full_profile_param, parse_profile_steps};

    // SQL·API 가 많은 트랜잭션이라야 비교에 의미가 있다.
    // elapsed 가 긴 것은 대개 sleep 이라 스텝이 2개뿐이다.
    let mut conn = login();
    let hashes: Vec<i32> = fetch_objects(&mut conn).iter().map(|(_, h)| *h).collect();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let date = yyyymmdd_local(now);

    let param =
        build_past_xlog_param(&hashes, &date, now - 10 * 60 * 1000, now, 500, &PastCursor::default());
    let s = conn.session;
    conn.send_request(CMD_TRANX_LOAD_TIME_GROUP_V2, s, &param).expect("과거 XLog 요청 실패");

    let mut best: Option<(i64, i32, i32)> = None;
    while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
        if let AnyPack::XLog(x) = pack {
            let weight = x.sql_count + x.apicall_count;
            if best.map_or(true, |(_, _, w)| weight > w) {
                best = Some((x.txid, x.obj_hash, weight));
            }
        }
    }
    let (txid, obj_hash, weight) = best.expect("XLog 가 없다");
    assert!(weight > 0, "SQL/API 가 있는 트랜잭션이 없다 — 부하가 도는지 확인");

    // 기존 경로
    let mut c = login();
    let sess = c.session;
    let mut p = MapPack::new();
    p.put("txid", ScouterValue::Decimal(txid));
    p.put("date", ScouterValue::Text(date.clone()));
    p.put("objHash", ScouterValue::Decimal(obj_hash as i64));
    c.send_request(CMD_TRANX_PROFILE, sess, &p).expect("프로파일 요청 실패");
    let mut normal = 0usize;
    while let Some(pack) = c.read_next_pack().expect("프로파일 수신 실패") {
        if let AnyPack::Profile(pp) = pack {
            normal += pp.steps.len();
        }
    }

    // FULL 경로
    let mut c2 = login();
    let sess2 = c2.session;
    c2.send_request(CMD_TRANX_PROFILE_FULL, sess2, &build_full_profile_param(&date, txid))
        .expect("FULL 프로파일 요청 실패");
    let blob = c2.read_blob_stream().expect("FULL 프로파일 수신 실패");
    let full = parse_profile_steps(blob);

    println!("txid={txid} sql+api={weight}건 · PROFILE {normal}개 / FULL {}개", full.len());
    assert!(!full.is_empty(), "FULL 이 0개다 — 파라미터나 응답 프레이밍이 틀렸다");
    assert_eq!(full.len(), normal, "두 경로의 스텝 수가 다르다");

    // 파싱이 끝까지 갔는지 본다. 중간에 깨지면 Unknown 이 base 없이 남는다.
    let broken = full
        .iter()
        .filter(|st| matches!(st, nscouter_lib::scouter::profile::ProfileStep::Unknown { base: None, step_type } if *step_type != 99))
        .count();
    assert_eq!(broken, 0, "본문을 못 읽은 Step 이 {broken}개 있다");
}

/// 흐름 그래프의 연결 고리: **부모 프로파일의 ApiCall 스텝 `txid` 가 자식 XLog 를 가리킨다.**
///
/// 이게 성립해야 XLogFlowView 가 "order-app 이 shop-app 을 불렀다"를 그릴 수 있다.
/// 안 가리키면 화면은 caller 로 대충 잇는 수준으로 조용히 내려앉는다.
#[test]
#[ignore]
fn live_flow_apicall_links_child_xlog() {
    use nscouter_lib::scouter::past::{build_past_xlog_param, PastCursor};
    use nscouter_lib::scouter::profile::{build_full_profile_param, parse_profile_steps, ProfileStep};
    use nscouter_lib::scouter::trace::build_gxid_param;

    // 앱 간 호출이 있는 gxid 를 고른다 (같은 앱 안의 비동기 디스패치는 제외).
    let mut conn = login();
    let hashes: Vec<i32> = fetch_objects(&mut conn).iter().map(|(_, h)| *h).collect();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let date = yyyymmdd_local(now);

    let param =
        build_past_xlog_param(&hashes, &date, now - 10 * 60 * 1000, now, 500, &PastCursor::default());
    let s = conn.session;
    conn.send_request(CMD_TRANX_LOAD_TIME_GROUP_V2, s, &param).expect("과거 XLog 요청 실패");

    let mut by_gxid: std::collections::HashMap<i64, std::collections::HashSet<i32>> =
        std::collections::HashMap::new();
    while let Some(pack) = conn.read_next_pack().expect("응답 수신 실패") {
        if let AnyPack::XLog(x) = pack {
            if x.gxid != 0 {
                by_gxid.entry(x.gxid).or_default().insert(x.obj_hash);
            }
        }
    }
    let gxid = by_gxid
        .iter()
        .find(|(_, objs)| objs.len() >= 2)
        .map(|(g, _)| *g)
        .expect("앱 간 분산 트랜잭션이 없다");

    // 그 트레이스의 XLog 전부
    let mut c = login();
    let sess = c.session;
    c.send_request(CMD_XLOG_READ_BY_GXID, sess, &build_gxid_param(&date, gxid))
        .expect("연관 XLog 요청 실패");
    let mut rows = Vec::new();
    while let Some(pack) = c.read_next_pack().expect("연관 XLog 수신 실패") {
        if let AnyPack::XLog(x) = pack {
            rows.push(x);
        }
    }
    assert!(rows.len() >= 2, "트레이스가 1건이다");

    let txids: std::collections::HashSet<i64> = rows.iter().map(|x| x.txid).collect();

    // 각 XLog 의 전체 프로파일에서 ApiCall 스텝의 txid 를 모은다.
    let mut linking = 0usize;
    let mut apicall_total = 0usize;
    for x in &rows {
        let mut cp = login();
        let cs = cp.session;
        cp.send_request(CMD_TRANX_PROFILE_FULL, cs, &build_full_profile_param(&date, x.txid))
            .expect("FULL 프로파일 요청 실패");
        let steps = parse_profile_steps(cp.read_blob_stream().expect("FULL 프로파일 수신 실패"));

        for st in &steps {
            if let ProfileStep::ApiCall(a) = st {
                apicall_total += 1;
                println!(
                    "   txid={} ApiCall(hash={}, txid={}, elapsed={}) → 자식 매칭 {}",
                    x.txid,
                    a.hash,
                    a.txid,
                    a.elapsed,
                    txids.contains(&a.txid)
                );
                if a.txid != 0 && a.txid != x.txid && txids.contains(&a.txid) {
                    linking += 1;
                }
            }
        }
    }

    println!("ApiCall 스텝 {apicall_total}개 중 자식 XLog 를 가리키는 것 {linking}개");
    assert!(apicall_total > 0, "ApiCall 스텝이 없다 — 앱 간 호출이 프로파일에 안 남았다");
    assert!(
        linking > 0,
        "ApiCall 의 txid 가 어떤 자식 XLog 도 가리키지 않는다 — 흐름을 이을 근거가 없다"
    );
}

/// 탐침: objType 우클릭 메뉴가 쓰는 커맨드들.
///
/// | 화면 | 커맨드 | 파라미터 |
/// |---|---|---|
/// | Vertical EQ | `ACTIVESPEED_REAL_TIME` | objType |
/// | ActiveSpeed | `ACTIVESPEED_REAL_TIME_GROUP` | objType |
/// | Service Group | `REALTIME_SERVICE_GROUP` | objType |
/// | Today Visitor | `VISITOR_REALTIME_TOTAL` | objType |
/// | Today Service Count | `COUNTER_TODAY_ALL` | counter, objType |
/// | (과거) | `COUNTER_PAST_DATE_ALL` | counter, date, objType |
///
/// **값이 안 오는 커맨드로 화면을 만들면 안 된다.** 무엇이 오는지 먼저 본다.
#[test]
#[ignore]
fn probe_objtype_menu_commands() {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_type = objs[0].0.clone();
    println!("대상 objType={obj_type} ({}개 오브젝트)", objs.len());

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let date = yyyymmdd_local(now);

    let cases: [(&str, Vec<(&str, ScouterValue)>); 6] = [
        ("ACTIVESPEED_REAL_TIME", vec![("objType", ScouterValue::Text(obj_type.clone()))]),
        ("ACTIVESPEED_REAL_TIME_GROUP", vec![("objType", ScouterValue::Text(obj_type.clone()))]),
        ("REALTIME_SERVICE_GROUP", vec![("objType", ScouterValue::Text(obj_type.clone()))]),
        ("VISITOR_REALTIME_TOTAL", vec![("objType", ScouterValue::Text(obj_type.clone()))]),
        (
            "COUNTER_TODAY_ALL",
            vec![
                ("counter", ScouterValue::Text("ServiceCount".into())),
                ("objType", ScouterValue::Text(obj_type.clone())),
            ],
        ),
        (
            "COUNTER_PAST_DATE_ALL",
            vec![
                ("counter", ScouterValue::Text("ServiceCount".into())),
                ("date", ScouterValue::Text(date.clone())),
                ("objType", ScouterValue::Text(obj_type.clone())),
            ],
        ),
    ];

    for (cmd, keys) in cases {
        let mut c = login();
        let sess = c.session;
        let mut p = MapPack::new();
        for (k, v) in keys {
            p.put(k, v);
        }
        if c.send_request(cmd, sess, &p).is_err() {
            println!("── {cmd} → 요청 실패");
            continue;
        }

        let mut packs = 0usize;
        let mut detail = Vec::new();
        loop {
            match c.read_next_pack() {
                Ok(Some(AnyPack::Map(m))) => {
                    packs += 1;
                    if detail.len() < 3 {
                        let mut keys: Vec<&String> = m.entries.keys().collect();
                        keys.sort();
                        detail.push(
                            keys.iter()
                                .map(|k| format!("{k}={:?}", m.entries[*k]))
                                .collect::<Vec<_>>()
                                .join(" "),
                        );
                    }
                }
                Ok(Some(other)) => {
                    packs += 1;
                    if detail.len() < 3 {
                        let kind = match other {
                            AnyPack::XLog(_) => "XLog",
                            AnyPack::Profile(_) => "Profile",
                            AnyPack::Object(_) => "Object",
                            AnyPack::PerfCounter(_) => "PerfCounter",
                            AnyPack::Alert(_) => "Alert",
                            AnyPack::Map(_) => "Map",
                            AnyPack::Interaction(_) => "Interaction",
                            AnyPack::Stack(_) => "Stack",
                        };
                        detail.push(format!("(MapPack 아님: {kind})"));
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    println!("── {cmd} → 수신 오류: {e}");
                    break;
                }
            }
        }
        println!("── {cmd} → pack {packs}개");
        for d in &detail {
            println!("     {d}");
        }
    }
}

/// objType 단위 조회 — 액티브 서비스 / 오늘 누적 / 방문자.
///
/// `VISITOR_REALTIME_TOTAL` 은 **Pack 이 아니라 Value 하나**다 (F-32).
/// Pack 으로 읽으면 Value 타입 바이트(DECIMAL=20)를 PackType 으로 오해해 멈춘다.
#[test]
#[ignore]
fn live_objtype_queries() {
    use nscouter_lib::scouter::objtype::{
        build_objtype_param, build_today_counter_param, parse_active_speed, parse_counter_series,
    };

    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_type = objs[0].0.clone();
    let obj_count = objs.len();
    println!("objType={obj_type} ({obj_count}개)");

    // 1) 타입 전체 합계 + TPS
    let mut c = login();
    let s = c.session;
    c.send_request(CMD_ACTIVESPEED_REAL_TIME_GROUP, s, &build_objtype_param(&obj_type))
        .expect("ACTIVESPEED GROUP 요청 실패");
    let mut group = None;
    while let Some(p) = c.read_next_pack().expect("수신 실패") {
        if let AnyPack::Map(m) = p {
            group = Some(parse_active_speed(&m));
        }
    }
    let group = group.expect("GROUP 응답이 없다 — objType 이 틀렸을 수 있다 (F-15)");
    println!("합계: act1={} act2={} act3={} tps={}", group.act1, group.act2, group.act3, group.tps);
    assert!(group.tps > 0.0, "TPS 가 0이다 — 부하가 도는지 확인 (load-gen)");

    // 2) 오브젝트별
    let mut c2 = login();
    let s2 = c2.session;
    c2.send_request(CMD_ACTIVESPEED_REAL_TIME, s2, &build_objtype_param(&obj_type))
        .expect("ACTIVESPEED 요청 실패");
    let mut per_obj = Vec::new();
    while let Some(p) = c2.read_next_pack().expect("수신 실패") {
        if let AnyPack::Map(m) = p {
            per_obj.push(parse_active_speed(&m));
        }
    }
    println!("오브젝트별 {}건", per_obj.len());
    assert_eq!(per_obj.len(), obj_count, "오브젝트 수와 응답 수가 다르다");
    for a in &per_obj {
        assert_ne!(a.obj_hash, 0, "오브젝트별 응답에는 objHash 가 있어야 한다");
    }

    // 3) 오늘 누적 카운터
    let mut c3 = login();
    let s3 = c3.session;
    c3.send_request(
        CMD_COUNTER_TODAY_ALL,
        s3,
        &build_today_counter_param("ServiceCount", &obj_type),
    )
    .expect("COUNTER_TODAY_ALL 요청 실패");
    let mut series = Vec::new();
    while let Some(p) = c3.read_next_pack().expect("수신 실패") {
        if let AnyPack::Map(m) = p {
            series.push(parse_counter_series(&m));
        }
    }
    println!("오늘 누적: 오브젝트 {}개", series.len());
    assert!(!series.is_empty(), "오늘 누적이 0건이다");
    for sr in &series {
        assert_eq!(sr.times.len(), sr.values.len(), "time/value 길이가 다르다");
        assert!(!sr.times.is_empty(), "objHash={} 의 시계열이 비었다", sr.obj_hash);
        println!("   objHash={} {}포인트", sr.obj_hash, sr.times.len());
    }

    // 4) 방문자 — Value 하나
    let mut c4 = login();
    let s4 = c4.session;
    c4.send_request(CMD_VISITOR_REALTIME_TOTAL, s4, &build_objtype_param(&obj_type))
        .expect("VISITOR 요청 실패");
    let v = c4.read_single_value().expect("방문자 수신 실패");
    let visitors = v.and_then(|v| v.as_decimal()).unwrap_or(-1);
    println!("오늘 방문자 {visitors}");
    assert!(visitors >= 0, "Value 로 읽지 못했다 — Pack 으로 읽으면 0x14 에서 멈춘다");
}

/// 탐침: 값이 **리스트**로 오는 카운터가 있는가.
///
/// ASIS `CounterRTAllPairChart` 는 `lv.get(0)`/`lv.get(1)` 을 총량·사용량으로 읽는다.
/// 즉 `HeapTotUsage` 같은 카운터는 스칼라가 아니라 2원소 리스트다.
///
/// 우리 `parse_counter_multi` 의 `as_f64` 는 리스트에 None 을 돌려주고,
/// `filter_map` 이 그 행을 **통째로 버린다.** 사실이면 해당 차트는 계속 비어 있었다는 뜻이다.
#[test]
#[ignore]
fn probe_pair_counters() {
    use nscouter_lib::scouter::counter::build_counter_multi_param;

    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();
    let obj_type = objs[0].0.clone();

    // 1) MULTI 로 받았을 때의 값 타입
    let mut c = login();
    let s = c.session;
    let counters = ["TPS", "HeapTotUsage", "FdUsage"];
    c.send_request(
        CMD_COUNTER_REAL_TIME_ALL_MULTI,
        s,
        &build_counter_multi_param(&hashes, &counters),
    )
    .expect("MULTI 요청 실패");

    while let Some(p) = c.read_next_pack().expect("수신 실패") {
        if let AnyPack::Map(m) = p {
            let names = m.entries.get("counter");
            let values = m.entries.get("value");
            if let (Some(ScouterValue::List(ns)), Some(ScouterValue::List(vs))) = (names, values) {
                for i in 0..ns.len().min(vs.len()) {
                    let kind = match &vs[i] {
                        ScouterValue::List(items) => format!("List({}원소) {:?}", items.len(), items),
                        other => format!("{other:?}"),
                    };
                    println!("   {} = {kind}", ns[i].as_text().unwrap_or("?"));
                }
            }
        }
    }

    // 2) objType 단위 ALL 응답 (ASIS pair 차트가 쓰는 경로)
    for counter in ["HeapTotUsage", "FdUsage"] {
        let mut c2 = login();
        let s2 = c2.session;
        let mut p = MapPack::new();
        p.put("objType", ScouterValue::Text(obj_type.clone()));
        p.put("counter", ScouterValue::Text(counter.to_string()));
        c2.send_request(CMD_COUNTER_REAL_TIME_ALL, s2, &p).expect("ALL 요청 실패");

        while let Some(pack) = c2.read_next_pack().expect("수신 실패") {
            if let AnyPack::Map(m) = pack {
                let v = m.entries.get("value");
                println!("── ALL {counter}: objHash={:?}", m.entries.get("objHash"));
                match v {
                    Some(ScouterValue::List(items)) => {
                        for (i, it) in items.iter().enumerate() {
                            println!("     [{i}] {it:?}");
                        }
                    }
                    other => println!("     {other:?}"),
                }
            }
        }
    }
}

/// 쌍으로 오는 카운터가 **버려지지 않는지** 확인한다.
///
/// `HeapTotUsage` = [총량, 사용량], `FdUsage` = [상한, 열린 수] 로 온다 (F-33).
/// 예전 `as_f64` 는 리스트에 None 을 돌려줬고 `filter_map` 이 행을 통째로 버려
/// 두 차트가 **조용히 빈 채로** 남아 있었다.
#[test]
#[ignore]
fn live_pair_counters_are_not_dropped() {
    use nscouter_lib::scouter::counter::{build_counter_multi_param, parse_counter_multi};

    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();

    let mut c = login();
    let s = c.session;
    let counters = ["TPS", "HeapTotUsage", "FdUsage"];
    c.send_request(
        CMD_COUNTER_REAL_TIME_ALL_MULTI,
        s,
        &build_counter_multi_param(&hashes, &counters),
    )
    .expect("MULTI 요청 실패");

    let mut rows = Vec::new();
    while let Some(p) = c.read_next_pack().expect("수신 실패") {
        if let AnyPack::Map(m) = p {
            rows.extend(parse_counter_multi(&m));
        }
    }

    for name in counters {
        let got: Vec<_> = rows.iter().filter(|r| r.counter == name).collect();
        println!("{name}: {}행", got.len());
        assert!(!got.is_empty(), "{name} 행이 하나도 없다 — 리스트 값을 버리고 있다");
        for r in &got {
            println!("   objHash={} value={} total={:?}", r.obj_hash, r.value, r.total);
        }
    }

    // 쌍 카운터는 총량이 있어야 하고, 사용량은 총량 이하여야 한다.
    for r in rows.iter().filter(|r| r.counter == "HeapTotUsage" || r.counter == "FdUsage") {
        let total = r.total.unwrap_or_else(|| panic!("{} 에 총량이 없다", r.counter));
        assert!(total > 0.0, "{} 총량이 0이다", r.counter);
        assert!(
            r.value <= total,
            "{}: 사용량 {} 이 총량 {} 보다 크다 — [0]/[1] 순서를 뒤집었다",
            r.counter,
            r.value,
            total
        );
    }

    // 스칼라 카운터에는 총량이 붙으면 안 된다.
    for r in rows.iter().filter(|r| r.counter == "TPS") {
        assert_eq!(r.total, None, "TPS 에 총량이 붙었다");
    }
}

/// 탐침: `OBJECT_ACTIVE_SERVICE_LIST` 에 **objType** 을 주면 타입 전체가 오는가.
///
/// ASIS `AgentDataProxy.getActiveThreadList(objType, objHash, ...)` 는 둘 다 보낸다.
/// 응답은 오브젝트당 MapPack 이고 `objHash` 와 `complete` 플래그가 함께 온다.
#[test]
#[ignore]
fn probe_active_service_by_objtype() {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_type = objs[0].0.clone();
    let first_hash = objs[0].1;
    println!("objType={obj_type}, 오브젝트 {}개", objs.len());

    let cases: [(&str, Vec<(&str, ScouterValue)>); 3] = [
        (
            "objType + objHash=0",
            vec![
                ("objType", ScouterValue::Text(obj_type.clone())),
                ("objHash", ScouterValue::Decimal(0)),
            ],
        ),
        ("objType 만", vec![("objType", ScouterValue::Text(obj_type.clone()))]),
        (
            "objType + 특정 objHash",
            vec![
                ("objType", ScouterValue::Text(obj_type.clone())),
                ("objHash", ScouterValue::Decimal(first_hash as i64)),
            ],
        ),
    ];

    for (label, keys) in cases {
        let mut c = login();
        let s = c.session;
        let mut p = MapPack::new();
        for (k, v) in keys {
            p.put(k, v);
        }
        if c.send_request(CMD_OBJECT_ACTIVE_SERVICE_LIST, s, &p).is_err() {
            println!("── {label} → 요청 실패");
            continue;
        }

        let mut packs = 0usize;
        let mut rows = 0usize;
        let mut detail = Vec::new();
        loop {
            match c.read_next_pack() {
                Ok(Some(AnyPack::Map(m))) => {
                    packs += 1;
                    let n = match m.entries.get("id") {
                        Some(ScouterValue::List(v)) => v.len(),
                        _ => 0,
                    };
                    rows += n;
                    detail.push(format!(
                        "objHash={:?} complete={:?} {n}행",
                        m.entries.get("objHash"),
                        m.entries.get("complete")
                    ));
                }
                Ok(Some(_)) => packs += 1,
                Ok(None) => break,
                Err(e) => {
                    println!("── {label} → 오류: {e}");
                    break;
                }
            }
        }
        println!("── {label} → pack {packs}개 · 총 {rows}행");
        for d in detail.iter().take(4) {
            println!("     {d}");
        }
    }
}

/// 타입 전체 액티브 서비스 — **요청 한 번**으로 그 타입의 모든 오브젝트를 받는다 (F-34).
///
/// 오브젝트마다 따로 부르면 F-1(연결당 명령 1개) 때문에 연결이 오브젝트 수만큼 열린다.
#[test]
#[ignore]
fn live_type_active_services() {
    use nscouter_lib::scouter::object::parse_active_services;
    use nscouter_lib::scouter::objtype::{build_active_service_param, is_complete};

    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_type = objs[0].0.clone();
    let known: std::collections::HashSet<i32> = objs.iter().map(|(_, h)| *h).collect();

    let mut c = login();
    let s = c.session;
    c.send_request(
        CMD_OBJECT_ACTIVE_SERVICE_LIST,
        s,
        &build_active_service_param(&obj_type, None),
    )
    .expect("액티브 서비스 요청 실패");

    let mut packs = 0usize;
    let mut rows = Vec::new();
    let mut incomplete = Vec::new();
    while let Some(p) = c.read_next_pack().expect("수신 실패") {
        if let AnyPack::Map(m) = p {
            packs += 1;
            if !is_complete(&m) {
                incomplete.push(m.get_decimal("objHash").unwrap_or(0) as i32);
            }
            rows.extend(parse_active_services(&m));
        }
    }

    println!("pack {packs}개 · {}행 · 미완 {}개", rows.len(), incomplete.len());
    assert_eq!(packs, objs.len(), "오브젝트 수만큼 pack 이 오지 않았다");

    for r in &rows {
        println!(
            "   objHash={} elapsed={}ms service={} sql={}",
            r.obj_hash, r.elapsed, r.service, r.sql
        );
        // 행마다 어느 오브젝트인지 붙어야 타입 전체 목록이 의미를 갖는다.
        assert!(
            known.contains(&r.obj_hash),
            "objHash={} 가 오브젝트 목록에 없다 — pack 의 objHash 를 못 읽었다",
            r.obj_hash
        );
    }
}

/// 탐침: 오브젝트 우클릭의 **부수효과 명령**들.
///
/// | 명령 | 파라미터 | 무엇을 하나 |
/// |---|---|---|
/// | `OBJECT_SYSTEM_GC` | objHash | 에이전트 JVM 에 Full GC 를 시킨다 |
/// | `OBJECT_RESET_CACHE` | objHash | 에이전트의 텍스트 캐시를 비운다 |
/// | `PSTACK_ON` | objHash, time | 스택 샘플링을 켠다 (time ms 동안) |
/// | `TRIGGER_ACTIVE_SERVICE_LIST` | objHash | 액티브 목록을 **파일로** 남긴다 |
/// | `TRIGGER_THREAD_LIST` | objHash | 스레드 목록을 파일로 |
/// | `TRIGGER_HEAPHISTO` | objHash | 힙 히스토그램을 파일로 |
/// | `OBJECT_CALL_HEAP_DUMP` | objHash | 힙 덤프 (예전에 빈 응답이었다) |
///
/// **테스트 컨테이너 대상이다.** 운영에 쏘면 안 되는 것들이 섞여 있다.
#[test]
#[ignore]
fn probe_object_side_effect_commands() {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_hash = objs[0].1;
    println!("대상 objHash={obj_hash}");

    let cases: [(&str, Vec<(&str, ScouterValue)>); 7] = [
        ("OBJECT_RESET_CACHE", vec![("objHash", ScouterValue::Decimal(obj_hash as i64))]),
        ("OBJECT_SYSTEM_GC", vec![("objHash", ScouterValue::Decimal(obj_hash as i64))]),
        (
            "PSTACK_ON",
            vec![
                ("objHash", ScouterValue::Decimal(obj_hash as i64)),
                ("time", ScouterValue::Decimal(5 * 60 * 1000)),
            ],
        ),
        ("TRIGGER_ACTIVE_SERVICE_LIST", vec![("objHash", ScouterValue::Decimal(obj_hash as i64))]),
        ("TRIGGER_THREAD_LIST", vec![("objHash", ScouterValue::Decimal(obj_hash as i64))]),
        ("TRIGGER_HEAPHISTO", vec![("objHash", ScouterValue::Decimal(obj_hash as i64))]),
        // **objHash 만으로는 빈 응답이었다.** ASIS HeapDumpAction 은 fName·time 을 함께 보낸다.
        (
            "OBJECT_CALL_HEAP_DUMP",
            vec![
                ("objHash", ScouterValue::Decimal(obj_hash as i64)),
                ("fName", ScouterValue::Text(obj_hash.to_string())),
                (
                    "time",
                    ScouterValue::Decimal(
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as i64,
                    ),
                ),
            ],
        ),
    ];

    for (cmd, keys) in cases {
        let mut c = login();
        let sess = c.session;
        let mut p = MapPack::new();
        for (k, v) in keys {
            p.put(k, v);
        }
        if c.send_request(cmd, sess, &p).is_err() {
            println!("── {cmd} → 요청 실패");
            continue;
        }

        let mut packs = 0usize;
        let mut detail = Vec::new();
        loop {
            match c.read_next_pack() {
                Ok(Some(AnyPack::Map(m))) => {
                    packs += 1;
                    let mut ks: Vec<&String> = m.entries.keys().collect();
                    ks.sort();
                    detail.push(
                        ks.iter()
                            .map(|k| {
                                let v = format!("{:?}", m.entries[*k]);
                                format!("{k}={}", v.chars().take(70).collect::<String>())
                            })
                            .collect::<Vec<_>>()
                            .join(" "),
                    );
                }
                Ok(Some(_)) => packs += 1,
                Ok(None) => break,
                Err(e) => {
                    println!("── {cmd} → 수신 오류: {e}");
                    break;
                }
            }
        }
        println!("── {cmd} → pack {packs}개");
        for d in detail.iter().take(2) {
            println!("     {d}");
        }
    }
}

/// 오브젝트 부수효과 명령 — 파라미터가 맞아야 실제로 동작한다.
///
/// **테스트 컨테이너 대상이다.** GC 와 힙 덤프가 섞여 있다.
#[test]
#[ignore]
fn live_object_side_effects() {
    use nscouter_lib::scouter::object::{build_heap_dump_param, build_object_param, build_pstack_param};

    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_hash = objs[0].1;

    // 1) 덤프 4종.
    //
    // **간헐적으로 빈 MapPack 이 온다** (F-35). 액티브 건수와도, 직전 덤프와도
    // 무관했고 초반 회차에서 주로 비었다. 그래서 "매번 성공"을 요구하지 않는다 —
    // 요구할 것은 두 가지다: 몇 번 안에 한 번은 되고, 이름이 오면 그 종류가 맞을 것.
    for (cmd, tag) in [
        (CMD_TRIGGER_THREAD_DUMP, "threaddump"),
        (CMD_TRIGGER_ACTIVE_SERVICE_LIST, "activeservice"),
        (CMD_TRIGGER_THREAD_LIST, "threads"),
        (CMD_TRIGGER_HEAPHISTO, "heaphisto"),
    ] {
        let mut got = String::new();
        for attempt in 1..=3 {
            let mut c = login();
            let s = c.session;
            c.send_request(cmd, s, &build_object_param(obj_hash)).expect("덤프 요청 실패");

            let mut name = String::new();
            while let Some(p) = c.read_next_pack().expect("수신 실패") {
                if let AnyPack::Map(m) = p {
                    name = m.get_text("name").unwrap_or("").to_string();
                }
            }
            println!("{cmd} {attempt}차 → {}", if name.is_empty() { "(빈 응답)" } else { &name });
            if !name.is_empty() {
                got = name;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }

        assert!(!got.is_empty(), "{cmd} 가 3번 모두 빈 응답이다 — 명령이 동작하지 않는다");
        assert!(
            got.contains(tag),
            "{cmd} 의 파일명({got})에 {tag} 가 없다 — 다른 덤프를 뜬 것일 수 있다"
        );
    }

    // 2) 스택 샘플링 — 켤 때만 time 이 붙는다
    for (label, dur) in [("켜기", Some(5 * 60 * 1000i64)), ("끄기", None)] {
        let mut c = login();
        let s = c.session;
        c.send_request(CMD_PSTACK_ON, s, &build_pstack_param(obj_hash, dur))
            .expect("PSTACK 요청 실패");
        let mut echoed = None;
        while let Some(p) = c.read_next_pack().expect("수신 실패") {
            if let AnyPack::Map(m) = p {
                echoed = Some(m.get_decimal("time").unwrap_or(-1));
            }
        }
        println!("PSTACK {label} → time={echoed:?}");
    }

    // 3) 응답이 없는 명령 — **에러가 아니라 그냥 비어 있다** (F-35)
    for cmd in [CMD_OBJECT_RESET_CACHE, CMD_OBJECT_SYSTEM_GC] {
        let mut c = login();
        let s = c.session;
        c.send_request(cmd, s, &build_object_param(obj_hash)).expect("요청 실패");
        let mut packs = 0;
        while c.read_next_pack().expect("수신 실패").is_some() {
            packs += 1;
        }
        println!("{cmd} → pack {packs}개");
        assert_eq!(packs, 0, "{cmd} 가 응답을 준다 — 결과를 읽어야 할 수도 있다");
    }

    // 4) 힙 덤프 — **fName/time 이 없으면 조용히 빈 응답이다**
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let mut bare = login();
    let bs = bare.session;
    bare.send_request(CMD_OBJECT_CALL_HEAP_DUMP, bs, &build_object_param(obj_hash))
        .expect("요청 실패");
    // **덤프 직후에는 침묵이 아니라 제한 안내가 온다.** 이 테스트가 앞에서 덤프를 네 번
    // 떴으므로 에이전트의 10초 제한에 걸린다 — 그때는 빈 응답 대신 메시지 팩이 온다.
    // F-35 의 근거는 "응답이 없다"가 아니라 **"파일명이 안 온다"** 이므로 그걸 확인한다.
    let mut bare_name: Option<String> = None;
    let mut bare_packs = 0;
    while let Some(pack) = bare.read_next_pack().expect("수신 실패") {
        bare_packs += 1;
        if let AnyPack::Map(m) = pack {
            // 성공했다면 파일명이 담긴다. 제한 안내에는 없다.
            if let Some(n) = m.get_text("fileName").or_else(|| m.get_text("fName")) {
                bare_name = Some(n.to_string());
            }
        }
    }
    println!("bare 힙덤프: {bare_packs}팩, 파일명={bare_name:?}");
    assert_eq!(
        bare_name, None,
        "fName/time 없이도 덤프 파일이 만들어졌다 — F-35 의 근거가 바뀌었다"
    );

    let mut c = login();
    let s = c.session;
    c.send_request(
        CMD_OBJECT_CALL_HEAP_DUMP,
        s,
        &build_heap_dump_param(obj_hash, &obj_hash.to_string(), now),
    )
    .expect("힙 덤프 요청 실패");

    let mut ok = false;
    let mut msg = String::new();
    while let Some(p) = c.read_next_pack().expect("수신 실패") {
        if let AnyPack::Map(m) = p {
            ok = matches!(
                m.entries.get("success"),
                Some(nscouter_lib::scouter::value::ScouterValue::Boolean(true))
            );
            msg = m.get_text("msg").unwrap_or("").to_string();
        }
    }
    println!("힙 덤프 → success={ok} msg={msg}");
    // 에이전트가 **10초에 한 번**으로 막는다 (F-35). 직전 요청이 있었으면
    // `success=false` 에 그 이유가 실려 온다 — 이것도 명령이 살아 있다는 증거다.
    // 빈 응답(파라미터 누락)과는 분명히 다르다.
    assert!(
        ok || msg.contains("wait"),
        "힙 덤프가 이유 없이 실패했다: {msg}"
    );
}

/// 탐침: `TRIGGER_ACTIVE_SERVICE_LIST` 는 **액티브가 있을 때만** 파일을 만드는가.
///
/// 같은 명령이 어떤 때는 파일명을, 어떤 때는 빈 MapPack 을 돌려줬다.
/// 실행 중인 트랜잭션 수와 함께 여러 번 재 본다.
#[test]
#[ignore]
fn probe_trigger_active_service_condition() {
    use nscouter_lib::scouter::object::{build_object_param, parse_active_services};

    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_hash = objs[0].1;

    for round in 1..=6 {
        // 지금 몇 건이 돌고 있나
        let mut c = login();
        let s = c.session;
        c.send_request(CMD_OBJECT_ACTIVE_SERVICE_LIST, s, &build_object_param(obj_hash))
            .expect("액티브 조회 실패");
        let mut active = 0usize;
        while let Some(p) = c.read_next_pack().expect("수신 실패") {
            if let AnyPack::Map(m) = p {
                active += parse_active_services(&m).len();
            }
        }

        // 바로 이어서 파일 생성 요청
        let mut c2 = login();
        let s2 = c2.session;
        c2.send_request(CMD_TRIGGER_ACTIVE_SERVICE_LIST, s2, &build_object_param(obj_hash))
            .expect("트리거 실패");
        let mut name = String::new();
        let mut keys = 0usize;
        while let Some(p) = c2.read_next_pack().expect("수신 실패") {
            if let AnyPack::Map(m) = p {
                keys = m.entries.len();
                name = m.get_text("name").unwrap_or("").to_string();
            }
        }

        println!(
            "{round}회차: 액티브 {active}건 → 응답 키 {keys}개 name={:?}",
            if name.is_empty() { "(없음)" } else { &name }
        );

        // 다른 덤프 **직후**에도 되는지. 처음 실패했을 때가 이 상황이었다.
        let mut c3 = login();
        let s3 = c3.session;
        c3.send_request(CMD_TRIGGER_THREAD_DUMP, s3, &build_object_param(obj_hash))
            .expect("스레드 덤프 실패");
        while c3.read_next_pack().expect("수신 실패").is_some() {}

        let mut c4 = login();
        let s4 = c4.session;
        c4.send_request(CMD_TRIGGER_ACTIVE_SERVICE_LIST, s4, &build_object_param(obj_hash))
            .expect("트리거 실패");
        let mut after = String::new();
        while let Some(p) = c4.read_next_pack().expect("수신 실패") {
            if let AnyPack::Map(m) = p {
                after = m.get_text("name").unwrap_or("").to_string();
            }
        }
        println!(
            "         스레드덤프 직후 → name={}",
            if after.is_empty() { "(없음)" } else { &after }
        );

        std::thread::sleep(std::time::Duration::from_millis(700));
    }
}

/// 탐침: 오늘 누적 `ServiceCount` 의 실제 값.
///
/// 화면이 "오늘 서비스 호출 0" 을 보여줬다. 스파크라인은 모양이 있는데 합이 0이면
/// 둘 중 하나가 거짓말이다 — 값을 직접 본다.
#[test]
#[ignore]
fn probe_today_service_count_values() {
    use nscouter_lib::scouter::objtype::{build_today_counter_param, parse_counter_series};

    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_type = objs[0].0.clone();

    for counter in ["ServiceCount", "TPS"] {
        let mut c = login();
        let s = c.session;
        c.send_request(
            CMD_COUNTER_TODAY_ALL,
            s,
            &build_today_counter_param(counter, &obj_type),
        )
        .expect("요청 실패");

        while let Some(p) = c.read_next_pack().expect("수신 실패") {
            if let AnyPack::Map(m) = p {
                let sr = parse_counter_series(&m);
                let sum: f32 = sr.values.iter().sum();
                let nonzero = sr.values.iter().filter(|v| **v != 0.0).count();
                let max = sr.values.iter().cloned().fold(f32::MIN, f32::max);
                println!(
                    "{counter} objHash={} 포인트={} 0이_아닌값={} 합={} 최대={}",
                    sr.obj_hash,
                    sr.values.len(),
                    nonzero,
                    sum,
                    max
                );
                let tail: Vec<String> = sr
                    .values
                    .iter()
                    .rev()
                    .take(8)
                    .map(|v| format!("{v:.1}"))
                    .collect();
                println!("   마지막 8개(역순): {}", tail.join(", "));
            }
        }
    }
}

/// `ThreadCallPossibleStep(14)` 이 실제 프로파일에 있고 **txid 를 들고 오는가**.
///
/// 그 txid 가 있어야 "이 스레드로 이어진 작업" 프로파일을 열 수 있다
/// (ASIS XLogThreadProfileView). 예전에는 본문만 소비하고 값을 버렸다.
#[test]
#[ignore]
fn live_thread_call_steps() {
    use nscouter_lib::scouter::past::{build_past_xlog_param, PastCursor};
    use nscouter_lib::scouter::profile::{build_full_profile_param, parse_profile_steps, ProfileStep};

    let mut conn = login();
    let hashes: Vec<i32> = fetch_objects(&mut conn).iter().map(|(_, h)| *h).collect();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let date = yyyymmdd_local(now);

    let param =
        build_past_xlog_param(&hashes, &date, now - 10 * 60 * 1000, now, 200, &PastCursor::default());
    let s = conn.session;
    conn.send_request(CMD_TRANX_LOAD_TIME_GROUP_V2, s, &param).expect("과거 XLog 요청 실패");

    let mut txids = Vec::new();
    while let Some(p) = conn.read_next_pack().expect("수신 실패") {
        if let AnyPack::XLog(x) = p {
            txids.push(x.txid);
        }
    }
    assert!(!txids.is_empty(), "트랜잭션이 없다");

    let mut found = 0usize;
    let mut threaded = 0usize;
    // 앞 80건만 보면 그 구간이 통째로 한 앱 것일 때 0건이 나온다 — 실제로 그렇게 헛돌았다.
    // 충분히 모이면 그때 끊는다 (F-48).
    for txid in txids.iter() {
        if found >= 5 {
            break;
        }
        let mut c = login();
        let cs = c.session;
        if c
            .send_request(CMD_TRANX_PROFILE_FULL, cs, &build_full_profile_param(&date, *txid))
            .is_err()
        {
            continue;
        }
        let blob = match c.read_blob_stream() {
            Ok(b) => b,
            Err(_) => continue,
        };

        for st in parse_profile_steps(blob) {
            if let ProfileStep::ThreadCall(t) = st {
                found += 1;
                if t.threaded {
                    threaded += 1;
                }
                if found <= 6 {
                    println!(
                        "   txid={} hash={} elapsed={} threaded={}",
                        t.txid, t.hash, t.elapsed, t.threaded
                    );
                }
            }
        }
    }

    println!("ThreadCall 스텝 {found}개 (실제 스레드 {threaded}개)");
    assert!(found > 0, "ThreadCall 스텝이 하나도 없다 — 파싱이 Unknown 으로 빠지고 있다");
}

/// 설정 조회 커맨드 정찰.
///
/// 콜렉터 바이트코드(`ConfigureService`)에서 읽은 사실:
///   - `GET_CONFIGURE_SERVER` / `LIST_CONFIGURE_SERVER` — 파라미터 없음. 콜렉터가 직접 답한다.
///   - `GET_CONFIGURE_WAS` / `LIST_CONFIGURE_WAS` — `objHash`(int) 로 **에이전트에 되물어본다**.
///     에이전트가 없거나 답이 null 이면 **아무것도 안 쓴다** — 빈 응답이 곧 실패다.
///
/// 응답 키 이름은 에이전트가 정하므로 여기서 실측해야 한다.
#[test]
#[ignore]
fn probe_configure_commands() {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_hash = objs.first().map(|(_, h)| *h).expect("javaee 오브젝트가 없다");
    println!("대상 objHash={obj_hash}");

    let cases: [(&str, bool); 4] = [
        ("GET_CONFIGURE_SERVER", false),
        ("LIST_CONFIGURE_SERVER", false),
        ("GET_CONFIGURE_WAS", true),
        ("LIST_CONFIGURE_WAS", true),
    ];

    for (cmd, needs_hash) in cases {
        let mut c = login();
        let sess = c.session;
        let mut p = MapPack::new();
        if needs_hash {
            p.put("objHash", ScouterValue::Decimal(obj_hash as i64));
        }
        if c.send_request(cmd, sess, &p).is_err() {
            println!("── {cmd} → 요청 실패");
            continue;
        }

        let mut packs = 0usize;
        loop {
            match c.read_next_pack() {
                Ok(Some(AnyPack::Map(m))) => {
                    packs += 1;
                    let mut keys: Vec<&String> = m.entries.keys().collect();
                    keys.sort();
                    println!("── {cmd} → MapPack");
                    for k in keys {
                        println!("     {k} = {}", describe(&m.entries[k]));
                    }
                }
                Ok(Some(_)) => packs += 1,
                Ok(None) => break,
                Err(e) => {
                    println!("── {cmd} → 수신 오류: {e}");
                    break;
                }
            }
        }
        if packs == 0 {
            println!("── {cmd} → 응답 없음");
        }
    }
}

/// 값을 통째로 찍으면 설정 파일 전문이 쏟아진다. 형태와 크기만 본다.
fn describe(v: &ScouterValue) -> String {
    match v {
        ScouterValue::Text(s) => {
            let head: String = s.chars().take(60).collect();
            format!("Text({}자) {head:?}", s.chars().count())
        }
        ScouterValue::Blob(b) => format!("Blob({}바이트)", b.len()),
        ScouterValue::List(items) => {
            let head: Vec<String> = items.iter().take(5).map(|i| format!("{i:?}")).collect();
            format!("List({}개) {}", items.len(), head.join(", "))
        }
        other => format!("{other:?}"),
    }
}

/// 에이전트 설정 조회 — 원문과 표가 둘 다 와야 한다.
///
/// **표가 비면 화면은 "설정 없음"으로 보인다.** 에이전트가 답하지 않아도
/// 콜렉터는 오류 대신 빈 응답을 주므로(F-37), 0건을 성공으로 넘기면
/// 고장이 조용히 지나간다.
#[test]
#[ignore]
fn live_agent_config() {
    let obj_hash = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
            .first()
            .map(|(_, h)| *h)
            .expect("javaee 오브젝트가 없다")
    };

    let text = {
        let mut c = login();
        let sess = c.session;
        c.send_request(CMD_GET_CONFIGURE_WAS, sess, &build_object_param(obj_hash))
            .expect("에이전트 설정 원문 요청 실패");
        first_map(&mut c).map(|m| parse_config_text(&m)).unwrap_or_default()
    };

    let entries = {
        let mut c = login();
        let sess = c.session;
        c.send_request(CMD_LIST_CONFIGURE_WAS, sess, &build_object_param(obj_hash))
            .expect("에이전트 설정 목록 요청 실패");
        first_map(&mut c).map(|m| parse_config_entries(&m)).unwrap_or_default()
    };

    println!("에이전트 설정: 원문 {}자, 항목 {}개", text.chars().count(), entries.len());
    assert!(!text.is_empty(), "설정 원문이 비었다 — 에이전트가 답하지 않았다");
    assert!(!entries.is_empty(), "설정 항목이 0개다 — 빈 응답을 성공으로 넘기고 있다");

    let collector_ip = entries
        .iter()
        .find(|e| e.key == "net_collector_ip")
        .expect("net_collector_ip 가 목록에 없다 — 키 이름이 바뀌었거나 파싱이 어긋났다");
    println!(
        "  net_collector_ip: 값={:?} 기본={:?} 바뀜={}",
        collector_ip.value, collector_ip.default, collector_ip.changed
    );
    assert!(
        collector_ip.changed,
        "테스트 환경은 콜렉터 주소를 기본값(127.0.0.1)에서 바꿔 두었다. \
         changed 가 false 면 value/default 짝이 어긋난 것이다"
    );

    let changed = entries.iter().filter(|e| e.changed).count();
    println!("  기본값과 다른 항목 {changed}개 / 전체 {}개", entries.len());
    assert!(changed < entries.len(), "전부 바뀐 것으로 나오면 비교가 고장난 것이다");
}

/// 콜렉터 설정 조회 — 파라미터가 없다.
#[test]
#[ignore]
fn live_server_config() {
    let text = {
        let mut c = login();
        let sess = c.session;
        c.send_request(CMD_GET_CONFIGURE_SERVER, sess, &MapPack::new())
            .expect("콜렉터 설정 원문 요청 실패");
        first_map(&mut c).map(|m| parse_config_text(&m)).unwrap_or_default()
    };

    let entries = {
        let mut c = login();
        let sess = c.session;
        c.send_request(CMD_LIST_CONFIGURE_SERVER, sess, &MapPack::new())
            .expect("콜렉터 설정 목록 요청 실패");
        first_map(&mut c).map(|m| parse_config_entries(&m)).unwrap_or_default()
    };

    println!("콜렉터 설정: 원문 {}자, 항목 {}개", text.chars().count(), entries.len());
    assert!(!text.is_empty(), "콜렉터 설정 원문이 비었다");
    assert!(!entries.is_empty(), "콜렉터 설정 항목이 0개다");
    assert!(
        entries.iter().any(|e| e.key == "server_id"),
        "server_id 가 없다 — 키 목록 파싱이 어긋났다"
    );
}

/// 응답에서 첫 MapPack 하나만. 설정 응답은 항상 1개다.
fn first_map(conn: &mut ScouterConnection) -> Option<MapPack> {
    let mut found = None;
    while let Ok(Some(pack)) = conn.read_next_pack() {
        if let AnyPack::Map(m) = pack {
            if found.is_none() {
                found = Some(m);
            }
        }
    }
    found
}

/// 호스트 에이전트도 설정 조회에 답하는가 — 메뉴를 막을지 정하려고 본다.
#[test]
#[ignore]
fn probe_host_agent_config() {
    let objs = {
        let mut c = login();
        fetch_objects(&mut c)
    };
    for (obj_type, obj_hash) in objs {
        let mut c = login();
        let sess = c.session;
        c.send_request(CMD_LIST_CONFIGURE_WAS, sess, &build_object_param(obj_hash))
            .expect("요청 실패");
        let n = first_map(&mut c).map(|m| parse_config_entries(&m).len()).unwrap_or(0);
        println!("{obj_type} (hash={obj_hash}) → 설정 항목 {n}개");
    }
}

/// 실시간 스트림이 같은 트랜잭션을 두 번 주는가.
///
/// 화면에서 드래그 선택을 하면 **똑같은 시각·똑같은 Elapsed 의 행이 쌍으로** 보였다.
/// 프론트 저장소는 txid 로 거르지 않으므로, 스트림이 겹쳐 주면 그대로 두 배가 된다.
#[test]
#[ignore]
fn probe_realtime_stream_duplicates() {
    use std::collections::HashMap;

    let hashes = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c)).iter().map(|(_, h)| *h).collect::<Vec<_>>()
    };

    let mut conn = login();
    let mut cursor = StreamCursor::default();
    let mut seen: HashMap<i64, usize> = HashMap::new();
    let mut total = 0usize;

    for round in 0..12 {
        let cmd = if round == 0 {
            CMD_TRANX_REAL_TIME_GROUP_LATEST
        } else {
            CMD_TRANX_REAL_TIME_GROUP
        };
        let param = build_request_param(&hashes, &cursor);
        let session = conn.session;
        conn.send_request(cmd, session, &param).expect("스트림 요청 실패");

        let mut got = 0usize;
        loop {
            match conn.read_next_pack().expect("스트림 수신 실패") {
                Some(AnyPack::Map(m)) => cursor.update_from(&m),
                Some(AnyPack::XLog(x)) => {
                    got += 1;
                    total += 1;
                    *seen.entry(x.txid).or_insert(0) += 1;
                }
                Some(_) => {}
                None => break,
            }
        }
        println!(
            "라운드 {round}: {got}건 (loop={} index={})",
            cursor.loop_val, cursor.index
        );
        std::thread::sleep(std::time::Duration::from_millis(500));
    }

    let dup: Vec<(i64, usize)> = seen.iter().filter(|(_, n)| **n > 1).map(|(k, n)| (*k, *n)).collect();
    println!("수신 {total}건 · 고유 txid {}개 · 중복 txid {}개", seen.len(), dup.len());
    for (txid, n) in dup.iter().take(5) {
        println!("  txid={txid} → {n}번");
    }
    assert!(total > 0, "한 건도 못 받았다 — 부하가 없거나 요청이 틀렸다");
}

/// 요약(Summary) 커맨드 정찰 — `TypeSummary` 가 어느 커맨드를 쓰는지 미조사로 남아 있었다.
///
/// 콜렉터 바이트코드(`SummaryService`)에서 읽은 사실:
///   - `LOAD_SERVICE_SUMMARY`/`LOAD_SQL_SUMMARY`/`LOAD_APICALL_SUMMARY` 는 한 메서드(`load`)를
///     `SummaryEnum`(APP=1 · SQL=2 · APICALL=5)으로 갈라 쓴다.
///   - 파라미터는 전부 같다: `date` · `stime` · `etime` · `objType` · `objHash`.
///   - 응답은 병렬 리스트 MapPack: `id` · `count` · `error` · `elapsed`.
///     **`cpu`·`mem` 은 APP(서비스) 요약에만 붙는다** (type==1 분기).
///   - `LOAD_SERVICE_ERROR_SUMMARY` 만 모양이 다르다: `id`·`error`·`service`·`message`·`count`.
#[test]
#[ignore]
fn probe_summary_commands() {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_type = objs[0].0.clone();
    println!("대상 objType={obj_type}");

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let date = yyyymmdd_local(now);
    // 오늘 하루 전체를 훑는다. 요약은 5분 단위로 쌓이므로 범위가 좁으면 0건이 나온다.
    let stime = now - 6 * 60 * 60 * 1000;
    let etime = now;

    let cmds = [
        CMD_LOAD_SERVICE_SUMMARY,
        CMD_LOAD_SQL_SUMMARY,
        CMD_LOAD_APICALL_SUMMARY,
        CMD_LOAD_IP_SUMMARY,
        CMD_LOAD_UA_SUMMARY,
        CMD_LOAD_SERVICE_ERROR_SUMMARY,
    ];

    for cmd in cmds {
        let mut c = login();
        let sess = c.session;
        let mut p = MapPack::new();
        p.put("date", ScouterValue::Text(date.clone()));
        p.put("stime", ScouterValue::Decimal(stime));
        p.put("etime", ScouterValue::Decimal(etime));
        p.put("objType", ScouterValue::Text(obj_type.clone()));
        // objHash 0 = 타입 전체. SummaryDialog 가 타입 단위로 여는 화면이다.
        p.put("objHash", ScouterValue::Decimal(0));

        if c.send_request(cmd, sess, &p).is_err() {
            println!("── {cmd} → 요청 실패");
            continue;
        }

        let mut printed = false;
        loop {
            match c.read_next_pack() {
                Ok(Some(AnyPack::Map(m))) => {
                    if !printed {
                        printed = true;
                        let mut keys: Vec<&String> = m.entries.keys().collect();
                        keys.sort();
                        let rows = match m.entries.get("id") {
                            Some(ScouterValue::List(items)) => items.len(),
                            _ => 0,
                        };
                        println!("── {cmd} → {rows}행, 키: {}", keys.iter().map(|k| k.as_str()).collect::<Vec<_>>().join(", "));
                        for k in keys {
                            println!("     {k} = {}", describe(&m.entries[k]));
                        }
                    }
                }
                Ok(Some(_)) => {}
                Ok(None) => break,
                Err(e) => {
                    println!("── {cmd} → 수신 오류: {e}");
                    break;
                }
            }
        }
        if !printed {
            println!("── {cmd} → 응답 없음");
        }
    }
}

/// 요약 파싱 실측 — 세 가지 응답 모양을 한 번에 확인한다.
///
/// **`cpu`/`mem` 은 서비스 요약에만 붙는다.** 없는 것을 0 으로 채우면
/// "CPU 를 0ms 썼다" 는 없던 사실이 생기므로 None 이어야 한다.
#[test]
#[ignore]
fn live_summary_shapes() {
    let obj_type = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))[0].0.clone()
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let date = yyyymmdd_local(now);
    let param = build_summary_param(&date, now - 6 * 60 * 60 * 1000, now, &obj_type, 0);

    let fetch = |cmd: &str| -> Option<MapPack> {
        let mut c = login();
        let sess = c.session;
        c.send_request(cmd, sess, &param).expect("요약 요청 실패");
        first_map(&mut c)
    };

    let service = parse_summary(&fetch(CMD_LOAD_SERVICE_SUMMARY).expect("서비스 요약 응답 없음"));
    assert!(!service.is_empty(), "서비스 요약이 0행이다 — 부하가 없거나 파라미터가 틀렸다");
    println!("서비스 요약 {}행", service.len());
    assert!(
        service.iter().all(|r| r.elapsed.is_some()),
        "서비스 요약에는 elapsed 가 있어야 한다"
    );
    assert!(
        service.iter().all(|r| r.cpu.is_some()),
        "서비스 요약에만 cpu 가 붙는다 — 빠졌다면 파싱이 어긋난 것이다"
    );
    let total: i64 = service.iter().map(|r| r.count).sum();
    println!("  호출 합계 {total}");
    assert!(total > 0, "호출 수 합계가 0이다");

    let sql = parse_summary(&fetch(CMD_LOAD_SQL_SUMMARY).expect("SQL 요약 응답 없음"));
    println!("SQL 요약 {}행", sql.len());
    assert!(!sql.is_empty(), "SQL 요약이 0행이다");
    assert!(
        sql.iter().all(|r| r.cpu.is_none()),
        "SQL 요약에는 cpu 가 없다. Some 이면 없는 값을 만들어낸 것이다"
    );
    assert!(sql.iter().all(|r| r.elapsed.is_some()), "SQL 요약에는 elapsed 가 있다");

    let ip = parse_summary(&fetch(CMD_LOAD_IP_SUMMARY).expect("IP 요약 응답 없음"));
    println!("IP 요약 {}행", ip.len());
    assert!(!ip.is_empty(), "IP 요약이 0행이다");
    assert!(
        ip.iter().all(|r| r.elapsed.is_none() && r.error.is_none()),
        "IP 요약은 id·count 뿐이다. 나머지를 0 으로 채우면 안 된다"
    );

    let errors = parse_error_summary(&fetch(CMD_LOAD_SERVICE_ERROR_SUMMARY).expect("에러 요약 응답 없음"));
    println!("에러 요약 {}행", errors.len());
    if let Some(e) = errors.first() {
        println!("  count={} txid={} service={} sql={}", e.count, e.txid, e.service, e.sql);
        assert_ne!(e.txid, 0, "대표 txid 가 0 이면 해당 트랜잭션을 열 수 없다");
    }
}

/// 요약이 시간축 어디에 쌓여 있는지 — 1시간과 6시간 결과가 같아서 확인한다.
#[test]
#[ignore]
fn probe_summary_time_distribution() {
    let obj_type = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))[0].0.clone()
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let date = yyyymmdd_local(now);
    let hour = 3_600_000i64;

    println!("date={date} now={now}");
    // 최근 24시간을 1시간씩 끊어 본다. 누적이 아니라 **구간별** 이다.
    for h in 0..24 {
        let etime = now - h * hour;
        let stime = etime - hour;
        let mut c = login();
        let sess = c.session;
        let param = build_summary_param(&date, stime, etime, &obj_type, 0);
        c.send_request(CMD_LOAD_SERVICE_SUMMARY, sess, &param).expect("요청 실패");
        let rows = first_map(&mut c).map(|m| parse_summary(&m)).unwrap_or_default();
        let total: i64 = rows.iter().map(|r| r.count).sum();
        if total > 0 {
            println!("  -{h}시간 ~ -{}시간: {}행 {total}호출", h + 1, rows.len());
        }
    }

    // 누적 창으로도 본다. 창이 커질수록 단조 증가해야 정상이다.
    for h in [1i64, 3, 6, 12, 24] {
        let mut c = login();
        let sess = c.session;
        let param = build_summary_param(&date, now - h * hour, now, &obj_type, 0);
        c.send_request(CMD_LOAD_SERVICE_SUMMARY, sess, &param).expect("요청 실패");
        let rows = first_map(&mut c).map(|m| parse_summary(&m)).unwrap_or_default();
        let total: i64 = rows.iter().map(|r| r.count).sum();
        println!("최근 {h}시간 누적: {total}호출");
    }
}

/// 에러 요약의 해시가 어느 사전으로 풀리는지 — 틀리면 화면에 숫자만 남는다.
///
/// `id`·`error`·`service`·`message` 네 필드가 각각 다른 종류일 수 있으므로
/// 후보 사전을 전부 던져 보고 **실제로 텍스트가 오는 것**을 고른다.
#[test]
#[ignore]
fn probe_error_summary_dictionaries() {
    use nscouter_lib::scouter::dictionary::{fetch_texts, TextCache};

    let obj_type = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))[0].0.clone()
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let date = yyyymmdd_local(now);
    let param = build_summary_param(&date, now - 24 * 60 * 60 * 1000, now, &obj_type, 0);

    let rows = {
        let mut c = login();
        let sess = c.session;
        c.send_request(CMD_LOAD_SERVICE_ERROR_SUMMARY, sess, &param)
            .expect("에러 요약 요청 실패");
        first_map(&mut c).map(|m| parse_error_summary(&m)).unwrap_or_default()
    };
    assert!(!rows.is_empty(), "에러 요약이 0행이다 — 에러가 없으면 이 프로브는 못 돈다");
    println!("에러 요약 {}행", rows.len());

    let candidates = ["error", "service", "hashMsg", "sql", "apicall", "desc", "method"];
    let fields: [(&str, i32); 4] = [
        ("id", rows[0].id),
        ("error", rows[0].error),
        ("service", rows[0].service),
        ("message", rows[0].message),
    ];

    for (field, hash) in fields {
        if hash == 0 {
            println!("── {field}: 해시 0 (없음)");
            continue;
        }
        let mut hits = Vec::new();
        for type_key in candidates {
            let mut c = login();
            let mut cache = TextCache::default();
            if fetch_texts(&mut c, &mut cache, type_key, &[hash]).is_err() {
                continue;
            }
            if let Some(text) = cache.get(type_key, hash) {
                let head: String = text.chars().take(70).collect();
                hits.push(format!("{type_key}={head:?}"));
            }
        }
        println!("── {field}(0x{:x}) → {}", hash as u32, if hits.is_empty() { "못 풀음".to_string() } else { hits.join(" | ") });
    }
}

/// 인터랙션(토폴로지) 정찰.
///
/// 콜렉터 바이트코드에서 읽은 사실:
///   - 커맨드는 `INTR_COUNTER_REAL_TIME_BY_OBJ` 하나뿐. 파라미터는 `objType`(Text) + `objHash`(List).
///     objHash 가 비면 콜렉터가 **그 타입의 살아 있는 오브젝트 전부**로 채운다.
///   - 응답은 MapPack 이 아니라 **`InteractionPerfCounterPack`(PackEnum 65)** 스트림이다.
///     우리 파서는 이 타입을 모르므로 O-5 규칙에 따라 에러가 난다 — 그게 정상 신호다.
///
/// 필드 순서 (`read()` 기준):
///   time(long) · objName(text) · interactionType(text) · fromHash(int) · toHash(int)
///   · period(int) · count(int) · errorCount(int) · totalElapsed(long) · customData(value)
#[test]
#[ignore]
fn probe_interaction_counter() {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let obj_type = objs[0].0.clone();
    println!("대상 objType={obj_type}, 오브젝트 {}개", objs.len());

    let mut c = login();
    let sess = c.session;
    let mut p = MapPack::new();
    p.put("objType", ScouterValue::Text(obj_type.clone()));
    // 빈 리스트를 보내면 콜렉터가 살아 있는 오브젝트로 채운다 (바이트코드 확인)
    p.put("objHash", ScouterValue::List(Vec::new()));
    c.send_request(CMD_INTR_COUNTER_REAL_TIME_BY_OBJ, sess, &p)
        .expect("인터랙션 요청 실패");

    let mut packs = 0usize;
    loop {
        match c.read_next_pack() {
            Ok(Some(other)) => {
                packs += 1;
                match other {
                    AnyPack::Interaction(i) => {
                        if packs <= 12 {
                            println!(
                                "  {} | {} → {} | {}건 err{} {}ms (period {}s)",
                                i.interaction_type, i.from_hash, i.to_hash,
                                i.count, i.error_count, i.total_elapsed, i.period
                            );
                        }
                    }
                    _ => println!("  pack #{packs}: (인터랙션 아님)"),
                }
            }
            Ok(None) => break,
            Err(e) => {
                // 모르는 팩 타입이면 여기로 온다. 그 자체가 "데이터가 있다"는 증거다.
                println!("  수신 오류(=미지원 팩일 가능성): {e}");
                break;
            }
        }
    }
    println!("총 {packs}개 (오류 전까지)");
}

/// 인터랙션 수집이 켜져 있는가 — `INTR_COUNTER_REAL_TIME_BY_OBJ` 가 0건인 이유를 찾는다.
///
/// 에이전트 설정(F-37)에서 interaction 관련 키만 뽑아 본다.
#[test]
#[ignore]
fn probe_interaction_agent_config() {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    for (obj_type, obj_hash) in objs.iter().take(1) {
        let mut c = login();
        let sess = c.session;
        c.send_request(CMD_LIST_CONFIGURE_WAS, sess, &build_object_param(*obj_hash))
            .expect("설정 목록 요청 실패");
        let entries = first_map(&mut c).map(|m| parse_config_entries(&m)).unwrap_or_default();
        println!("{obj_type} 설정 {}개", entries.len());
        for e in entries.iter().filter(|e| {
            let k = e.key.to_lowercase();
            k.contains("intr") || k.contains("interaction") || k.contains("topology")
                || k.contains("jmx") || k.contains("obj_") || k.contains("registry")
        }) {
            println!("  {} = {:?} (기본 {:?}, 바뀜={})", e.key, e.value, e.default, e.changed);
        }
    }
}

/// 인터랙션 수집을 켠다 — **에이전트 설정을 실제로 바꾼다** (테스트 환경 전용).
///
/// `SET_CONFIGURE_WAS` 는 에이전트에서 `setConfig` 텍스트를 받아
/// `Configure.saveText()` → `reload()` 를 한다. **saveText 는 파일을 통째로 덮어쓴다** —
/// 원문을 읽어 한 줄만 덧붙여 되돌려주지 않으면 에이전트 설정이 날아간다 (F-40).
#[test]
#[ignore]
fn enable_interaction_counter() {
    for key in ["counter_interaction_enabled", "jmx_counter_enabled"] {
        set_agent_flag(key);
    }
}

/// 에이전트 설정 한 줄을 원격으로 켠다 (F-40).
fn set_agent_flag(key: &str) {
    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };

    for (obj_type, obj_hash) in &objs {
        // 1. 원문을 먼저 읽는다. 이걸 빼먹으면 덮어쓰기가 곧 설정 삭제다.
        let current = {
            let mut c = login();
            let sess = c.session;
            c.send_request(CMD_GET_CONFIGURE_WAS, sess, &build_object_param(*obj_hash))
                .expect("설정 원문 요청 실패");
            first_map(&mut c).map(|m| parse_config_text(&m)).unwrap_or_default()
        };
        assert!(!current.is_empty(), "원문이 비었다 — 덮어쓰면 설정이 날아간다. 중단");

        if current.contains(key) {
            println!("{obj_type}({obj_hash}): 이미 {key} 가 있다. 건너뜀");
            continue;
        }

        let next = format!("{current}\n\n# 인터랙션(토폴로지) 수집\n{key}=true\n");
        let mut param = build_object_param(*obj_hash);
        param.put("setConfig", ScouterValue::Text(next));

        let result = {
            let mut c = login();
            let sess = c.session;
            c.send_request(CMD_SET_CONFIGURE_WAS, sess, &param)
                .expect("설정 저장 요청 실패");
            first_map(&mut c)
                .and_then(|m| m.get_text("result").map(|s| s.to_string()))
                .unwrap_or_else(|| "(응답 없음)".into())
        };
        println!("{obj_type}({obj_hash}): 저장 result={result}");

        // 2. 되읽어 확인한다. 저장했다는 말만 믿지 않는다.
        let after = {
            let mut c = login();
            let sess = c.session;
            c.send_request(CMD_LIST_CONFIGURE_WAS, sess, &build_object_param(*obj_hash))
                .expect("설정 목록 요청 실패");
            first_map(&mut c).map(|m| parse_config_entries(&m)).unwrap_or_default()
        };
        let entry = after.iter().find(|e| e.key == key);
        println!("  확인: {:?}", entry.map(|e| (&e.key, &e.value, e.changed)));
        assert_eq!(
            entry.map(|e| e.value.as_str()),
            Some("true"),
            "저장 후에도 {key} 가 true 가 아니다"
        );
    }
}

/// 인터랙션의 from/to 해시는 어느 사전으로 푸는가.
#[test]
#[ignore]
fn probe_interaction_dictionaries() {
    use nscouter_lib::scouter::dictionary::{fetch_texts, TextCache};

    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    let known: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();
    println!("알려진 objHash: {known:?}");

    let mut targets: Vec<(String, i32)> = Vec::new();
    {
        let mut c = login();
        let sess = c.session;
        let mut p = MapPack::new();
        p.put("objType", ScouterValue::Text(objs[0].0.clone()));
        p.put("objHash", ScouterValue::List(Vec::new()));
        c.send_request(CMD_INTR_COUNTER_REAL_TIME_BY_OBJ, sess, &p).expect("요청 실패");
        while let Ok(Some(pack)) = c.read_next_pack() {
            if let AnyPack::Interaction(i) = pack {
                for h in [i.from_hash, i.to_hash] {
                    if h != 0 && !known.contains(&h) && !targets.iter().any(|(_, x)| *x == h) {
                        targets.push((i.interaction_type.clone(), h));
                    }
                }
            }
        }
    }
    println!("풀어야 할 해시 {}개", targets.len());

    // TextTypes.class 에서 뽑은 **전체 목록**. 하나씩 짐작하지 않는다.
    let candidates = [
        "error", "apicall", "method", "service", "sql", "object", "referer", "ua",
        "group", "city", "table", "maria", "login", "desc", "web", "hmsg", "stackelem",
        "obj",
    ];
    for (intr_type, hash) in targets {
        let mut hits = Vec::new();
        for type_key in candidates {
            let mut c = login();
            let mut cache = TextCache::default();
            if fetch_texts(&mut c, &mut cache, type_key, &[hash]).is_err() {
                continue;
            }
            if let Some(t) = cache.get(type_key, hash) {
                hits.push(format!("{type_key}={:?}", t.chars().take(50).collect::<String>()));
            }
        }
        println!("── {intr_type} {hash} → {}", if hits.is_empty() { "못 풀음".into() } else { hits.join(" | ") });
    }
}

/// `OBJECT_CALL_HEAP_DUMP` 를 objHash 만으로 불렀을 때 정말 빈 응답인가 (F-35 재확인).
#[test]
#[ignore]
fn probe_bare_heap_dump() {
    let obj_hash = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))[0].1
    };
    let mut c = login();
    let sess = c.session;
    c.send_request(CMD_OBJECT_CALL_HEAP_DUMP, sess, &build_object_param(obj_hash))
        .expect("요청 실패");
    let mut n = 0;
    while let Ok(Some(pack)) = c.read_next_pack() {
        n += 1;
        if let AnyPack::Map(m) = pack {
            let mut keys: Vec<&String> = m.entries.keys().collect();
            keys.sort();
            for k in keys {
                println!("  {k} = {:?}", m.entries[k]);
            }
        }
    }
    println!("bare 힙덤프 응답 {n}건");
}

/// javaee 카운터 19종의 **실제 값**을 찍는다. 단정하기 전에 무엇이 오는지 본다.
#[test]
#[ignore]
fn probe_javaee_counter_values() {
    let mut conn = login();
    let objs = javaee_objects(&fetch_objects(&mut conn));
    let hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();

    let wanted = [
        "TPS", "ElapsedTime", "ActiveService", "RecentUser", "ErrorRate",
        "HeapUsed", "HeapTotal", "GcCount", "GcTime", "SqlTimeByService",
        "ApiTimeByService", "Elapsed90%", "QueuingTime", "ProcCpu", "ServiceCount",
        "HeapTotUsage", "PermUsed", "PermPercent", "FdUsage",
    ];
    let param = nscouter_lib::scouter::counter::build_counter_multi_param(&hashes, &wanted);
    let session = conn.session;
    conn.send_request(CMD_COUNTER_REAL_TIME_ALL_MULTI, session, &param)
        .expect("MULTI 요청 실패");

    let mut rows = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("수신 실패") {
        if let AnyPack::Map(map) = pack {
            rows = nscouter_lib::scouter::counter::parse_counter_multi(&map);
        }
    }

    println!("요청 {}종 × 오브젝트 {}개 → {}행", wanted.len(), hashes.len(), rows.len());
    for name in wanted {
        let got: Vec<String> = rows
            .iter()
            .filter(|r| r.counter == name)
            .map(|r| match r.total {
                Some(t) => format!("{}/{}", r.value, t),
                None => format!("{}", r.value),
            })
            .collect();
        if got.is_empty() {
            println!("  {name:<18} → **미수신**");
        } else {
            println!("  {name:<18} → {}", got.join(" , "));
        }
    }
}

/// javaee 카운터 값 검증.
///
/// "값이 온다"는 건 이미 `live_counter_multi` 가 본다. 여기서 보는 건 **값이 말이 되는가**다.
/// 서로 다른 경로로 수집된 카운터끼리 **교차 검증**한다 — 이름이 바뀌거나 단위가 어긋나면
/// 개별 범위 검사로는 안 잡히고 이것으로만 잡힌다.
#[test]
#[ignore]
fn live_javaee_counter_values() {
    use std::collections::HashMap;

    let mut conn = login();
    let objs = javaee_objects(&fetch_objects(&mut conn));
    let hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();
    assert!(!hashes.is_empty(), "javaee 오브젝트가 없다");

    // 이 환경에서 실제로 오는 17종. ProcCpu·PermPercent 는 수집 자체가 없다(인벤토리 참조).
    let wanted = [
        "TPS", "ElapsedTime", "ActiveService", "RecentUser", "ErrorRate",
        "HeapUsed", "HeapTotal", "GcCount", "GcTime", "SqlTimeByService",
        "ApiTimeByService", "Elapsed90%", "QueuingTime", "ServiceCount",
        "HeapTotUsage", "PermUsed", "FdUsage",
    ];
    let param = nscouter_lib::scouter::counter::build_counter_multi_param(&hashes, &wanted);
    let session = conn.session;
    conn.send_request(CMD_COUNTER_REAL_TIME_ALL_MULTI, session, &param)
        .expect("MULTI 요청 실패");

    let mut rows = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("수신 실패") {
        if let AnyPack::Map(map) = pack {
            rows = nscouter_lib::scouter::counter::parse_counter_multi(&map);
        }
    }

    // objHash → 카운터명 → (값, 상한)
    let mut by_obj: HashMap<i32, HashMap<String, (f64, Option<f64>)>> = HashMap::new();
    for r in &rows {
        by_obj
            .entry(r.obj_hash)
            .or_default()
            .insert(r.counter.clone(), (r.value, r.total));
    }

    // **이름이 하나라도 틀리면 조용히 빠진다** (F-15). 전부 왔는지부터 본다.
    for name in wanted {
        let n = rows.iter().filter(|r| r.counter == name).count();
        assert!(n > 0, "{name} 이 한 오브젝트에서도 오지 않았다 — 이름이 틀렸거나 수집이 없다");
    }

    for (obj_hash, c) in &by_obj {
        let get = |k: &str| c.get(k).map(|(v, _)| *v);
        let name = objs.iter().find(|(_, h)| h == obj_hash).map(|(t, _)| t.clone()).unwrap_or_default();
        println!("── {name}({obj_hash})");

        // 값이 숫자로서 성립하는가
        for (k, (v, _)) in c {
            assert!(v.is_finite(), "{k} 가 유한하지 않다: {v}");
            assert!(*v >= 0.0, "{k} 가 음수다: {v}");
        }

        // 1) 백분율은 0~100 이다
        if let Some(rate) = get("ErrorRate") {
            assert!((0.0..=100.0).contains(&rate), "ErrorRate 가 백분율 범위 밖이다: {rate}");
        }

        // 2) 쓴 힙이 전체 힙보다 클 수 없다 — 둘이 뒤바뀌면 여기서 걸린다
        if let (Some(used), Some(total)) = (get("HeapUsed"), get("HeapTotal")) {
            assert!(used <= total, "HeapUsed({used}) > HeapTotal({total})");
        }

        // 3) 쌍 카운터의 두 값이 **독립 수집된 스칼라 카운터와 같아야** 한다.
        //    [총량, 사용량] 순서를 뒤집어 읽으면(F-33) 여기서 드러난다.
        if let Some((pair_used, Some(pair_total))) = c.get("HeapTotUsage").copied() {
            if let (Some(used), Some(total)) = (get("HeapUsed"), get("HeapTotal")) {
                assert!(
                    (pair_used - used).abs() < 1.0,
                    "HeapTotUsage 의 사용량({pair_used})이 HeapUsed({used})와 다르다 — 쌍 순서 의심"
                );
                assert!(
                    (pair_total - total).abs() < 1.0,
                    "HeapTotUsage 의 상한({pair_total})이 HeapTotal({total})과 다르다"
                );
            }
            println!("   Heap {pair_used:.1}/{pair_total:.0} MB");
        }

        // 4) 파일 디스크립터 — 열린 수가 상한을 넘을 수 없다
        if let Some((open, Some(limit))) = c.get("FdUsage").copied() {
            assert!(open <= limit, "FdUsage 열린 수({open})가 상한({limit})보다 크다 — 쌍 순서 의심");
            assert!(limit >= 1024.0, "FdUsage 상한({limit})이 비현실적으로 작다");
            println!("   FD {open:.0}/{limit:.0}");
        }

        // 5) **단위 교차 검증.** ServiceCount 는 분당, TPS 는 초당이다.
        //    둘은 다른 경로로 수집되므로, 60 으로 나눈 값이 TPS 와 맞아야 한다.
        //    이름이나 단위가 어긋나면 개별 범위 검사로는 절대 안 잡힌다.
        if let (Some(per_min), Some(tps)) = (get("ServiceCount"), get("TPS")) {
            if per_min > 60.0 && tps > 1.0 {
                let derived = per_min / 60.0;
                let ratio = derived / tps;
                println!("   ServiceCount {per_min:.0}/분 → {derived:.1}/초 vs TPS {tps:.1} (비 {ratio:.2})");
                assert!(
                    (0.4..=2.5).contains(&ratio),
                    "ServiceCount/60 ({derived:.1}) 과 TPS ({tps:.1}) 가 너무 다르다 — 단위나 이름 의심"
                );
            }
        }

        // 6) 90 분위는 평균보다 작을 이유가 없다. 다만 긴 꼬리 하나가 평균을 끌어올릴 수 있어
        //    단정하지 않고 **기록만** 한다 — 거짓 실패를 만드느니 눈으로 보는 게 낫다.
        if let (Some(p90), Some(avg)) = (get("Elapsed90%"), get("ElapsedTime")) {
            println!("   Elapsed 평균 {avg:.0}ms / 90분위 {p90:.0}ms");
        }
    }
}

/// datasource(커넥션 풀) 카운터 실측.
///
/// 에이전트가 HikariCP MBean 을 읽어 **별도 오브젝트**(objType=`datasource`)로 올린다.
/// 두 관문을 모두 열어야 온다 (F-41):
///   - 앱: `spring.datasource.hikari.register-mbeans=true` (HikariCP 기본 false)
///   - 에이전트: `jmx_counter_enabled=true` (기본 false)
#[test]
#[ignore]
fn live_datasource_counters() {
    let mut conn = login();
    let objs = fetch_objects(&mut conn);
    let ds: Vec<i32> = objs.iter().filter(|(t, _)| t == "datasource").map(|(_, h)| *h).collect();
    assert!(!ds.is_empty(), "datasource 오브젝트가 없다 — register-mbeans / jmx_counter_enabled 확인");
    println!("datasource 오브젝트 {}개", ds.len());

    let wanted = ["ConnActive", "ConnIdle", "ConnMax"];
    let param = nscouter_lib::scouter::counter::build_counter_multi_param(&ds, &wanted);
    let session = conn.session;
    conn.send_request(CMD_COUNTER_REAL_TIME_ALL_MULTI, session, &param)
        .expect("MULTI 요청 실패");

    let mut rows = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("수신 실패") {
        if let AnyPack::Map(map) = pack {
            rows = nscouter_lib::scouter::counter::parse_counter_multi(&map);
        }
    }

    for name in wanted {
        let got: Vec<String> = rows.iter().filter(|r| r.counter == name)
            .map(|r| format!("{}", r.value)).collect();
        println!("  {name:<12} → {}", if got.is_empty() { "**미수신**".into() } else { got.join(" , ") });
        assert!(!got.is_empty(), "{name} 미수신");
    }

    // 활성 + 유휴가 상한을 넘을 수 없다. 넘으면 카운터가 뒤섞인 것이다.
    for h in &ds {
        let get = |n: &str| rows.iter().find(|r| r.obj_hash == *h && r.counter == n).map(|r| r.value);
        if let (Some(a), Some(i), Some(m)) = (get("ConnActive"), get("ConnIdle"), get("ConnMax")) {
            println!("  풀 {h}: 활성 {a} + 유휴 {i} ≤ 상한 {m}");
            assert!(a + i <= m + 0.001, "활성({a})+유휴({i})가 상한({m})을 넘는다");
            assert!(m > 0.0, "상한이 0이다");
        }
    }
}

/// 덤프 파일명에 박힌 타임스탬프(yyyymmddHHMMSS). 못 찾으면 빈 문자열.
fn stamp_of(name: &str) -> String {
    name.chars().filter(|c| c.is_ascii_digit()).collect()
}

/// ObjectPack 의 **꼬리 두 필드**(`wakeup`, `tags`)가 실제로 무엇을 담는가.
///
/// 오래 `_wakeup` / `_tags` 로 읽고 버리던 자리다. ASIS `ObjectPropertiesDialog` 는
/// 이 tags 를 통째로 펴서 보여준다 — 즉 **화면에 낼 값이 여기 들어 있다**.
///
/// tags 는 **고정 스키마가 아니다.** 에이전트 종류·버전마다 키가 다르므로
/// 특정 키를 단정하지 않는다. 여기서 확인하는 것은 두 가지뿐이다:
///   1. 뒤에 남은 바이트를 제대로 소비하는가 (안 그러면 다음 팩이 어긋난다)
///   2. wakeup 이 epoch ms 로 말이 되는가
#[test]
#[ignore]
fn live_object_pack_tail_fields() {
    let mut conn = login();
    let session = conn.session;
    conn.send_request(CMD_OBJECT_LIST_REAL_TIME, session, &MapPack::new())
        .expect("오브젝트 목록 요청 실패");

    let mut objs = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("오브젝트 응답 수신 실패") {
        if let AnyPack::Object(obj) = pack {
            objs.push(obj);
        }
    }
    assert!(!objs.is_empty(), "오브젝트가 0건이다");

    for o in &objs {
        println!(
            "  {} ({}) alive={} wakeup={} addr={:?} ver={:?}",
            o.obj_name, o.obj_type, o.alive, o.wakeup, o.address, o.version
        );
        for (k, v) in &o.tags {
            println!("      tag {k} = {v}");
        }
    }

    // 살아 있는 오브젝트라면 wakeup 이 epoch ms 여야 한다.
    // readDecimal 을 readLong 으로 잘못 읽으면 여기서 값이 붕괴한다 (F-17 계열).
    for o in objs.iter().filter(|o| o.alive) {
        assert!(
            o.wakeup > 1_600_000_000_000 && o.wakeup < 4_000_000_000_000,
            "{} 의 wakeup 이 epoch ms 가 아니다: {}",
            o.obj_name,
            o.wakeup
        );
    }

    // 정렬해 두지 않으면 폴링마다 표의 줄 순서가 바뀐다.
    for o in &objs {
        let keys: Vec<&str> = o.tags.iter().map(|(k, _)| k.as_str()).collect();
        let mut sorted = keys.clone();
        sorted.sort_unstable();
        assert_eq!(keys, sorted, "{} 의 tags 가 정렬돼 있지 않다", o.obj_name);
    }
}

/// PermPercent 는 **Java 17 때문에 안 오는 게 아니다.**
///
/// 오래 "Java 17 에는 PermGen 이 없다" 로 적어 두었지만, 에이전트 바이트코드를 보면
/// `PermGen` 태스크는 풀 이름에 `PERM GEN` **또는 `METASPACE`** 가 들어가면 잡는다.
/// 그래서 Java 17 에서도 `PermUsed` 는 온다(실제로 왔다).
///
/// `PermPercent` 만 한 줄 더 걸려 있다:
///
/// ```
/// if (usage.getMax() != -1) { pack.put("PermPercent", used * 100 / max); }
/// ```
///
/// Metaspace 는 기본이 **상한 없음(-1)** 이라 이 조건에서 걸러진다.
/// `-XX:MaxMetaspaceSize` 를 주면 온다 — 환경 제약이 아니라 **JVM 옵션** 문제였다.
///
/// 환경: Test/apps/*/Containerfile 이 `-XX:MaxMetaspaceSize=256m` 을 준다.
#[test]
#[ignore]
fn live_perm_percent_needs_metaspace_cap() {
    let mut conn = login();
    let objs = javaee_objects(&fetch_objects(&mut conn));
    let hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();
    assert!(!hashes.is_empty(), "javaee 오브젝트가 없다");

    let param =
        nscouter_lib::scouter::counter::build_counter_multi_param(&hashes, &["PermUsed", "PermPercent"]);
    let session = conn.session;
    conn.send_request(CMD_COUNTER_REAL_TIME_ALL_MULTI, session, &param)
        .expect("MULTI 요청 실패");

    let mut rows = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("수신 실패") {
        if let AnyPack::Map(map) = pack {
            rows = nscouter_lib::scouter::counter::parse_counter_multi(&map);
        }
    }
    for r in &rows {
        println!("   obj={} {:<12} {}", r.obj_hash, r.counter, r.value);
    }

    // 기준점: PermUsed 가 없으면 PermGen 태스크 자체가 안 도는 것이라
    // 아래 단정이 무의미해진다.
    assert!(
        rows.iter().any(|r| r.counter == "PermUsed"),
        "PermUsed 조차 없다 — PermGen 태스크가 Metaspace 풀을 못 찾았다"
    );

    let pct: Vec<&_> = rows.iter().filter(|r| r.counter == "PermPercent").collect();
    assert!(
        !pct.is_empty(),
        "PermPercent 가 없다. 앱 JVM 에 -XX:MaxMetaspaceSize 가 걸려 있는지 확인할 것"
    );
    for r in &pct {
        assert!(
            r.value > 0.0 && r.value <= 100.0,
            "PermPercent 가 백분율이 아니다: {}",
            r.value
        );
    }
}

/// 서비스 그룹은 **파라미터가 objType 이 아니라 objHash 목록**이다.
///
/// `probe_objtype_menu_commands` 가 `objType` 으로 물어 0건을 받았고, 그걸
/// "에이전트에 서비스 그룹 설정이 없다"로 적어 두었다. **추정이었다.**
/// ASIS `ServiceGroupTPSView.fetch()` 는 이렇게 보낸다:
///
/// ```java
/// ListValue objLv = param.newList("objHash");
/// for (AgentObject p : agentMap.values())
///     if (p.getObjType().equals(objType)) objLv.add(p.getObjHash());
/// ```
///
/// 파라미터가 틀리면 에러 없이 0건이 오는 게 이 프로토콜의 실패 방식이다 (F-15).
/// 두 모양을 같은 자리에서 나란히 물어 **차이가 파라미터에 있음**을 못 박는다.
#[test]
#[ignore]
fn live_service_group_needs_objhash_list() {
    let mut conn = login();
    let objs = javaee_objects(&fetch_objects(&mut conn));
    let hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();
    let obj_type = objs[0].0.clone();
    assert!(!hashes.is_empty(), "javaee 오브젝트가 없다");

    // (1) 예전 모양 — objType 하나
    let mut wrong = MapPack::new();
    wrong.put("objType", ScouterValue::Text(obj_type.clone()));

    // (2) ASIS 모양 — objHash 리스트
    let mut right = MapPack::new();
    right.put(
        "objHash",
        ScouterValue::List(hashes.iter().map(|h| ScouterValue::Decimal(*h as i64)).collect()),
    );

    let mut names_by_shape: Vec<(&str, usize)> = Vec::new();
    for (label, param) in [("objType", wrong), ("objHash 리스트", right)] {
        // F-1: 요청 하나에 연결 하나
        let mut c = login();
        let session = c.session;
        c.send_request("REALTIME_SERVICE_GROUP", session, &param)
            .expect("REALTIME_SERVICE_GROUP 요청 실패");

        let mut count = 0usize;
        while let Some(pack) = c.read_next_pack().expect("응답 수신 실패") {
            if let AnyPack::Map(map) = pack {
                let names = match map.entries.get("name") {
                    Some(ScouterValue::List(v)) => v.len(),
                    _ => 0,
                };
                count += names;
                println!("  [{label}] 키={:?} 그룹 {names}개", map.entries.keys().collect::<Vec<_>>());
                // **elapsed 는 Float 으로 온다.** 여기서 원시 타입을 찍어 두는 이유는
                // as_decimal 로 읽어 전부 0ms 가 됐던 적이 있기 때문이다 (F-44).
                println!("      원시 elapsed={:?}", map.entries.get("elapsed"));
                for r in nscouter_lib::scouter::objtype::parse_service_group(&map) {
                    println!(
                        "      {:<10} count={:<6} elapsed={:<6} error={}",
                        r.name, r.count, r.elapsed, r.error
                    );
                }
            }
        }
        names_by_shape.push((label, count));
    }

    println!("=> {names_by_shape:?}");
    let right_count = names_by_shape[1].1;
    assert!(
        right_count > 0,
        "objHash 리스트로도 0건이다. 콜렉터가 서비스 그룹을 만들지 않는 것일 수 있다"
    );

    // elapsed 가 전부 0이면 Float 을 Decimal 로 읽고 있다는 뜻이다 —
    // 부하가 도는 환경에서 평균 응답시간이 0ms 일 수는 없다.
    let mut c = login();
    let session = c.session;
    c.send_request(
        "REALTIME_SERVICE_GROUP",
        session,
        &nscouter_lib::scouter::objtype::build_service_group_param(&hashes),
    )
    .expect("재요청 실패");
    let mut rows = Vec::new();
    while let Some(pack) = c.read_next_pack().expect("응답 수신 실패") {
        if let AnyPack::Map(map) = pack {
            rows.extend(nscouter_lib::scouter::objtype::parse_service_group(&map));
        }
    }
    let busy: Vec<_> = rows.iter().filter(|r| r.count > 0).collect();
    assert!(!busy.is_empty(), "호출이 있는 그룹이 없다 — 부하가 도는지 확인할 것");
    assert!(
        busy.iter().any(|r| r.elapsed > 0.0),
        "모든 그룹의 elapsed 가 0이다. Float 을 Decimal 로 읽고 있지 않은지 확인할 것"
    );
}

/// 탐침: 모인 스택을 **볼 수 있는가**.
///
/// 지금까지 스택 분석기는 샘플링을 켜고 끄는 것만 됐다. 켜 놓고 못 보면 아무 소용이 없다.
///
/// ASIS 경로는 둘로 나뉜다 (`StackListDialog` / `FetchStackJob`):
///   `GET_STACK_INDEX`    param objName/from/to → **raw long 나열** (Pack 이 아니다)
///   `GET_STACK_ANALYZER` param objName/from/to → StackPack(62) 스트림, 본문은 **GZIP**
///
/// 파라미터 키가 `objHash` 가 아니라 **`objName`** 인 것도 다른 OBJECT_* 와 다르다.
#[test]
#[ignore]
fn probe_stack_analyzer_readback() {
    use nscouter_lib::scouter::object::{build_pstack_param, build_stack_range_param};

    let objs = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))
    };
    // objName 이 필요하다 — fetch_objects 는 (objType, objHash) 만 준다.
    let (obj_name, obj_hash) = {
        let mut c = login();
        let session = c.session;
        c.send_request(CMD_OBJECT_LIST_REAL_TIME, session, &MapPack::new())
            .expect("오브젝트 목록 요청 실패");
        let mut found = None;
        while let Some(pack) = c.read_next_pack().expect("수신 실패") {
            if let AnyPack::Object(o) = pack {
                if o.obj_hash == objs[0].1 {
                    found = Some((o.obj_name.clone(), o.obj_hash));
                }
            }
        }
        found.expect("대상 오브젝트를 못 찾았다")
    };
    println!("대상 {obj_name} ({obj_hash})");

    // 1) 샘플링을 켠다 (30초)
    {
        let mut c = login();
        let s = c.session;
        c.send_request(CMD_PSTACK_ON, s, &build_pstack_param(obj_hash, Some(30_000)))
            .expect("PSTACK_ON 실패");
        while c.read_next_pack().expect("수신 실패").is_some() {}
    }
    println!("샘플링 켬 — 12초 기다린다");
    std::thread::sleep(std::time::Duration::from_secs(12));

    // 2) 오늘 하루를 훑어 모인 시각을 받는다. **Pack 이 아니라 raw long 이다.**
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let day_start = now - (now % 86_400_000) - 9 * 3_600_000; // KST 자정
    let times = {
        let mut c = login();
        let s = c.session;
        c.send_request(
            CMD_GET_STACK_INDEX,
            s,
            &build_stack_range_param(&obj_name, day_start, day_start + 86_400_000 - 1),
        )
        .expect("GET_STACK_INDEX 실패");
        c.read_long_stream().expect("long 스트림 수신 실패")
    };
    println!("GET_STACK_INDEX → {}건", times.len());
    for t in times.iter().take(5) {
        println!("   time={t}");
    }

    // 3) 원문을 받는다
    if let (Some(first), Some(last)) = (times.iter().min(), times.iter().max()) {
        let mut c = login();
        let s = c.session;
        c.send_request(
            CMD_GET_STACK_ANALYZER,
            s,
            &build_stack_range_param(&obj_name, *first, *last + 1),
        )
        .expect("GET_STACK_ANALYZER 실패");
        let mut n = 0usize;
        let mut chars = 0usize;
        let mut sample = String::new();
        while let Some(pack) = c.read_next_pack().expect("수신 실패") {
            if let AnyPack::Stack(sp) = pack {
                n += 1;
                chars += sp.stack.len();
                if sample.is_empty() {
                    sample = sp.stack.chars().take(400).collect();
                }
            }
        }
        println!("GET_STACK_ANALYZER → 팩 {n}개 · 총 {chars}자");
        println!("--- 첫 장 앞부분 ---\n{sample}");
    }
}

/// 스택 분석기의 **읽는 쪽** 계약.
///
/// 켜고 끄기만 되던 기능이라, 여기서 확인할 것은 "모아 놓은 걸 실제로 꺼낼 수 있는가"다.
///
/// 세 가지가 각각 다른 함정이다 (F-45):
///   1. `GET_STACK_INDEX` 응답은 **Pack 이 아니라 raw long** — read_next_pack 으로 읽으면 깨진다
///   2. 파라미터가 `objHash` 가 아니라 **`objName`**
///   3. StackPack(62) 의 본문은 **GZIP** — 풀지 않으면 바이너리가 나온다
///
/// 환경: `probe_stack_analyzer_readback` 이나 이전 실행에서 샘플링이 켜져 스택이 쌓여 있어야 한다.
#[test]
#[ignore]
fn live_stack_analyzer_readback() {
    use nscouter_lib::scouter::object::{build_pstack_param, build_stack_range_param};

    let (obj_name, obj_hash) = {
        let mut c = login();
        let want = javaee_objects(&fetch_objects(&mut c))[0].1;
        let mut c2 = login();
        let s = c2.session;
        c2.send_request(CMD_OBJECT_LIST_REAL_TIME, s, &MapPack::new())
            .expect("오브젝트 목록 요청 실패");
        let mut found = None;
        while let Some(pack) = c2.read_next_pack().expect("수신 실패") {
            if let AnyPack::Object(o) = pack {
                if o.obj_hash == want {
                    found = Some((o.obj_name.clone(), o.obj_hash));
                }
            }
        }
        found.expect("대상 오브젝트를 못 찾았다")
    };

    // 스택이 없으면 검증할 것이 없다. 샘플링을 켜고 한 주기(10초)를 기다린다.
    {
        let mut c = login();
        let s = c.session;
        c.send_request(CMD_PSTACK_ON, s, &build_pstack_param(obj_hash, Some(30_000)))
            .expect("PSTACK_ON 실패");
        while c.read_next_pack().expect("수신 실패").is_some() {}
    }
    std::thread::sleep(std::time::Duration::from_secs(12));

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let day_start = now - (now % 86_400_000) - 9 * 3_600_000;

    // (1) 목록 — raw long 스트림
    let mut times = {
        let mut c = login();
        let s = c.session;
        c.send_request(
            CMD_GET_STACK_INDEX,
            s,
            &build_stack_range_param(&obj_name, day_start, day_start + 86_400_000 - 1),
        )
        .expect("GET_STACK_INDEX 실패");
        c.read_long_stream().expect("long 스트림 수신 실패")
    };
    times.sort_unstable();
    println!("스택 {}건", times.len());
    assert!(!times.is_empty(), "모인 스택이 없다 — 샘플링이 켜졌는지 확인할 것");

    // 시각이 epoch ms 여야 한다. readLong(8바이트 고정)이 아니라 readDecimal 로 읽으면
    // 첫 바이트를 길이로 해석해 값이 붕괴한다 (F-17 계열).
    for t in &times {
        assert!(
            *t > 1_600_000_000_000 && *t < 4_000_000_000_000,
            "스택 시각이 epoch ms 가 아니다: {t}"
        );
    }

    // (2) 한 장 — from=time, to=time+1 (ASIS FetchSingleStackJob 과 같다)
    let target = *times.last().unwrap();
    let mut c = login();
    let s = c.session;
    c.send_request(
        CMD_GET_STACK_ANALYZER,
        s,
        &build_stack_range_param(&obj_name, target, target + 1),
    )
    .expect("GET_STACK_ANALYZER 실패");

    let mut text = String::new();
    let mut packs = 0usize;
    while let Some(pack) = c.read_next_pack().expect("수신 실패") {
        if let AnyPack::Stack(sp) = pack {
            packs += 1;
            assert_eq!(sp.obj_hash, obj_hash, "다른 오브젝트의 스택이 왔다");
            text.push_str(&sp.stack);
        }
    }
    println!("한 장 → 팩 {packs}개 · {}자", text.len());
    assert_eq!(packs, 1, "한 시각을 물었는데 여러 장이 왔다");

    // (3) GZIP 을 실제로 풀었는가.
    // 안 풀면 바이너리가 그대로 들어와 이 문자열이 없다.
    assert!(
        text.contains("Full thread dump"),
        "스택 원문이 아니다 — GZIP 을 풀지 못했을 수 있다. 앞부분: {:?}",
        text.chars().take(80).collect::<String>()
    );
    assert!(
        !text.starts_with("<스택을 풀지 못했습니다"),
        "GZIP 해제에 실패했다: {}",
        text.chars().take(120).collect::<String>()
    );
}

/// 탐침: 실행 중인 트랜잭션 **한 건의 상세**.
///
/// 액티브 서비스 목록은 "무엇이 몇 초째 돌고 있다"까지만 말한다.
/// 정작 알고 싶은 건 **지금 어디에 멈춰 있나**이고, 그건 이 명령에만 있다.
///
/// ASIS `AgentDataProxy.getThreadDetail` 은 objHash/id/txid 셋을 보낸다.
/// 응답 MapPack 의 키는 **사람이 읽는 이름**이다 — `"Service Name"`, `"Stack Trace"` 처럼
/// 공백이 든다 (webapp `ActiveThread.of`). 키를 짐작하면 안 되므로 전부 찍는다.
#[test]
#[ignore]
fn probe_thread_detail() {
    use nscouter_lib::scouter::object::build_thread_detail_param;
    use nscouter_lib::scouter::objtype::build_active_service_param;

    let obj_type = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))[0].0.clone()
    };

    // 액티브 서비스를 몇 번 훑는다 — 순간 상태라 한 번에 안 잡힐 수 있다.
    let mut target = None;
    for _ in 0..12 {
        let mut c = login();
        let s = c.session;
        c.send_request(
            CMD_OBJECT_ACTIVE_SERVICE_LIST,
            s,
            &build_active_service_param(&obj_type, None),
        )
        .expect("액티브 서비스 요청 실패");
        while let Some(pack) = c.read_next_pack().expect("수신 실패") {
            if let AnyPack::Map(map) = pack {
                for a in nscouter_lib::scouter::object::parse_active_services(&map) {
                    if let Some(txid) = a.txid {
                        target = Some((a.obj_hash, a.id, txid, a.service.clone(), a.elapsed));
                    }
                }
            }
        }
        if target.is_some() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(400));
    }

    let (obj_hash, thread_id, txid, service, elapsed) =
        target.expect("실행 중인 트랜잭션이 하나도 안 잡혔다 — 부하가 도는지 확인할 것");
    println!("대상 obj={obj_hash} thread={thread_id} txid={txid} {service} ({elapsed}ms)");

    let mut c = login();
    let s = c.session;
    c.send_request(
        CMD_OBJECT_THREAD_DETAIL,
        s,
        &build_thread_detail_param(obj_hash, thread_id, txid),
    )
    .expect("OBJECT_THREAD_DETAIL 요청 실패");

    let mut maps = 0usize;
    while let Some(pack) = c.read_next_pack().expect("수신 실패") {
        if let AnyPack::Map(map) = pack {
            maps += 1;
            let mut keys: Vec<&String> = map.entries.keys().collect();
            keys.sort();
            for k in keys {
                let v = &map.entries[k];
                let shown = v.to_display();
                let head: String = shown.chars().take(80).collect();
                // **타입까지 찍는다.** 숫자처럼 보여도 Text 로 오면 as_number 가 0을 준다.
                let ty = match v {
                    ScouterValue::Text(_) => "Text",
                    ScouterValue::Decimal(_) => "Decimal",
                    ScouterValue::Float(_) => "Float",
                    ScouterValue::Double(_) => "Double",
                    ScouterValue::Boolean(_) => "Boolean",
                    ScouterValue::Null => "Null",
                    ScouterValue::Blob(_) => "Blob",
                    ScouterValue::List(_) => "List",
                    ScouterValue::Map(_) => "Map",
                };
                println!("   {k:<22} {ty:<8} = {head}{}", if shown.chars().count() > 80 { " …" } else { "" });
            }
        }
    }
    println!("=> MapPack {maps}개");
}

/// 실행 중인 트랜잭션 상세의 계약.
///
/// 목록에서 본 (objHash, 스레드 id, txid) 로 상세를 물으면 **그 트랜잭션의 스택**이 온다.
///
/// 두 가지를 못 박는다 (F-46):
///   1. 응답 MapPack 의 키가 **사람이 읽는 이름**이다 — `"Service Name"`, `"Stack Trace"`.
///      camelCase 로 짐작하면 파서가 전부 빈 값을 만든다.
///   2. `Blocked Time`/`Waited Time` 이 **-1** 로 온다 — 0이 아니라 "측정 꺼짐"이다.
#[test]
#[ignore]
fn live_thread_detail_contract() {
    use nscouter_lib::scouter::object::{build_thread_detail_param, parse_thread_detail};
    use nscouter_lib::scouter::objtype::build_active_service_param;

    let obj_type = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))[0].0.clone()
    };

    // 액티브 서비스는 순간 상태다. 몇 번 훑는다.
    let mut target = None;
    for _ in 0..15 {
        let mut c = login();
        let s = c.session;
        c.send_request(
            CMD_OBJECT_ACTIVE_SERVICE_LIST,
            s,
            &build_active_service_param(&obj_type, None),
        )
        .expect("액티브 서비스 요청 실패");
        while let Some(pack) = c.read_next_pack().expect("수신 실패") {
            if let AnyPack::Map(map) = pack {
                for a in nscouter_lib::scouter::object::parse_active_services(&map) {
                    if let Some(txid) = a.txid {
                        target = Some((a.obj_hash, a.id, txid));
                    }
                }
            }
        }
        if target.is_some() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
    let (obj_hash, thread_id, txid) =
        target.expect("실행 중인 트랜잭션이 안 잡혔다 — 부하가 도는지 확인할 것");

    let mut c = login();
    let s = c.session;
    c.send_request(
        CMD_OBJECT_THREAD_DETAIL,
        s,
        &build_thread_detail_param(obj_hash, thread_id, txid),
    )
    .expect("OBJECT_THREAD_DETAIL 요청 실패");

    let mut first = None;
    let mut maps = 0usize;
    while let Some(pack) = c.read_next_pack().expect("수신 실패") {
        if let AnyPack::Map(map) = pack {
            maps += 1;
            // **첫 팩만 쓴다.** 뒤에 빈 팩이 따라오면 마지막을 잡아 0으로 덮인다.
            if first.is_none() {
                first = Some(map);
            }
        }
    }

    // 여는 사이에 트랜잭션이 끝날 수 있다. 그건 오류가 아니다.
    //
    // **끝난 것과 파싱이 깨진 것을 구별해야 한다** — 둘 다 값이 0/빈 문자열로 보인다.
    // 키가 아예 없으면 끝난 것이고, 키가 있는데 값이 안 읽히면 그건 버그다.
    let Some(map) = first else {
        println!("응답 MapPack 이 없다 — 트랜잭션이 이미 끝났다");
        return;
    };
    let mut keys: Vec<&String> = map.entries.keys().collect();
    keys.sort();
    println!("  MapPack {maps}개 · 키 {keys:?}");
    if !map.entries.contains_key("Thread Id") {
        println!("Thread Id 키가 없다 — 트랜잭션이 이미 끝났다");
        return;
    }

    let d = parse_thread_detail(&map);
    println!(
        "  {} #{} {} · {}ms · blocked={:?} waited={:?}",
        d.thread_name, d.thread_id, d.state, d.service_elapsed, d.blocked_time, d.waited_time
    );

    // 여기서부터는 응답에 값이 실려 있다는 뜻이다.
    // 키를 잘못 읽었으면 전부 빈 값/0이 되므로, 이 단정들이 그 회귀를 잡는다.
    assert_eq!(d.thread_id, thread_id, "요청한 스레드가 아니다");
    assert!(!d.thread_name.is_empty(), "Thread Name 이 비었다 — 키 표기를 확인할 것");
    assert!(!d.state.is_empty(), "State 가 비었다");
    assert!(
        !d.stack_trace.is_empty(),
        "Stack Trace 가 비었다 — 이걸 보려고 여는 화면이다"
    );
    assert!(
        d.stack_trace.contains('('),
        "스택 트레이스 모양이 아니다: {:?}",
        d.stack_trace.chars().take(80).collect::<String>()
    );

    // -1 을 0으로 눕히면 "경합이 전혀 없었다"는 거짓이 된다.
    // 이 환경은 측정이 꺼져 있으므로 None 이어야 한다.
    assert!(
        d.blocked_time.is_none_or(|v| v >= 0),
        "blocked_time 이 음수로 남았다: {:?}",
        d.blocked_time
    );
    assert!(
        d.waited_time.is_none_or(|v| v >= 0),
        "waited_time 이 음수로 남았다: {:?}",
        d.waited_time
    );
}

/// 에이전트 설정 저장의 왕복 계약.
///
/// **읽은 원문을 그대로 되돌려 저장한다.** 설정을 바꾸지 않으면서 저장 경로 전체를 지난다 —
/// 이 테스트가 환경을 망가뜨리면 안 되기 때문이다.
///
/// 확인하는 것 (F-47):
///   1. `result` 가 "true" 로 온다 — 응답이 왔다는 것과 저장됐다는 것은 다르다
///   2. 되읽은 원문이 보낸 것과 같다 — "저장했다"는 말만 믿지 않는다
#[test]
#[ignore]
fn live_agent_config_save_roundtrip() {
    use nscouter_lib::scouter::configure::{escape_config_text, parse_save_result};

    let obj_hash = {
        let mut c = login();
        javaee_objects(&fetch_objects(&mut c))[0].1
    };

    let read_text = |hash: i32| -> String {
        let mut c = login();
        let s = c.session;
        c.send_request(CMD_GET_CONFIGURE_WAS, s, &build_object_param(hash))
            .expect("설정 원문 요청 실패");
        first_map(&mut c).map(|m| parse_config_text(&m)).unwrap_or_default()
    };

    let before = read_text(obj_hash);
    assert!(
        !before.is_empty(),
        "원문이 비었다 — 이 상태로 저장하면 설정이 날아간다. 중단"
    );

    // 역슬래시가 없으면 이스케이프해도 원문 그대로여야 한다.
    // (있으면 되읽은 값이 달라지므로 이 테스트의 전제가 깨진다)
    assert_eq!(
        escape_config_text(&before),
        before,
        "설정에 역슬래시가 있다 — 이 테스트는 그 경우를 다루지 않는다"
    );

    let mut param = build_object_param(obj_hash);
    param.put("setConfig", ScouterValue::Text(before.clone()));

    let mut c = login();
    let s = c.session;
    c.send_request(CMD_SET_CONFIGURE_WAS, s, &param)
        .expect("설정 저장 요청 실패");
    let out = first_map(&mut c).expect("저장 응답이 없다");
    println!("저장 응답 result={:?}", out.get_text("result"));

    // **응답이 왔다를 성공으로 읽으면 안 된다.** 실패해도 MapPack 은 온다.
    parse_save_result(&out).expect("저장이 실패했다");

    // 저장했다는 말만 믿지 않는다.
    let after = read_text(obj_hash);
    assert_eq!(after, before, "되읽은 원문이 보낸 것과 다르다");
    println!("왕복 확인 {}자", after.len());
}


/// 프로파일 본문 검색이 **실제 데이터에서 걸리는가**.
///
/// 순수 로직은 단위 테스트가 덮는다. 여기서 확인할 것은 그 위의 것들이다:
///   1. 사전 종류를 맞게 골랐는가 — `hmsg` 를 `method` 로 물으면 조용히 빈다 (F-15)
///   2. 실서버 SQL 텍스트가 실제로 검색어에 걸리는가
///   3. 없는 말은 안 걸리는가 — 전부 걸리면 검색이 아니다
#[test]
#[ignore]
fn live_profile_text_search() {
    use nscouter_lib::scouter::dictionary::TextCache;
    use nscouter_lib::scouter::profile_search::{collect_hashes, search_steps, StepTexts};
    use nscouter_lib::scouter::protocol::text_type;

    let mut conn = login();
    let objs = fetch_objects(&mut conn);
    let hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();

    let cursor = StreamCursor::default();
    let param = build_request_param(&hashes, &cursor);
    let session = conn.session;
    conn.send_request(CMD_TRANX_REAL_TIME_GROUP_LATEST, session, &param)
        .expect("XLog 요청 실패");

    let mut xlogs = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("XLog 수신 실패") {
        if let AnyPack::XLog(x) = pack {
            // SQL 이 있는 트랜잭션이라야 검색할 텍스트가 있다.
            if x.sql_count > 0 {
                xlogs.push((x.txid, x.obj_hash, x.end_time));
            }
        }
    }
    assert!(!xlogs.is_empty(), "SQL 이 있는 XLog 가 없다 — 부하가 도는지 확인할 것");

    // 프로파일을 모으고 사전을 채운다.
    let mut cache = TextCache::new();
    let mut all_sql: Vec<String> = Vec::new();
    let mut steps_by_tx = Vec::new();

    for (txid, obj_hash, end_time) in xlogs.iter().take(12) {
        let date = yyyymmdd_local(*end_time);
        let mut c = login();
        let s = c.session;
        let mut p = MapPack::new();
        p.put("txid", ScouterValue::Decimal(*txid));
        p.put("date", ScouterValue::Text(date));
        p.put("objHash", ScouterValue::Decimal(*obj_hash as i64));
        c.send_request(CMD_TRANX_PROFILE, s, &p).expect("프로파일 요청 실패");

        let mut steps = Vec::new();
        while let Some(pack) = c.read_next_pack().expect("프로파일 수신 실패") {
            if let AnyPack::Profile(pp) = pack {
                steps.extend(pp.steps);
            }
        }
        if steps.is_empty() {
            continue;
        }

        let h = collect_hashes(&steps);
        for (key, list) in [
            (text_type::METHOD, &h.method),
            (text_type::SQL, &h.sql),
            (text_type::APICALL, &h.apicall),
            (text_type::ERROR, &h.error),
            (text_type::HASH_MSG, &h.hmsg),
        ] {
            let missing = cache.missing(key, list);
            if !missing.is_empty() {
                let mut c2 = login();
                nscouter_lib::scouter::dictionary::fetch_texts(&mut c2, &mut cache, key, &missing)
                    .expect("사전 조회 실패");
            }
        }
        for hh in &h.sql {
            if let Some(t) = cache.get(text_type::SQL, *hh) {
                all_sql.push(t.to_string());
            }
        }
        steps_by_tx.push(steps);
    }

    assert!(!steps_by_tx.is_empty(), "프로파일을 하나도 못 받았다");
    assert!(!all_sql.is_empty(), "SQL 텍스트를 하나도 못 풀었다 — 사전 종류를 확인할 것");
    println!("프로파일 {}건 · SQL 텍스트 {}개", steps_by_tx.len(), all_sql.len());
    println!("  예: {}", all_sql[0].chars().take(90).collect::<String>());

    // 실제 SQL 에서 뽑은 단어는 반드시 걸려야 한다.
    let needle = all_sql[0]
        .split_whitespace()
        .find(|w| w.len() >= 4 && w.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
        .expect("SQL 에서 검색어로 쓸 낱말을 못 찾았다")
        .to_lowercase();
    println!("  검색어: {needle}");

    let mf = |x: i32| cache.get(text_type::METHOD, x).map(|s| s.to_string());
    let sf = |x: i32| cache.get(text_type::SQL, x).map(|s| s.to_string());
    let af = |x: i32| cache.get(text_type::APICALL, x).map(|s| s.to_string());
    let ef = |x: i32| cache.get(text_type::ERROR, x).map(|s| s.to_string());
    let hf = |x: i32| cache.get(text_type::HASH_MSG, x).map(|s| s.to_string());
    let texts = StepTexts { method: &mf, sql: &sf, apicall: &af, error: &ef, hmsg: &hf };

    let matched = steps_by_tx
        .iter()
        .filter(|steps| !search_steps(steps, &texts, &needle).is_empty())
        .count();
    println!("  적중 {matched}/{}", steps_by_tx.len());
    assert!(matched > 0, "실제 SQL 에서 뽑은 낱말이 하나도 안 걸린다");

    // 없는 말은 안 걸려야 한다. 전부 걸리면 검색이 아니라 통과다.
    let none = steps_by_tx
        .iter()
        .filter(|steps| !search_steps(steps, &texts, "zzz_nonexistent_needle_zzz").is_empty())
        .count();
    assert_eq!(none, 0, "없는 말이 걸렸다");
}


/// 탐침: SQL 스텝의 **바인딩 파라미터 원문**이 어떤 모양인가.
///
/// 채워 넣으려면 세 가지를 알아야 한다:
///   1. 구분자가 무엇인가 (쉼표? 줄바꿈?)
///   2. 문자열 값에 따옴표가 붙어 오는가
///   3. SQL 쪽 자리표시자가 `?` 인가 `@{n}` 인가 (EscapeLiteralSQL 이 켜져 있으면 후자)
#[test]
#[ignore]
fn probe_sql_bind_params() {
    use nscouter_lib::scouter::dictionary::TextCache;
    use nscouter_lib::scouter::profile::ProfileStep;
    use nscouter_lib::scouter::protocol::text_type;

    let mut conn = login();
    let objs = fetch_objects(&mut conn);
    let hashes: Vec<i32> = objs.iter().map(|(_, h)| *h).collect();

    let cursor = StreamCursor::default();
    let param = build_request_param(&hashes, &cursor);
    let session = conn.session;
    conn.send_request(CMD_TRANX_REAL_TIME_GROUP_LATEST, session, &param)
        .expect("XLog 요청 실패");

    let mut xlogs = Vec::new();
    while let Some(pack) = conn.read_next_pack().expect("XLog 수신 실패") {
        if let AnyPack::XLog(x) = pack {
            if x.sql_count > 0 {
                xlogs.push((x.txid, x.obj_hash, x.end_time));
            }
        }
    }
    assert!(!xlogs.is_empty(), "SQL 이 있는 XLog 가 없다");

    let mut cache = TextCache::new();
    let mut shown = 0usize;

    for (txid, obj_hash, end_time) in xlogs.iter().take(25) {
        let date = yyyymmdd_local(*end_time);
        let mut c = login();
        let s = c.session;
        let mut p = MapPack::new();
        p.put("txid", ScouterValue::Decimal(*txid));
        p.put("date", ScouterValue::Text(date));
        p.put("objHash", ScouterValue::Decimal(*obj_hash as i64));
        c.send_request(CMD_TRANX_PROFILE, s, &p).expect("프로파일 요청 실패");

        let mut steps = Vec::new();
        while let Some(pack) = c.read_next_pack().expect("프로파일 수신 실패") {
            if let AnyPack::Profile(pp) = pack {
                steps.extend(pp.steps);
            }
        }

        let sql_hashes: Vec<i32> = steps
            .iter()
            .filter_map(|st| match st {
                ProfileStep::Sql(sq) if sq.hash != 0 => Some(sq.hash),
                _ => None,
            })
            .collect();
        let missing = cache.missing(text_type::SQL, &sql_hashes);
        if !missing.is_empty() {
            let mut c2 = login();
            nscouter_lib::scouter::dictionary::fetch_texts(
                &mut c2, &mut cache, text_type::SQL, &missing,
            )
            .expect("SQL 사전 조회 실패");
        }

        for st in &steps {
            if let ProfileStep::Sql(sq) = st {
                if sq.param.is_empty() {
                    continue;
                }
                let sql = cache.get(text_type::SQL, sq.hash).unwrap_or("(못 품)");
                println!("--- param={:?}", sq.param);
                println!("    sql  ={}", sql.chars().take(160).collect::<String>());
                println!(
                    "    ? 개수={} · @{{n}} 있음={}",
                    sql.matches('?').count(),
                    sql.contains("@{")
                );
                shown += 1;
                if shown >= 8 {
                    return;
                }
            }
        }
    }
    println!("=> 파라미터가 실린 SQL 스텝을 {shown}건 봤다");
}

/// 흐름 보기(FlowTreeView)가 ThreadCall 을 서비스 노드로 이을 수 있는가.
///
/// 다른 스레드로 넘어간 작업의 txid 가 **부모와 같은 gxid 그룹**으로 들어와야
/// 흐름 트리에서 그 서비스를 이어 붙일 수 있다. 안 들어오면 잎으로만 그린다.
/// 이 답이 `flowTree.ts` 의 ThreadCall 분기를 가른다 (F-48).
///
/// 스텝 종류 집계도 함께 찍는다 — `Dispatch(13)` / `ThreadSubmit(7)` / `Span(51,52)`
/// 이 이 환경에 나타나기 시작하면 여기서 먼저 보인다.
#[test]
#[ignore]
fn live_flow_threadcall_links_child_xlog() {
    use nscouter_lib::scouter::past::{build_past_xlog_param, PastCursor};
    use nscouter_lib::scouter::profile::{build_full_profile_param, parse_profile_steps, ProfileStep};
    use nscouter_lib::scouter::trace::build_gxid_param;
    use std::collections::HashMap;

    let mut conn = login();
    let hashes: Vec<i32> = fetch_objects(&mut conn).iter().map(|(_, h)| *h).collect();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let date = yyyymmdd_local(now);

    let param = build_past_xlog_param(
        &hashes,
        &date,
        now - 15 * 60 * 1000,
        now,
        400,
        &PastCursor::default(),
    );
    let s = conn.session;
    conn.send_request(CMD_TRANX_LOAD_TIME_GROUP_V2, s, &param).expect("과거 XLog 요청 실패");

    // (txid, gxid)
    let mut txs: Vec<(i64, i64)> = Vec::new();
    while let Some(p) = conn.read_next_pack().expect("수신 실패") {
        if let AnyPack::XLog(x) = p {
            txs.push((x.txid, x.gxid));
        }
    }
    assert!(!txs.is_empty(), "트랜잭션이 없다");
    println!("XLog {}건", txs.len());

    let mut kinds: HashMap<&'static str, usize> = HashMap::new();
    let mut unknown: HashMap<u8, usize> = HashMap::new();
    // (부모 txid, 부모 gxid, ThreadCall txid, threaded)
    let mut tcalls: Vec<(i64, i64, i64, bool)> = Vec::new();

    // 앞에서 120건만 보면 그 구간이 통째로 한 앱 것일 때 비동기가 한 건도 안 잡힌다.
    // 실제로 그렇게 헛돌았다 — 충분히 모이면 끊는 쪽이 맞다.
    for (txid, gxid) in txs.iter() {
        if tcalls.len() >= 5 {
            break;
        }
        let mut c = login();
        let cs = c.session;
        if c
            .send_request(CMD_TRANX_PROFILE_FULL, cs, &build_full_profile_param(&date, *txid))
            .is_err()
        {
            continue;
        }
        let blob = match c.read_blob_stream() {
            Ok(b) => b,
            Err(_) => continue,
        };

        for st in parse_profile_steps(blob) {
            let name = match &st {
                ProfileStep::Method(_) => "Method",
                ProfileStep::Sql(_) => "Sql",
                ProfileStep::Message(_) => "Message",
                ProfileStep::ApiCall(_) => "ApiCall",
                ProfileStep::Socket(_) => "Socket",
                ProfileStep::ThreadCall(t) => {
                    if t.txid != 0 {
                        tcalls.push((*txid, *gxid, t.txid, t.threaded));
                    }
                    "ThreadCall"
                }
                ProfileStep::Unknown { step_type, .. } => {
                    *unknown.entry(*step_type).or_insert(0) += 1;
                    "Unknown"
                }
            };
            *kinds.entry(name).or_insert(0) += 1;
        }
    }

    let mut rows: Vec<_> = kinds.iter().collect();
    rows.sort();
    println!("스텝 종류: {rows:?}");
    let mut ur: Vec<_> = unknown.iter().collect();
    ur.sort();
    println!("Unknown step_type 내역: {ur:?}  (13=Dispatch, 7=ThreadSubmit, 12=Dump)");
    println!("txid 를 가진 ThreadCall {}개", tcalls.len());

    assert!(
        tcalls.iter().any(|(_, _, _, threaded)| *threaded),
        "threaded=true 인 ThreadCall 이 없다 — 비동기 트래픽이 도는지 확인할 것"
    );

    // ThreadCall 이 가리키는 txid 가 부모의 gxid 그룹에 들어오는가
    let mut linkable = 0usize;
    for (ptx, gxid, tctx, threaded) in tcalls.iter().take(5) {
        if *gxid == 0 {
            println!("   부모 txid={ptx} 는 gxid=0 — 그룹 조회 불가 (threaded={threaded})");
            continue;
        }
        let mut c = login();
        let cs = c.session;
        c.send_request(CMD_XLOG_READ_BY_GXID, cs, &build_gxid_param(&date, *gxid))
            .expect("gxid 조회 실패");
        let mut group = Vec::new();
        while let Some(p) = c.read_next_pack().expect("수신 실패") {
            if let AnyPack::XLog(x) = p {
                group.push((x.txid, x.caller, x.elapsed, x.service));
            }
        }
        let txids: Vec<i64> = group.iter().map(|g| g.0).collect();
        println!(
            "   부모 txid={ptx} gxid={gxid} threaded={threaded} → ThreadCall txid={tctx} 그룹포함={} (그룹 {}건)",
            txids.contains(tctx),
            group.len()
        );
        for (tx, caller, elapsed, service) in &group {
            println!("      txid={tx} caller={caller} elapsed={elapsed} service={service}");
        }

        // 넘어간 트랜잭션은 부모를 caller 로 달고 같은 그룹에 들어온다.
        // 이 둘이 맞아야 흐름 트리가 **서비스 노드**로 잇는다 (잎이 아니라).
        if group.iter().any(|(tx, caller, _, _)| tx == tctx && caller == ptx) {
            linkable += 1;
        }
    }

    assert!(
        linkable > 0,
        "ThreadCall 의 txid 가 부모 gxid 그룹에 없다 — 흐름 트리는 잎으로만 그릴 수 있다"
    );
}
