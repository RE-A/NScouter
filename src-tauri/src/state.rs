// src-tauri/src/state.rs
// Tauri AppState - 연결 및 스트리밍 상태 관리

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::cache::CacheDb;
use crate::config::{resolve_data_dir, AppConfig};
use crate::hub::{CollectorLink, ObjMap};
use crate::scouter::connection::ScouterConnection;

/// 스트림 종류. 각각 독립된 중지 토큰을 가진다.
///
/// 하나의 플래그를 공유하면 `stop_xlog_stream` 이 카운터·알람까지 멈춘다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamKind {
    XLog,
    Counter,
    Alert,
}

/// 스트림별 중지 토큰 묶음.
///
/// `take_token()` 은 **이전 토큰을 중지시키고** 새 토큰을 준다.
/// 같은 스트림을 두 번 시작해도 살아남는 태스크는 항상 하나다
/// (React StrictMode 는 dev 에서 effect 를 두 번 실행한다).
#[derive(Default)]
pub struct StreamTokens {
    xlog: Mutex<Option<Arc<AtomicBool>>>,
    counter: Mutex<Option<Arc<AtomicBool>>>,
    alert: Mutex<Option<Arc<AtomicBool>>>,
}

impl StreamTokens {
    fn slot(&self, kind: StreamKind) -> &Mutex<Option<Arc<AtomicBool>>> {
        match kind {
            StreamKind::XLog => &self.xlog,
            StreamKind::Counter => &self.counter,
            StreamKind::Alert => &self.alert,
        }
    }

    /// 이전 태스크를 중지시키고 새 토큰을 발급한다.
    pub async fn take_token(&self, kind: StreamKind) -> Arc<AtomicBool> {
        let mut slot = self.slot(kind).lock().await;
        if let Some(prev) = slot.take() {
            prev.store(true, Ordering::Relaxed);
        }
        let token = Arc::new(AtomicBool::new(false));
        *slot = Some(token.clone());
        token
    }

    /// 해당 스트림만 중지한다.
    pub async fn stop(&self, kind: StreamKind) {
        if let Some(token) = self.slot(kind).lock().await.take() {
            token.store(true, Ordering::Relaxed);
        }
    }

    /// 전부 중지한다 (연결 종료 시).
    pub async fn stop_all(&self) {
        for kind in [StreamKind::XLog, StreamKind::Counter, StreamKind::Alert] {
            self.stop(kind).await;
        }
    }
}

pub struct AppState {
    /// 붙어 있는 콜렉터들. 맨 앞이 주 콜렉터다 — 붙는 데 성공한 것이 앞에 온다 (`crate::hub`). 비어 있으면 미연결
    links: std::sync::RwLock<Vec<Arc<CollectorLink>>>,
    /// (콜렉터, 원래 objHash) ↔ 화면용 objHash
    objmap: std::sync::Mutex<ObjMap>,
    /// 스트림별 중지 토큰
    pub streams: StreamTokens,
    /// 현재 로그 레벨 (0=Error, 1=Warn, 2=Info, 3=Debug, 4=Trace)
    pub log_level: Arc<AtomicU8>,
    /// 앱 설정 (config.json에서 로드)
    pub config: Mutex<AppConfig>,
    /// config.json 파일 경로
    pub config_path: PathBuf,
    /// 종류별 «사라졌다 돌아온» 추적 (ActiveTrace 주석 참고)
    pub active_trace: Mutex<HashMap<String, ActiveTrace>>,
    /// 창마다 XLog 스트림으로 받고 싶은 오브젝트. **스트림은 하나**라 이것들을 합쳐 연다
    /// (`restart_xlog_stream`). 창 이름 → 해시들
    pub xlog_subs: Mutex<HashMap<String, Vec<i32>>>,
    /// 화면에 보일 접속 이름. 미연결이면 None. 나중에 뜬 창이 접속 상태를 물을 때 쓴다.
    /// 콜렉터 하나면 그 콜렉터의 server_id, 여럿이면 이름을 ` + ` 로 이은 것, 데모면 `DEMO_SERVER_ID`
    pub server_id: Mutex<Option<String>>,
}

