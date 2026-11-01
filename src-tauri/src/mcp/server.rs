// MCP 도구 — 읽기만 한다. 콜렉터에는 조회용 연결 풀로 묻는다.
//
// **화면의 주 연결을 쓰지 않는다.** 6시간 구간을 훑는 동안 주 연결을 잡고 있으면 화면의
// 프로파일·사전 조회가 그만큼 멈춘다. 풀에서 빌려 쓰고, 끝까지 읽은 연결만 돌려준다.
//
// 훑기는 막히는(blocking) 소켓 읽기라 `spawn_blocking` 으로 돌린다 — 몇 초짜리 훑기가
// 비동기 일꾼 하나를 붙잡으면 화면 명령과 MCP 응답이 같이 밀린다.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{Implementation, ServerCapabilities, ServerConfig},
    schemars, tool, tool_handler, tool_router, ServerHandler,
};
use serde_json::json;
use tauri::{AppHandle, Manager};

use super::digest::{
    self, contains_rule, detail_hashes, detail_json, parse_ref, resolve_window, search_result_json, Collector,
    plan_slices, unscanned_range, GroupRule, Patterns, ProfileFacts, ProfileHitView, RowFilter, ScanFacts, ServerFilter, Slice,
    SortBy, Texts, Window,
};
use super::McpState;
use crate::scouter::connection::{local_now_ms, ScouterConnection};
use crate::scouter::dictionary::{fetch_texts, TextCache};
use crate::scouter::object::{build_daily_object_param, parse_daily_objects};
use crate::scouter::objtype::{date_key, split_by_day};
use crate::scouter::pack::{AnyPack, MapPack, XLogPack};
use crate::scouter::past::{build_past_xlog_param, parse_past_cursor, PastCursor};
use crate::scouter::profile::{build_full_profile_param, parse_profile_steps, ProfileStep};
use crate::scouter::protocol::*;
use crate::scouter::value::ScouterValue;
use crate::state::AppState;

/// 한 번에 받는 페이지 크기. 분포 조회(`DISTRIBUTION_PAGE_COUNT`)와 같은 이유로 크게 잡는다
const PAGE_COUNT: i32 = 5_000;
/// 한 번의 목록 조회에서 훑을 트랜잭션 수의 상한. 넘으면 `truncated` 로 말한다
const MAX_SCAN_ROWS: u64 = 200_000;
/// 커서가 안 밀릴 때를 대비한 빗장
const MAX_PAGES: u32 = 200;
/// list_servers 가 돌려줄 최대 수
const MAX_SERVERS: usize = 500;

const NOT_CONNECTED: &str = "NScouter 가 콜렉터에 연결되어 있지 않습니다. 앱에서 서버에 접속한 뒤 다시 시도하세요.";

#[derive(Clone)]
pub struct NScouterMcp {
    app: AppHandle,
    tool_router: ToolRouter<Self>,
}

impl NScouterMcp {
    pub fn new(app: AppHandle) -> Self {
        Self { app, tool_router: Self::tool_router() }
    }
}

// ─── 인자 ────────────────────────────────────────────────────

/// 글자 하나 또는 여러 개. 여러 개면 **포함은 OR**(하나라도 맞으면), 제외는 하나라도 맞으면 뺀다
#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(untagged)]
pub enum OneOrMany {
    One(String),
    Many(Vec<String>),
}

