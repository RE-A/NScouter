// src-tauri/src/config.rs
// 앱 설정 (config.json) — 실행파일 경로 기준 저장

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AppConfig {
    /// 커스텀 데이터 디렉토리 (None 또는 빈 문자열이면 실행파일 경로 사용)
    pub data_dir: Option<String>,
    /// 마지막 접속 호스트
    pub last_host: Option<String>,
    /// 마지막 접속 포트
    pub last_port: Option<u16>,
    /// 마지막 접속 사용자명
    pub last_user: Option<String>,
}

impl AppConfig {
    /// config.json 로드 (파일 없거나 파싱 실패 시 기본값 반환)
    pub fn load(path: &PathBuf) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// config.json 저장 (부모 디렉토리 자동 생성)
    pub fn save(&self, path: &PathBuf) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(path, json).map_err(|e| e.to_string())
    }
}