/// 액티브 목록에서 **사라졌다 돌아온** 트랜잭션을 찾기 위한 자취.
///
/// 행 수만 적어서는 «지나간 것» 과 «빠졌다 돌아온 것» 을 가를 수 없다 —
/// 1건이 1건으로 유지되어도 속은 다른 트랜잭션일 수 있다. txid 로 짚어야 한다.
///
/// **디버그 로그가 켜져 있을 때만 쌓는다.** 운영 기본값(Error)에서는 비용이 0 이어야 한다.
#[derive(Default)]
pub struct ActiveTrace {
    /// 이 종류를 몇 번 조회했는가. 종류마다 세야 한다 —
    /// 종류가 둘이면 한 번의 폴링에 틱이 두 번 올라 멀줦한 행이 «빠졌다» 로 잍힌다.
    pub tick: u64,
    /// txid → 마지막으로 보인 틱
    pub last_seen: HashMap<i64, u64>,
}

impl AppState {
    pub fn new_with_config(config: AppConfig, config_path: PathBuf) -> Self {
        // 릴리즈 빌드: Error(0), 개발 빌드: Debug(3)
        #[cfg(debug_assertions)]
        let default_level = 3u8;
        #[cfg(not(debug_assertions))]
        let default_level = 0u8;

        crate::tuning::apply(&config);
        Self {
            links: std::sync::RwLock::new(Vec::new()),
            objmap: std::sync::Mutex::new(ObjMap::default()),
            streams: StreamTokens::default(),
            log_level: Arc::new(AtomicU8::new(default_level)),
            config: Mutex::new(config),
            config_path,
            active_trace: Mutex::new(HashMap::new()),
            xlog_subs: Mutex::new(HashMap::new()),
            server_id: Mutex::new(None),
        }
    }

    // ─── 콜렉터들 ─────────────────────────────────────────────

    /// 붙어 있는 콜렉터들 (붙은 순서)
    pub fn links(&self) -> Vec<Arc<CollectorLink>> {
        self.links.read().unwrap_or_else(|p| p.into_inner()).clone()
    }

    /// 콜렉터들을 갈아 끼운다. 화면용 해시 표도 새로 시작한다
    pub fn set_links(&self, links: Vec<Arc<CollectorLink>>) {
        *self.links.write().unwrap_or_else(|p| p.into_inner()) = links;
        self.objmap.lock().unwrap_or_else(|p| p.into_inner()).clear();
    }

    /// 주 콜렉터 — 아직 여러 콜렉터를 합치지 못하는 조회가 여기에 묻는다
    pub fn primary(&self) -> Result<Arc<CollectorLink>, String> {
        self.links.read().unwrap_or_else(|p| p.into_inner()).first().cloned().ok_or_else(|| "연결되지 않음".to_string())
    }

    /// 이름으로 콜렉터를 찾는다
    pub fn link_named(&self, name: &str) -> Option<Arc<CollectorLink>> {
        self.links().into_iter().find(|l| l.name == name)
    }

    /// 화면용 해시 → (그 콜렉터, 원래 해시). 모르는 해시는 주 콜렉터의 것으로 본다 —
    /// 콜렉터 하나만 볼 때는 화면용 해시가 곧 원래 해시다
    pub fn route(&self, vhash: i32) -> Result<(Arc<CollectorLink>, i32), String> {
        let found = self.objmap.lock().unwrap_or_else(|p| p.into_inner()).real(vhash);
        let links = self.links();
        if let Some((idx, real)) = found {
            if let Some(l) = links.iter().find(|l| l.idx == idx) {
                return Ok((l.clone(), real));
            }
        }
        links.first().cloned().map(|l| (l, vhash)).ok_or_else(|| "연결되지 않음".to_string())
    }

    /// 오브젝트 이름 → (그 콜렉터, 원래 이름). 해시가 겹친 오브젝트는 이름 뒤에 ` @콜렉터` 가 붙어 있다
    pub fn route_name(&self, name: &str) -> Result<(Arc<CollectorLink>, String), String> {
        if let (base, Some(tag)) = crate::hub::split_tag(name) {
            if let Some(l) = self.link_named(tag) {
                return Ok((l, base.to_string()));
            }
        }
        Ok((self.primary()?, name.to_string()))
    }

