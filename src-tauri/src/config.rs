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
    /// 글자 크기 배율. 1.0 이 기본이고 화면에서 0.8~1.6 사이로 고른다.
    ///
    /// 밀도를 위해 작게 잡은 화면이라 오래 보면 읽기 힘들다는 이야기가 있어 둔다.
    #[serde(default = "default_font_scale")]
    pub ui_font_scale: f32,
    /// 화면 언어. `"ko"` 또는 `"en"`.
    ///
    /// Scouter 용어(TPS·XLog·Elapsed)는 원래 영어라 두 언어에서 같다.
    /// 바뀌는 건 우리가 붙인 설명과 레이블이다.
    #[serde(default = "default_lang")]
    pub ui_language: String,
    /// 끌어서 정한 패널 크기와 마지막에 보던 탭.
    ///
    /// **매번 다시 맞추는 게 가장 번거로운 부분이라 남긴다.**
    #[serde(default)]
    pub ui_layout: UiLayout,
    /// XLog 스캐터 차트 설정(Y축·시간 범위·무시 구간).
    #[serde(default)]
    pub xlog_chart: XLogChartPrefs,
}

/// 끌어서 정한 패널 크기. 픽셀이다.
///
/// **화면 밖으로 나갈 값이 들어와도 앱이 죽으면 안 된다.** 설정 파일은 사람이 여는 곳이고,
/// 모니터를 바꾸면 어제 맞는 값이 오늘 안 맞는다 — 실제 배치는 화면에서 다시 가둔다
/// (`clampPane`). 여기서는 저장만 한다.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct UiLayout {
    /// 좌측 서비스 목록 폭
    pub services_w: f32,
    /// 우측 상세 패널 폭
    pub detail_w: f32,
    /// 아래 트랜잭션 표 높이
    pub table_h: f32,
    /// 마지막에 보던 탭. `"xlog"` · `"counter"` · `"alert"`
    pub active_tab: String,
    /// 서비스 목록을 무엇으로 묶는가. `"type"`(오브젝트 종류) 또는 `"group"`(이름의 부모 경로)
    pub agent_group_by: String,
}

impl Default for UiLayout {
    fn default() -> Self {
        // 0 을 기본값으로 두면 패널이 사라진 채로 뜬다. 화면 쪽 기본값과 같은 수를 쓴다
        // (`src/components/paneSizing.ts` 의 PANE).
        Self {
            services_w: 200.0,
            detail_w: 420.0,
            table_h: 240.0,
            active_tab: "xlog".to_string(),
            agent_group_by: "type".to_string(),
        }
    }
}

/// XLog 스캐터 차트 설정.
///
/// 색은 넣지 않는다 — 팔레트는 `colorPalette.ts` 한 곳에만 있어야 하고,
/// 설정 파일에 두 벌이 되면 테마를 바꿔도 저장해 둔 색이 이긴다.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct XLogChartPrefs {
    /// `"elapsed"` · `"cpu"` · `"memory"`
    pub y_axis_mode: String,
    /// 보는 시간 폭(ms)
    pub time_range_ms: i64,
    /// Y축 최대값(초)
    pub y_max: f32,
    /// 무시 구간을 칠할지
    pub show_ignore_area: bool,
    /// 그 아래는 무시로 보는 응답시간(ms)
    pub ignore_threshold_ms: i64,
}

impl Default for XLogChartPrefs {
    fn default() -> Self {
        Self {
            y_axis_mode: "elapsed".to_string(),
            time_range_ms: 300_000,
            y_max: 9.0,
            show_ignore_area: false,
            ignore_threshold_ms: 0,
        }
    }
}

/// serde 기본값용. **`Default` 파생만으로는 false 가 된다** —
/// 설정 파일에 항목이 없는 기존 사용자에게 기능이 꺼진 채로 보인다.
fn default_true() -> bool {
    true
}

/// 같은 이유로 파생 기본값(0.0)을 쓰면 글자가 사라진다.
fn default_font_scale() -> f32 {
    1.0
}

