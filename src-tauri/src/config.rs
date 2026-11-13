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
    /// 트랜잭션 찾기(넓은 구간)로 모두 모을 최대 건수. 기본 300,000.
    /// 화면 쪽에서 1만~100만으로 자른다.
    #[serde(default = "default_wide_search_max")]
    pub wide_search_max: u32,
    /// 로컬 캐시(`{data_dir}/cache/`) 전체 상한(MB) — 콜렉터 여럿의 파일을 합친 것. 기본 2GB.
    /// 넘으면 안 쓴 지 오래된 콜렉터의 파일부터, 그다음 지금 콜렉터의 오래된 XLog 부터 지운다
    #[serde(default = "default_cache_max_mb")]
    pub cache_max_mb: u32,
    /// 콜렉터 동시 요청·페이지 크기·미리 받기 (`PerfPrefs`)
    #[serde(default)]
    pub perf: PerfPrefs,
    /// 화면 언어. `"ko"` 또는 `"en"`.
    ///
    /// Scouter 용어(TPS·XLog·Elapsed)는 원래 영어라 두 언어에서 같다.
    /// 바뀌는 건 우리가 붙인 설명과 레이블이다.
    #[serde(default = "default_lang")]
    pub ui_language: String,
    /// 색 벌. `"dark"`(기본) · `"light"` · `"slate"` · `"warm"` · `"contrast"`.
    ///
    /// **모르는 값은 화면이 기본으로 되돌린다**(`toTheme`). 여기서 막지 않는 것은
    /// 테마가 늘어날 때마다 양쪽을 고쳐야 하면 한쪽을 빼먹기 때문이다.
    #[serde(default = "default_theme")]
    pub ui_theme: String,
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
    /// 마지막으로 **함께** 붙었던 서버 이름들 (`servers` 의 이름, 앞의 것이 주 콜렉터).
    /// 둘 이상이면 자동 연결이 이 묶음으로 붙는다. 혼자 붙으면 비운다
    #[serde(default)]
    pub last_servers: Vec<String>,
    /// 이름 붙여 둔 서버 묶음 — 골라서 한 번에 함께 붙는다 (`Workspace`)
    #[serde(default)]
    pub workspaces: Vec<Workspace>,
    /// 마지막으로 걸어 두었던 조회 조건
    #[serde(default)]
    pub xlog_filter: XLogFilterPrefs,
    /// 열어 둔 XLog 탭들의 **조건만**. 받아 둔 데이터는 담지 않는다 —
    /// 수십만 건을 파일에 넣을 수도 없고, 열어 보면 이미 지나간 것이다.
    ///
    /// 비어 있으면 위의 `xlog_chart`·`xlog_filter` 한 벌로 탭 하나를 만든다
    /// (판이 올라가기 전 파일을 읽기 위해 남겨 둔다).
    #[serde(default)]
    pub xlog_tabs: Vec<XLogTabPrefs>,
    /// XLog 화면 분할 — 어느 탭들을 나란히 띄웠나. 탭은 `xlog_tabs` 의 순번으로 적는다
    #[serde(default)]
    pub xlog_split: XLogSplitPrefs,
    /// 떼어 낸 XLog 창들. 켤 때 같은 자리에 다시 연다
    #[serde(default)]
    pub xlog_windows: Vec<XLogWindowPrefs>,
    /// 어느 Task 가 어느 논리 서비스인가를 정하는 규칙.
    ///
    /// 사이트마다 이름 짃는 법이 다르다 — ECS 가 아닐 수도 있고
    /// `svc-1`·`svc-2` 일 수도 있어서 고칠 수 있게 둔다.
    #[serde(default)]
    pub group_rule: GroupRulePrefs,
    /// 비활성 오브젝트 자동 정리 주기(분). **0 이면 끕(기본).**
    ///
    /// 정리는 콜렉터 전역이라 같은 서버를 보는 **다른 사람 화면에서도** 사라진다.
    /// 남의 화면을 건드리는 일을 기본으로 켜 둘 수는 없다.
    #[serde(default)]
    pub auto_remove_inactive_min: u32,
    /// Visualize 탭의 지표 임계값
    #[serde(default)]
    pub kpi_thresholds: Vec<KpiThresholdPrefs>,
    /// 이름 붙여 담아 둔 조회 조건들
    #[serde(default)]
    pub saved_filters: Vec<SavedFilterPrefs>,
    /// 껐을 때 열려 있던 상세 탭들
    #[serde(default)]
    pub open_details: Vec<OpenDetailPrefs>,
    /// 로컬 MCP 서버 (Claude Code · Cursor 가 붙는 자리). `src/mcp/`
    #[serde(default)]
    pub mcp: McpPrefs,
    /// 통계 탭에서 이름 붙여 저장한 Task 이름 규칙
    #[serde(default)]
    pub stats_rules: Vec<StatsTaskRule>,
    /// 통계 탭 설정 — 판정 기준 · 결과 보관 · 조건 묶음
    #[serde(default)]
    pub stats: StatsPrefs,
}

