// 로컬 MCP 서버 — Claude Code · Cursor 가 NScouter 를 거쳐 트랜잭션을 읽는다.
//
// **앱이 떠 있어야 붙는다.** 서버는 이 프로세스 안에서 돌고(Streamable HTTP), 콜렉터 연결도
// 앱의 것을 빌려 쓴다. 앱을 끄면 같이 사라진다 — 따로 띄우는 데몬이 없다.
//
// 지키는 것:
//   · 127.0.0.1 에만 연다. 다른 PC 에서는 닿지 않는다
//   · `Authorization: Bearer <토큰>` 이 없으면 401. 이 PC 의 다른 프로그램도 토큰 없이는 못 읽는다
//   · Host 머리는 loopback 만 받는다(rmcp 기본값) — 브라우저 DNS 리바인딩을 막는다
//   · 읽기 전용 도구만 있다. SQL 바인딩 값은 설정에서 허용해야 나간다
//   · 기본은 꺼짐. 설정 창에서 켠다
//
// 시작은 화면이 한다(`mcp_sync`). 날짜 디렉토리(F-18)를 정하려면 이 PC 의 시간대가 필요한데
// 그것은 화면이 안다(`get_past_counter` 와 같은 이유로 Rust 에서 구하지 않는다).

pub mod digest;
mod server;

use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Request, State as AxState};
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::state::AppState;

/// 끌 때 기다리는 시간. 그 안에 안 끝나면 버리고 간다 — 같은 포트로 다시 열 때만 문제가 된다
const STOP_WAIT: Duration = Duration::from_secs(3);

pub struct McpState {
    running: Mutex<Option<Running>>,
    /// 프로파일 본문 검색을 한꺼번에 몇 개까지 돌릴지(설정 `mcp.limits.profile_searches`).
    /// 하나가 콜렉터 연결을 `perf.profile_workers` 개 연다. 수가 바뀌면 새 것으로 갈아 끼운다 —
    /// 그때 돌던 검색은 옛 것을 쥔 채 끝난다
    profile_slots: std::sync::Mutex<(usize, Arc<tokio::sync::Semaphore>)>,
    /// 이 PC 시간대(ms). 화면이 `mcp_sync` 로 알려 준다
    tz_offset_ms: AtomicI64,
    /// 마지막으로 켜려다 실패한 까닭 (포트가 이미 쓰이는 중 등)
    last_error: Mutex<Option<String>>,
}

struct Running {
    port: u16,
    token: String,
    cancel: CancellationToken,
    task: JoinHandle<()>,
}

impl Default for McpState {
    fn default() -> Self {
        Self {
            running: Mutex::new(None),
            profile_slots: std::sync::Mutex::new((0, Arc::new(tokio::sync::Semaphore::new(0)))),
            tz_offset_ms: AtomicI64::new(0),
            last_error: Mutex::new(None),
        }
    }
}

impl McpState {
    /// 프로파일 본문 검색 자리 하나를 얻는다 — 다 차 있으면 빌 때까지 기다린다
    pub async fn profile_slot(&self) -> Result<tokio::sync::OwnedSemaphorePermit, String> {
        let sem = {
            let want = crate::tuning::mcp().profile_searches as usize;
            let mut g = self.profile_slots.lock().unwrap_or_else(|p| p.into_inner());
            if g.0 != want {
                *g = (want, Arc::new(tokio::sync::Semaphore::new(want)));
            }
            g.1.clone()
        };
        sem.acquire_owned().await.map_err(|e| format!("프로파일 검색 대기 실패: {e}"))
    }

    pub fn tz_offset_ms(&self) -> i64 {
        self.tz_offset_ms.load(Ordering::Relaxed)
    }
}

/// 설정 창이 보여줄 상태
#[derive(serde::Serialize)]
pub struct McpStatus {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub token: String,
    pub bind_values: bool,
    /// 조회 한도 (범위로 자른 것)
    pub limits: crate::config::McpLimits,
    /// 켜려다 실패했으면 그 까닭
    pub error: Option<String>,
}

