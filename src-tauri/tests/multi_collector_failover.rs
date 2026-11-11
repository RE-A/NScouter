// 콜렉터 하나가 죽었을 때 — **나머지로 계속 보이고**, F5(처음부터 다시)로 되살아난다 (`hub::gather`).
//
// `multi_collector_apps.rs` 와 같은 환경(콜렉터 A 에 shop-app, B 에 order-app, 부하)에서 돌린다. 시험 도중에
// **콜렉터 B 컨테이너를 세웠다 다시 띄운다** — 다른 시험과 섞이지 않게 파일을 따로 둔다.
// 컨테이너 이름은 `NSC_STOP_B`(기본 collB)로 바꾼다.
//
//   cargo test --test multi_collector_failover -- --ignored --nocapture

use std::collections::HashSet;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use nscouter_lib::commands::{
    connect_links, get_active_speed_by_object_core, get_active_speed_core, get_interaction_core, get_summary_core,
    object_list_all, resolve_texts_all, restart_links, SummaryKind,
};
use nscouter_lib::config::AppConfig;
use nscouter_lib::hub::ConnectTarget;
use nscouter_lib::scouter::objtype::date_key;
use nscouter_lib::state::AppState;

const KST: i64 = 9 * 3600 * 1000;

fn port(var: &str, default: u16) -> u16 {
    std::env::var(var).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn target(name: &str, port: u16) -> ConnectTarget {
    ConnectTarget { name: name.into(), host: "127.0.0.1".into(), port, user: "admin".into(), pass: "admin".into() }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64
}

fn docker(args: &[&str]) {
    let ok = Command::new("docker").args(args).status().map(|s| s.success()).unwrap_or(false);
    assert!(ok, "docker {args:?} 실패");
}

/// 콜렉터가 받을 때까지 기다린다 (최대 60초)
async fn wait_up(port: u16) {
    for _ in 0..60 {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            tokio::time::sleep(Duration::from_secs(3)).await;
            return;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    panic!("콜렉터 {port} 가 안 떴다");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn 콜렉터_하나가_죽어도_나머지로_보이고_처음부터_다시_붙으면_되살아난다() {
    let (pa, pb) = (port("NSC_PORT_A", 16100), port("NSC_PORT_B", 16200));
    let container_b = std::env::var("NSC_STOP_B").unwrap_or_else(|_| "collB".into());
    let dir: PathBuf = std::env::temp_dir().join(format!("nscouter-failover-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let st = Arc::new(AppState::new_with_config(AppConfig::default(), dir.join("config.json")));
    connect_links(&st, vec![target("A", pa), target("B", pb)]).await.expect("접속 실패");

    let list = object_list_all(&st).await.unwrap();
    // 앱 자신(tomcat) — 같은 이름 아래 커넥션 풀(datasource)도 있다
    let find = |part: &str| {
        list.iter().find(|o| o.obj_type == "tomcat" && o.obj_name.contains(part)).unwrap_or_else(|| panic!("{part} 없음")).obj_hash
    };
    let (shop, order) = (find("shop-app"), find("order-app"));
    let types = vec!["tomcat".to_string()];
    let link = |name: &str| st.links().into_iter().find(|l| l.name == name).unwrap();

    // ── 콜렉터 B 를 세운다 ──
    docker(&["stop", &container_b]);
    // 붙어 있던 소켓은 그대로 — 주기 조회가 실패를 겪어야 한다

    // 주기 조회는 A 만으로 답한다 (예전에는 통째로 실패했다)
    let objs = object_list_all(&st).await.expect("오브젝트 목록이 통째로 실패했다");
    let hs: HashSet<i32> = objs.iter().map(|o| o.obj_hash).collect();
    println!("  B 를 세운 뒤 오브젝트 {}개 — shop {} · order {}", objs.len(), hs.contains(&shop), hs.contains(&order));
    assert!(hs.contains(&shop) && !hs.contains(&order));

    let by_obj = get_active_speed_by_object_core(&st, types.clone()).await.expect("오브젝트별 액티브가 통째로 실패했다");
    assert!(by_obj.iter().all(|a| a.obj_hash != order));
    get_active_speed_core(&st, types.clone()).await.expect("액티브 합계가 통째로 실패했다");
    let rows = get_summary_core(&st, SummaryKind::Service, date_key(now_ms(), KST), now_ms() - 30 * 60_000, now_ms(), types.clone(), 0)
        .await
        .expect("요약이 통째로 실패했다");
    let names = resolve_texts_all(&st, "service".into(), rows.iter().map(|r| r.id).collect()).await.expect("이름 풀기 실패");
    println!("  B 를 세운 뒤 요약 {}행 — /shop {} · /order {}", rows.len(), names.values().any(|n| n.contains("/shop")), names.values().any(|n| n.contains("/order")));
    assert!(names.values().any(|n| n.contains("/shop")));
    assert!(!names.values().any(|n| n.contains("/order")), "B 의 서비스는 빠진다");
    get_interaction_core(&st, types.clone()).await.expect("토폴로지가 통째로 실패했다");

    // 실패한 콜렉터는 경고로 남는다 (헤더가 노랗게, F5 가 «처음부터 다시» 를 고르는 근거)
    let warn = link("B").recent_warning();
    println!("  B 경고: {warn:?} · A 경고: {:?}", link("A").recent_warning());
    assert!(warn.is_some());
    assert!(link("A").recent_warning().is_none());

    // ── 콜렉터 B 를 다시 띄우고 처음부터 다시 붙는다 (오류가 있을 때의 F5) ──
    docker(&["start", &container_b]);
    wait_up(pb).await;
    let label = restart_links(&st).await.expect("처음부터 다시 붙기 실패");
    println!("  처음부터 다시: {label}");
    assert_eq!(label, "A + B", "같은 순서로 다시 붙는다 — A 가 주 콜렉터");
    assert!(link("B").is_connected().await && link("B").recent_warning().is_none(), "다시 붙으면 경고가 지워진다");

    // 에이전트가 새 콜렉터에 다시 붙기까지 기다린다
    let mut back = false;
    for _ in 0..30 {
        let objs = object_list_all(&st).await.unwrap();
        let names: Vec<&str> = objs.iter().map(|o| o.obj_name.as_str()).collect();
        if names.iter().any(|n| n.contains("order-app")) && names.iter().any(|n| n.contains("shop-app")) {
            back = true;
            // 콜렉터가 같으면 해시도 같다 — 화면이 쥔 고르기가 그대로 맞는다
            let app = |part: &str| objs.iter().find(|o| o.obj_type == "tomcat" && o.obj_name.contains(part)).unwrap().obj_hash;
            let (order2, shop2) = (app("order-app"), app("shop-app"));
            assert_eq!((shop2, order2), (shop, order), "처음부터 다시 붙어도 화면용 해시가 같다");
            break;
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    assert!(back, "다시 붙은 뒤 order-app 이 B 에서 안 돌아왔다");
    println!("  되살아남: shop·order 둘 다 보인다");
}
