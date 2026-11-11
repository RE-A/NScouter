// 여러 콜렉터를 한 화면에 — 콜렉터마다 연결 묶음(`CollectorLink`) 하나, 화면에는 가상 objHash 하나.
//
// **사람은 서버 하나에 붙은 것처럼 본다.** 운영 콜렉터가 시스템별로 나뉜 곳이 많아, 서버 목록·XLog·상세를
// 한 화면에서 섞어 봐야 한다. 그래서 화면(명령 인자·이벤트)에는 지금처럼 objHash 하나만 오가게 두고,
// 어느 콜렉터의 것인지는 여기서 가린다:
//
//   · 콜렉터마다 주 연결·조회 연결 풀·세션·시계 차·로컬 캐시·이름 사전을 따로 든다 — 남의 연결로
//     물으면 남의 답이 온다
//   · `objHash = hash(objName)` 이라(F-58) 두 콜렉터에 이름이 같은 앱이 있으면 해시가 겹친다.
//     `ObjMap` 이 (콜렉터, 원래 해시) 를 화면용 해시로 바꿔 준다. **겹치지 않으면 원래 해시 그대로**라
//     콜렉터 하나만 볼 때는 지금과 똑같다. 겹친 쪽만 다른 값을 받고, 이름 뒤에 ` @콜렉터` 가 붙는다
//   · 먼저 붙은(앞에 놓인) 콜렉터가 원래 해시를 차지한다 — 오브젝트 목록을 콜렉터 순서대로 읽는다

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::cache::CacheDb;
use crate::scouter::connection::{local_now_ms, ScouterConnection};
use crate::scouter::dictionary::TextCache;

/// 놀고 있는 조회용 연결을 콜렉터마다 몇 개까지 들고 있을지.
///
/// 동시에 도는 주기 조회는 액티브 서비스(2초)·서비스 그룹(10초)·토폴로지(15초)·
/// 타임라인(30초, 카운터 4개) 정도다. 겹쳐도 서넛이라 이만큼이면 기다릴 일이 없고,
/// 더 들고 있어 봐야 콜렉터 쪽 소켓만 잡아 둔다.
const MAX_IDLE_QUERY_CONNS: usize = 4;

/// 붙을 콜렉터 하나 — 화면의 서버 프로필에서 온다
#[derive(Debug, Clone, serde::Deserialize)]
pub struct ConnectTarget {
    /// 화면에 보일 이름. 비면 `host:port`
    #[serde(default)]
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(default)]
    pub pass: String,
}

impl ConnectTarget {
    pub fn label(&self) -> String {
        let n = self.name.trim();
        if n.is_empty() {
            format!("{}:{}", self.host, self.port)
        } else {
            n.to_string()
        }
    }
}