// ─── 켜고 끄기 ───────────────────────────────────────────────

/// 설정대로 맞춘다. 켜져 있어야 하는데 꺼져 있거나, 포트·토큰이 바뀌었으면 다시 연다
async fn apply(app: &AppHandle) -> McpStatus {
    let state = app.state::<AppState>();
    let mcp = app.state::<McpState>();
    let prefs = state.config.lock().await.mcp.clone();

    let mut running = mcp.running.lock().await;
    let want = prefs.enabled.then(|| (prefs.port, prefs.token.clone()));
    let same = match (running.as_ref(), want.as_ref()) {
        (Some(r), Some((p, t))) => r.port == *p && &r.token == t,
        (None, None) => true,
        _ => false,
    };
    if !same {
        if let Some(r) = running.take() {
            stop(r).await;
        }
        let mut error = None;
        if let Some((port, token)) = want {
            match start(app.clone(), port, token.clone()).await {
                Ok((cancel, task)) => {
                    log::info!("MCP 서버 시작: http://127.0.0.1:{port}/mcp");
                    *running = Some(Running { port, token, cancel, task });
                }
                Err(e) => {
                    log::error!("MCP 서버 시작 실패: {e}");
                    error = Some(e);
                }
            }
        }
        *mcp.last_error.lock().await = error;
    }

    let error = mcp.last_error.lock().await.clone();
    McpStatus {
        enabled: prefs.enabled,
        running: running.is_some(),
        port: prefs.port,
        token: prefs.token,
        bind_values: prefs.bind_values,
        limits: prefs.limits.clamped(),
        error,
    }
}

async fn stop(r: Running) {
    r.cancel.cancel();
    // 같은 포트로 곧바로 다시 열 수 있게 리스너가 놓일 때까지 기다린다
    if tokio::time::timeout(STOP_WAIT, r.task).await.is_err() {
        log::warn!("MCP 서버가 {}초 안에 안 끝났다 (포트 {})", STOP_WAIT.as_secs(), r.port);
    }
    log::info!("MCP 서버 중지 (포트 {})", r.port);
}

async fn start(app: AppHandle, port: u16, token: String) -> Result<(CancellationToken, JoinHandle<()>), String> {
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, port))
        .await
        .map_err(|e| format!("127.0.0.1:{port} 를 열 수 없습니다 — 다른 프로그램이 쓰는 중일 수 있습니다 ({e})"))?;

    let cancel = CancellationToken::new();
    let config = StreamableHttpServerConfig::default().with_cancellation_token(cancel.child_token());
    let service = StreamableHttpService::new(
        move || Ok(server::NScouterMcp::new(app.clone())),
        Arc::new(LocalSessionManager::default()),
        config,
    );
    let router = axum::Router::new()
        .nest_service("/mcp", service)
        .layer(axum::middleware::from_fn_with_state(Arc::<str>::from(token), require_token));

    let shutdown = cancel.clone();
    let task = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).with_graceful_shutdown(shutdown.cancelled_owned()).await {
            log::error!("MCP 서버 오류: {e}");
        }
    });
    Ok((cancel, task))
}

/// `Authorization: Bearer <토큰>` 을 본다
async fn require_token(AxState(token): AxState<Arc<str>>, req: Request, next: Next) -> Response {
    let given = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim);
    match given {
        Some(t) if same_secret(t.as_bytes(), token.as_bytes()) => next.run(req).await,
        _ => (
            StatusCode::UNAUTHORIZED,
            "NScouter MCP: Authorization: Bearer <토큰> 이 필요합니다. 토큰은 NScouter 설정 창에 있습니다.",
        )
            .into_response(),
    }
}