/// 통계 탭 설정
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct StatsPrefs {
    pub judge: StatsJudgePrefs,
    /// 결과를 며칠 남기나 — 지난 것은 목록을 읽을 때 지운다. **0 이면 지우지 않는다**
    pub keep_days: u32,
    /// 이름 붙여 저장한 조건 묶음. 모양은 화면이 정한다(`statsPresets.ts`) — 여기서는 그대로 들고 있기만 한다
    pub presets: Vec<serde_json::Value>,
    /// 비교 표의 열 너비(px) — 끌어서 정한 것만. 열 이름은 화면이 정한다(`service`, `avg.cur` …)
    pub col_widths: std::collections::BTreeMap<String, u32>,
}

impl Default for StatsPrefs {
    fn default() -> Self {
        Self { judge: StatsJudgePrefs::default(), keep_days: 90, presets: Vec::new(), col_widths: Default::default() }
    }
}

/// 특이사항 판정 기준 (판정은 화면이 한다 — 바꾸면 지난 결과도 바로 다시 판정된다)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct StatsJudgePrefs {
    /// 평균·p90(·p99) 이 평소의 몇 배 넘게 늘면 «느려짐»
    pub slow_ratio: f64,
    /// 그리고 이만큼(ms) 이상 늘었을 때만
    pub slow_min_ms: f64,
    /// 에러율이 평소의 몇 배 이상이면 «에러 증가»
    pub error_ratio: f64,
    /// 그리고 이만큼(%p) 이상 늘었을 때만
    pub error_min_pp: f64,
    /// TPS 가 평소에서 이 비율(%) 넘게 변하면 «호출량 급변»
    pub volume_pct: f64,
    /// 한쪽 건수가 이보다 적으면 판정하지 않는다
    pub min_count: u32,
    /// «느려짐» 에 p99 도 본다 — 예전 설정. `slow_metrics` 가 비었을 때만 읽는다
    pub use_p99: bool,
    /// «느려짐» 을 볼 지표(`avg`·`p50`·`p90`·`p99`) — 하나라도 걸리면 느려짐. 비면 평균·p90(+ use_p99)
    pub slow_metrics: Vec<String>,
    /// 과거 구간이 여럿이면 **과거 날들 중 가장 나빴던 날보다도 나쁠 때만** 느려짐·에러 증가로 본다
    pub beyond_worst: bool,
    /// 느려짐에 배율(`slow_ratio`)을 쓰나 · 차이(`slow_min_ms`)를 쓰나 — 둘 다 켜면 `slow_combine` 으로 묶는다
    pub slow_use_ratio: bool,
    pub slow_use_ms: bool,
    /// 에러 증가에 배율(`error_ratio`)을 쓰나 · 차이(`error_min_pp`)를 쓰나
    pub error_use_ratio: bool,
    pub error_use_pp: bool,
    /// 배율·차이를 둘 다 쓸 때 묶는 법 — `and`(둘 다 넘어야) · `or`(하나만 넘어도). 모르는 값은 `and`
    pub slow_combine: String,
    pub error_combine: String,
}