fn many(v: Option<OneOrMany>) -> Vec<String> {
    match v {
        None => Vec::new(),
        Some(OneOrMany::One(s)) => vec![s],
        Some(OneOrMany::Many(v)) => v,
    }
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SearchArgs {
    /// 지금부터 몇 분 전까지 볼지. 기본 30, 최대 360. from/to 를 주면 구간 길이로 쓴다
    pub minutes: Option<u32>,
    /// 구간 시작. 이 PC 시간대의 `YYYY-MM-DD HH:MM[:SS]`
    pub from: Option<String>,
    /// 구간 끝. 이 PC 시간대의 `YYYY-MM-DD HH:MM[:SS]`
    pub to: Option<String>,
    /// 훑을 서버(오브젝트) — 이름이나 종류에 들어 있는 글자. 여러 개면 OR. service_group 과도 OR. 비우면 전체 서버
    pub server: Option<OneOrMany>,
    /// 뺄 서버 — 이름이나 종류에 들어 있는 글자
    pub server_exclude: Option<OneOrMany>,
    /// 논리 서비스(앱 설정의 «서비스로 묶기» 규칙, list_servers 의 service_group 열) 이름. 완전 일치·대소문자 무시
    pub service_group: Option<OneOrMany>,
    /// 서비스(URL·메서드) 이름에 들어 있는 글자. 여러 개면 OR. 대소문자 무시
    pub service: Option<OneOrMany>,
    /// 뺄 서비스 이름 글자 (예: /health)
    pub service_exclude: Option<OneOrMany>,
    /// 호출한 IP 에 들어 있는 글자. 여러 개면 OR
    pub ip: Option<OneOrMany>,
    /// 뺄 IP 글자
    pub ip_exclude: Option<OneOrMany>,
    /// 에러난 트랜잭션만
    pub error_only: Option<bool>,
    /// 이 응답시간(ms) 이상만
    pub min_elapsed_ms: Option<i32>,
    /// 이 응답시간(ms) 미만만
    pub max_elapsed_ms: Option<i32>,
    /// 로그인 이름에 들어 있는 글자
    pub login: Option<String>,
    /// 설명(desc)에 들어 있는 글자
    pub desc: Option<String>,
    /// 앱 자유 필드 text1 에 들어 있는 글자 (text2~5 도 같다)
    pub text1: Option<String>,
    pub text2: Option<String>,
    pub text3: Option<String>,
    pub text4: Option<String>,
    pub text5: Option<String>,
    /// 앱에서 이름 붙여 담아 둔 조회 조건의 이름. 위 조건들과 함께 걸린다
    pub saved_filter: Option<String>,
    /// 프로파일 본문(SQL 문장·바인딩 값·API 주소·메서드·에러·로그 메시지)에 이 글자가 든 것만.
    /// 트랜잭션마다 프로파일을 열어 보므로 느리다 — 위 조건에 걸린 것 중 sort 순으로 최대 2,000건만 열어 본다
    pub profile_contains: Option<String>,
    /// `slowest`(기본, 느린 것부터) 또는 `latest`(최근 것부터)
    pub sort: Option<String>,
    /// 돌려줄 최대 건수. 기본 50, 최대 500
    pub limit: Option<u32>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct DetailArgs {
    /// search_transactions 가 준 `ref`(`txid:yyyymmdd`). 한 번에 최대 5개
    pub refs: Vec<String>,
}

// ─── 도구 ────────────────────────────────────────────────────

#[tool_router]
impl NScouterMcp {
    #[tool(
        name = "list_servers",
        description = "NScouter 가 붙어 있는 Scouter 콜렉터의 서버(에이전트) 목록. 이름·종류·살아 있는지. search_transactions 의 server 조건에 넣을 이름을 찾을 때 쓴다."
    )]
    async fn list_servers(&self) -> Result<String, String> {
        let objects = with_conn(&self.app, |conn, _| realtime_objects(conn)).await?;
        let rule = group_rule(&self.app.state::<AppState>()).await;
        let mut rows: Vec<_> = objects
            .into_iter()
            .map(|o| {
                let group = rule.service_of(&o.obj_name, &o.tags);
                (o.obj_name, o.obj_type, o.alive, group)
            })
            .collect();
        rows.sort();
        let total = rows.len();
        rows.truncate(MAX_SERVERS);
        let out = json!({
            "total": total,
            "returned": rows.len(),
            "columns": ["name", "type", "alive", "service_group"],
            "rows": rows.iter().map(|(n, t, a, g)| json!([n, t, a, g])).collect::<Vec<_>>(),
        });
        Ok(out.to_string())
    }

    #[tool(
        name = "search_transactions",
        description = "구간 안의 트랜잭션(XLog)을 훑어 조건에 맞는 것을 짧은 행으로 돌려준다 — 프로파일은 싣지 않는다. 기본은 최근 30분·느린 순 50건, 최대 6시간·500건. 조건은 앱 XLog 화면과 같다: 서버·서비스 묶음, 서비스/IP 포함·제외(여러 개면 포함은 OR), 에러만, 응답시간 이상/미만, 로그인·설명·text1~5, 담아 둔 조건(saved_filter). profile_contains 를 주면 프로파일 본문(SQL·바인딩 값·API·에러·메시지)까지 찾고 걸린 자리를 profile_hit 열에 싣는다(느리다 — 다른 조건으로 먼저 좁힐 것). 행마다 `ref` 가 있으니 자세히 볼 것만 골라 get_transaction_details 에 넘긴다. top_services 는 걸린 것을 서비스별로 센 요약이다."
    )]
    async fn search_transactions(&self, Parameters(a): Parameters<SearchArgs>) -> Result<String, String> {
        let state = self.app.state::<AppState>();
        let tz = self.app.state::<McpState>().tz_offset_ms();
        let offset = state.clock_offset_ms.lock().await.unwrap_or(0);
        let window = resolve_window(local_now_ms() + offset, tz, a.minutes, a.from.as_deref(), a.to.as_deref())?;
        let sort = SortBy::parse(a.sort.as_deref())?;
        let limit = (a.limit.unwrap_or(digest::DEFAULT_LIMIT as u32) as usize).clamp(1, digest::MAX_LIMIT);

        let mut filter = RowFilter {
            error_only: a.error_only.unwrap_or(false),
            min_elapsed_ms: a.min_elapsed_ms.unwrap_or(0).max(0),
            max_elapsed_ms: a.max_elapsed_ms.unwrap_or(0).max(0),
            service: Patterns::new(&many(a.service), &many(a.service_exclude)),
            ip: Patterns::new(&many(a.ip), &many(a.ip_exclude)),
            login: contains_rule(a.login.as_deref()),
            desc: contains_rule(a.desc.as_deref()),
            text: [a.text1, a.text2, a.text3, a.text4, a.text5].map(|t| contains_rule(t.as_deref())),
        };
        if let Some(name) = a.saved_filter.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
            let cfg = state.config.lock().await;
            let saved = cfg.saved_filters.iter().find(|f| f.name.trim().eq_ignore_ascii_case(name)).ok_or_else(|| {
                let names: Vec<&str> = cfg.saved_filters.iter().map(|f| f.name.as_str()).collect();
                format!("담아 둔 조건 «{name}» 이 없습니다. 있는 것: {names:?}")
            })?;
            filter.apply_saved(saved);
        }
        if filter.min_elapsed_ms > 0 && filter.max_elapsed_ms > 0 && filter.min_elapsed_ms >= filter.max_elapsed_ms {
            return Err("min_elapsed_ms 가 max_elapsed_ms 보다 작아야 합니다 — 이대로면 한 건도 안 걸립니다".into());
        }
        let servers = ServerFilter {
            names: Patterns::new(&many(a.server), &many(a.server_exclude)),
            groups: many(a.service_group).into_iter().map(|g| g.trim().to_lowercase()).filter(|g| !g.is_empty()).collect(),
        };
        let rule = group_rule(&state).await;
        let profile = contains_rule(a.profile_contains.as_deref());

        // 프로파일 검색은 콜렉터에 연결을 여럿(`SEARCH_WORKERS`) 연다 — 한꺼번에 둘까지만 돈다.
        // 셋째는 앞의 것이 끝날 때까지 기다린다
        let mcp = self.app.state::<McpState>();
        let _slot = match &profile {
            Some(_) => Some(mcp.profile_slots.acquire().await.map_err(|e| format!("프로파일 검색 대기 실패: {e}"))?),
            None => None,
        };

        let q = ScanQuery { window, tz, servers, rule, filter, profile, sort, limit };
        with_conn(&self.app, move |conn, state| Ok(scan(conn, state, &q)?.to_string())).await
    }

    #[tool(
        name = "get_transaction_details",
        description = "트랜잭션 몇 건(최대 5)의 상세 — 헤더(서비스·서버·응답시간·에러), 스텝에 붙은 에러, 느린 스텝, 같은 SQL/API 를 묶은 합계(되풀이 = N+1 의심), 앞부분 흐름. 한 건에 10KB 남짓으로 줄여 준다. SQL 바인딩 값은 기본으로 싣는다(앱 설정에서 끌 수 있다)."
    )]
    async fn get_transaction_details(&self, Parameters(a): Parameters<DetailArgs>) -> Result<String, String> {
        if a.refs.is_empty() {
            return Err("refs 가 비었습니다. search_transactions 가 준 ref 를 넘겨 주세요".into());
        }
        if a.refs.len() > digest::MAX_DETAIL_REFS {
            return Err(format!(
                "한 번에 최대 {}건입니다 (받은 수 {}). 나눠서 물어 주세요",
                digest::MAX_DETAIL_REFS,
                a.refs.len()
            ));
        }
        let parsed: Vec<(String, i64, String)> = a
            .refs
            .iter()
            .map(|r| parse_ref(r).map(|(t, d)| (r.trim().to_string(), t, d)))
            .collect::<Result<_, _>>()?;
        let tz = self.app.state::<McpState>().tz_offset_ms();
        let bind_values = self.app.state::<AppState>().config.lock().await.mcp.bind_values;

        with_conn(&self.app, move |conn, state| {
            let mut out = Vec::new();
            for (reference, txid, date) in parsed {
                out.push(detail_one(conn, state, &reference, txid, &date, tz, bind_values)?);
            }
            Ok(serde_json::Value::Array(out).to_string())
        })
        .await
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for NScouterMcp {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("nscouter", env!("CARGO_PKG_VERSION")))
            .with_instructions(
                "NScouter(Scouter APM 클라이언트)가 붙어 있는 콜렉터의 트랜잭션을 읽는다. 읽기 전용이다. \
                 문제 있는 트랜잭션을 찾아 코드를 고치는 용도: \
                 ① search_transactions 로 구간·조건에 맞는 것을 짧게 훑고 \
                 ② 고칠 만한 것의 ref 를 최대 5개씩 get_transaction_details 에 넘겨 에러·느린 SQL·되풀이 호출을 본다. \
                 시각은 사용자 PC 시간대다.",
            )
    }
}