    /// 화면용 해시들을 콜렉터별 원래 해시로 가른다 (콜렉터 순서대로)
    pub fn split_hashes(&self, vhashes: &[i32]) -> Vec<(Arc<CollectorLink>, Vec<i32>)> {
        let links = self.links();
        let mut parts: Vec<Vec<i32>> = vec![Vec::new(); links.len()];
        {
            let map = self.objmap.lock().unwrap_or_else(|p| p.into_inner());
            for &v in vhashes {
                // 모르는 해시는 주 콜렉터(맨 앞)의 것으로 본다
                let (pos, real) = map
                    .real(v)
                    .and_then(|(idx, real)| links.iter().position(|l| l.idx == idx).map(|p| (p, real)))
                    .unwrap_or((0, v));
                if let Some(p) = parts.get_mut(pos) {
                    p.push(real);
                }
            }
        }
        links.into_iter().zip(parts).filter(|(_, p)| !p.is_empty()).collect()
    }

    /// 이 콜렉터의 원래 해시 → 화면용 해시 (처음 보면 정한다)
    pub fn virt(&self, link: &CollectorLink, real: i32) -> i32 {
        self.objmap.lock().unwrap_or_else(|p| p.into_inner()).virt(link.idx, real, &link.name)
    }

    /// 해시가 겹쳐 다른 값을 받았나 — 그런 오브젝트는 이름에 콜렉터를 붙인다
    pub fn is_tagged(&self, link: &CollectorLink, real: i32) -> bool {
        self.objmap.lock().unwrap_or_else(|p| p.into_inner()).peek(link.idx, real).is_some_and(|v| v != real)
    }

    /// 이 콜렉터에서 받은 XLog 의 objHash 를 화면용으로 바꾼다
    pub fn virtualize_xlogs(&self, link: &CollectorLink, xs: &mut [crate::scouter::pack::XLogPack]) {
        let mut map = self.objmap.lock().unwrap_or_else(|p| p.into_inner());
        for x in xs {
            x.obj_hash = map.virt(link.idx, x.obj_hash, &link.name);
        }
    }

    /// 주 콜렉터의 시계 차 (콜렉터 시계 − PC 시계, ms). 화면의 실시간 «지금» 이 쓴다
    pub async fn clock_offset_ms(&self) -> Option<i64> {
        match self.primary() {
            Ok(l) => *l.clock_offset_ms.lock().await,
            Err(_) => None,
        }
    }

    // ── 주 콜렉터에 묻는 자리 (아직 여러 콜렉터를 합치지 못하는 조회) ──

    /// 주 콜렉터의 조회용 연결을 빌린다
    pub async fn acquire_query_conn(&self) -> Result<ScouterConnection, String> {
        self.primary()?.acquire_query_conn().await
    }

    /// 빌린 연결을 **그 연결이 붙은 콜렉터의** 풀에 돌려준다. 붙은 콜렉터가 없으면 버린다
    pub async fn release_query_conn(&self, conn: ScouterConnection) {
        let (host, port) = conn.target();
        let owner = self.links().into_iter().find(|l| l.host == host && l.port == port);
        if let Some(l) = owner {
            l.release_query_conn(conn).await;
        }
    }

    /// 데이터 폴더 아래의 한 자리.
    ///
    /// `config_path` 는 늘 `{exe_dir}/config.json` 이므로 그 부모가 실행파일 폴더다.
    async fn data_sub_dir(&self, name: &str) -> PathBuf {
        let config = self.config.lock().await;
        let exe_dir = self
            .config_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        resolve_data_dir(&config, &exe_dir).join(name)
    }

    /// 저장본 폴더. `{data_dir}/profiles/`
    pub async fn profile_dir(&self) -> PathBuf {
        self.data_sub_dir(crate::profile_store::DIR_NAME).await
    }

    /// 내보내기 폴더. `{data_dir}/exports/`
    pub async fn export_dir(&self) -> PathBuf {
        self.data_sub_dir(crate::export_store::DIR_NAME).await
    }

    /// 로컬 캐시 폴더. `{data_dir}/cache/`
    pub async fn cache_dir(&self) -> PathBuf {
        self.data_sub_dir(crate::cache::DIR_NAME).await
    }

    /// 콜렉터 하나의 캐시를 열어 붙인다 (사전도 같이). 못 열면 캐시 없이 간다 — 조회는 그대로 된다
    pub async fn attach_cache(&self, link: &CollectorLink) {
        let dir = self.cache_dir().await;
        let key = crate::cache::collector_key(&link.host, link.port);
        let db = match CacheDb::open(&dir, &key) {
            Ok(db) => Some(Arc::new(db)),
            Err(e) => {
                log::warn!("로컬 캐시 없이 갑니다 ({}): {e}", link.name);
                None
            }
        };
        if let Some(db) = &db {
            log::info!("로컬 캐시: {}", db.path().display());
        }
        link.set_cache(db).await;
    }