impl Default for StatsJudgePrefs {
    fn default() -> Self {
        Self {
            slow_ratio: 1.3,
            slow_min_ms: 1000.0,
            error_ratio: 2.0,
            error_min_pp: 1.0,
            volume_pct: 50.0,
            min_count: 30,
            use_p99: false,
            slow_metrics: Vec::new(),
            beyond_worst: true,
            slow_use_ratio: true,
            slow_use_ms: true,
            error_use_ratio: true,
            error_use_pp: true,
            slow_combine: "and".into(),
            error_combine: "and".into(),
        }
    }
}

/// 통계 대상으로 묶을 Task 이름 규칙 (`shop-app-*` 같은 것 여럿)
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct StatsTaskRule {
    pub name: String,
    pub patterns: Vec<String>,
}

/// 로컬 MCP 서버 설정.
///
/// **기본은 끔이다.** 켜면 이 PC 의 다른 프로그램이 토큰만 있으면 트랜잭션을 읽어 간다.
/// 설정 창이 «저장» 과 따로 바로 적용한다(`mcp_configure`) — 그래서 `save_config` 가
/// 이 칸은 덮어쓰지 않는다(설정 창이 열 때 읽어 둔 옛 토큰이 새 토큰을 되돌리지 않게).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct McpPrefs {
    pub enabled: bool,
    /// 127.0.0.1 의 이 포트로 연다
    pub port: u16,
    /// `Authorization: Bearer …` 로 받을 값. 비어 있으면 켤 때 만든다
    pub token: String,
    /// 상세 조회에 SQL 바인딩 값(실제 데이터)을 실을지. **기본은 싣는다** — 값이 없으면
    /// «어떤 값으로 느렸나» 를 재현할 수 없다. 비밀번호 같은 값은 앱 쪽에서 따로 암호화해 둔다고 했다
    pub bind_values: bool,
    /// AI 쪽 조회 한도 (건수·시간·동시 검색)
    pub limits: McpLimits,
}

impl Default for McpPrefs {
    fn default() -> Self {
        Self { enabled: false, port: DEFAULT_MCP_PORT, token: String::new(), bind_values: true, limits: McpLimits::default() }
    }
}

/// MCP 기본 포트. 콜렉터(6100)·웹앱(6180) 과 겹치지 않는 자리.
/// IANA 에는 `doc-server`(Document WCF Server, 2008) 로 적혀 있는 잘 안 쓰이는 번호다 —
/// 예전 기본값 7100 은 X 윈도 폰트 서버(`font-service`) 자리라 리눅스에서 겹칠 수 있었다
pub const DEFAULT_MCP_PORT: u16 = 7165;

/// MCP 조회 한도. 화면에서 바꾸고(`mcp_set_limits`) 읽을 때는 `clamped` 를 거친다 —
/// 파일을 손으로 고쳐 0 이나 엄청 큰 값이 들어와도 앱이 이상하게 돌지 않게
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct McpLimits {
    /// 목록(search_transactions) 한 번에 돌려줄 최대 건수
    pub list_max: u32,
    /// 상세(get_transaction_details) 한 번에 볼 최대 건수
    pub detail_max: u32,
    /// 목록 구간의 최대 길이(분)
    pub max_minutes: u32,
    /// 목록 한 번에 훑을 최대 트랜잭션 수
    pub scan_max_rows: u32,
    /// 프로파일 본문 검색에서 콜렉터에 새로 물을 최대 건수 (캐시에 있는 것은 안 센다)
    pub profile_fetch_max: u32,
    /// 프로파일 본문 검색에 쓸 시간(초)
    pub profile_budget_sec: u32,
    /// 프로파일 본문 검색을 한꺼번에 몇 개까지 돌릴지
    pub profile_searches: u32,
}

impl Default for McpLimits {
    fn default() -> Self {
        Self {
            list_max: 500,
            detail_max: 5,
            max_minutes: 360,
            scan_max_rows: 200_000,
            profile_fetch_max: 2_000,
            profile_budget_sec: 15,
            profile_searches: 2,
        }
    }
}