// ─── 연결 ────────────────────────────────────────────────────

/// 풀에서 연결을 빌려 막히는 작업을 돌린다. **끝까지 성공한 연결만 돌려준다** —
/// 응답을 다 못 읽은 소켓에는 남은 조각이 있어 다음 조회가 남의 답을 읽는다.
async fn with_conn<T, F>(app: &AppHandle, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut ScouterConnection, &AppState) -> Result<T, String> + Send + 'static,
{
    let state = app.state::<AppState>();
    if state.server_id.lock().await.is_none() {
        return Err(NOT_CONNECTED.into());
    }
    let mut conn = state.acquire_query_conn().await.map_err(|e| format!("{NOT_CONNECTED} ({e})"))?;
    let app2 = app.clone();
    let (conn, result) = tokio::task::spawn_blocking(move || {
        let state = app2.state::<AppState>();
        let r = f(&mut conn, &state);
        (conn, r)
    })
    .await
    .map_err(|e| format!("조회 작업이 중간에 끝났습니다: {e}"))?;
    if result.is_ok() {
        state.release_query_conn(conn).await;
    }
    result
}

/// 요청 하나를 보내고 응답 팩을 끝까지 읽는다
fn request_all(conn: &mut ScouterConnection, cmd: &str, param: &MapPack) -> Result<Vec<AnyPack>, String> {
    let session = conn.session;
    conn.send_request(cmd, session, param).map_err(|e| format!("{cmd} 요청 실패: {e}"))?;
    let mut out = Vec::new();
    while let Some(p) = conn.read_next_pack().map_err(|e| format!("{cmd} 수신 실패: {e}"))? {
        out.push(p);
    }
    Ok(out)
}

