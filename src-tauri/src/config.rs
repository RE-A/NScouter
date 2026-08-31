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
    /// 글자 크기 배율. 1.0 이 기본이고 화면에서는 4단계(1·1.15·1.3·1.5) 중 고른다.
    /// 파일을 손으로 고쳐 넣은 값은 읽는 쪽에서 0.8~1.6 으로 자른다(`clampFontScale`).
    ///
    /// 밀도를 위해 작게 잡은 화면이라 오래 보면 읽기 힘들다는 이야기가 있어 둔다.
    #[serde(default = "default_font_scale")]
    pub ui_font_scale: f32,
    /// XLog 버퍼에 담아 둘 최대 건수.
    ///
    /// 창(1~30분) 밖은 시간으로 지우고, 그래도 남는 것이 많으면 이 수에서
    /// **오래된 것부터** 버린다. 상한이 낮으면 창은 30분인데 화면에는 그보다 짧은
    /// 구간만 남는다 — 현장에서 «중간 넘어가면 뒷부분이 갑자기 날아간다» 로 나왔다.
    /// 기본 100,000(≈37MB). 올릴수록 메모리를 쓴다(30만 ≈ 113MB 실측).
    /// 화면 쪽에서 1만~100만으로 자른다.
    #[serde(default = "default_buffer_max")]
    pub xlog_buffer_max: u32,
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
    /// 갈아 가며 볼 서버들. 비어 있으면 `last_*` 로 하나를 만들어 쓴다
    #[serde(default)]
    pub servers: Vec<ServerProfile>,
    /// 마지막으로 고른 서버 이름
    #[serde(default)]
    pub last_server: String,
    /// 마지막으로 걸어 두었던 조회 조건
    #[serde(default)]
    pub xlog_filter: XLogFilterPrefs,
    /// 카운터에서 그리기로 고른 서버
    #[serde(default)]
    pub counter_picks: CounterPickPrefs,
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
/// 접속해 둘 서버 하나.
///
/// **여러 콜렉터를 갈아 가며 본다.** 운영·QA 를 오가거나, 시스템별로 콜렉터가 나뉜
/// 환경에서 매번 호스트·계정을 다시 치는 것이 현장에서 나온 불편이었다.
///
/// 비밀번호는 **비워 둘 수 있다.** 비면 그 서버로 갈아탈 때 한 번 묻는다 —
/// 저장하면 `config.json` 에 평문으로 남기 때문에 고르게 둔다(자동 연결과 같은 규칙).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ServerProfile {
    /// 화면에 보일 이름. 비면 `host:port` 를 쓴다
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    /// 저장하지 않으면 빈 문자열
    pub pass: String,
}

/// 마지막으로 걸어 두었던 XLog 조회 조건.
///
/// **껐다 켜면 다 날아간다** 는 것이 현장에서 가장 많이 나온 말이다.
/// 필터를 다시 채우는 데 드는 시간보다, 어제 보던 자리로 바로 돌아가는 것이 훨씬 낫다.
/// 화면 값과 1:1 이라 화면 타입이 바뀌면 여기도 바뀐다.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct XLogFilterPrefs {
    /// 응답시간 임계(ms). 0 이면 조건 없음
    pub elapsed_ms: i64,
    /// true 면 임계 **미만**만 통과
    pub elapsed_exclude: bool,
    pub error_only: bool,
    /// 고른 오브젝트. 비어 있으면 전부
    pub obj_hashes: Vec<i32>,
    pub service_text: String,
    pub service_exclude: bool,
    pub ip_text: String,
    pub ip_exclude: bool,
    /// `"live"` 또는 `"past"`
    pub mode: String,
}

impl Default for XLogFilterPrefs {
    fn default() -> Self {
        Self {
            elapsed_ms: 0,
            elapsed_exclude: false,
            error_only: false,
            obj_hashes: Vec::new(),
            service_text: String::new(),
            service_exclude: false,
            ip_text: String::new(),
            ip_exclude: false,
            // **과거 구간은 복원하지 않는다.** 어제 보던 «최근 1시간» 은 오늘 열면
            // 남의 시간이다. 조건은 남기고 시점만 지금으로 되돌린다.
            mode: "live".to_string(),
        }
    }
}

/// 카운터 화면에서 그리기로 고른 서버.
///
/// Family 마다 따로 고른다 — 앱과 호스트는 대수도 다르고 보는 이유도 다르다.
/// 비어 있으면 **전부**다(고르지 않은 것과 «하나도 안 고른 것» 을 가르지 않는다).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct CounterPickPrefs {
    pub javaee: Vec<i32>,
    pub host: Vec<i32>,
    pub datasource: Vec<i32>,
}

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

/// 파생 기본값(0)이면 버퍼가 한 건도 못 담는다.
fn default_buffer_max() -> u32 {
    // 화면 쪽 DEFAULT_MAX_ITEMS 와 같은 수여야 한다. 갈리면 설정 창이 «기본값» 이라고
    // 보여주는 값과 실제로 도는 값이 달라진다.
    100_000
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
            xlog_buffer_max: default_buffer_max(),
            ui_language: "ko".to_string(),
            ui_layout: UiLayout::default(),
            xlog_chart: XLogChartPrefs::default(),
            servers: Vec::new(),
            last_server: String::new(),
            xlog_filter: XLogFilterPrefs::default(),
            counter_picks: CounterPickPrefs::default(),
        }
    }
}

/// 데이터 디렉토리 결정. `data_dir` 이 있으면 그것, 없으면 실행파일 폴더.
///
/// **두 곳에서 쓴다** — 기동할 때 로그 폴더를 잡는 자리(lib.rs)와
/// 저장본을 읽고 쓰는 자리(AppState). 규칙이 갈라지면 로그와 저장본이
/// 서로 다른 폴더로 흩어진다.
pub fn resolve_data_dir(config: &AppConfig, exe_dir: &std::path::Path) -> PathBuf {
    config
        .data_dir
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| exe_dir.to_path_buf())
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