impl McpLimits {
    /// 쓸 수 있는 범위로 자른다
    pub fn clamped(&self) -> Self {
        Self {
            list_max: self.list_max.clamp(10, 5_000),
            detail_max: self.detail_max.clamp(1, 20),
            max_minutes: self.max_minutes.clamp(10, 1_440),
            scan_max_rows: self.scan_max_rows.clamp(10_000, 2_000_000),
            profile_fetch_max: self.profile_fetch_max.clamp(100, 20_000),
            profile_budget_sec: self.profile_budget_sec.clamp(5, 120),
            profile_searches: self.profile_searches.clamp(1, 8),
        }
    }
}

/// 콜렉터에 보내는 요청의 동시 수·크기, 프로파일 미리 받기.
///
/// **기본값은 콜렉터 왕복 500ms 를 기준으로 잰 값이다**(`tests/search_latency.rs`). 콜렉터는 연결 하나에 명령
/// 하나라(F-1) 요청마다 왕복이 둘 이상 든다 — 그래서 동시에 보내고 페이지를 크게 받는다. 실측(왕복 500ms):
///   · 프로파일 200건: 동시 8 → 18.8초, 16 → 9.8초, **32 → 5.3초**, 64 → 4.0초
///   · 9분 1.2만 건: 페이지 500 → 18.3초, 5,000 → 1.6초, **20,000 → 0.9초**
///   · 같은 것을 500건 페이지로 조각 4개 → 4.6초, **8개 → 3.1초**
/// **운영 왕복(20ms 이하)에서 다시 쟀다**(2026-11-11, 실제 콜렉터 + 지연 프록시, 9분 2.8천 건) — 그래도 이 값들이
/// 가장 빠르거나 같았다. 줄이면 속도만 잃는다:
///   · 프로파일 200건: 동시 8 → 0.79초, 16 → 0.42초, **32 → 0.23초**, 64 → 0.20초
///   · 500건 페이지 과거 조회: 순차 0.23초, 조각 4개 0.13초, **8개 0.07초** / 페이지 20,000 은 순차로도 0.08초
/// 줄여야 하는 것은 **콜렉터의 동시 연결이 빠듯할 때**뿐이다(운영 콜렉터의 상한은 아직 모른다 — backlog B-3).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct PerfPrefs {
    /// 구간을 조각으로 나눠 동시에 받는 수 — MCP 목록 · 트랜잭션 찾기
    pub scan_parallel: u32,
    /// 화면 과거 조회를 조각으로 나눠 동시에 받는 수
    pub past_parallel: u32,
    /// 프로파일을 동시에 받는 수 — 프로파일 검색(화면·MCP)
    pub profile_workers: u32,
    /// 이름 사전(100개 묶음)을 동시에 묻는 수
    pub text_workers: u32,
    /// 구간 한 페이지의 건수 — MCP 목록 · 트랜잭션 찾기 · 응답시간 분포 (화면 과거 조회는 500 그대로)
    pub page_rows: u32,
    /// 에러·느린 트랜잭션의 프로파일을 미리 받아 둘지
    pub prefetch_enabled: bool,
    /// 이 응답시간(ms) 이상이면 미리 받는다 (에러는 늘)
    pub prefetch_min_elapsed_ms: u32,
    /// 미리 받기 초당 최대 건수
    pub prefetch_per_sec: u32,
    /// 통계 작업이 콜렉터마다 동시에 받는 조각 수 — 하루치를 오래 훑으므로 화면 조회보다 낮게 둔다(운영 콜렉터 보호)
    pub stats_parallel: u32,
}

impl Default for PerfPrefs {
    fn default() -> Self {
        Self {
            scan_parallel: 4,
            past_parallel: 8,
            profile_workers: 32,
            text_workers: 8,
            page_rows: 20_000,
            prefetch_enabled: true,
            prefetch_min_elapsed_ms: 3_000,
            prefetch_per_sec: 20,
            stats_parallel: 4,
        }
    }
}