fn realtime_objects(conn: &mut ScouterConnection) -> Result<Vec<crate::scouter::pack::ObjectPack>, String> {
    Ok(request_all(conn, CMD_OBJECT_LIST_REAL_TIME, &MapPack::new())?
        .into_iter()
        .filter_map(|p| match p {
            AnyPack::Object(o) => Some(o),
            _ => None,
        })
        .collect())
}

/// 사전에서 못 찾은 글을 채운다. 공유 캐시를 쓴다 — 화면이 이미 푼 것은 다시 묻지 않는다
fn fill_texts(conn: &mut ScouterConnection, state: &AppState, wants: &[(&'static str, i32)]) -> Result<(), String> {
    let mut by_kind: HashMap<&str, Vec<i32>> = HashMap::new();
    for (k, h) in wants {
        if *h != 0 {
            by_kind.entry(k).or_default().push(*h);
        }
    }
    let mut cache = state.text_cache.blocking_lock();
    for (kind, hashes) in by_kind {
        let missing = cache.missing(kind, &hashes);
        if !missing.is_empty() {
            fetch_texts(conn, &mut cache, kind, &missing).map_err(|e| format!("텍스트 조회 실패: {e}"))?;
        }
    }
    Ok(())
}

/// 캐시를 `Texts` 로 읽는다
fn cache_texts(cache: &TextCache) -> impl Fn(&str, i32) -> Option<String> + '_ {
    move |kind: &str, h: i32| cache.get(kind, h).map(str::to_string)
}

// ─── 목록 훑기 ───────────────────────────────────────────────

/// 목록 조회 한 번의 조건
pub struct ScanQuery {
    window: Window,
    tz: i64,
    servers: ServerFilter,
    rule: GroupRule,
    filter: RowFilter,
    /// 프로파일 본문에서 찾을 글자 (소문자)
    profile: Option<String>,
    sort: SortBy,
    limit: usize,
}

/// 앱 설정의 «서비스로 묶기» 규칙
async fn group_rule(state: &AppState) -> GroupRule {
    let cfg = state.config.lock().await;
    GroupRule::new(&cfg.group_rule.tag_key, &cfg.group_rule.pattern)
}

fn scan(conn: &mut ScouterConnection, state: &AppState, q: &ScanQuery) -> Result<serde_json::Value, String> {
    let (window, tz, filter) = (q.window, q.tz, &q.filter);
    // 오늘 살아 있는 서버는 그날 목록에 아직 없을 수 있다 — 지금 목록을 더한다.
    // 태그(서비스 묶기)는 살아 있는 것만 갖고 있다. 지난 Task 는 이름 규칙으로만 묶인다(화면과 같다)
    let alive: Vec<(i32, String, String, Option<String>)> = realtime_objects(conn)?
        .into_iter()
        .map(|o| {
            let g = q.rule.service_of(&o.obj_name, &o.tags);
            (o.obj_hash, o.obj_name, o.obj_type, g)
        })
        .collect();

    // 날짜마다 훑을 서버. 날짜마다 그날 붙었던 오브젝트가 다르다(ECS Task 는 갈린다)
    let mut names: HashMap<i32, String> = HashMap::new();
    let mut by_date: HashMap<String, Vec<i32>> = HashMap::new();
    for (day_start, _) in split_by_day(window.stime, window.etime, tz) {
        let date = date_key(day_start, tz);
        let daily = request_all(conn, CMD_OBJECT_LIST_LOAD_DATE, &build_daily_object_param(&date))?
            .into_iter()
            .find_map(|p| match p {
                AnyPack::Map(m) => Some(parse_daily_objects(&m)),
                _ => None,
            })
            .unwrap_or_default();
        let mut hashes: Vec<i32> = Vec::new();
        let candidates = daily
            .into_iter()
            .map(|o| {
                let g = q.rule.service_of(&o.obj_name, &[]);
                (o.obj_hash, o.obj_name, o.obj_type, g)
            })
            .chain(alive.iter().cloned());
        for (h, name, kind, group) in candidates {
            if q.servers.picks(&name, &kind, group.as_deref()) && !hashes.contains(&h) {
                hashes.push(h);
                names.entry(h).or_insert(name);
            }
        }
        if !hashes.is_empty() {
            by_date.insert(date, hashes);
        }
    }
    let any_server = !by_date.is_empty();
    let slices: Vec<Slice> = plan_slices(window, tz, digest::SLICE_MS, q.sort)
        .into_iter()
        .filter(|s| by_date.contains_key(&s.date))
        .collect();

    // 프로파일을 볼 때는 후보를 넉넉히 남긴다. 걸러진 뒤에 `limit` 으로 자른다
    let keep = if q.profile.is_some() { digest::PROFILE_CANDIDATES } else { q.limit };
    let shared = SharedScan {
        collector: Mutex::new(Collector::new(q.sort, keep)),
        seen: Mutex::new(HashSet::new()),
        scanned: AtomicU64::new(0),
        next: AtomicUsize::new(0),
        stop: AtomicBool::new(false),
        error: Mutex::new(None),
        done: slices.iter().map(|_| AtomicBool::new(false)).collect(),
    };

    // **조각을 연결 여럿이 나눠 받는다.** 운영 콜렉터는 왕복이 커서 순서대로 받으면 페이지 수 × 왕복이
    // 그대로 시간이다. 첫 일꾼은 빌려 온 연결을, 나머지는 같은 세션으로 새 소켓을 연다(F-1 — 세션은
    // 소켓과 무관하다). 새 소켓을 못 열면 그 일꾼만 빠지고 나머지가 마저 받는다
    let workers = SCAN_PARALLEL.min(slices.len()).max(1);
    let host = state.conn_host.blocking_lock().clone();
    let port = *state.conn_port.blocking_lock();
    let session = conn.session;
    std::thread::scope(|sc| {
        let (shared, slices, by_date) = (&shared, &slices, &by_date);
        for _ in 1..workers {
            let host = host.clone();
            sc.spawn(move || {
                let Ok(mut c) = ScouterConnection::connect(&host, port) else { return };
                c.session = session;
                scan_worker(&mut c, state, slices, by_date, filter, shared);
            });
        }
        scan_worker(conn, state, slices, by_date, filter, shared);
    });
    if let Some(e) = shared.error.lock().unwrap_or_else(|p| p.into_inner()).take() {
        return Err(e);
    }
    let scanned = shared.scanned.load(Ordering::Relaxed);
    let done: Vec<bool> = shared.done.iter().map(|d| d.load(Ordering::Relaxed)).collect();
    let unscanned = unscanned_range(&slices, &done);
    let collector = shared.collector.into_inner().unwrap_or_else(|p| p.into_inner());

    if !any_server {
        return Err(if q.servers.is_empty() {
            "이 구간에 서버(오브젝트)가 하나도 없습니다".into()
        } else {
            "server/service_group 조건에 맞는 서버가 없습니다. list_servers 로 이름과 service_group 을 확인하세요".into()
        });
    }

    let mut res = collector.finish();
    let mut hits: HashMap<i64, ProfileHitView> = HashMap::new();
    let mut profile_facts = None;
    if let Some(needle) = &q.profile {
        let candidates = res.matched;
        let rows = std::mem::take(&mut res.rows);
        let searched = rows.len();
        let (found, failed) = search_profiles(conn, state, &rows, needle, tz)?;
        // 걸린 것만으로 다시 센다 — 요약(건수·서비스별)이 «프로파일에 걸린 것» 의 것이어야 한다
        let mut again = Collector::new(q.sort, q.limit);
        for x in rows {
            if found.contains_key(&x.txid) {
                again.add(x);
            }
        }
        res = again.finish();
        hits = found;
        profile_facts = Some(ProfileFacts { needle: needle.clone(), candidates, searched, failed });
    }

    let mut wants: Vec<(&'static str, i32)> = Vec::new();
    for x in &res.rows {
        wants.push((text_type::SERVICE, x.service));
        if x.error != 0 {
            wants.push((text_type::ERROR, x.error));
        }
    }
    wants.extend(res.top_services.iter().map(|s| (text_type::SERVICE, s.service)));
    fill_texts(conn, state, &wants)?;

    let facts = ScanFacts { window, tz_offset_ms: tz, scanned, unscanned, servers: names.len(), profile: profile_facts };
    let cache = state.text_cache.blocking_lock();
    let texts = cache_texts(&cache);
    let server_name = |h: i32| names.get(&h).cloned().unwrap_or_else(|| format!("#{h}"));
    log::debug!(
        "mcp search_transactions: {}~{} 서버 {} · 훑음 {scanned} · 걸림 {}",
        window.stime,
        window.etime,
        names.len(),
        res.matched
    );
    Ok(search_result_json(&res, &facts, &server_name, &texts as &dyn Texts, &hits))
}

/// 조각을 동시에 받는 연결 수. 화면의 «트랜잭션 찾기»(`WIDE_PARALLEL`)와 같은 값이다.
/// 운영 콜렉터의 왕복을 재면 이 값을 그에 맞춘다
const SCAN_PARALLEL: usize = 4;

/// 일꾼들이 함께 쓰는 것
struct SharedScan {
    collector: Mutex<Collector>,
    /// 조각 경계·페이지 경계에서 같은 트랜잭션이 다시 온다 (F-28)
    seen: Mutex<HashSet<i64>>,
    scanned: AtomicU64,
    /// 다음에 가져갈 조각 번호
    next: AtomicUsize,
    /// 상한에 닿았거나 오류가 났다 — 새 조각을 가져가지 않는다
    stop: AtomicBool,
    error: Mutex<Option<String>>,
    /// 끝까지 받은 조각
    done: Vec<AtomicBool>,
}

/// 조각을 하나씩 가져가 끝까지 받는다
fn scan_worker(
    conn: &mut ScouterConnection,
    state: &AppState,
    slices: &[Slice],
    by_date: &HashMap<String, Vec<i32>>,
    filter: &RowFilter,
    sh: &SharedScan,
) {
    while !sh.stop.load(Ordering::Relaxed) {
        let i = sh.next.fetch_add(1, Ordering::Relaxed);
        let Some(sl) = slices.get(i) else { break };
        let hashes = &by_date[&sl.date];
        match scan_slice(conn, state, sl, hashes, filter, sh) {
            Ok(true) => sh.done[i].store(true, Ordering::Relaxed),
            Ok(false) => {}
            Err(e) => {
                sh.error.lock().unwrap_or_else(|p| p.into_inner()).get_or_insert(e);
                sh.stop.store(true, Ordering::Relaxed);
            }
        }
        if sh.scanned.load(Ordering::Relaxed) >= MAX_SCAN_ROWS {
            sh.stop.store(true, Ordering::Relaxed);
        }
    }
}

/// 조각 하나를 페이지로 넘겨 가며 받는다. 끝까지 받았으면 true, 상한에 걸려 멈췄으면 false
fn scan_slice(
    conn: &mut ScouterConnection,
    state: &AppState,
    sl: &Slice,
    hashes: &[i32],
    filter: &RowFilter,
    sh: &SharedScan,
) -> Result<bool, String> {
    let name_kinds = filter.name_kinds();
    let mut cursor = PastCursor::default();
    for _ in 0..MAX_PAGES {
        let param = build_past_xlog_param(hashes, &sl.date, sl.stime, sl.etime, PAGE_COUNT, &cursor);
        let mut next = PastCursor::default();
        let mut raw: Vec<XLogPack> = Vec::new();
        for p in request_all(conn, CMD_TRANX_LOAD_TIME_GROUP_V2, &param)? {
            match p {
                AnyPack::XLog(x) => raw.push(x),
                AnyPack::Map(m) => next = parse_past_cursor(&m),
                _ => {}
            }
        }
        let rows = raw.len();
        let fresh: Vec<XLogPack> = {
            let mut seen = sh.seen.lock().unwrap_or_else(|p| p.into_inner());
            raw.into_iter().filter(|x| seen.insert(x.txid)).collect()
        };
        sh.scanned.fetch_add(fresh.len() as u64, Ordering::Relaxed);
        let mut page: Vec<XLogPack> = fresh.into_iter().filter(|x| filter.passes_cheap(x)).collect();

        // 이름 조건(서비스·로그인·설명)은 이름을 풀어야 볼 수 있다 — 싼 조건을 넘은 것만 푼다
        if !name_kinds.is_empty() && !page.is_empty() {
            let wants: Vec<(&'static str, i32)> = page.iter().flat_map(|x| filter.name_hashes(x)).collect();
            fill_texts(conn, state, &wants)?;
            let cache = state.text_cache.blocking_lock();
            let texts = cache_texts(&cache);
            page.retain(|x| filter.passes_names(x, &texts as &dyn Texts));
        }
        if !page.is_empty() {
            let mut c = sh.collector.lock().unwrap_or_else(|p| p.into_inner());
            page.into_iter().for_each(|x| c.add(x));
        }

        // 서버가 `hasMore` 를 계속 주면서 커서를 안 밀면 같은 페이지를 영원히 받는다
        if !next.has_more || rows == 0 || next.last_xlog_time <= cursor.last_xlog_time {
            return Ok(true);
        }
        if sh.scanned.load(Ordering::Relaxed) >= MAX_SCAN_ROWS {
            return Ok(false);
        }
        cursor = next;
    }
    // 빗장에 걸렸다 — 끝까지 받았다고 할 수 없다
    Ok(false)
}

/// 후보들의 프로파일을 열어 글자를 찾는다. 화면의 «프로파일 검색» 과 같은 길이다 —
/// 워커 여럿(`SEARCH_WORKERS`)으로 받고, 사전은 한 번에 모아 풀고, `search_steps` 로 맞춘다.
/// **바인딩 값도 찾는다**(`sql-param`) — «이 주문번호가 들어간 쿼리» 가 실제 용도다.
///
/// 돌려주는 것: txid → 걸린 자리, 프로파일을 못 받은 건수
fn search_profiles(
    conn: &mut ScouterConnection,
    state: &AppState,
    rows: &[XLogPack],
    needle: &str,
    tz: i64,
) -> Result<(HashMap<i64, ProfileHitView>, usize), String> {
    use crate::commands::{fetch_profiles_parallel, SearchTarget, SEARCH_WORKERS};
    use crate::scouter::profile_search::{collect_hashes, search_steps, StepTexts};

    let targets: Vec<SearchTarget> = rows
        .iter()
        .map(|x| SearchTarget { txid: x.txid.to_string(), obj_hash: x.obj_hash, date: date_key(x.end_time, tz) })
        .collect();
    let host = state.conn_host.blocking_lock().clone();
    let port = *state.conn_port.blocking_lock();
    let fetched = fetch_profiles_parallel(&host, port, conn.session, &targets, SEARCH_WORKERS);
    let failed = fetched.iter().filter(|f| f.is_none()).count();

    let mut wants: Vec<(&'static str, i32)> = Vec::new();
    for steps in fetched.iter().flatten() {
        let h = collect_hashes(steps);
        wants.extend(h.method.into_iter().map(|x| (text_type::METHOD, x)));
        wants.extend(h.sql.into_iter().map(|x| (text_type::SQL, x)));
        wants.extend(h.apicall.into_iter().map(|x| (text_type::APICALL, x)));
        wants.extend(h.error.into_iter().map(|x| (text_type::ERROR, x)));
        wants.extend(h.hmsg.into_iter().map(|x| (text_type::HASH_MSG, x)));
    }
    wants.sort_unstable();
    wants.dedup();
    fill_texts(conn, state, &wants)?;

    let guard = state.text_cache.blocking_lock();
    let cache: &TextCache = &guard;
    let get = |kind: &'static str| move |h: i32| cache.get(kind, h).map(str::to_string);
    let (mf, sf, af, ef, hf) = (get(text_type::METHOD), get(text_type::SQL), get(text_type::APICALL), get(text_type::ERROR), get(text_type::HASH_MSG));
    let texts = StepTexts { method: &mf, sql: &sf, apicall: &af, error: &ef, hmsg: &hf };

    let mut out = HashMap::new();
    for (x, steps) in rows.iter().zip(&fetched) {
        let Some(steps) = steps else { continue };
        let found = search_steps(steps, &texts, needle);
        if let Some(first) = found.first() {
            out.insert(x.txid, ProfileHitView { count: found.len(), kind: first.kind.clone(), snippet: first.snippet.clone() });
        }
    }
    log::debug!("mcp 프로파일 검색: {}건 중 {}건 적중, {failed}건 실패", rows.len(), out.len());
    Ok((out, failed))
}

// ─── 상세 ────────────────────────────────────────────────────

fn detail_one(
    conn: &mut ScouterConnection,
    state: &AppState,
    reference: &str,
    txid: i64,
    date: &str,
    tz: i64,
    bind_values: bool,
) -> Result<serde_json::Value, String> {
    let mut param = MapPack::new();
    param.put("txid", ScouterValue::Decimal(txid));
    param.put("date", ScouterValue::Text(date.to_string()));
    let xlog = request_all(conn, CMD_XLOG_READ_BY_TXID, &param)?.into_iter().find_map(|p| match p {
        AnyPack::XLog(x) => Some(x),
        _ => None,
    });
    let Some(xlog) = xlog else {
        return Ok(json!({ "ref": reference, "error": "트랜잭션을 찾지 못했습니다 (날짜가 다르거나 콜렉터에서 지워졌을 수 있습니다)" }));
    };

    // 프로파일은 팩이 아니라 `[3][blob]` 청크로 온다 — `read_next_pack` 으로 읽으면 안 된다 (F-26)
    let session = conn.session;
    conn.send_request(CMD_TRANX_PROFILE_FULL, session, &build_full_profile_param(date, txid))
        .map_err(|e| format!("프로파일 요청 실패: {e}"))?;
    let blob = conn.read_blob_stream().map_err(|e| format!("프로파일 수신 실패: {e}"))?;
    let steps: Vec<ProfileStep> = parse_profile_steps(blob);

    let mut wants = detail_hashes(&xlog, &steps);
    wants.push((text_type::OBJECT, xlog.obj_hash));
    fill_texts(conn, state, &wants)?;

    let cache = state.text_cache.blocking_lock();
    let server = cache.get(text_type::OBJECT, xlog.obj_hash).map(str::to_string).unwrap_or_else(|| format!("#{}", xlog.obj_hash));
    let texts = cache_texts(&cache);
    Ok(detail_json(reference, &xlog, &steps, &server, &texts as &dyn Texts, tz, bind_values))
}
