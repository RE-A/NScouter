// 통계 비교 엔진 실측 — 실제 콜렉터 둘(A: shop-app, B: order-app)에서 현재·기준 구간을 훑는다.
//
// `multi_collector_apps.rs` 와 같은 환경(부하가 도는 중)이 필요하다. 최근 15분 안의 구간을 쓴다.
//
//   cargo test --test stats_live -- --ignored --nocapture

use std::path::PathBuf;
use std::sync::Arc;

use nscouter_lib::commands::connect_links;
use nscouter_lib::config::AppConfig;
use nscouter_lib::hub::ConnectTarget;
use nscouter_lib::state::AppState;
use nscouter_lib::stats::engine::{estimate, run, Control};
use nscouter_lib::stats::raw::RawSink;
use nscouter_lib::stats::model::{ServiceStats, StatsRange, StatsRequest};

const KST: i64 = 9 * 3600 * 1000;
const MIN: i64 = 60_000;

fn port(var: &str, default: u16) -> u16 {
    std::env::var(var).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn target(name: &str, port: u16) -> ConnectTarget {
    ConnectTarget { name: name.into(), host: "127.0.0.1".into(), port, user: "admin".into(), pass: "admin".into() }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64
}

async fn connected() -> Arc<AppState> {
    let dir: PathBuf = std::env::temp_dir().join(format!("nscouter-stats-live-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let st = Arc::new(AppState::new_with_config(AppConfig::default(), dir.join("config.json")));
    connect_links(&st, vec![target("A", port("NSC_PORT_A", 16100)), target("B", port("NSC_PORT_B", 16200))])
        .await
        .expect("접속 실패");
    st
}

fn request(servers: &[&str]) -> StatsRequest {
    // 5분 경계로 내린 «지금» 앞의 5분이 현재, 그 앞 5분이 기준
    let end = now_ms() / (5 * MIN) * (5 * MIN);
    StatsRequest {
        title: "live".into(),
        groups: vec![],
        servers: servers.iter().map(|s| s.to_string()).collect(),
        task_patterns: vec![],
        current: StatsRange { stime: end - 5 * MIN, etime: end },
        baselines: vec![StatsRange { stime: end - 10 * MIN, etime: end - 5 * MIN }],
        services: vec![],
        service_include: vec![],
        service_exclude: vec![],
        ip_include: vec![],
        ip_exclude: vec![],
        tz_offset_ms: KST,
        raw: false,
    }
}

async fn go(st: &Arc<AppState>, req: StatsRequest) -> (Vec<ServiceStats>, usize, Vec<String>) {
    let st = st.clone();
    tokio::task::spawn_blocking(move || {
        let ctl = Control::default();
        let t0 = std::time::Instant::now();
        let (cov, book, collectors) = run(&st, &req, &ctl, None, &|_| {}).expect("통계 실패");
        let missing: usize = cov.iter().map(|c| c.missing.len()).sum();
        let scanned: u64 = cov.iter().map(|c| c.scanned).sum();
        println!(
            "  {:?}: 조각 {} · 받은 것 {scanned} · 빠진 조각 {missing} · {:?}",
            req.servers,
            cov.iter().map(|c| c.slices).sum::<usize>(),
            t0.elapsed()
        );
        (book.finish(req.current.secs(), req.baselines.iter().map(|b| b.secs()).sum()), missing, collectors)
    })
    .await
    .unwrap()
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn 콜렉터_둘에서_현재와_기준을_훑어_서비스별로_비교한다() {
    let st = connected().await;

    // ── shop-app (콜렉터 A) ──
    let (rows, missing, collectors) = go(&st, request(&["shop-app"])).await;
    println!("  콜렉터 {collectors:?}");
    for r in rows.iter().take(8) {
        let c = r.current.as_ref();
        let b = r.baseline.as_ref();
        println!(
            "    {:<28} 현재 {:>5}건 avg {:>6.1} p90 {:>5} err {:>5.2}% | 기준 {:>5}건 avg {:>6.1}",
            r.service,
            c.map_or(0, |s| s.count),
            c.map_or(0.0, |s| s.avg_ms),
            c.map_or(0, |s| s.p90_ms),
            c.map_or(0.0, |s| s.error_rate * 100.0),
            b.map_or(0, |s| s.count),
            b.map_or(0.0, |s| s.avg_ms),
        );
    }
    assert_eq!(missing, 0, "빠진 조각이 없어야 한다");
    assert!(!rows.is_empty(), "shop-app 서비스가 하나도 없다");
    assert!(rows.iter().all(|r| !r.service.contains("/order")), "order-app(B) 서비스가 섞였다");
    let both = rows.iter().filter(|r| r.current.is_some() && r.baseline.is_some()).count();
    assert!(both > 0, "현재·기준 둘 다 있는 서비스가 없다");
    let top = rows[0].current.as_ref().expect("현재 건수 순 첫 줄");
    assert!(top.count > 0 && top.p50_ms <= top.p90_ms && top.p90_ms <= top.max_ms);
    assert!(top.slowest.len() <= 5 && !top.slowest.is_empty(), "가장 느린 표본");
    assert!(!top.series.is_empty(), "5분 추이");

    // ── order-app (콜렉터 B) — 다른 콜렉터도 같은 방식으로 ──
    let (rows_b, missing_b, _) = go(&st, request(&["order-app"])).await;
    assert_eq!(missing_b, 0);
    assert!(!rows_b.is_empty() && rows_b.iter().all(|r| !r.service.contains("/shop")));

    // ── Task 이름 규칙 — `shop-*` 는 shop-app 만, 이름이 같으면 서버 글자로 고른 것과 같은 결과 ──
    let mut req = request(&[]);
    req.task_patterns = vec!["SHOP-*".into()];
    let (by_rule, missing_r, _) = go(&st, req).await;
    assert_eq!(missing_r, 0);
    let names = |v: &[ServiceStats]| {
        let mut n: Vec<(String, u64)> = v.iter().map(|r| (r.service.clone(), r.current.as_ref().map_or(0, |s| s.count))).collect();
        n.sort();
        n
    };
    println!("  규칙 shop-*: 서비스 {}개", by_rule.len());
    assert_eq!(names(&by_rule), names(&rows), "규칙으로 고른 것과 이름 글자로 고른 것이 같아야 한다");
    let mut req = request(&[]);
    req.task_patterns = vec!["shop-?".into()];
    let st4 = st.clone();
    let err = tokio::task::spawn_blocking(move || run(&st4, &req, &Control::default(), None, &|_| {}).err()).await.unwrap();
    assert!(err.is_some_and(|e| e.contains("찾지 못했습니다")), "아무 서버도 안 걸리면 알려야 한다");

    // ── 수집 조건: 서비스 포함 ──
    let first = rows[0].service.clone();
    let mut req = request(&["shop-app"]);
    req.service_include = vec![first.clone()];
    let (only, _, _) = go(&st, req).await;
    assert!(only.iter().all(|r| r.service.to_lowercase().contains(&first.to_lowercase())));
    assert!(only.len() <= rows.len());

    // ── 수집 조건: IP 전부 제외 → 아무것도 없다 ──
    let mut req = request(&["shop-app"]);
    req.ip_exclude = vec![".".into()]; // IPv4 는 모두 점을 품는다
    let (none, _, _) = go(&st, req).await;
    assert!(none.is_empty(), "IP 를 전부 빼면 남는 것이 없어야 한다: {}", none.len());

    // ── 직접 고른 서비스 ──
    let mut req = request(&["shop-app"]);
    req.services = vec![first.clone(), "/없는-서비스".into()];
    let (picked, _, _) = go(&st, req).await;
    println!("  직접 고름: {:?}", picked.iter().map(|r| &r.service).collect::<Vec<_>>());
    assert!(picked.iter().any(|r| r.service == first));
    assert!(picked.len() <= 2);

    // ── 원본 CSV — 센 건수만큼 줄이 있고 서버 이름이 찬다 ──
    let path = std::env::temp_dir().join(format!("nscouter-stats-raw-{}.csv", std::process::id()));
    let sink = RawSink::create(&path).unwrap();
    let req = request(&["shop-app"]);
    let st3 = st.clone();
    let (cov, book) = {
        let sink = &sink;
        let st3 = st3.clone();
        let req = req.clone();
        // RawSink 는 빌림으로 넘기므로 같은 스레드에서 돈다 (spawn_blocking 대신 block_in_place)
        tokio::task::block_in_place(move || {
            let (cov, book, _) = run(&st3, &req, &Control::default(), Some(sink), &|_| {}).unwrap();
            (cov, book)
        })
    };
    let (_, rows_raw, _, err) = sink.finish();
    let counted: u64 = book.finish(1.0, 1.0).iter().map(|r| r.current.as_ref().map_or(0, |s| s.count) + r.baseline.as_ref().map_or(0, |s| s.count)).sum();
    let body = std::fs::read_to_string(&path).unwrap();
    println!("  원본 CSV {rows_raw}줄 · 집계 {counted}건 · 빠진 조각 {}", cov.iter().map(|c| c.missing.len()).sum::<usize>());
    println!("    {}", body.lines().nth(1).unwrap_or(""));
    assert_eq!(err, None);
    assert_eq!(rows_raw, counted, "원본 줄 수와 집계 건수가 같아야 한다");
    assert_eq!(body.lines().count() as u64, rows_raw + 1);
    assert!(body.lines().skip(1).all(|l| l.split(',').nth(3).is_some_and(|s| s.contains("shop-app"))), "서버 칸이 비었다");
    let _ = std::fs::remove_file(&path);

    // ── 예상 건수 — 실제 훑은 것과 크게 다르지 않다 ──
    let st2 = st.clone();
    let est = tokio::task::spawn_blocking(move || estimate(&st2, &request(&["shop-app"]))).await.unwrap().expect("예상 실패");
    let real: u64 = rows.iter().map(|r| r.current.as_ref().map_or(0, |s| s.count) + r.baseline.as_ref().map_or(0, |s| s.count)).sum();
    println!("  예상 {} · 실제 {real}", est.total);
    assert!(est.total > 0);
}

/// 건수 미리 보기(서비스 요약)가 실제보다 큰 까닭을 잰다 — 구간 경계를 바꿔 가며 견준다
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn 예상_건수와_실제_건수를_구간_경계별로_견준다() {
    let st = connected().await;
    let end = now_ms() / (5 * MIN) * (5 * MIN);
    let cases: Vec<(&str, i64, i64)> = vec![
        ("5분 정렬", end - 10 * MIN, end - 5 * MIN),
        ("10분 정렬", end - 15 * MIN, end - 5 * MIN),
        ("5분 정렬 안쪽 1초", end - 10 * MIN + 1000, end - 5 * MIN - 1000),
        ("5분 2분30초 밀림", end - 10 * MIN + 150_000, end - 5 * MIN + 150_000),
        ("1분", end - 7 * MIN, end - 6 * MIN),
    ];
    for (label, s, e) in cases {
        let mut req = request(&["shop-app"]);
        req.current = StatsRange { stime: s, etime: e };
        req.baselines = vec![StatsRange { stime: s, etime: e }];
        let st2 = st.clone();
        let r2 = req.clone();
        let est = tokio::task::spawn_blocking(move || estimate(&st2, &r2)).await.unwrap().unwrap();
        let (rows, _, _) = go(&st, req).await;
        let real: u64 = rows.iter().map(|r| r.current.as_ref().map_or(0, |s| s.count)).sum();
        let guess = est.ranges[0].count;
        println!("  {label:<16} 예상 {guess:>6} · 실제 {real:>6} · 비 {:.2}", guess as f64 / real.max(1) as f64);
    }
}

/// 요약 점 하나가 «앞 5분» 몫인지 «뒤 5분» 몫인지 — 데이터가 시작된 시각 근처의 점을 하나씩 물어 실제 5분 칸과 견준다
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn 요약_점은_어느_5분_몫인가() {
    let st = connected().await;
    let first: i64 = std::env::var("NSC_DATA_START").ok().and_then(|v| v.parse().ok()).expect("NSC_DATA_START(ms)");
    let t0 = first / (5 * MIN) * (5 * MIN);
    for k in 0..4 {
        let t = t0 + k * 5 * MIN;
        let mut req = request(&["shop-app"]);
        req.current = StatsRange { stime: t, etime: t + 1 };
        req.baselines = vec![req.current];
        let st2 = st.clone();
        let est = tokio::task::spawn_blocking(move || estimate(&st2, &req)).await.unwrap().unwrap().ranges[0].count;
        let real = |s: i64| {
            let mut r = request(&["shop-app"]);
            r.current = StatsRange { stime: s, etime: s + 5 * MIN };
            r.baselines = vec![r.current];
            r
        };
        let (before, _, _) = go(&st, real(t - 5 * MIN)).await;
        let (after, _, _) = go(&st, real(t)).await;
        let n = |v: &[ServiceStats]| v.iter().map(|r| r.current.as_ref().map_or(0, |s| s.count)).sum::<u64>();
        println!("  점 {} 요약 {est:>5} · 앞 5분 실제 {:>5} · 뒤 5분 실제 {:>5}", nscouter_lib::stats::raw::local_time(t, KST), n(&before), n(&after));
    }
}

/// 자정을 넘는 구간 — 콜렉터를 `NSC_TZ_HOURS`(기본 9) 시간대로 띄우고 그 자정(`NSC_MIDNIGHT`, ms) 앞뒤 10분을 비교 구간으로 훑는다.
/// 콜렉터 B 는 서비스 이름을 날짜별 사전에 두게(`mgr_text_db_daily_service_enabled=true`) 띄워 두고, 어제 서비스를
/// 날짜 없이·날짜 붙여 물어 견준다(F-70 — 실측에서는 둘 다 풀렸다)
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn 자정을_넘는_구간도_양쪽_날짜를_다_훑고_이름을_푼다() {
    use nscouter_lib::cache::xlog::past_page;
    use nscouter_lib::scouter::dictionary::{fetch_texts, fetch_texts_on, TextCache};
    use nscouter_lib::scouter::objtype::date_key;
    use nscouter_lib::scouter::past::PastCursor;
    use nscouter_lib::scouter::protocol::text_type;

    // 시간대는 30분 단위도 있다(UTC+6:30) — 소수로 받는다
    let tz: i64 = (std::env::var("NSC_TZ_HOURS").ok().and_then(|v| v.parse::<f64>().ok()).unwrap_or(9.0) * 3_600_000.0) as i64;
    let m: i64 = std::env::var("NSC_MIDNIGHT").ok().and_then(|v| v.parse().ok()).expect("NSC_MIDNIGHT(ms)");
    let st = connected().await;
    let req_of = |s: i64, e: i64| {
        let mut r = request(&[]);
        r.task_patterns = vec!["shop-app".into(), "order-app".into()];
        r.tz_offset_ms = tz;
        r.current = StatsRange { stime: s, etime: e };
        r.baselines = vec![StatsRange { stime: m - 30 * MIN, etime: m - 20 * MIN }];
        r
    };
    let total = |v: &[ServiceStats]| v.iter().map(|r| r.current.as_ref().map_or(0, |s| s.count)).sum::<u64>();
    let (across, miss, _) = go(&st, req_of(m - 10 * MIN, m + 10 * MIN)).await;
    let (before, _, _) = go(&st, req_of(m - 10 * MIN, m)).await;
    let (after, _, _) = go(&st, req_of(m, m + 10 * MIN)).await;
    println!("  날짜 {} → {}", date_key(m - 1, tz), date_key(m, tz));
    println!("  넘는 구간 {} = 앞 {} + 뒤 {} · 빠진 조각 {miss}", total(&across), total(&before), total(&after));
    let hashed: Vec<&str> = across.iter().map(|r| r.service.as_str()).filter(|s| s.starts_with('#')).collect();
    println!("  이름 못 푼 서비스 {:?}", hashed);
    assert_eq!(miss, 0);
    assert!(total(&before) > 0 && total(&after) > 0, "자정 앞뒤 모두 있어야 한다");
    assert_eq!(total(&across), total(&before) + total(&after), "넘는 구간 = 앞 + 뒤");
    assert!(hashed.is_empty(), "이름을 못 푼 서비스가 있다");

    // 날짜 없이 물으면 어떤가 — 콜렉터 B(날짜별 사전)의 어제 서비스로 견준다
    let b = st.links().into_iter().find(|l| l.name == "B").unwrap();
    let objs = nscouter_lib::commands::object_list_all(&st).await.unwrap();
    let order = objs.iter().find(|o| o.obj_type == "tomcat" && o.obj_name.contains("order-app")).unwrap().obj_hash;
    let yday = date_key(m - 1, tz);
    let (no_date, with_date, n) = tokio::task::spawn_blocking(move || {
        let mut conn = b.open().unwrap();
        let page = past_page(&mut conn, None, &[order], &yday, m - 10 * MIN, m, 2000, &PastCursor::default(), 0).unwrap();
        let mut hs: Vec<i32> = page.rows.iter().map(|x| x.service).collect();
        hs.sort_unstable();
        hs.dedup();
        let (mut a, mut c) = (TextCache::new(), TextCache::new());
        fetch_texts(&mut conn, &mut a, text_type::SERVICE, &hs).unwrap();
        fetch_texts_on(&mut conn, &mut c, text_type::SERVICE, &hs, Some(&yday)).unwrap();
        let got = |t: &TextCache| hs.iter().filter(|h| t.get(text_type::SERVICE, **h).is_some()).count();
        // 에러 문구 — 콜렉터 설정과 상관없이 늘 날짜별 사전이다
        let mut es: Vec<i32> = page.rows.iter().map(|x| x.error).filter(|e| *e != 0).collect();
        es.sort_unstable();
        es.dedup();
        let (mut ea, mut ec) = (TextCache::new(), TextCache::new());
        fetch_texts(&mut conn, &mut ea, text_type::ERROR, &es).unwrap();
        fetch_texts_on(&mut conn, &mut ec, text_type::ERROR, &es, Some(&yday)).unwrap();
        let egot = |t: &TextCache| es.iter().filter(|h| t.get(text_type::ERROR, **h).is_some()).count();
        println!("  B 어제 에러 문구 {}개 — 날짜 없이 {}개 풂 · 날짜 붙여 {}개 풂", es.len(), egot(&ea), egot(&ec));
        assert_eq!(egot(&ec), es.len());
        (got(&a), got(&c), hs.len())
    })
    .await
    .unwrap();
    println!("  B 어제 서비스 {n}개 — 날짜 없이 {no_date}개 풂 · 날짜 붙여 {with_date}개 풂");
    assert_eq!(with_date, n);
}