impl PerfPrefs {
    /// 쓸 수 있는 범위로 자른다
    pub fn clamped(&self) -> Self {
        Self {
            scan_parallel: self.scan_parallel.clamp(1, 16),
            past_parallel: self.past_parallel.clamp(1, 16),
            profile_workers: self.profile_workers.clamp(1, 64),
            text_workers: self.text_workers.clamp(1, 16),
            page_rows: self.page_rows.clamp(1_000, 50_000),
            prefetch_enabled: self.prefetch_enabled,
            prefetch_min_elapsed_ms: self.prefetch_min_elapsed_ms.clamp(500, 60_000),
            prefetch_per_sec: self.prefetch_per_sec.clamp(1, 100),
            stats_parallel: self.stats_parallel.clamp(1, 16),
        }
    }
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
    /// 마지막에 보던 탭. `"xlog"` · `"visualize"` · `"counter"` · `"alert"`
    pub active_tab: String,
    /// 서비스 목록을 무엇으로 묶는가. `"type"`(오브젝트 종류) 또는 `"group"`(이름의 부모 경로)
    pub agent_group_by: String,
    /// XLog 트랜잭션 표의 열 너비(px). 열 이름(`time`·`server`·`ip`·`elapsed`·`y`) → 너비.
    /// 없는 열은 기본 너비다. URL 은 남는 자리라 안 든다 (`xlogColumns.ts`)
    pub xlog_cols: std::collections::BTreeMap<String, f32>,
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
            xlog_cols: std::collections::BTreeMap::new(),
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

/// 이름 붙여 둔 서버 묶음 («운영 전체» 처럼).
///
/// **서버는 이름으로 가리킨다**(`servers` 의 이름, 앞의 것이 주 콜렉터) — 접속 정보·비밀번호를 여기에 한 벌 더
/// 두면 서버 쪽을 고쳤을 때 묶음만 옛 값으로 남는다. 서버 이름을 바꾸거나 지우면 화면이 여기도 함께 고친다.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Workspace {
    pub name: String,
    pub servers: Vec<String>,
}

/// 껐을 때 열려 있던 상세 탭 하나.
///
/// 프로파일까지 담지 않는다 — 다시 열 때 받으면 된다. **날짜가 반드시 필요하다:**
/// 콜렉터는 XLog 를 날짜별로 저장해서, 날짜가 없으면 에러가 아니라 빈 결과가 온다.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct OpenDetailPrefs {
    pub txid: String,
    /// `yyyyMMdd`
    pub date: String,
}

/// 이름 붙여 담아 둔 조회 조건 한 벌.
///
/// **조건만 담는다.** 대상 서버(objHash)는 콜렉터마다 달라 다른 서버에서 불러오면
/// 아무것도 안 걸리고, 실시간/과거 모드는 조건이 아니라 «지금 무엇을 보고 있나» 다.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct SavedFilterPrefs {
    pub name: String,
    pub patterns: Vec<PatternPrefs>,
    pub error_only: bool,
    pub elapsed_ms: i64,
    pub elapsed_exclude: bool,
}

/// 마지막으로 걸어 두었던 XLog 조회 조건.
///
/// **껐다 켜면 다 날아간다** 는 것이 현장에서 가장 많이 나온 말이다.
/// 필터를 다시 채우는 데 드는 시간보다, 어제 보던 자리로 바로 돌아가는 것이 훨씬 낫다.
/// 화면 값과 1:1 이라 화면 타입이 바뀌면 여기도 바뀐다.
/// 문자열 조건 한 줄. `field` 는 `"service"` 또는 `"ip"`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct PatternPrefs {
    pub field: String,
    pub text: String,
    pub exclude: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct XLogFilterPrefs {
    /// 응답시간 임계(ms). 0 이면 조건 없음
    pub elapsed_ms: i64,
    /// true 면 임계 **미만**만 통과
    pub elapsed_exclude: bool,
    pub error_only: bool,
    /// **보기로 고른 오브젝트.** 비어 있으면 «아직 안 골랐다» 이고, 그때 화면은
    /// 아무것도 그리지 않는다 (`src/features/xlog/components/agentFilter.ts`).
    /// 예전 판은 이걸 «전부» 로 읽었다 — 서버가 100대인 곳에서는 켜자마자 100줄이었다.
    pub obj_hashes: Vec<i32>,
    pub service_text: String,
    pub service_exclude: bool,
    pub ip_text: String,
    pub ip_exclude: bool,
    /// 여러 줄짜리 조건. **이쪽이 본판이다** — 위의 `service_*`/`ip_*` 는
    /// 판이 올라가기 전 파일을 읽기 위해 남겨 둔다(읽고 나면 여기로 옮긴다).
    pub patterns: Vec<PatternPrefs>,
    /// `"live"` 또는 `"past"`
    pub mode: String,
}

