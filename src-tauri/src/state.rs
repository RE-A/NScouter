// src-tauri/src/state.rs
// Tauri AppState - 연결 및 스트리밍 상태 관리

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8};
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::config::AppConfig;
use crate::scouter::connection::ScouterConnection;
use crate::scouter::dictionary::TextCache;

pub struct AppState {
    /// TCP 연결 (None이면 미연결) - profile/dictionary 전용
    pub connection: Mutex<Option<ScouterConnection>>,
    /// 텍스트 딕셔너리 캐시
    pub text_cache: Mutex<TextCache>,
    /// 스트리밍 중지 플래그
    pub stream_stop: Arc<AtomicBool>,
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
            stream_stop: Arc::new(AtomicBool::new(false)),
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
