// src-tauri/src/state.rs
// Tauri AppState - 연결 및 스트리밍 상태 관리

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::config::AppConfig;
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

pub struct AppState {
    /// TCP 연결 (None이면 미연결) - profile/dictionary 전용
    pub connection: Mutex<Option<ScouterConnection>>,
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