/// 논리 서비스 묶기 규칙. 화면의 `GroupRule` 과 1:1 이다.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GroupRulePrefs {
    /// 이 키의 태그가 있으면 그 값이 곧 서비스 이름이다
    pub tag_key: String,
    /// 태그가 없을 때 짧은 이름에 거는 정규식. **첫 캐처 그룹이 서비스 이름**이다
    pub pattern: String,
}

impl Default for GroupRulePrefs {
    fn default() -> Self {
        // 화면의 `DEFAULT_GROUP_RULE` 과 **같은 값이어야 한다.**
        // 한쪽만 바꾸면 설정을 안 건드린 사람의 화면이 말없이 달라진다.
        Self {
            tag_key: "service".to_string(),
            pattern: "^(?<svc>.+?)-ip-[0-9-]+".to_string(),
        }
    }
}

/// 떼어 낸 XLog 창 하나 — 그 창의 탭·분할과 자리. 화면의 `detached/registry.ts` 와 짝이다.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct XLogWindowPrefs {
    /// 창 이름 (`xlogwin-N`)
    pub label: String,
    pub tabs: Vec<XLogTabPrefs>,
    pub split: XLogSplitPrefs,
    /// 창 자리·크기 (논리 좌표). 0 이면 모른다 — 기본 자리에 연다
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// XLog 화면 분할. 화면의 `XLogTabsState.panes/dir/ratio` 와 짝이다.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct XLogSplitPrefs {
    /// 띄운 탭들의 순번(`xlog_tabs` 기준), 놓인 순서대로. 비어 있으면 첫 탭 하나
    pub panes: Vec<u32>,
    /// 지금 판의 순번
    pub active: u32,
    /// 두 판의 방향. `"row"`(좌우) 또는 `"column"`(위아래)
    pub dir: String,
    /// 두 판일 때 첫 판의 몫
    pub ratio: f32,
}

impl Default for XLogSplitPrefs {
    fn default() -> Self {
        Self { panes: Vec::new(), active: 0, dir: "row".to_string(), ratio: 0.5 }
    }
}

/// 탭 하나의 조건. 화면의 `XLogTab` 과 1:1 이다.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct XLogTabPrefs {
    /// 사람이 붙인 탭 이름. **비어 있으면 화면이 조건에서 만든다**
    pub title: String,
    /// 왼쪽 목록에서 고른 서비스 이름들. 해시가 아니라 이름이라 Task 가 갈려도 따라간다
    pub sel_services: Vec<String>,
    /// 낱개로 고른 오브젝트 해시
    pub sel_hashes: Vec<i32>,
    pub chart: XLogChartPrefs,
    pub filter: XLogFilterPrefs,
    /// 과거 구간(epoch ms). **둘 다 0 이면 구간을 정하지 않은 것**이다 —
    /// 실시간인지는 `filter.mode` 가 따로 말한다.
    pub stime: i64,
    pub etime: i64,
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
            patterns: Vec::new(),
            // **과거 구간은 복원하지 않는다.** 어제 보던 «최근 1시간» 은 오늘 열면
            // 남의 시간이다. 조건은 남기고 시점만 지금으로 되돌린다.
            mode: "live".to_string(),
        }
    }
}

