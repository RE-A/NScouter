// src-tauri/src/config.rs
// 앱 설정 (config.json) — 실행파일 경로 기준 저장

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    /// 기동 시 마지막 접속 정보로 자동 연결할지
    pub auto_connect: bool,
    /// 자동 연결용 비밀번호.
    ///
    /// **평문으로 config.json 에 저장된다.** `auto_connect` 를 켤 때만 기록하고
    /// 끄면 즉시 지운다. OS 자격증명 저장소를 쓰지 않는 이유는 의존성 때문이며,
    /// 공용 PC 에서는 켜지 말 것.
    pub last_pass: Option<String>,
    /// SQL 바인딩 파라미터를 문장에 채워 보여줄지.
    ///
    /// **기본은 채우기다.** `where id=?` 만 봐서는 무슨 값으로 느렸는지 알 수 없고,
    /// 그대로 복사해 DB 에 붙일 수도 없다. 값을 따로 보고 싶은 사람을 위해 끌 수 있게 둔다.
    #[serde(default = "default_true")]
    pub sql_bind_inline: bool,
}

/// serde 기본값용. **`Default` 파생만으로는 false 가 된다** —
/// 설정 파일에 항목이 없는 기존 사용자에게 기능이 꺼진 채로 보인다.
fn default_true() -> bool {
    true
}

/// **파생 Default 를 쓰면 안 된다.** bool 의 파생 기본값은 false 라
/// 설정 파일이 아예 없는 첫 실행에서 SQL 채우기가 꺼진 채로 뜬다.
impl Default for AppConfig {
    fn default() -> Self {
        Self {
            data_dir: None,
            last_host: None,
            last_port: None,
            last_user: None,
            auto_connect: false,
            last_pass: None,
            sql_bind_inline: true,
        }
    }
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


#[cfg(test)]
mod bind_default_tests {
    use super::*;

    #[test]
    fn 설정_파일이_없으면_sql_채우기가_켜져_있다() {
        // bool 파생 기본값은 false 다. 그대로 두면 첫 실행에서 기능이 꺼진 채로 뜬다.
        assert!(AppConfig::default().sql_bind_inline);
    }

    #[test]
    fn 예전_설정_파일에_항목이_없어도_켜져_있다() {
        // 이 항목이 생기기 전에 저장된 config.json 이 그대로 남아 있다.
        let old = r#"{"auto_connect":false,"last_host":"127.0.0.1"}"#;
        let cfg: AppConfig = serde_json::from_str(old).expect("파싱 실패");
        assert!(cfg.sql_bind_inline);
        assert_eq!(cfg.last_host.as_deref(), Some("127.0.0.1"));
    }

    #[test]
    fn 꺼_둔_설정은_유지된다() {
        let saved = r#"{"sql_bind_inline":false}"#;
        let cfg: AppConfig = serde_json::from_str(saved).expect("파싱 실패");
        assert!(!cfg.sql_bind_inline);
    }
}
