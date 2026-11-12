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
    let (_, rows_raw, err) = sink.finish();
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