/// Visualize 탭 지표 하나의 임계값.
///
/// **줄 단위로 담는다.** 지표마다 칸을 두면 지표를 하나 더할 때 여기까지 고쳐야 한다.
/// 값을 검증하지 않는 이유는 조회 조건과 같다 — 파일은 사람이 여는 곳이고,
/// 실제 판정은 화면에서 다시 다듬는다(`threshold.toThresholds`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct KpiThresholdPrefs {
    /// `"tps"` · `"elapsed"` · `"error"` · `"active"` · `"cpu"` · `"heap"`
    pub id: String,
    /// 이 값 이상이면 주의
    pub warn: f64,
    /// 이 값 이상이면 위험
    pub danger: f64,
    /// false 면 색을 쓰지 않는다. **줄을 빼는 것과 다르다** — 빠진 줄은 기본값이 산다
    pub enabled: bool,
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
    /// 밀집 구간을 밝기로 겹쳐 보일지.
    ///
    /// 점 하나가 5x5 를 막아 촘촘한 구간에서는 대부분이 안 그려진다 —
    /// 켜면 칸마다 건수를 세어 밝기로 얹는다. **기본은 끔** (파생 기본값 false 가 맞다).
    pub show_density: bool,
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
            show_density: false,
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
/// 파생 기본값(0)이면 캐시가 한 건도 못 담는다
pub fn default_cache_max_mb() -> u32 {
    2048
}

fn default_wide_search_max() -> u32 {
    300_000
}

fn default_buffer_max() -> u32 {
    // 화면 쪽 DEFAULT_MAX_ITEMS 와 같은 수여야 한다. 갈리면 설정 창이 «기본값» 이라고
    // 보여주는 값과 실제로 도는 값이 달라진다.
    100_000
}

/// 빈 문자열이 기본값이 되면 언어를 못 정한다.
fn default_lang() -> String {
    "ko".to_string()
}