/// 콜렉터 하나의 연결 묶음
pub struct CollectorLink {
    /// 고유 번호 (프로필 순서). 화면용 해시 표(`ObjMap`)가 이 번호로 콜렉터를 가린다.
    /// 주 콜렉터는 이 번호가 아니라 `AppState` 목록의 맨 앞이다
    pub idx: usize,
    /// 화면에 보일 이름 (프로필 이름 또는 `host:port`)
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pass: String,
    /// 주 연결 — 사전·프로파일 같은 짧은 조회. None 이면 끊긴 상태
    pub connection: Mutex<Option<ScouterConnection>>,
    /**
     * 조회용 연결 풀.
     *
     * **긴 조회가 짧은 폴링을 막지 않게 한다.** 예전에는 objType 조회가 전부
     * 주 연결 하나를 나눠 써서, 6시간짜리 카운터 조회(오브젝트 2대에 856ms,
     * 100대면 그 몇 배) 동안 액티브 서비스 2초 폴링과 토폴로지가 통째로 멈췄다.
     *
     * ASIS 도 같은 이유로 `TcpProxy` 풀을 쓴다.
     * 비어 있으면 새로 붙는다 — 연결 하나가 곧 명령 하나이므로(F-1) 빌려 쓰고 돌려준다.
     */
    query_pool: Mutex<Vec<ScouterConnection>>,
    /// 콜렉터가 알려 준 서버 이름. 한 번도 못 붙었으면 None
    pub server_id: Mutex<Option<String>>,
    /// 콜렉터 시계 − PC 시계 (ms). 접속·새로고침 때 잰다
    pub clock_offset_ms: Mutex<Option<i64>>,
    /// 이 콜렉터의 로컬 캐시 (`crate::cache`). 못 열면 None
    cache: Mutex<Option<Arc<CacheDb>>>,
    /// 텍스트 딕셔너리 캐시 — 콜렉터마다 따로 (디스크 캐시가 콜렉터별이다)
    pub text_cache: Mutex<TextCache>,
    /// 마지막으로 붙으려다 실패한 까닭
    pub error: Mutex<Option<String>>,
    /// 붙어는 있는데 **조회가 실패한** 마지막 일 — (언제 ms, 까닭). 주기 조회는 이 콜렉터만 빼고 답하고
    /// 헤더가 이걸 경고로 보인다. **성공했다고 지우지 않는다** — 같은 콜렉터에서 다른 조회가 성공할 때마다 지우면
    /// 경고가 깜빡인다. `WARNING_TTL_MS` 가 지나면 안 보이고, 다시 붙으면 지운다.
    /// 막히는 일꾼 스레드에서도 적으므로 std 뮤텍스다
    warning: std::sync::Mutex<Option<(i64, String)>>,
}

/// 조회 경고를 «최근» 으로 보는 시간 — 주기 조회가 2~10초라 이만큼 지나도 다시 안 났으면 나은 것이다
pub const WARNING_TTL_MS: i64 = 60_000;

impl CollectorLink {
    pub fn new(idx: usize, t: &ConnectTarget) -> Self {
        Self {
            idx,
            name: t.label(),
            host: t.host.trim().to_string(),
            port: t.port,
            user: t.user.clone(),
            pass: t.pass.clone(),
            connection: Mutex::new(None),
            query_pool: Mutex::new(Vec::new()),
            server_id: Mutex::new(None),
            clock_offset_ms: Mutex::new(None),
            cache: Mutex::new(None),
            text_cache: Mutex::new(TextCache::new()),
            error: Mutex::new(None),
            warning: std::sync::Mutex::new(None),
        }
    }

    pub fn pass(&self) -> &str {
        &self.pass
    }

    /// 새 소켓으로 붙어 로그인까지 한다 — **막힌다.** 스트림·조회 연결이 쓴다
    pub fn open(&self) -> Result<ScouterConnection, String> {
        let mut conn = ScouterConnection::connect(&self.host, self.port).map_err(|e| format!("연결 실패: {e}"))?;
        conn.login(&self.user, &self.pass).map_err(|e| format!("로그인 실패: {e}"))?;
        Ok(conn)
    }

    /// 주 연결을 새로 맺는다 (접속·새로고침). 시계 차도 다시 재고, 조회용 연결 풀은 비운다 —
    /// 죽은 연결이 풀에서 나오면 안 된다. 실패하면 끊긴 상태로 두고 까닭을 남긴다
    pub async fn reconnect(self: &Arc<Self>) -> Result<String, String> {
        let me = self.clone();
        let opened = tokio::task::spawn_blocking(move || me.open())
            .await
            .unwrap_or_else(|e| Err(format!("연결 작업 실패: {e}")));
        self.clear_query_pool().await;
        match opened {
            Ok(conn) => {
                let sid = conn.server_id.clone();
                *self.clock_offset_ms.lock().await = conn.clock_offset_ms;
                *self.server_id.lock().await = Some(sid.clone());
                *self.connection.lock().await = Some(conn);
                *self.error.lock().await = None;
                self.clear_warning();
                Ok(sid)
            }
            Err(e) => {
                *self.connection.lock().await = None;
                *self.error.lock().await = Some(e.clone());
                Err(e)
            }
        }
    }