/// 길이가 같으면 끝까지 비교한다 — 앞에서부터 맞는 만큼 빨리 끝나면 시간으로 토큰을 더듬을 수 있다
fn same_secret(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// 새 토큰 — 24바이트 난수의 16진수
fn new_token() -> Result<String, String> {
    let mut buf = [0u8; 24];
    getrandom::fill(&mut buf).map_err(|e| format!("난수를 만들 수 없습니다: {e}"))?;
    Ok(hex::encode(buf))
}

/// 켜는데 토큰이 없으면 만들어 저장한다
async fn ensure_token(state: &AppState) -> Result<(), String> {
    let mut cfg = state.config.lock().await;
    if cfg.mcp.enabled && cfg.mcp.token.is_empty() {
        cfg.mcp.token = new_token()?;
        cfg.save(&state.config_path)?;
    }
    Ok(())
}

// ─── 명령 ────────────────────────────────────────────────────

/// 화면이 뜰 때 부른다. 시간대를 받아 두고 설정대로 켜거나 끈다
#[tauri::command]
pub async fn mcp_sync(app: AppHandle, tz_offset_ms: i64) -> Result<McpStatus, String> {
    app.state::<McpState>().tz_offset_ms.store(tz_offset_ms, Ordering::Relaxed);
    ensure_token(&app.state::<AppState>()).await?;
    Ok(apply(&app).await)
}

/// 설정 창의 «AI 연결» — **저장 단추와 따로 바로 적용한다**
#[tauri::command]
pub async fn mcp_configure(app: AppHandle, enabled: bool, port: u16, bind_values: bool) -> Result<McpStatus, String> {
    if port < 1024 {
        return Err(format!("포트는 1024~65535 입니다 (받은 값 {port})"));
    }
    {
        let state = app.state::<AppState>();
        let mut cfg = state.config.lock().await;
        cfg.mcp.enabled = enabled;
        cfg.mcp.port = port;
        cfg.mcp.bind_values = bind_values;
        cfg.save(&state.config_path)?;
    }
    ensure_token(&app.state::<AppState>()).await?;
    Ok(apply(&app).await)
}

/// 설정 창의 «AI 연결» 한도 — 목록·상세 건수, 구간 길이, 프로파일 검색 건수·시간·동시 수. 바로 적용한다
#[tauri::command]
pub async fn mcp_set_limits(app: AppHandle, limits: crate::config::McpLimits) -> Result<McpStatus, String> {
    {
        let state = app.state::<AppState>();
        let mut cfg = state.config.lock().await;
        cfg.mcp.limits = limits.clamped();
        cfg.save(&state.config_path)?;
        crate::tuning::apply(&cfg);
    }
    Ok(apply(&app).await)
}

/// 토큰을 새로 만든다. 켜져 있으면 새 토큰으로 다시 연다 — 예전 토큰을 든 클라이언트는 끊긴다
#[tauri::command]
pub async fn mcp_regenerate_token(app: AppHandle) -> Result<McpStatus, String> {
    {
        let state = app.state::<AppState>();
        let mut cfg = state.config.lock().await;
        cfg.mcp.token = new_token()?;
        cfg.save(&state.config_path)?;
    }
    Ok(apply(&app).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 토큰은_48자_16진수이고_매번_다르다() {
        let a = new_token().unwrap();
        let b = new_token().unwrap();
        assert_eq!(a.len(), 48);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[tokio::test]
    async fn 프로파일_검색은_설정한_수까지만_한꺼번에_돈다() {
        let st = McpState::default();
        // 기본 2
        let a = st.profile_slot().await.unwrap();
        let _b = st.profile_slot().await.unwrap();
        let third = tokio::time::timeout(std::time::Duration::from_millis(50), st.profile_slot()).await;
        assert!(third.is_err(), "셋째는 기다려야 한다");
        drop(a);
        assert!(tokio::time::timeout(std::time::Duration::from_millis(50), st.profile_slot()).await.is_ok());
    }

    #[test]
    fn 토큰_비교는_길이와_내용을_다_본다() {
        assert!(same_secret(b"abc", b"abc"));
        assert!(!same_secret(b"abc", b"abd"));
        assert!(!same_secret(b"abc", b"abcd"));
        assert!(!same_secret(b"", b"a"));
    }
}