    /// 설정 «로컬 캐시 상한» 을 적용한다 — 안 붙은 콜렉터의 파일을 먼저 줄이고, 남은 몫을 붙은 콜렉터들이 나눠 쓴다
    pub async fn apply_cache_limit(&self) {
        let budget = self.config.lock().await.cache_max_mb as u64 * 1024 * 1024;
        let dir = self.cache_dir().await;
        let mut dbs = Vec::new();
        for l in self.links() {
            if let Some(db) = l.cache_handle().await {
                dbs.push(db);
            }
        }
        if dbs.is_empty() {
            return;
        }
        let paths: Vec<&std::path::Path> = dbs.iter().map(|d| d.path()).collect();
        let mine = crate::cache::prune_others(&dir, &paths, budget);
        let each = mine / dbs.len() as u64;
        for db in &dbs {
            db.set_max_bytes(each);
        }
    }

    /// 주 콜렉터의 캐시
    pub async fn cache_handle(&self) -> Option<Arc<CacheDb>> {
        match self.primary() {
            Ok(l) => l.cache_handle().await,
            Err(_) => None,
        }
    }

    /// `cache_handle` — 막히는 일꾼 스레드에서 (`spawn_blocking` 안)
    pub fn cache_handle_blocking(&self) -> Option<Arc<CacheDb>> {
        self.primary().ok().and_then(|l| l.cache_handle_blocking())
    }

    /// 주 콜렉터 시계로 «지금 − 5분». 이보다 뒤의 XLog 는 «다 받았다» 고 적지 않는다 (`cache::xlog`)
    pub async fn seal_before(&self) -> i64 {
        match self.primary() {
            Ok(l) => l.seal_before().await,
            Err(_) => crate::scouter::connection::local_now_ms() - crate::cache::xlog::SEAL_MS,
        }
    }

    /// 콜렉터를 다 끊는다 — 연결·풀·캐시를 버리고 목록을 비운다
    pub async fn close_all(&self) {
        for l in self.links() {
            l.close().await;
        }
        self.set_links(Vec::new());
    }

    /// 오브젝트 기록 폴더. `{data_dir}/object-history/`
    pub async fn object_history_dir(&self) -> PathBuf {
        self.data_sub_dir(crate::object_history_store::DIR_NAME).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// StrictMode 는 dev 에서 effect 를 두 번 실행한다.
    /// 두 번 시작하면 첫 태스크는 죽어야 한다.
    #[tokio::test]
    async fn 같은_스트림을_다시_시작하면_이전_토큰이_중지된다() {
        let t = StreamTokens::default();
        let first = t.take_token(StreamKind::Counter).await;
        let second = t.take_token(StreamKind::Counter).await;

        assert!(first.load(Ordering::Relaxed), "이전 토큰이 중지되지 않았다");
        assert!(!second.load(Ordering::Relaxed), "새 토큰이 이미 중지 상태다");
    }

    /// 예전에는 플래그 하나를 공유해서 XLog 를 멈추면 카운터도 멈췄다.
    #[tokio::test]
    async fn 한_스트림을_멈춰도_다른_스트림은_살아있다() {
        let t = StreamTokens::default();
        let xlog = t.take_token(StreamKind::XLog).await;
        let counter = t.take_token(StreamKind::Counter).await;

        t.stop(StreamKind::XLog).await;

        assert!(xlog.load(Ordering::Relaxed), "XLog 가 안 멈췄다");
        assert!(!counter.load(Ordering::Relaxed), "카운터까지 멈췄다");
    }

    #[tokio::test]
    async fn stop_all_은_전부_중지한다() {
        let t = StreamTokens::default();
        let xlog = t.take_token(StreamKind::XLog).await;
        let counter = t.take_token(StreamKind::Counter).await;
        let alert = t.take_token(StreamKind::Alert).await;

        t.stop_all().await;

        assert!(xlog.load(Ordering::Relaxed));
        assert!(counter.load(Ordering::Relaxed));
        assert!(alert.load(Ordering::Relaxed));
    }
}
