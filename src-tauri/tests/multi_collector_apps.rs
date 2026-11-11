// 콜렉터 여럿을 함께 볼 때 — **서비스 트랜잭션이 흐르는** 콜렉터 두 대로 확인한다 (`crate::hub`).
//
// `multi_collector.rs` 는 호스트 에이전트만 붙여 목록·과거 조회·카운터를 본다. 여기서는 자바 에이전트가 붙은
// 앱 둘을 콜렉터에 **하나씩 갈라** 붙여, 트랜잭션이 있어야 볼 수 있는 길을 본다:
// 실시간 XLog · 상세·프로파일 · 콜렉터를 넘는 gxid · 프로파일 검색 · 액티브 · 서비스 그룹 · 요약 · 토폴로지 · MCP.
//
// 띄우는 법 (Test/ 의 앱을 그대로 쓴다):
//   · 콜렉터 A(기본 16100)에 shop-app, 콜렉터 B(기본 16200)에 order-app 을 붙인다 (agent conf 의 net_collector_ip 만 다르게)
//   · order-app 은 shop-app 을 부른다(`/order/api/pipeline`) — 한 요청이 두 콜렉터에 나눠 남는다
//   · 부하를 몇 분 돌린 뒤(요약은 5분 단위로 쌓인다) 실행한다
//
//   cargo test --test multi_collector_apps -- --ignored --nocapture

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use nscouter_lib::commands::{
    connect_links, get_active_speed_by_object_core, get_active_speed_core, get_interaction_core, get_service_group_core,
    get_summary_core, get_type_active_services_core, get_xlog_detail_core, get_xlog_full_profile_core,
    load_xlog_by_gxid_core, object_list_all, past_page_all, resolve_texts_all, search_profiles_core, HubCursor,
    SearchTarget, SummaryKind,
};
use nscouter_lib::config::AppConfig;
use nscouter_lib::hub::ConnectTarget;
use nscouter_lib::mcp::server::{details_core, list_servers_core, search_core, DetailArgs, SearchArgs};
use nscouter_lib::scouter::objtype::date_key;
use nscouter_lib::scouter::pack::XLogPack;
use nscouter_lib::scouter::streaming::{poll_xlogs, StreamCursor};
use nscouter_lib::state::AppState;

/// 콜렉터 시간대(Test/collector: Asia/Seoul)
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

