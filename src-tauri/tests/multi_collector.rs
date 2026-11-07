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