    /// 끊는다 — 주 연결과 풀을 버리고 캐시를 뗀다
    pub async fn close(&self) {
        self.clear_warning();
        *self.connection.lock().await = None;
        self.clear_query_pool().await;
        self.set_cache(None).await;
    }

    pub async fn is_connected(&self) -> bool {
        self.connection.lock().await.is_some()
    }

    /// 조회용 연결 하나를 빌린다. 놀고 있는 것이 없으면 새로 붙는다.
    ///
    /// **주 연결을 잠그지 않는다** — 그게 이 풀을 두는 이유다.
    pub async fn acquire_query_conn(&self) -> Result<ScouterConnection, String> {
        if let Some(conn) = self.query_pool.lock().await.pop() {
            return Ok(conn);
        }
        if !self.is_connected().await {
            return Err(format!("연결되지 않음 ({})", self.name));
        }
        let mut conn = ScouterConnection::connect(&self.host, self.port).map_err(|e| format!("조회용 연결 실패: {e}"))?;
        conn.login(&self.user, &self.pass).map_err(|e| format!("조회용 로그인 실패: {e}"))?;
        Ok(conn)
    }

    /// 다 쓴 연결을 돌려준다.
    ///
    /// **오류가 난 연결은 돌려주지 말 것.** 응답을 끝까지 못 읽은 소켓에는 다음 응답의
    /// 앞부분이 남아 있어, 다음 조회가 남의 답을 자기 것으로 읽는다.
    pub async fn release_query_conn(&self, conn: ScouterConnection) {
        let mut pool = self.query_pool.lock().await;
        if pool.len() < MAX_IDLE_QUERY_CONNS {
            pool.push(conn);
        }
    }

    /// 풀을 비운다. 접속을 끊거나 다시 맺을 때.
    pub async fn clear_query_pool(&self) {
        self.query_pool.lock().await.clear();
    }

    /// 로컬 캐시를 붙이거나 뗀다 (사전도 같이)
    pub async fn set_cache(&self, db: Option<Arc<CacheDb>>) {
        self.text_cache.lock().await.attach(db.clone());
        *self.cache.lock().await = db;
    }

    pub async fn cache_handle(&self) -> Option<Arc<CacheDb>> {
        self.cache.lock().await.clone()
    }

    /// `cache_handle` — 막히는 일꾼 스레드에서 (`spawn_blocking` 안)
    pub fn cache_handle_blocking(&self) -> Option<Arc<CacheDb>> {
        self.cache.blocking_lock().clone()
    }

    /// 이 콜렉터 시계로 «지금 − 5분». 이보다 뒤의 XLog 는 «다 받았다» 고 적지 않는다 (`cache::xlog`)
    pub async fn seal_before(&self) -> i64 {
        let offset = self.clock_offset_ms.lock().await.unwrap_or(0);
        local_now_ms() + offset - crate::cache::xlog::SEAL_MS
    }

    /// `seal_before` — 막히는 일꾼 스레드에서
    pub fn seal_before_blocking(&self) -> i64 {
        let offset = self.clock_offset_ms.blocking_lock().unwrap_or(0);
        local_now_ms() + offset - crate::cache::xlog::SEAL_MS
    }

    /// 조회가 실패했다 — 경고로 남긴다
    pub fn warn(&self, msg: &str) {
        log::warn!("콜렉터 조회 실패 ({}): {msg}", self.name);
        *self.warning.lock().unwrap_or_else(|p| p.into_inner()) = Some((local_now_ms(), msg.to_string()));
    }

    /// 경고를 지운다 — 다시 붙었을 때
    pub fn clear_warning(&self) {
        *self.warning.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }

    /// 최근(`WARNING_TTL_MS`) 조회 경고
    pub fn recent_warning(&self) -> Option<String> {
        let w = self.warning.lock().unwrap_or_else(|p| p.into_inner());
        w.as_ref().filter(|(t, _)| local_now_ms() - t < WARNING_TTL_MS).map(|(_, m)| m.clone())
    }