/// 기본 테마. 지금까지 쓰던 색이라, 올리는 사람은 아무것도 달라지지 않아야 한다.
fn default_theme() -> String {
    "dark".to_string()
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
            wide_search_max: default_wide_search_max(),
            cache_max_mb: default_cache_max_mb(),
            perf: PerfPrefs::default(),
            ui_language: "ko".to_string(),
            ui_theme: default_theme(),
            ui_layout: UiLayout::default(),
            xlog_chart: XLogChartPrefs::default(),
            servers: Vec::new(),
            last_server: String::new(),
            last_servers: Vec::new(),
            workspaces: Vec::new(),
            xlog_filter: XLogFilterPrefs::default(),
            xlog_tabs: Vec::new(),
            xlog_split: XLogSplitPrefs::default(),
            xlog_windows: Vec::new(),
            group_rule: GroupRulePrefs::default(),
            auto_remove_inactive_min: 0,
            // 비워 둔다. 화면이 기본 임계를 들고 있으므로(`threshold.DEFAULT_THRESHOLDS`)
            // 여기서 같은 수를 한 벌 더 적으면 두 곳이 갈린다.
            kpi_thresholds: Vec::new(),
            saved_filters: Vec::new(),
            open_details: Vec::new(),
            mcp: McpPrefs::default(),
            stats_rules: Vec::new(),
            stats: StatsPrefs::default(),
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
    fn 서버_목록이_없는_예전_설정도_읽힌다() {
        // 목록이 생기기 전에 저장된 config.json 이 그대로 남아 있다.
        let old = r#"{"auto_connect":false,"last_host":"10.0.0.1"}"#;
        let cfg: AppConfig = serde_json::from_str(old).expect("파싱 실패");
        assert!(cfg.servers.is_empty());
        assert_eq!(cfg.last_server, "");
        // 예전 접속 정보는 살아 있어야 한다 — 화면이 이걸로 첫 프로필을 만든다.
        assert_eq!(cfg.last_host.as_deref(), Some("10.0.0.1"));
    }

    #[test]
    fn 서버의_비밀번호가_저장되고_그대로_읽힌다() {
        // **이 왕복이 깨지면 갈아탈 때마다 비밀번호를 다시 묻는다.**
        let cfg = AppConfig {
            servers: vec![ServerProfile {
                name: "운영".to_string(),
                host: "10.0.0.1".to_string(),
                port: 6100,
                user: "admin".to_string(),
                pass: "secret".to_string(),
            }],
            last_server: "운영".to_string(),
            ..AppConfig::default()
        };

        let json = serde_json::to_string(&cfg).expect("직렬화 실패");
        let back: AppConfig = serde_json::from_str(&json).expect("파싱 실패");
        assert_eq!(back.servers.len(), 1);
        assert_eq!(back.servers[0].pass, "secret");
        assert_eq!(back.servers[0].name, "운영");
        assert_eq!(back.last_server, "운영");
    }

    #[test]
    fn 비밀번호를_안_담은_프로필도_읽힌다() {
        // 빈 문자열이 «저장 안 함» 이다. 항목이 아예 없는 줄도 같은 뜻이어야 한다.
        let saved = r#"{"servers":[{"host":"a","port":6100,"user":"u"}]}"#;
        let cfg: AppConfig = serde_json::from_str(saved).expect("파싱 실패");
        assert_eq!(cfg.servers[0].pass, "");
        assert_eq!(cfg.servers[0].name, "");
    }

    #[test]
    fn mcp_는_없으면_꺼져_있고_바인딩_값은_싣는다() {
        let old = r#"{"auto_connect":false}"#;
        let cfg: AppConfig = serde_json::from_str(old).expect("파싱 실패");
        assert!(!cfg.mcp.enabled, "켜 두면 이 PC 의 다른 프로그램이 트랜잭션을 읽어 간다");
        assert!(cfg.mcp.bind_values);
        // 칸 일부만 있는 설정도 기본값을 따른다 (bool 파생 기본값 false 가 끼어들면 안 된다)
        let part: AppConfig = serde_json::from_str(r#"{"mcp":{"enabled":true}}"#).expect("파싱 실패");
        assert!(part.mcp.bind_values);
        // 끈 사람은 끈 채로
        let off: AppConfig = serde_json::from_str(r#"{"mcp":{"bind_values":false}}"#).expect("파싱 실패");
        assert!(!off.mcp.bind_values);
        assert_eq!(cfg.mcp.port, DEFAULT_MCP_PORT);
        assert_eq!(cfg.mcp.port, 7165);
        assert_eq!(cfg.mcp.limits, McpLimits::default());
        assert_eq!(cfg.perf, PerfPrefs::default());
        assert_eq!(cfg.mcp.token, "");
    }

    #[test]
    fn 성능_설정은_빠진_칸만_기본값이고_범위를_넘으면_자른다() {
        let saved = r#"{"perf":{"profile_workers":64},"mcp":{"limits":{"list_max":0}}}"#;
        let cfg: AppConfig = serde_json::from_str(saved).expect("파싱 실패");
        assert_eq!(cfg.perf.profile_workers, 64);
        assert_eq!(cfg.perf.scan_parallel, 4, "빠진 칸은 기본값");
        assert_eq!(cfg.mcp.limits.clamped().list_max, 10, "0 이 오면 최소값으로");
        let wild = PerfPrefs { page_rows: 9_999_999, text_workers: 0, ..PerfPrefs::default() }.clamped();
        assert_eq!((wild.page_rows, wild.text_workers), (50_000, 1));
    }

    #[test]
    fn 화면의_성능_기본값은_여기와_같다() {
        // 갈리면 설정 창이 «기본값으로» 를 눌렀을 때 실제 기본과 다른 값을 저장한다
        let ts = include_str!("../../src/features/xlog/api/perfDefaults.ts").replace('_', "");
        let d = PerfPrefs::default();
        for (k, v) in [
            ("scanparallel", d.scan_parallel),
            ("pastparallel", d.past_parallel),
            ("profileworkers", d.profile_workers),
            ("textworkers", d.text_workers),
            ("pagerows", d.page_rows),
            ("prefetchminelapsedms", d.prefetch_min_elapsed_ms),
            ("prefetchpersec", d.prefetch_per_sec),
            ("statsparallel", d.stats_parallel),
        ] {
            assert!(ts.contains(&format!("{k}: {v},")), "perfDefaults.ts 의 {k} 가 {v} 가 아니다");
        }
        assert!(ts.contains(&format!("prefetchenabled: {},", d.prefetch_enabled)));
    }

    #[test]
    fn 저장된_글자_배율은_유지된다() {
        let saved = r#"{"ui_font_scale":1.3}"#;
        let cfg: AppConfig = serde_json::from_str(saved).expect("파싱 실패");
        assert_eq!(cfg.ui_font_scale, 1.3);
    }
}
