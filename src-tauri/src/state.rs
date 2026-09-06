// src-tauri/src/state.rs
// Tauri AppState - 연결 및 스트리밍 상태 관리

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::config::{resolve_data_dir, AppConfig};
use crate::scouter::connection::ScouterConnection;
use crate::scouter::dictionary::TextCache;

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

/// 놀고 있는 조회용 연결을 몇 개까지 들고 있을지.
///
/// 동시에 도는 주기 조회는 액티브 서비스(2초)·서비스 그룹(10초)·토폴로지(15초)·
/// 타임라인(30초, 카운터 4개) 정도다. 겹쳐도 서넛이라 이만큼이면 기다릴 일이 없고,
/// 더 들고 있어 봐야 콜렉터 쪽 소켓만 잡아 둔다.
const MAX_IDLE_QUERY_CONNS: usize = 4;

pub struct AppState {
    /// TCP 연결 (None이면 미연결) - profile/dictionary 전용
    pub connection: Mutex<Option<ScouterConnection>>,
    /**
     * 조회용 연결 풀.
     *
     * **긴 조회가 짧은 폴링을 막지 않게 한다.** 예전에는 objType 조회가 전부
     * `connection` 하나를 나눠 써서, 6시간짜리 카운터 조회(오브젝트 2대에 856ms,
     * 100대면 그 몇 배) 동안 액티브 서비스 2초 폴링과 토폴로지가 통째로 멈췄다.
     * 화면에는 «지금 이 순간» 이 몇 초씩 얼어붙은 채로 남는다.
     *
     * ASIS 도 같은 이유로 `TcpProxy` 풀을 쓴다.
     * 비어 있으면 새로 붙는다 — 연결 하나가 곧 명령 하나이므로(F-1) 빌려 쓰고 돌려준다.
     */
    query_pool: Mutex<Vec<ScouterConnection>>,
    /// 텍스트 딕셔너리 캐시
    pub text_cache: Mutex<TextCache>,
    /// 스트림별 중지 토큰
    pub streams: StreamTokens,
    /// 현재 로그 레벨 (0=Error, 1=Warn, 2=Info, 3=Debug, 4=Trace)
    pub log_level: Arc<AtomicU8>,
    /// 재연결용 파라미터 (streaming 전용 connection 생성에 사용)
    pub conn_host: Mutex<String>,
    pub conn_port: Mutex<u16>,
    pub conn_user: Mutex<String>,
    pub conn_pass: Mutex<String>,
    /// 앱 설정 (config.json에서 로드)
    pub config: Mutex<AppConfig>,
    /// config.json 파일 경로
    pub config_path: PathBuf,
}

impl AppState {
    pub fn new_with_config(config: AppConfig, config_path: PathBuf) -> Self {
        // 릴리즈 빌드: Error(0), 개발 빌드: Debug(3)
        #[cfg(debug_assertions)]
        let default_level = 3u8;
        #[cfg(not(debug_assertions))]
        let default_level = 0u8;

        Self {
            connection: Mutex::new(None),
            query_pool: Mutex::new(Vec::new()),
            text_cache: Mutex::new(TextCache::new()),
            streams: StreamTokens::default(),
            log_level: Arc::new(AtomicU8::new(default_level)),
            conn_host: Mutex::new(String::new()),
            conn_port: Mutex::new(0),
            conn_user: Mutex::new(String::new()),
            conn_pass: Mutex::new(String::new()),
            config: Mutex::new(config),
            config_path,
        }
    }

    /// 조회용 연결 하나를 빌린다. 놀고 있는 것이 없으면 새로 붙는다.
    ///
    /// **`connection` 을 잠그지 않는다** — 그게 이 풀을 두는 이유다.
    /// 접속 여부만 그쪽에서 확인하고, 실제 요청은 빌린 연결로 보낸다.
    pub async fn acquire_query_conn(&self) -> Result<ScouterConnection, String> {
        if let Some(conn) = self.query_pool.lock().await.pop() {
            return Ok(conn);
        }

        // 접속 정보는 스트림이 쓰는 것과 같다. 여기서 새로 붙는다.
        let host = self.conn_host.lock().await.clone();
        let port = *self.conn_port.lock().await;
        let user = self.conn_user.lock().await.clone();
        let pass = self.conn_pass.lock().await.clone();
        if host.is_empty() {
            return Err("연결되지 않음".to_string());
        }

        let mut conn = ScouterConnection::connect(&host, port)
            .map_err(|e| format!("조회용 연결 실패: {e}"))?;
        conn.login(&user, &pass)
            .map_err(|e| format!("조회용 로그인 실패: {e}"))?;
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

    /// 풀을 비운다. 접속을 끊거나 서버를 갈아탈 때.
    ///
    /// 안 비우면 이전 서버로 붙은 연결이 남아, 새 서버를 보는 중에 옛 서버의 답이 온다.
    pub async fn clear_query_pool(&self) {
        self.query_pool.lock().await.clear();
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