    /// 해시가 겹쳐 다른 값을 받은 오브젝트의 화면 이름
    pub fn tagged_name(&self, name: &str) -> String {
        format!("{name}{NAME_TAG}{}", self.name)
    }
}

/// 겹친 오브젝트 이름 뒤에 붙이는 표지 — `"/shop/app @QA"`
pub const NAME_TAG: &str = " @";

/// `"/shop/app @QA"` → (`"/shop/app"`, `Some("QA")`). 표지가 없으면 그대로
pub fn split_tag(name: &str) -> (&str, Option<&str>) {
    match name.rfind(NAME_TAG) {
        Some(i) => (&name[..i], Some(&name[i + NAME_TAG.len()..])),
        None => (name, None),
    }
}

// ─── 콜렉터 여럿의 결과 모으기 ────────────────────────────────

/// 콜렉터마다 돌린 결과를 모은다 — **주기 조회용.**
///
/// 실패한 콜렉터는 경고로 남기고(`warn`) 빼서, 붙어 있는 나머지 콜렉터의 값으로 답한다. 콜렉터 하나가 흔들릴 때
/// 패널이 통째로 비면 안 된다. **전부 실패하면 실패다** — 콜렉터가 하나일 때는
/// 그 오류를 그대로 돌려준다(예전과 같다).
///
/// 한 번 누르는 조회(과거 조회·찾기·분포·상세)는 쓰지 않는다 — 콜렉터 하나가 빠진 결과를 «그 구간에 그것뿐» 으로
/// 믿게 되므로 거기서는 실패를 그대로 올린다.
pub fn gather<T>(results: Vec<(std::sync::Arc<CollectorLink>, Result<T, String>)>) -> Result<Vec<(std::sync::Arc<CollectorLink>, T)>, String> {
    if results.is_empty() {
        return Err("연결되지 않음".to_string());
    }
    let n = results.len();
    let mut ok = Vec::with_capacity(n);
    let mut errs = Vec::new();
    for (link, r) in results {
        match r {
            Ok(v) => ok.push((link, v)),
            Err(e) => {
                link.warn(&e);
                errs.push(if n > 1 { format!("{e} ({})", link.name) } else { e });
            }
        }
    }
    if ok.is_empty() {
        return Err(errs.join(" / "));
    }
    Ok(ok)
}

// ─── 가상 objHash ────────────────────────────────────────────

/// (콜렉터, 원래 objHash) ↔ 화면용 objHash.
///
/// **한 번 정한 값은 접속 동안 바뀌지 않는다** — 화면의 필터·상세 탭이 이 값을 쥐고 있다.
#[derive(Default)]
pub struct ObjMap {
    to_real: HashMap<i32, (usize, i32)>,
    to_virt: HashMap<(usize, i32), i32>,
}

impl ObjMap {
    /// 화면용 해시. 처음 보는 것이면 정한다 — 다른 콜렉터가 아직 안 쓴 값이면 원래 해시 그대로,
    /// 쓰고 있으면 `salt`(콜렉터 이름)를 섞은 해시에서 빈 자리를 찾는다
    pub fn virt(&mut self, link: usize, real: i32, salt: &str) -> i32 {
        if let Some(v) = self.to_virt.get(&(link, real)) {
            return *v;
        }
        let mut v = real;
        if self.to_real.contains_key(&v) {
            v = fnv32(&format!("{salt}|{real}"));
            while v == 0 || self.to_real.contains_key(&v) {
                v = v.wrapping_add(1);
            }
        }
        self.to_real.insert(v, (link, real));
        self.to_virt.insert((link, real), v);
        v
    }

    /// 이미 정한 화면용 해시
    pub fn peek(&self, link: usize, real: i32) -> Option<i32> {
        self.to_virt.get(&(link, real)).copied()
    }

