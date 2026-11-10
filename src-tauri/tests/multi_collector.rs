// 콜렉터 여럿을 함께 볼 때 — 실제 콜렉터 두 대로 확인한다 (`crate::hub`).
//
// 띄우는 법: 콜렉터 두 대를 서로 다른 포트(기본 16100 · 16200)에 띄우고, 두 콜렉터에 **같은 이름**
// (`web01`)의 에이전트와 서로 다른 이름의 에이전트를 하나씩 붙인다. 포트는 `NSC_PORT_A`·`NSC_PORT_B` 로 바꾼다.
//
//   cargo test --test multi_collector -- --ignored --nocapture
//
// 지키려는 것:
//   · 두 콜렉터의 오브젝트가 한 목록으로 온다
//   · 이름이 같아 해시가 겹친 오브젝트는 뒤쪽 콜렉터의 것만 다른 해시와 ` @콜렉터` 이름을 받는다
//   · 그 해시로 물으면 뒤쪽 콜렉터에 원래 해시로 간다
//   · 한 콜렉터가 안 붙어도 나머지로 접속은 성공하고, 못 붙은 것은 끊긴 채로 남는다

use std::path::PathBuf;

use nscouter_lib::commands::{connect_links, object_list_all, resolve_texts_all};
use nscouter_lib::config::AppConfig;
use nscouter_lib::hub::ConnectTarget;
use nscouter_lib::state::AppState;

