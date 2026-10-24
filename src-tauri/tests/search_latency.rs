//! 원격 콜렉터에서 텍스트 검색이 얼마나 느려지나 (백로그 B-3).
//!
//! 로컬 콜렉터는 왕복이 0.2ms 라 「워커 8」(`SEARCH_WORKERS`) 의 근거가
//! 원격에서도 맞는지 알 수 없었다. 가운데에 **TCP 를 늦추는 프록시**를 세워
//! 왕복만 바꿔 가며 워커 수별 처리량을 잰다. 콜렉터·데이터는 그대로다.
//!
//! ```
//! cargo test --test search_latency -- --ignored --nocapture
//! ```
//!
//! 재는 경로는 화면 검색이 쓰는 그 함수다(`fetch_profiles_parallel`).

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use nscouter_lib::commands::{fetch_profiles_parallel, SearchTarget};
use nscouter_lib::scouter::protocol::CMD_TRANX_LOAD_TIME_GROUP_V2;
use nscouter_lib::scouter::connection::ScouterConnection;
use nscouter_lib::scouter::pack::AnyPack;
use nscouter_lib::scouter::past::{build_past_xlog_param, PastCursor};

const HOST: &str = "127.0.0.1";
const PORT: u16 = 6100;
const USER: &str = "admin";
const PASS: &str = "admin";

/// 표본 수. 왕복 40ms · 워커 8 이면 한 번에 2~3초다.
const SAMPLE: usize = 200;

/// 한쪽 방향 지연을 넣어 중계한다. 돌려주는 값은 **붙을 포트**.
///
/// 왕복은 이 값의 두 배다. 연결 자체에도 한 번 값을 더한다 — 원격은
/// 핸드셰이크부터 멀기 때문이다(요청마다 소켓을 새로 연다, F-1).
fn start_delay_proxy(one_way: Duration) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("프록시 바인드 실패");
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for client in listener.incoming() {
            let Ok(client) = client else { continue };
            thread::spawn(move || {
                thread::sleep(one_way);
                let Ok(server) = TcpStream::connect((HOST, PORT)) else { return };
                let (c2, s2) = (client.try_clone().unwrap(), server.try_clone().unwrap());
                let up = thread::spawn(move || pipe(client, server, one_way));
                pipe(s2, c2, one_way);
                let _ = up.join();
            });
        }
    });
    port
}

/// 읽은 덩어리를 `one_way` **뒤에** 내보낸다.
///
/// 내보내는 쪽이 따로 돌기 때문에 이어 붙은 덩어리도 각자 자기 시각에 나간다 —
/// 한 덩어리마다 지연을 곱해 버리면(동기 전송) 큰 응답이 터무니없이 느려져
/// 지연 회선이 아니라 좁은 회선을 재게 된다.
fn pipe(mut from: TcpStream, mut to: TcpStream, one_way: Duration) {
    let (tx, rx) = mpsc::channel::<(Instant, Vec<u8>)>();
    let writer = thread::spawn(move || {
        while let Ok((due, buf)) = rx.recv() {
            let now = Instant::now();
            if due > now {
                thread::sleep(due - now);
            }
            if to.write_all(&buf).is_err() {
                break;
            }
            let _ = to.flush();
        }
        let _ = to.shutdown(std::net::Shutdown::Write);
    });
    let mut buf = [0u8; 8192];
    loop {
        match from.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if tx.send((Instant::now() + one_way, buf[..n].to_vec())).is_err() {
                    break;
                }
            }
        }
    }
    drop(tx);
    let _ = writer.join();
}

fn yyyymmdd_local(ms: i64) -> String {
    use chrono::{Local, TimeZone};
    Local.timestamp_millis_opt(ms).unwrap().format("%Y%m%d").to_string()
}

#[test]
#[ignore]
fn probe_search_workers_under_latency() {
    let mut conn = ScouterConnection::connect(HOST, PORT).expect("콜렉터 연결 실패");
    conn.login(USER, PASS).expect("로그인 실패");
    let session = conn.session;

    // 오브젝트 목록
    let mut hashes: Vec<i32> = Vec::new();
    {
        use nscouter_lib::scouter::protocol::CMD_OBJECT_LIST_REAL_TIME;
        use nscouter_lib::scouter::pack::MapPack;
        conn.send_request(CMD_OBJECT_LIST_REAL_TIME, session, &MapPack::new())
            .expect("오브젝트 목록 요청 실패");
        while let Some(p) = conn.read_next_pack().expect("수신 실패") {
            if let AnyPack::Object(o) = p {
                hashes.push(o.obj_hash);
            }
        }
    }
    assert!(!hashes.is_empty(), "오브젝트가 없다 — Test 환경이 떠 있는지 확인할 것");

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let date = yyyymmdd_local(now);
    let param = build_past_xlog_param(
        &hashes,
        &date,
        now - 10 * 60 * 1000,
        now,
        SAMPLE as i32 * 2,
        &PastCursor::default(),
    );
    conn.send_request(CMD_TRANX_LOAD_TIME_GROUP_V2, session, &param)
        .expect("과거 XLog 요청 실패");
    let mut targets: Vec<SearchTarget> = Vec::new();
    while let Some(p) = conn.read_next_pack().expect("수신 실패") {
        if let AnyPack::XLog(x) = p {
            targets.push(SearchTarget {
                txid: x.txid.to_string(),
                obj_hash: x.obj_hash,
                date: yyyymmdd_local(x.end_time),
            });
        }
    }
    targets.truncate(SAMPLE);
    assert!(targets.len() >= 20, "표본이 {}건뿐이다 — 부하를 먼저 돌릴 것", targets.len());
    println!("표본 {}건\n", targets.len());

    // 캐시를 고르게 해 둔다 — 뒤 회차가 공짜로 빨라지면 비교가 안 된다.
    let _ = fetch_profiles_parallel(HOST, PORT, session, &targets, 8);

    let n = targets.len();
    for one_way_ms in [0u64, 5, 20, 50] {
        let port = start_delay_proxy(Duration::from_millis(one_way_ms));
        println!("── 왕복 {}ms (한쪽 {}ms) ──", one_way_ms * 2, one_way_ms);
        for workers in [1usize, 8, 16, 32, 64] {
            // 순차 1건은 왕복이 크면 몇십 초가 걸린다 — 기준만 보면 된다
            if workers == 1 && one_way_ms >= 20 {
                continue;
            }
            let t = Instant::now();
            let got = fetch_profiles_parallel(HOST, port, session, &targets, workers);
            let el = t.elapsed();
            let ok = got.iter().filter(|v| v.is_some()).count();
            println!(
                "  워커 {workers:>2}: {:>7.2}s (건당 {:>6.1}ms) 적중 {ok}/{n}{}",
                el.as_secs_f64(),
                el.as_secs_f64() * 1000.0 / n as f64,
                if ok < n { "  ← 실패 있음" } else { "" }
            );
        }
        println!();
    }
}
