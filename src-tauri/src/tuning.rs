// 지금 쓰는 조정값 — 설정(`config::PerfPrefs`·`McpLimits`)을 범위로 자른 것.
//
// 여러 곳(사전 조회 · 프로파일 받기 · MCP · 미리 받기)이 상태를 넘겨받지 않고도 읽을 수 있게
// 한 곳에 둔다. 앱이 뜰 때와 설정을 저장할 때 `apply` 로 갈아 끼운다.

use std::sync::RwLock;

use crate::config::{AppConfig, McpLimits, PerfPrefs};

static CURRENT: RwLock<Option<(PerfPrefs, McpLimits)>> = RwLock::new(None);

/// 설정에서 다시 읽는다
pub fn apply(cfg: &AppConfig) {
    let v = (cfg.perf.clamped(), cfg.mcp.limits.clamped());
    *CURRENT.write().unwrap_or_else(|p| p.into_inner()) = Some(v);
}

/// 콜렉터 동시 요청·페이지·미리 받기
pub fn perf() -> PerfPrefs {
    CURRENT.read().unwrap_or_else(|p| p.into_inner()).as_ref().map(|v| v.0.clone()).unwrap_or_default()
}

/// MCP 조회 한도
pub fn mcp() -> McpLimits {
    CURRENT.read().unwrap_or_else(|p| p.into_inner()).as_ref().map(|v| v.1.clone()).unwrap_or_default()
}