fn port(var: &str, default: u16) -> u16 {
    std::env::var(var).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn target(name: &str, port: u16) -> ConnectTarget {
    ConnectTarget { name: name.into(), host: "127.0.0.1".into(), port, user: "admin".into(), pass: "admin".into() }
}

fn state() -> AppState {
    let dir: PathBuf = std::env::temp_dir().join(format!("nscouter-multi-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    AppState::new_with_config(AppConfig::default(), dir.join("config.json"))
}

#[tokio::test]
#[ignore]
async fn 두_콜렉터의_오브젝트가_한_목록으로_오고_겹친_해시는_가려진다() {
    let (pa, pb) = (port("NSC_PORT_A", 16100), port("NSC_PORT_B", 16200));
    let st = state();
    let label = connect_links(&st, vec![target("A", pa), target("B", pb)]).await.expect("접속 실패");
    assert_eq!(label, "A + B");

    let list = object_list_all(&st).await.expect("오브젝트 목록 실패");
    for o in &list {
        println!("{:>12} {:<14} {}", o.obj_hash, o.obj_name, o.obj_type);
    }
    let names: Vec<&str> = list.iter().map(|o| o.obj_name.as_str()).collect();
    assert!(names.contains(&"/web01"), "앞 콜렉터의 web01 은 이름 그대로");
    assert!(names.contains(&"/web01 @B"), "뒤 콜렉터의 web01 은 콜렉터가 붙는다: {names:?}");
    assert!(names.contains(&"/only-a") && names.contains(&"/only-b"), "{names:?}");

    let a = list.iter().find(|o| o.obj_name == "/web01").unwrap();
    let b = list.iter().find(|o| o.obj_name == "/web01 @B").unwrap();
    assert_ne!(a.obj_hash, b.obj_hash, "화면용 해시는 겹치지 않는다");

    // 앞의 것은 원래 해시 그대로, 뒤의 것은 B 콜렉터의 원래 해시(=앞의 것과 같은 값)로 간다
    let (la, ra) = st.route(a.obj_hash).unwrap();
    let (lb, rb) = st.route(b.obj_hash).unwrap();
    assert_eq!((la.name.as_str(), ra), ("A", a.obj_hash));
    assert_eq!(lb.name.as_str(), "B");
    assert_eq!(rb, a.obj_hash, "objHash = hash(objName) 이라 두 콜렉터의 원래 해시는 같다");

    // 이름 사전(object)도 화면용 해시로 묻고, 겹친 것은 같은 이름으로 온다
    let got = resolve_texts_all(&st, "object".into(), vec![a.obj_hash, b.obj_hash]).await.unwrap();
    println!("object 사전: {got:?}");
    assert_eq!(got.get(&b.obj_hash).map(String::as_str), Some("/web01 @B"));

    // 다시 읽어도 해시가 바뀌지 않는다
    let again = object_list_all(&st).await.unwrap();
    let b2 = again.iter().find(|o| o.obj_name == "/web01 @B").unwrap();
    assert_eq!(b2.obj_hash, b.obj_hash);
}

#[tokio::test]
#[ignore]
async fn 한_콜렉터가_안_붙어도_나머지로_접속한다() {
    let pb = port("NSC_PORT_B", 16200);
    let st = state();
    // 앞에 놓은 콜렉터가 죽어 있으면 붙은 것이 주 콜렉터가 된다
    let label = connect_links(&st, vec![target("죽은것", 1), target("B", pb)]).await.expect("하나는 붙어야 한다");
    assert_eq!(label, "B + 죽은것");
    let links = st.links();
    assert_eq!(links[0].name, "B");
    assert!(links[0].is_connected().await);
    assert!(!links[1].is_connected().await);
    assert!(links[1].error.lock().await.is_some(), "못 붙은 까닭이 남는다");

    let list = object_list_all(&st).await.expect("붙은 콜렉터의 목록은 온다");
    assert!(list.iter().any(|o| o.obj_name == "/only-b"));
    assert!(list.iter().all(|o| !o.obj_name.contains('@')), "겹칠 상대가 없다");

    // 전부 못 붙으면 실패다
    let st2 = state();
    assert!(connect_links(&st2, vec![target("x", 1), target("y", 2)]).await.is_err());
}

#[tokio::test]
#[ignore]
async fn 콜렉터_하나만_붙으면_해시와_이름이_그대로다() {
    let pa = port("NSC_PORT_A", 16100);
    let st = state();
    let label = connect_links(&st, vec![target("", pa)]).await.unwrap();
    assert_eq!(label, "COLL-A", "하나면 콜렉터의 server_id 가 접속 이름이다");
    let list = object_list_all(&st).await.unwrap();
    for o in &list {
        assert_eq!(st.route(o.obj_hash).unwrap().1, o.obj_hash);
        assert!(!o.obj_name.contains(" @"));
    }
}

// ─── 과거 조회·찾기·분포 (2단계) ─────────────────────────────
//
// 이 환경의 에이전트(host agent)는 XLog 를 안 만든다. **에이전트가 보내는 길(UDP `CAFE` + 팩) 그대로**
// 합성 XLog 를 콜렉터에 넣고 받아 본다. txid 는 시험마다 새로 잡는다(다시 돌려도 안 섞이게).

use nscouter_lib::commands::{distribution_all, past_page_all, wide_page_all, HubCursor};
use nscouter_lib::scouter::codec::ScouterWriter;
use nscouter_lib::scouter::objtype::date_key;
use nscouter_lib::scouter::pack::XLogPack;
use nscouter_lib::scouter::protocol::PACK_XLOG;
use nscouter_lib::scouter::search::SearchXLogFilter;

/// 콜렉터 시간대(Test/collector: Asia/Seoul)
const KST: i64 = 9 * 3600 * 1000;

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64
}

/// 에이전트처럼 XLog 를 UDP 로 보낸다 — `CAFE` + 팩 종류 + 블롭(`XLogPack.write`)
fn send_xlogs(port: u16, xs: &[XLogPack]) {
    let sock = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
    for x in xs {
        let mut w = ScouterWriter::new();
        w.write_blob(&x.to_blob());
        let mut pkt = b"CAFE".to_vec();
        pkt.push(PACK_XLOG);
        pkt.extend(w.into_bytes());
        sock.send_to(&pkt, ("127.0.0.1", port)).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
}

fn xlog(obj_hash: i32, txid: i64, end_time: i64, elapsed: i32, ip: &str) -> XLogPack {
    // 콜렉터(2.21.3 `XLogPreCore`)가 버리지 않게 — 바이트코드로 확인한 조건:
    //   · `service == 0` 이면 «버려진 XLog»(`XLogPack.isDropped`)로 보고 저장하지 않는다
    //   · `ignore_global_consequent_sampling` 이 켜져 있으면 `discard_type` 이 1·3·5(살아 있는 것)여야 한다
    XLogPack {
        service: 0x5eed,
        obj_hash,
        txid,
        gxid: txid,
        end_time,
        elapsed,
        ipaddr: ip.into(),
        discard_type: 1,
        ignore_global_consequent_sampling: true,
        ..XLogPack::default()
    }
}

/// 과거 조회를 끝까지 넘긴다 (화면 `pastXLog.ts` 와 같은 규칙)
async fn past_all(st: &AppState, hashes: &[i32], date: &str, s: i64, e: i64) -> (Vec<XLogPack>, Vec<HubCursor>) {
    let mut out = Vec::new();
    let mut cursors = Vec::new();
    let mut cursor: Option<HubCursor> = None;
    for _ in 0..50 {
        let page = past_page_all(st, hashes.to_vec(), date.into(), s, e, 7, cursor.clone()).await.expect("과거 조회 실패");
        out.extend(page.xlogs);
        cursors.push(page.cursor.clone());
        let stuck = cursor.as_ref().is_some_and(|c| c.base.last_xlog_time == page.cursor.base.last_xlog_time);
        if !page.cursor.base.has_more || stuck {
            break;
        }
        cursor = Some(page.cursor);
    }
    (out, cursors)
}

#[tokio::test]
#[ignore]
async fn 과거_조회_찾기_분포가_두_콜렉터를_합친다() {
    let (pa, pb) = (port("NSC_PORT_A", 16100), port("NSC_PORT_B", 16200));
    let st = state();
    connect_links(&st, vec![target("A", pa), target("B", pb)]).await.unwrap();
    let list = object_list_all(&st).await.unwrap();
    let vh = |n: &str| list.iter().find(|o| o.obj_name == n).unwrap_or_else(|| panic!("{n} 없음")).obj_hash;
    let (va, vb, vonly) = (vh("/web01"), vh("/web01 @B"), vh("/only-b"));
    let real = st.route(vb).unwrap().1; // 두 콜렉터의 web01 원래 해시 (같다)
    let real_only = st.route(vonly).unwrap().1;

    // 구간: 지금부터 90초 전 ~ 지금. txid 는 시각에서 따 다시 돌려도 안 겹치게
    let t0 = now_ms() - 60_000;
    let base = now_ms() * 1000;
    let a: Vec<XLogPack> = (0..30).map(|i| xlog(real, base + i, t0 + i * 1000, 100, "10.1.1.1")).collect();
    let b: Vec<XLogPack> = (0..20).map(|i| xlog(real, base + 100 + i, t0 + i * 1500, 2000, "10.9.9.1")).collect();
    let only: Vec<XLogPack> = (0..10).map(|i| xlog(real_only, base + 200 + i, t0 + i * 2000, 3000, "10.9.9.2")).collect();
    send_xlogs(pa, &a);
    let mut to_b = b.clone();
    to_b.extend(only.clone());
    send_xlogs(pb, &to_b);
    // 콜렉터가 파일에 쓰기를 기다린다
    tokio::time::sleep(std::time::Duration::from_secs(6)).await;

    let date = date_key(t0, KST);
    let (s, e) = (t0 - 30_000, now_ms() + 5_000);
    // 이 시험이 넣은 것만, txid 로 한 번씩 — 페이지 경계의 같은 시각은 다시 온다(F-28, 화면도 txid 로 거른다)
    let mine = |xs: &[XLogPack]| -> Vec<XLogPack> {
        let mut seen = std::collections::HashSet::new();
        xs.iter().filter(|x| x.txid >= base && x.txid < base + 1000 && seen.insert(x.txid)).cloned().collect()
    };

    // ① 과거 조회 — 세 서버(콜렉터 둘) 다 온다. B 의 web01 은 화면용 해시로
    let (rows, cursors) = past_all(&st, &[va, vb, vonly], &date, s, e).await;
    let rows = mine(&rows);
    let mut txids: Vec<i64> = rows.iter().map(|x| x.txid).collect();
    txids.sort();
    txids.dedup();
    println!("과거 조회: {}건 ({}페이지), 마지막 자리 parts={}", txids.len(), cursors.len(), cursors.last().unwrap().parts.len());
    assert_eq!(txids.len(), 60, "A 30 + B 20 + only-b 10");
    assert_eq!(rows.iter().filter(|x| x.obj_hash == va).count(), 30);
    assert_eq!(rows.iter().filter(|x| x.obj_hash == vb).count(), 20, "B 의 web01 은 화면용 해시로 온다");
    assert_eq!(rows.iter().filter(|x| x.obj_hash == vonly).count(), 10);
    assert!(cursors.iter().all(|c| c.parts.len() == 2), "콜렉터 둘이면 자리를 콜렉터마다 든다");
    assert!(cursors.len() > 1, "페이지 7건이라 여러 번 넘긴다");

    // ② 한 콜렉터만 고르면 예전 그대로 — parts 가 없다
    let (rows_a, cur_a) = past_all(&st, &[va], &date, s, e).await;
    assert_eq!(mine(&rows_a).len(), 30);
    assert!(cur_a.iter().all(|c| c.parts.is_empty()));

    // ③ 찾기 — IP 로 거르면 B 쪽만 (콜렉터를 넘어 합친다)
    let filter = SearchXLogFilter { stime: s, etime: e, ip: "10.9.9".into(), ..SearchXLogFilter::default() };
    let mut found = Vec::new();
    let mut cursor: Option<HubCursor> = None;
    for _ in 0..20 {
        let p = wide_page_all(&st, filter.clone(), date.clone(), vec![va, vb, vonly], cursor.clone()).await.expect("찾기 실패");
        found.extend(p.xlogs);
        if p.done {
            break;
        }
        cursor = Some(p.cursor);
    }
    let found = mine(&found);
    println!("찾기: {}건", found.len());
    assert_eq!(found.len(), 30, "10.9.9.* 는 B 의 web01 20 + only-b 10");
    assert!(found.iter().all(|x| x.obj_hash == vb || x.obj_hash == vonly));

    // ④ 분포 — 콜렉터를 합쳐 센다 (이 시험 것만 있는 구간이 아니므로 «적어도» 로 본다)
    let d = distribution_all(&st, vec![va, vb, vonly], s, e, KST).await.expect("분포 실패");
    println!("분포: total={} max={}ms", d.total, d.max_ms);
    assert!(d.total >= 60);
    assert!(d.max_ms >= 3000, "only-b(B 콜렉터)의 3초짜리가 세어졌다");
}

// ─── 카운터·종류 표 (3단계) ──────────────────────────────────
//
// host agent 가 실제로 내는 카운터(linux 종류의 Cpu)로 본다.

use nscouter_lib::commands::{families_all, today_counter_all};

#[tokio::test]
#[ignore]
async fn 카운터와_종류_표가_두_콜렉터를_합친다() {
    let (pa, pb) = (port("NSC_PORT_A", 16100), port("NSC_PORT_B", 16200));
    let st = state();
    connect_links(&st, vec![target("A", pa), target("B", pb)]).await.unwrap();
    let list = object_list_all(&st).await.unwrap();
    let vh = |n: &str| list.iter().find(|o| o.obj_name == n).unwrap_or_else(|| panic!("{n} 없음")).obj_hash;

    // 오늘 누적 카운터 — 오브젝트별 시계열이 콜렉터 둘에서 다 오고, B 의 web01 은 화면용 해시다
    let series = today_counter_all(&st, "Cpu".into(), vec!["linux".into()], None).await.expect("카운터 실패");
    let hashes: Vec<i32> = series.iter().map(|c| c.obj_hash).collect();
    println!("Cpu 오늘 누적: 오브젝트 {:?}", hashes);
    for n in ["/web01", "/web01 @B", "/only-a", "/only-b"] {
        assert!(hashes.contains(&vh(n)), "{n} 의 시계열이 없다: {hashes:?}");
    }
    assert_eq!(hashes.len(), 4, "콜렉터 둘의 같은 원래 해시가 한 줄로 섞이지 않는다");

    // 종류 표 — 두 콜렉터의 합집합, 같은 종류는 한 번만
    let fams = families_all(&st).await.expect("종류 표 실패");
    let linux: Vec<_> = fams.iter().filter(|f| f.name == "linux").collect();
    println!("종류 {}개, linux → {:?}", fams.len(), linux.iter().map(|f| &f.family).collect::<Vec<_>>());
    assert_eq!(linux.len(), 1);
}

// ─── 콜렉터 설정 (4단계) ─────────────────────────────────────

use nscouter_lib::commands::server_config_of;

#[tokio::test]
#[ignore]
async fn 콜렉터_설정은_고른_콜렉터의_것을_읽는다() {
    let (pa, pb) = (port("NSC_PORT_A", 16100), port("NSC_PORT_B", 16200));
    let st = state();
    connect_links(&st, vec![target("A", pa), target("B", pb)]).await.unwrap();
    let sid = |text: &str| text.lines().find(|l| l.starts_with("server_id=")).map(str::to_string);

    let a = server_config_of(&st, Some("A")).await.unwrap();
    let b = server_config_of(&st, Some("B")).await.unwrap();
    let primary = server_config_of(&st, None).await.unwrap();
    println!("A {:?} · B {:?} · 주 {:?}", sid(&a.text), sid(&b.text), sid(&primary.text));
    assert_eq!(sid(&a.text).as_deref(), Some("server_id=COLL-A"));
    assert_eq!(sid(&b.text).as_deref(), Some("server_id=COLL-B"));
    assert_eq!(sid(&primary.text), sid(&a.text), "고르지 않으면 주 콜렉터(맨 앞)");
    // 붙어 있지 않은 이름이면 엉뚱한 콜렉터에 묻지 않고 거절한다
    assert!(server_config_of(&st, Some("없는것")).await.is_err());
}