async fn connected() -> Arc<AppState> {
    let dir: PathBuf = std::env::temp_dir().join(format!("nscouter-apps-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let st = Arc::new(AppState::new_with_config(AppConfig::default(), dir.join("config.json")));
    let (pa, pb) = (port("NSC_PORT_A", 16100), port("NSC_PORT_B", 16200));
    connect_links(&st, vec![target("A", pa), target("B", pb)]).await.expect("접속 실패");
    st
}

/// 두 앱의 화면용 해시 — (shop @A, order @B)
async fn apps(st: &AppState) -> (i32, i32) {
    let list = object_list_all(st).await.expect("오브젝트 목록 실패");
    for o in &list {
        println!("  {:>12} {:<24} {}", o.obj_hash, o.obj_name, o.obj_type);
    }
    // 앱 자신(tomcat) — 같은 이름 아래 커넥션 풀(`…/shop-app/HikariPool-1`, datasource)도 있다
    let find = |part: &str| {
        list.iter().find(|o| o.obj_type == "tomcat" && o.obj_name.contains(part)).unwrap_or_else(|| panic!("{part} 없음")).obj_hash
    };
    (find("shop-app"), find("order-app"))
}

/// 최근 구간의 XLog 전부 (두 콜렉터)
async fn recent(st: &AppState, hashes: &[i32], minutes: i64) -> Vec<XLogPack> {
    let (e, s) = (now_ms() + 5_000, now_ms() - minutes * 60_000);
    let date = date_key(now_ms(), KST);
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut cursor: Option<HubCursor> = None;
    for _ in 0..40 {
        let page = past_page_all(st, hashes.to_vec(), date.clone(), s, e, 2_000, cursor.clone()).await.expect("과거 조회 실패");
        out.extend(page.xlogs.into_iter().filter(|x| seen.insert(x.txid)));
        let stuck = cursor.as_ref().is_some_and(|c| c.base.last_xlog_time == page.cursor.base.last_xlog_time);
        if !page.cursor.base.has_more || stuck {
            break;
        }
        cursor = Some(page.cursor);
    }
    out
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn 실시간_xlog_가_콜렉터마다_와서_화면용_해시로_합쳐진다() {
    let st = connected().await;
    let (shop, order) = apps(&st).await;

    // 앱의 스트림과 같은 길: 고른 서버를 콜렉터별로 갈라, 콜렉터마다 새 연결로 폴링한다
    let mut got: Vec<XLogPack> = Vec::new();
    let parts = st.split_hashes(&[shop, order]);
    assert_eq!(parts.len(), 2, "두 앱은 서로 다른 콜렉터에 있다");
    for (link, reals) in parts {
        let l = link.clone();
        let mut conn = tokio::task::spawn_blocking(move || l.open()).await.unwrap().expect("스트림 연결 실패");
        let mut cursor = StreamCursor::default();
        let mut n_seen = 0;
        poll_xlogs(&mut conn, &link, &st, &reals, &mut cursor, true, &mut |_| n_seen += 1, &mut |chunk| got.extend(chunk)).expect("폴링 실패");
        println!("  스트림 {}: {n_seen}건", link.name);
        assert!(n_seen > 0, "{} 에서 실시간 XLog 가 안 왔다 — 부하가 도는지 볼 것", link.name);
    }
    let from_shop = got.iter().filter(|x| x.obj_hash == shop).count();
    let from_order = got.iter().filter(|x| x.obj_hash == order).count();
    println!("  합쳐서 {}건 (shop {from_shop} · order {from_order})", got.len());
    assert!(from_shop > 0 && from_order > 0);
    assert_eq!(from_shop + from_order, got.len(), "다른 해시가 섞이지 않는다");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn 상세_프로파일_gxid_프로파일_검색이_콜렉터를_넘는다() {
    let st = connected().await;
    let (shop, order) = apps(&st).await;
    let rows = recent(&st, &[shop, order], 10).await;
    let date = date_key(now_ms(), KST);
    println!("  최근 10분 {}건", rows.len());

    // ① txid 만으로 상세 — 어느 콜렉터의 것이든 찾고, 해시는 화면용이다
    for (label, vh) in [("shop", shop), ("order", order)] {
        let x = rows.iter().find(|x| x.obj_hash == vh).unwrap_or_else(|| panic!("{label} 의 XLog 가 없다"));
        let d = get_xlog_detail_core(&st, x.txid.to_string(), date.clone()).await.expect("상세 실패");
        assert_eq!((d.txid, d.obj_hash), (x.txid, vh), "{label}");
        // ② 프로파일 — 그 트랜잭션을 남긴 콜렉터에서
        let p = get_xlog_full_profile_core(&st, x.txid.to_string(), date.clone(), vh).await.expect("프로파일 실패");
        println!("  {label} txid={} 프로파일 스텝 {}개", x.txid, p.steps.len());
    }

    // ③ gxid — order 가 shop 을 부른 요청은 두 콜렉터에 나눠 남는다
    let mut crossed = None;
    for x in rows.iter().filter(|x| x.obj_hash == order && x.gxid != 0).take(400) {
        let linked = load_xlog_by_gxid_core(&st, x.gxid.to_string(), date.clone()).await.expect("gxid 실패");
        let objs: HashSet<i32> = linked.iter().map(|l| l.obj_hash).collect();
        if objs.contains(&shop) && objs.contains(&order) {
            crossed = Some((x.gxid, linked.len()));
            break;
        }
    }
    let (gxid, n) = crossed.expect("콜렉터 둘에 걸친 gxid 를 못 찾았다 — /order/api/pipeline 부하가 도는지 볼 것");
    println!("  gxid={gxid} → {n}건이 shop(@A)·order(@B) 에 걸쳐 있다");

    // ④ 프로파일 검색 — 대상이 두 콜렉터에 섞여 있어도 각자의 콜렉터에서 연다
    let targets: Vec<SearchTarget> = rows
        .iter()
        .filter(|x| x.obj_hash == shop)
        .take(15)
        .chain(rows.iter().filter(|x| x.obj_hash == order).take(15))
        .map(|x| SearchTarget { txid: x.txid.to_string(), obj_hash: x.obj_hash, date: date.clone() })
        .collect();
    let batch = search_profiles_core(&st, targets.clone(), "select".into()).await.expect("프로파일 검색 실패");
    let hit: HashSet<&str> = batch.hits.iter().map(|h| h.txid.as_str()).collect();
    let hits_of = |vh: i32| targets.iter().filter(|t| t.obj_hash == vh && hit.contains(t.txid.as_str())).count();
    println!("  프로파일 검색 «select»: {}건 중 {}건 (shop {} · order {}), 실패 {}", targets.len(), batch.hits.len(), hits_of(shop), hits_of(order), batch.failed);
    assert_eq!(batch.failed, 0, "제 콜렉터에 물으면 못 받는 프로파일이 없다");
    assert!(hits_of(shop) > 0 && hits_of(order) > 0, "두 콜렉터의 트랜잭션에서 다 걸린다");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn 액티브_서비스그룹_요약_토폴로지가_두_콜렉터를_합친다() {
    let st = connected().await;
    let (shop, order) = apps(&st).await;
    let types = vec!["tomcat".to_string()];

    // 액티브 속도 — 오브젝트별은 둘 다, 합계는 그 합
    let by_obj = get_active_speed_by_object_core(&st, types.clone()).await.expect("오브젝트별 액티브 실패");
    let hs: HashSet<i32> = by_obj.iter().map(|a| a.obj_hash).collect();
    let total = get_active_speed_core(&st, types.clone()).await.expect("액티브 합계 실패");
    println!("  액티브: 오브젝트 {}개, 합계 tps={:.1} act={}/{}/{}", by_obj.len(), total.tps, total.act1, total.act2, total.act3);
    assert!(hs.contains(&shop) && hs.contains(&order), "{hs:?}");
    assert!(total.tps > 0.0);

    // 타입 액티브 서비스 — 두 콜렉터의 오브젝트가 다 답한다
    let act = get_type_active_services_core(&st, "tomcat".into()).await.expect("액티브 목록 실패");
    println!("  액티브 목록: 답한 오브젝트 {:?}, 행 {}", act.answered, act.rows.len());
    assert!(act.answered.contains(&shop) && act.answered.contains(&order));
    assert!(act.rows.iter().all(|r| r.obj_hash == shop || r.obj_hash == order));

    // 서비스 그룹 — 고른 서버를 콜렉터별로 물어 합친다
    let groups = get_service_group_core(&st, vec![shop, order]).await.expect("서비스 그룹 실패");
    let only_shop = get_service_group_core(&st, vec![shop]).await.unwrap();
    println!("  서비스 그룹: 합쳐서 {}개 (shop 만 {}개) {:?}", groups.len(), only_shop.len(), groups.iter().map(|g| g.name.as_str()).collect::<Vec<_>>());
    assert!(!groups.is_empty() && groups.len() >= only_shop.len());
    let names: HashSet<&str> = groups.iter().map(|g| g.name.as_str()).collect();
    assert_eq!(names.len(), groups.len(), "같은 이름은 하나로 합쳐진다");

    // 요약 — 타입 전체면 콜렉터 전부에 물어 더한다. 서비스 이름을 풀어 두 앱의 것이 다 있는지 본다
    let (s, e) = (now_ms() - 30 * 60_000, now_ms());
    let rows = get_summary_core(&st, SummaryKind::Service, date_key(now_ms(), KST), s, e, types.clone(), 0).await.expect("요약 실패");
    let names = resolve_texts_all(&st, "service".into(), rows.iter().map(|r| r.id).collect()).await.expect("서비스 이름 실패");
    let has = |part: &str| names.values().any(|n| n.contains(part));
    println!("  요약(서비스): {}행, 이름 {}개 — /shop {} · /order {}", rows.len(), names.len(), has("/shop"), has("/order"));
    assert!(!rows.is_empty(), "요약이 비었다 — 5분 단위로 쌓이니 부하를 5분 넘게 돌릴 것");
    assert!(has("/shop") && has("/order"), "두 콜렉터의 서비스가 다 있어야 한다");
    assert_eq!(names.len(), rows.len(), "화면이 해시만 넘겨도 콜렉터를 차례로 물어 다 푼다");

    // 토폴로지 — 콜렉터마다 묻는다. 보낸 쪽이 그 콜렉터의 오브젝트면 화면용 해시다
    let intr = get_interaction_core(&st, types).await.expect("토폴로지 실패");
    let froms: HashSet<i32> = intr.iter().map(|i| i.from_hash).collect();
    println!("  토폴로지: {}행, 보낸 쪽 {:?}", intr.len(), froms);
    assert!(!intr.is_empty(), "인터랙션이 비었다 (counter_interaction_enabled)");
    assert!(froms.contains(&shop) || froms.contains(&order));
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn mcp_가_두_콜렉터를_한_곳처럼_답한다() {
    let st = connected().await;
    let _ = apps(&st).await;

    // list_servers — collector 열
    let v: serde_json::Value = serde_json::from_str(&list_servers_core(&st).await.expect("list_servers 실패")).unwrap();
    assert_eq!(v["columns"][4], "collector");
    let colls: HashSet<String> = v["rows"].as_array().unwrap().iter().map(|r| r[4].as_str().unwrap().to_string()).collect();
    println!("  list_servers: {}대, 콜렉터 {colls:?}", v["total"]);
    assert!(colls.contains("A") && colls.contains("B"));

    // search_transactions — 콜렉터 전부를 훑어 한 목록으로
    let args = |j: serde_json::Value| -> SearchArgs { serde_json::from_value(j).unwrap() };
    let v: serde_json::Value =
        serde_json::from_str(&search_core(&st, KST, args(serde_json::json!({ "minutes": 10, "sort": "latest", "limit": 200 }))).await.expect("search 실패")).unwrap();
    let cols: Vec<&str> = v["columns"].as_array().unwrap().iter().map(|c| c.as_str().unwrap()).collect();
    let ci = cols.iter().position(|c| *c == "collector").expect("collector 열");
    let rows = v["rows"].as_array().unwrap();
    let by: HashSet<&str> = rows.iter().map(|r| r[ci].as_str().unwrap()).collect();
    println!("  search: 훑음 {} · 걸림 {} · 실음 {} · 콜렉터 {:?} · 행의 콜렉터 {by:?}", v["scanned"], v["matched"], rows.len(), v["collectors_scanned"]);
    assert_eq!(v["collectors_scanned"].as_array().unwrap().len(), 2);
    assert!(by.contains("A") && by.contains("B"), "최근 것 200건에 두 콜렉터가 다 있어야 한다");
    assert!(v["top_services"].as_array().unwrap().iter().all(|s| !s["service"].as_str().unwrap().starts_with('#')), "요약의 서비스 이름이 다 풀린다");

    // collector 조건으로 좁히면 그 콜렉터 것만
    let only: serde_json::Value =
        serde_json::from_str(&search_core(&st, KST, args(serde_json::json!({ "minutes": 10, "collector": "B", "limit": 50 }))).await.unwrap()).unwrap();
    assert_eq!(only["collectors_scanned"], serde_json::json!(["B"]));
    assert!(only["rows"].as_array().unwrap().iter().all(|r| r[ci] == "B"));

    // 프로파일 본문 검색도 콜렉터를 넘는다
    let prof: serde_json::Value = serde_json::from_str(
        &search_core(&st, KST, args(serde_json::json!({ "minutes": 5, "profile_contains": "select", "limit": 100, "sort": "latest" }))).await.expect("프로파일 검색 실패"),
    )
    .unwrap();
    let pby: HashSet<&str> = prof["rows"].as_array().unwrap().iter().map(|r| r[ci].as_str().unwrap()).collect();
    println!("  search(profile_contains=select): {} · 행의 콜렉터 {pby:?}", prof["profile_search"]);
    assert!(pby.contains("A") && pby.contains("B"));

    // get_transaction_details — ref 에 적힌 콜렉터에 묻는다
    let pick = |c: &str| rows.iter().find(|r| r[ci] == c).unwrap()[0].as_str().unwrap().to_string();
    let (ra, rb) = (pick("A"), pick("B"));
    assert!(ra.ends_with("@A") && rb.ends_with("@B"), "{ra} {rb}");
    let d: serde_json::Value = serde_json::from_str(&details_core(&st, KST, DetailArgs { refs: vec![ra.clone(), rb.clone()] }).await.expect("details 실패")).unwrap();
    let d = d.as_array().unwrap();
    println!("  details: {} → {} / {} → {}", ra, d[0]["server"], rb, d[1]["server"]);
    assert!(d.iter().all(|x| x.get("error").is_none_or(|e| e.is_null())), "{d:?}");
    // 콜렉터를 뗀 ref 도 붙은 콜렉터를 차례로 물어 찾는다
    let bare = rb.split('@').next().unwrap().to_string();
    let d2: serde_json::Value = serde_json::from_str(&details_core(&st, KST, DetailArgs { refs: vec![bare] }).await.unwrap()).unwrap();
    assert!(d2[0].get("error").is_none_or(|e| e.is_null()), "{d2}");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn 알림이_콜렉터마다_오고_오브젝트는_화면용_해시다() {
    use nscouter_lib::commands::poll_alerts;

    let st = connected().await;
    let list = object_list_all(&st).await.unwrap();
    let known: HashSet<i32> = list.iter().map(|o| o.obj_hash).collect();

    // 앱의 알림 스트림과 같은 길: 콜렉터마다 새 연결로 폴링한다. 첫 폴링은 콜렉터가 들고 있는 최근 알림을 준다
    let mut total = 0;
    for link in st.links() {
        let l = link.clone();
        let mut conn = tokio::task::spawn_blocking(move || l.open()).await.unwrap().expect("알림 연결 실패");
        let mut cursor = StreamCursor::default();
        let alerts = poll_alerts(&mut conn, &link, &st, &mut cursor).expect("알림 폴링 실패");
        for a in alerts.iter().take(3) {
            println!("  알림 {}: level={} {} — obj={}", link.name, a.level, a.title, a.obj_hash);
        }
        println!("  알림 {}: {}건", link.name, alerts.len());
        assert!(!alerts.is_empty(), "{} 에서 알림이 안 왔다 — 에이전트를 하나 세웠다 띄워 볼 것", link.name);
        // 오브젝트 알림은 그 콜렉터의 오브젝트(화면용 해시)를 가리킨다
        let mine: HashSet<i32> = st.split_hashes(&known.iter().copied().collect::<Vec<_>>())
            .into_iter()
            .filter(|(l, _)| l.idx == link.idx)
            .flat_map(|(l, reals)| reals.into_iter().map(move |r| (l.clone(), r)))
            .map(|(l, r)| st.virt(&l, r))
            .collect();
        assert!(alerts.iter().any(|a| mine.contains(&a.obj_hash)), "{} 의 알림이 제 오브젝트를 가리키지 않는다", link.name);
        total += alerts.len();
    }
    assert!(total > 0);
}