/// 빈 문자열이 기본값이 되면 언어를 못 정한다.
fn default_lang() -> String {
    "ko".to_string()
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
            ui_font_scale: 1.0,
            ui_language: "ko".to_string(),
            ui_layout: UiLayout::default(),
            xlog_chart: XLogChartPrefs::default(),
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

    #[test]
    fn 글자_배율은_없으면_1이다() {
        // 파생 기본값(0.0)이 들어가면 **글자가 사라진다.**
        assert_eq!(AppConfig::default().ui_font_scale, 1.0);
        let old = r#"{"auto_connect":false}"#;
        let cfg: AppConfig = serde_json::from_str(old).expect("파싱 실패");
        assert_eq!(cfg.ui_font_scale, 1.0);
    }

    #[test]
    fn 배치가_없는_예전_설정도_읽힌다() {
        // **이 항목이 생기기 전에 저장된 config.json 이 그대로 남아 있다.**
        // 0 이 들어가면 패널이 사라진 채로 뜬다 — 화면 쪽 기본값과 같은 수여야 한다.
        let old = r#"{"auto_connect":false,"ui_language":"en"}"#;
        let cfg: AppConfig = serde_json::from_str(old).expect("파싱 실패");
        assert_eq!(cfg.ui_layout.services_w, 200.0);
        assert_eq!(cfg.ui_layout.detail_w, 420.0);
        assert_eq!(cfg.ui_layout.table_h, 240.0);
        assert_eq!(cfg.ui_layout.active_tab, "xlog");
        assert_eq!(cfg.ui_layout.agent_group_by, "type", "항목이 없으면 예전 동작(타입)이어야 한다");
        assert_eq!(cfg.xlog_chart.y_axis_mode, "elapsed");
        assert_eq!(cfg.xlog_chart.time_range_ms, 300_000);
        assert_eq!(cfg.xlog_chart.y_max, 9.0);
        // 다른 항목이 밀려나지 않았다
        assert_eq!(cfg.ui_language, "en");
    }

    #[test]
    fn 배치가_일부만_있어도_나머지는_기본값이다() {
        // 항목을 하나씩 늘려 갈 때 예전 파일이 반쪽으로 읽히면 안 된다.
        let saved = r#"{"ui_layout":{"detail_w":800.0}}"#;
        let cfg: AppConfig = serde_json::from_str(saved).expect("파싱 실패");
        assert_eq!(cfg.ui_layout.detail_w, 800.0);
        assert_eq!(cfg.ui_layout.services_w, 200.0);
        assert_eq!(cfg.ui_layout.active_tab, "xlog");
    }

    #[test]
    fn 저장하면_그대로_다시_읽힌다() {
        let mut cfg = AppConfig::default();
        cfg.ui_layout.detail_w = 640.0;
        cfg.ui_layout.active_tab = "counter".to_string();
        cfg.xlog_chart.y_max = 30.0;
        cfg.xlog_chart.show_ignore_area = true;
        let json = serde_json::to_string(&cfg).expect("직렬화 실패");
        let back: AppConfig = serde_json::from_str(&json).expect("파싱 실패");
        assert_eq!(back.ui_layout.detail_w, 640.0);
        assert_eq!(back.ui_layout.active_tab, "counter");
        assert_eq!(back.xlog_chart.y_max, 30.0);
        assert!(back.xlog_chart.show_ignore_area);
    }

    #[test]
    fn 언어는_없으면_한국어다() {
        assert_eq!(AppConfig::default().ui_language, "ko");
        let old = r#"{"auto_connect":false}"#;
        let cfg: AppConfig = serde_json::from_str(old).expect("파싱 실패");
        assert_eq!(cfg.ui_language, "ko");
    }

    #[test]
    fn 저장된_글자_배율은_유지된다() {
        let saved = r#"{"ui_font_scale":1.3}"#;
        let cfg: AppConfig = serde_json::from_str(saved).expect("파싱 실패");
        assert_eq!(cfg.ui_font_scale, 1.3);
    }
}
