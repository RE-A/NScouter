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
    let _ = fetch_profiles_parallel(HOST, PORT, session, &targets, 8, None);

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
            let got = fetch_profiles_parallel(HOST, port, session, &targets, workers, None);
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

/// 구간 하나를 페이지로 넘겨 가며 다 받는다. 받은 행 수
fn fetch_range(port: u16, session: i64, hashes: &[i32], date: &str, s: i64, e: i64, page: i32) -> usize {
    let mut conn = ScouterConnection::connect(HOST, port).expect("연결 실패");
    conn.session = session;
    let mut cursor = PastCursor::default();
    let mut seen = std::collections::HashSet::new();
    loop {
        let param = build_past_xlog_param(hashes, date, s, e, page, &cursor);
        conn.send_request(CMD_TRANX_LOAD_TIME_GROUP_V2, session, &param).expect("요청 실패");
        let mut next = PastCursor::default();
        let mut rows = 0;
        while let Some(p) = conn.read_next_pack().expect("수신 실패") {
            match p {
                AnyPack::XLog(x) => {
                    rows += 1;
                    seen.insert(x.txid);
                }
                AnyPack::Map(m) => next = nscouter_lib::scouter::past::parse_past_cursor(&m),
                _ => {}
            }
        }
        if !next.has_more || rows == 0 || next.last_xlog_time <= cursor.last_xlog_time {
            return seen.len();
        }
        cursor = next;
    }
}

/// MCP 목록 조회가 구간을 조각으로 나눠 **연결 여럿으로 동시에** 받는 것(`SCAN_PARALLEL`)이
/// 왕복이 큰 콜렉터에서 얼마나 빨라지나.
///
/// ```
/// cargo test --test search_latency probe_scan_parallel -- --ignored --nocapture
/// ```
#[test]
#[ignore]
fn probe_scan_parallel_under_latency() {
    let mut conn = ScouterConnection::connect(HOST, PORT).expect("콜렉터 연결 실패");
    conn.login(USER, PASS).expect("로그인 실패");
    let session = conn.session;
    let mut hashes: Vec<i32> = Vec::new();
    {
        use nscouter_lib::scouter::pack::MapPack;
        use nscouter_lib::scouter::protocol::CMD_OBJECT_LIST_REAL_TIME;
        conn.send_request(CMD_OBJECT_LIST_REAL_TIME, session, &MapPack::new()).expect("오브젝트 목록 요청 실패");
        while let Some(p) = conn.read_next_pack().expect("수신 실패") {
            if let AnyPack::Object(o) = p {
                hashes.push(o.obj_hash);
            }
        }
    }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    // 자정을 넘지 않게 — 날짜가 바뀌면 조회가 둘로 갈린다
    let span = 9 * 60_000;
    let (s, e) = (now - span, now);
    let date = yyyymmdd_local(s);
    let slices: Vec<(i64, i64)> = (0..3).map(|i| (s + i * span / 3, s + (i + 1) * span / 3)).collect();

    for one_way_ms in [0u64, 10, 20] {
        let port = start_delay_proxy(Duration::from_millis(one_way_ms));
        // 페이지를 작게 잡아 «페이지 수 × 왕복» 이 드러나게 한다 (운영 50만 건/시간이면 5,000 건 페이지가 이만큼 나온다)
        for page in [500i32, 5000] {
            let t = Instant::now();
            let n1 = fetch_range(port, session, &hashes, &date, s, e, page);
            let seq = t.elapsed();
            let t = Instant::now();
            let n4: usize = thread::scope(|sc| {
                let hs = &hashes;
                let d = &date;
                let h: Vec<_> = slices.iter().map(|&(a, b)| sc.spawn(move || fetch_range(port, session, hs, d, a, b, page))).collect();
                h.into_iter().map(|j| j.join().unwrap()).sum()
            });
            let par = t.elapsed();
            println!(
                "왕복 {:>2}ms · 페이지 {page:>4}: 순차 {:>6.2}s ({n1}건) · 조각 3개 동시 {:>6.2}s ({n4}건) → {:.1}배",
                one_way_ms * 2,
                seq.as_secs_f64(),
                par.as_secs_f64(),
                seq.as_secs_f64() / par.as_secs_f64().max(0.001)
            );
        }
    }
}