    /// 화면용 해시 → (콜렉터, 원래 해시). 모르는 값이면 None
    pub fn real(&self, v: i32) -> Option<(usize, i32)> {
        self.to_real.get(&v).copied()
    }

    pub fn clear(&mut self) {
        self.to_real.clear();
        self.to_virt.clear();
    }
}

/// FNV-1a 32비트 — 겹친 해시를 다시 정할 때만 쓴다(콜렉터 해시와 같을 필요가 없다)
fn fnv32(s: &str) -> i32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 겹치지_않으면_원래_해시_그대로다() {
        let mut m = ObjMap::default();
        assert_eq!(m.virt(0, 100, "A"), 100);
        assert_eq!(m.virt(1, 200, "B"), 200);
        assert_eq!(m.real(200), Some((1, 200)));
    }

    #[test]
    fn 겹치면_뒤에_온_콜렉터만_다른_값을_받고_계속_같은_값이다() {
        let mut m = ObjMap::default();
        assert_eq!(m.virt(0, 100, "A"), 100);
        let v = m.virt(1, 100, "B");
        assert_ne!(v, 100);
        assert_ne!(v, 0);
        assert_eq!(m.virt(1, 100, "B"), v);
        assert_eq!(m.real(v), Some((1, 100)));
        assert_eq!(m.real(100), Some((0, 100)));
    }

    #[test]
    fn 다시_정한_값이_다른_원래_해시와_겹치면_피한다() {
        let mut m = ObjMap::default();
        let would = fnv32("B|100");
        m.virt(0, 100, "A");
        m.virt(0, would, "A");
        let v = m.virt(1, 100, "B");
        assert_ne!(v, would);
        assert_ne!(v, 100);
    }

    #[test]
    fn 이름_표지를_떼어_낸다() {
        assert_eq!(split_tag("/shop/app @QA"), ("/shop/app", Some("QA")));
        assert_eq!(split_tag("/shop/app"), ("/shop/app", None));
    }

    fn link(name: &str) -> std::sync::Arc<CollectorLink> {
        let t = ConnectTarget { name: name.into(), host: "h".into(), port: 1, user: "u".into(), pass: String::new() };
        std::sync::Arc::new(CollectorLink::new(0, &t))
    }

    #[test]
    fn 한_콜렉터가_실패해도_나머지로_답하고_실패한_것은_경고로_남긴다() {
        let (a, b) = (link("A"), link("B"));
        let got = gather(vec![(a.clone(), Ok(1)), (b.clone(), Err::<i32, _>("끊김".to_string()))]).unwrap();
        assert_eq!(got.iter().map(|(l, v)| (l.name.clone(), *v)).collect::<Vec<_>>(), vec![("A".to_string(), 1)]);
        assert_eq!(b.recent_warning().as_deref(), Some("끊김"));
        assert_eq!(a.recent_warning(), None);
        // 성공했다고 지우지 않는다 — 1분 동안은 «최근에 실패가 있었다» 로 남는다(깜빡이지 않게)
        gather(vec![(b.clone(), Ok(2))]).unwrap();
        assert_eq!(b.recent_warning().as_deref(), Some("끊김"));
        b.clear_warning();
        assert_eq!(b.recent_warning(), None);
    }

    #[test]
    fn 전부_실패하면_실패다_콜렉터가_하나면_오류를_그대로() {
        let a = link("A");
        assert_eq!(gather(vec![(a.clone(), Err::<i32, _>("x".to_string()))]).err().as_deref(), Some("x"));
        let b = link("B");
        let e = gather(vec![(a, Err::<i32, _>("x".to_string())), (b, Err("y".to_string()))]).err();
        assert_eq!(e.as_deref(), Some("x (A) / y (B)"));
        assert!(gather::<i32>(vec![]).is_err());
    }

    #[test]
    fn 이름이_비면_호스트와_포트로_부른다() {
        let t = ConnectTarget { name: " ".into(), host: "h".into(), port: 6100, user: "u".into(), pass: String::new() };
        assert_eq!(t.label(), "h:6100");
    }
}
