// MCP 도구 — 읽기만 한다. 콜렉터에는 조회용 연결 풀로 묻는다.
//
// **붙은 콜렉터가 여럿이면 한 곳처럼 답한다** (`crate::hub`). 목록은 콜렉터 전부를 훑어 하나로 합치고,
// 콜렉터가 둘 이상일 때만 행에 `collector` 열과 `ref` 의 `@콜렉터` 가 붙는다 — 하나일 때는 예전과 같다.
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
use crate::hub::CollectorLink;
use crate::scouter::connection::{local_now_ms, ScouterConnection};
use crate::scouter::dictionary::{fetch_texts, TextCache};
use crate::scouter::object::{build_daily_object_param, parse_daily_objects};
use crate::scouter::objtype::{date_key, split_by_day};
use crate::scouter::pack::{AnyPack, MapPack, XLogPack};
use crate::cache::profile::full_profile_steps;
use crate::cache::xlog::past_page;
use crate::scouter::past::PastCursor;
use crate::scouter::profile::ProfileStep;
use crate::scouter::protocol::*;
use crate::scouter::value::ScouterValue;
use crate::state::AppState;

// 조정값은 설정에서 온다 (`tuning`):
//   · 페이지 크기 `perf.page_rows` (기본 20,000) — 근거는 `config::PerfPrefs`
//   · 조각 동시 수 `perf.scan_parallel` (기본 4) — 화면의 «트랜잭션 찾기» 와 같은 값
//   · 훑을 트랜잭션 상한 `mcp.limits.scan_max_rows` (기본 20만) — 넘으면 `truncated` 로 말한다
//   · 프로파일 본문 검색 시간 `mcp.limits.profile_budget_sec` (기본 15초) — 목록 훑기·사전 풀기를 더해
//     한 번의 호출이 20초 안팎이 되게(왕복 500ms 실측). 넘으면 그때까지 연 것만으로 답한다

/// 커서가 안 밀릴 때를 대비한 빗장
const MAX_PAGES: u32 = 200;
/// 프로파일 본문 검색에서 시간을 재는 묶음 크기 — 프로파일 동시 받기 수의 두 배.
/// 묶음 사이에서만 시간을 보므로 크면 그만큼 넘친다 — 256 이면 왕복 500ms 에서 한 묶음이 7초라
/// 15초 상한이 27초까지 갔다(실측)
fn profile_chunk() -> usize {
    crate::commands::search_workers() * 2
}

/// list_servers 가 돌려줄 최대 수
const MAX_SERVERS: usize = 500;

const NOT_CONNECTED: &str = "NScouter 가 콜렉터에 연결되어 있지 않습니다. 앱에서 서버에 접속한 뒤 다시 시도하세요.";

/// `AppState` 를 꺼내 쓸 손잡이 — 앱에서는 `AppHandle`, 시험에서는 `Arc<AppState>`.
/// 도구의 몸통(`*_core`)이 창 없이도 돌게 하려고 둔다
pub trait StateRef: Clone + Send + Sync + 'static {
    fn get(&self) -> impl std::ops::Deref<Target = AppState> + Send + '_;
}

impl StateRef for AppHandle {
    fn get(&self) -> impl std::ops::Deref<Target = AppState> + Send + '_ {
        self.state::<AppState>()
    }
}

impl StateRef for std::sync::Arc<AppState> {
    fn get(&self) -> impl std::ops::Deref<Target = AppState> + Send + '_ {
        self.as_ref()
    }
}

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
    /// 구간 길이(분). 기본 30, 상한은 앱 설정(기본 360). from·to 를 둘 다 주면 쓰지 않는다 —
    /// 하나만 주면 그 시각부터(from) 또는 그 시각까지(to) 이 길이만큼, 둘 다 없으면 지금까지 이 길이만큼
    pub minutes: Option<u32>,
    /// 구간 시작. 이 PC 시간대의 `YYYY-MM-DD HH:MM[:SS]`
    pub from: Option<String>,
    /// 구간 끝. 이 PC 시간대의 `YYYY-MM-DD HH:MM[:SS]`
    pub to: Option<String>,
    /// 훑을 콜렉터 — 이름에 들어 있는 글자(list_servers 의 collector 열). 여러 개면 OR. 비우면 붙은 콜렉터 전부
    pub collector: Option<OneOrMany>,
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
    /// 앱 자유 필드 text1 에 들어 있는 글자
    pub text1: Option<String>,
    /// 앱 자유 필드 text2 에 들어 있는 글자
    pub text2: Option<String>,
    /// 앱 자유 필드 text3 에 들어 있는 글자
    pub text3: Option<String>,
    /// 앱 자유 필드 text4 에 들어 있는 글자
    pub text4: Option<String>,
    /// 앱 자유 필드 text5 에 들어 있는 글자
    pub text5: Option<String>,
    /// 앱에서 이름 붙여 담아 둔 조회 조건의 이름. 위 조건들과 함께 걸린다
    pub saved_filter: Option<String>,
    /// 프로파일 본문(SQL 문장·바인딩 값·API 주소·메서드·에러·로그 메시지)에 이 글자가 든 것만.
    /// 트랜잭션마다 프로파일을 열어 보므로 느리다 — 위 조건에 걸린 것 중 sort 순으로 앱 설정의 건수·시간(기본 2,000건·15초)까지만 열어 본다
    pub profile_contains: Option<String>,
    /// `slowest`(기본, 느린 것부터) 또는 `latest`(최근 것부터)
    pub sort: Option<String>,
    /// 돌려줄 최대 건수. 기본 50, 상한은 앱 설정(기본 500)
    pub limit: Option<u32>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct DetailArgs {
    /// search_transactions 가 준 `ref`(`txid:yyyymmdd`, 콜렉터가 여럿이면 `txid:yyyymmdd@콜렉터`)를 그대로.
    /// 한 번에 앱 설정의 수까지(기본 5)
    pub refs: Vec<String>,
}

// ─── 도구 ────────────────────────────────────────────────────

#[tool_router]
impl NScouterMcp {
    #[tool(
        name = "list_servers",
        description = "NScouter 가 붙어 있는 Scouter 콜렉터들의 서버(에이전트) 목록 — 이름·종류·살아 있는지·service_group(앱의 «서비스로 묶기» 규칙으로 묶인 논리 서비스)·collector(어느 콜렉터). 콜렉터가 여럿이어도 한 목록이다. 같은 이름이 두 콜렉터에 있으면 뒤쪽 것의 이름에 ` @콜렉터` 가 붙는다. search_transactions 의 server·service_group·collector 조건에 넣을 이름을 찾을 때 쓴다."
    )]
    async fn list_servers(&self) -> Result<String, String> {
        list_servers_core(&self.app).await
    }

    #[tool(
        name = "search_transactions",
        description = "구간 안의 트랜잭션(XLog)을 훑어 조건에 맞는 것을 짧은 행으로 돌려준다 — 프로파일은 싣지 않는다. 콜렉터가 여럿 붙어 있으면 전부를 한꺼번에 훑어 한 목록으로 준다(collector 로 좁힐 수 있다, 행의 collector 열). 기본은 최근 30분·느린 순 50건, 상한은 앱 설정(기본 6시간·500건). 조건은 앱 XLog 화면과 같다: 서버·서비스 묶음, 서비스/IP 포함·제외(여러 개면 포함은 OR), 에러만, 응답시간 이상/미만, 로그인·설명·text1~5, 담아 둔 조건(saved_filter). profile_contains 를 주면 프로파일 본문(SQL·바인딩 값·API·에러·메시지)까지 찾고 걸린 자리를 profile_hit 열에 싣는다(느리다 — 다른 조건으로 먼저 좁힐 것). 행마다 `ref` 가 있으니 자세히 볼 것만 골라 그대로 get_transaction_details 에 넘긴다. top_services 는 걸린 것을 서비스별로 센 요약이다."
    )]
    async fn search_transactions(&self, Parameters(a): Parameters<SearchArgs>) -> Result<String, String> {
        // 프로파일 검색은 콜렉터에 연결을 여럿(`perf.profile_workers`) 연다 — 한꺼번에 `mcp.limits.profile_searches`
        // 개까지만 돈다(기본 2). 넘치는 것은 앞의 것이 끝날 때까지 기다린다
        let mcp = self.app.state::<McpState>();
        let _slot = match contains_rule(a.profile_contains.as_deref()) {
            Some(_) => Some(mcp.profile_slot().await?),
            None => None,
        };
        search_core(&self.app, mcp.tz_offset_ms(), a).await
    }

    #[tool(
        name = "get_transaction_details",
        description = "트랜잭션 몇 건(앱 설정, 기본 최대 5)의 상세 — 헤더(서비스·서버·응답시간·에러), 스텝에 붙은 에러, 느린 스텝, 같은 SQL/API 를 묶은 합계(되풀이 = N+1 의심), 앞부분 흐름. 한 건에 12KB 안쪽으로 줄여 준다. SQL 바인딩 값은 기본으로 싣는다(앱 설정에서 끌 수 있다). refs 는 search_transactions 가 준 ref 를 그대로 넘긴다 — 콜렉터가 붙은 ref(`…@콜렉터`)는 그 콜렉터에만 묻는다."
    )]
    async fn get_transaction_details(&self, Parameters(a): Parameters<DetailArgs>) -> Result<String, String> {
        details_core(&self.app, self.app.state::<McpState>().tz_offset_ms(), a).await
    }
}

/// `get_transaction_details` 의 몸통
pub async fn details_core<H: StateRef>(h: &H, tz: i64, a: DetailArgs) -> Result<String, String> {
    {
        if a.refs.is_empty() {
            return Err("refs 가 비었습니다. search_transactions 가 준 ref 를 넘겨 주세요".into());
        }
        let detail_max = crate::tuning::mcp().detail_max as usize;
        if a.refs.len() > detail_max {
            return Err(format!(
                "한 번에 최대 {}건입니다 (받은 수 {}). 나눠서 물어 주세요",
                detail_max,
                a.refs.len()
            ));
        }
        let parsed: Vec<(String, i64, String, Option<String>)> = a
            .refs
            .iter()
            .map(|r| parse_ref(r).map(|(t, d, c)| (r.trim().to_string(), t, d, c)))
            .collect::<Result<_, _>>()?;
        let bind_values = h.get().config.lock().await.mcp.bind_values;

        // **한 건씩 차례로 묻지 않는다.** 한 건에 요청이 서넛(XLog·프로파일·사전)이고 요청마다 소켓을 새로 연다(F-1) —
        // 왕복 500ms 면 5건을 차례로 열 때 10초가 넘는다. 건마다 소켓을 따로 열어 동시에 연다.
        // 콜렉터가 적힌 ref 는 그 콜렉터에만, 안 적힌 것은 붙은 콜렉터를 차례로 묻는다(txid 는 콜렉터끼리 안 겹친다)
        with_conns(h, None, move |conns, state| {
            let conns: &[(std::sync::Arc<CollectorLink>, ScouterConnection)] = conns;
            let results: Vec<Result<serde_json::Value, String>> = std::thread::scope(|sc| {
                let handles: Vec<_> = parsed
                    .iter()
                    .map(|(reference, txid, date, coll)| {
                        sc.spawn(move || -> Result<serde_json::Value, String> {
                            let order: Vec<&(std::sync::Arc<CollectorLink>, ScouterConnection)> = match coll {
                                Some(c) => {
                                    let found: Vec<_> = conns.iter().filter(|(l, _)| l.name == *c).collect();
                                    if found.is_empty() {
                                        let names: Vec<&str> = conns.iter().map(|(l, _)| l.name.as_str()).collect();
                                        return Ok(json!({ "ref": reference, "error": format!("콜렉터 «{c}» 에 붙어 있지 않습니다. 붙은 콜렉터: {names:?}") }));
                                    }
                                    found
                                }
                                None => conns.iter().collect(),
                            };
                            for (link, conn) in order {
                                let mut c = conn.sibling().map_err(|e| format!("연결 실패 ({}): {e}", link.name))?;
                                if let Some(v) = detail_one(&mut c, link, state, reference, *txid, date, tz, bind_values)? {
                                    return Ok(v);
                                }
                            }
                            Ok(json!({ "ref": reference, "error": "트랜잭션을 찾지 못했습니다 (날짜가 다르거나 콜렉터에서 지워졌을 수 있습니다)" }))
                        })
                    })
                    .collect();
                handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("상세 조회 스레드 실패".into()))).collect()
            });
            let out = results.into_iter().collect::<Result<Vec<_>, _>>()?;
            Ok(serde_json::Value::Array(out).to_string())
        })
        .await
    }
}

/// `list_servers` 의 몸통
pub async fn list_servers_core<H: StateRef>(h: &H) -> Result<String, String> {
    let rule = group_rule(&h.get()).await;
    let objects = with_conns(h, None, move |conns, state| {
        let mut out = Vec::new();
        for (link, conn) in conns.iter_mut() {
            for mut o in realtime_objects(conn)? {
                let real = o.obj_hash;
                o.obj_hash = state.virt(link, real);
                if o.obj_hash != real {
                    o.obj_name = link.tagged_name(&o.obj_name);
                }
                out.push((o, link.name.clone()));
            }
        }
        Ok(out)
    })
    .await?;
    let mut rows: Vec<_> = objects
        .into_iter()
        .map(|(o, collector)| {
            let group = rule.service_of(&o.obj_name, &o.tags);
            (o.obj_name, o.obj_type, o.alive, group, collector)
        })
        .collect();
    rows.sort();
    let total = rows.len();
    rows.truncate(MAX_SERVERS);
    let out = json!({
        "total": total,
        "returned": rows.len(),
        "columns": ["name", "type", "alive", "service_group", "collector"],
        "rows": rows.iter().map(|(n, t, a, g, c)| json!([n, t, a, g, c])).collect::<Vec<_>>(),
    });
    Ok(out.to_string())
}

/// `search_transactions` 의 몸통 (프로파일 검색 자리는 부르는 쪽이 잡는다)
pub async fn search_core<H: StateRef>(h: &H, tz: i64, a: SearchArgs) -> Result<String, String> {
    let state = h.get();
    let offset = state.clock_offset_ms().await.unwrap_or(0);
    let lim = crate::tuning::mcp();
    let window = resolve_window(local_now_ms() + offset, tz, lim.max_minutes, a.minutes, a.from.as_deref(), a.to.as_deref())?;
    let sort = SortBy::parse(a.sort.as_deref())?;
    let max = lim.list_max as usize;
    let limit = (a.limit.map(|v| v as usize).unwrap_or(digest::DEFAULT_LIMIT)).clamp(1, max);

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
    let collectors: Vec<String> = many(a.collector).into_iter().map(|c| c.trim().to_lowercase()).filter(|c| !c.is_empty()).collect();
    let rule = group_rule(&state).await;
    let profile = contains_rule(a.profile_contains.as_deref());

    let multi = state.links().len() > 1;
    let q = ScanQuery { window, tz, servers, rule, filter, profile, sort, limit, multi };
    let pick = (!collectors.is_empty()).then_some(collectors);
    with_conns(h, pick, move |conns, state| Ok(scan(conns, state, &q)?.to_string())).await
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for NScouterMcp {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("nscouter", env!("CARGO_PKG_VERSION")))
            .with_instructions(
                "NScouter(Scouter APM 클라이언트)가 붙어 있는 콜렉터의 트랜잭션을 읽는다. 읽기 전용이다. \
                 NScouter 앱이 켜져 있고 콜렉터에 접속해 있을 때만 답한다. \
                 콜렉터가 여럿 붙어 있어도 한 곳처럼 다룬다 — 목록은 전부를 합쳐 주고, 행의 collector 열이 어느 콜렉터인지 말한다. \
                 문제 있는 트랜잭션을 찾아 코드를 고치는 용도: \
                 ① 서버 이름·service_group 을 모르면 list_servers 로 먼저 확인하고 \
                 ② search_transactions 로 구간·조건에 맞는 것을 짧게 훑고 \
                 ③ 고칠 만한 것의 ref 를 그대로 몇 개씩(앱 설정, 기본 5) get_transaction_details 에 넘겨 에러·느린 SQL·되풀이 호출을 본다. \
                 시각은 사용자 PC 시간대다.",
            )
    }
}

// ─── 연결 ────────────────────────────────────────────────────

/// 붙은 콜렉터마다 조회용 연결을 하나씩 빌려 막히는 작업을 돌린다.
///
/// `pick` 이 있으면 이름에 그 글자가 든 콜렉터만 (소문자). 못 붙은 콜렉터는 빠진다 — 하나도 없으면 미연결이다.
/// **끝까지 성공했을 때만 연결을 돌려준다** — 응답을 다 못 읽은 소켓에는 남은 조각이 있어 다음 조회가 남의 답을 읽는다.
async fn with_conns<H, T, F>(h: &H, pick: Option<Vec<String>>, f: F) -> Result<T, String>
where
    H: StateRef,
    T: Send + 'static,
    F: FnOnce(&mut [(std::sync::Arc<CollectorLink>, ScouterConnection)], &AppState) -> Result<T, String> + Send + 'static,
{
    let state = h.get();
    if state.server_id.lock().await.is_none() {
        return Err(NOT_CONNECTED.into());
    }
    let links = state.links();
    let chosen: Vec<_> = match &pick {
        Some(p) => links.into_iter().filter(|l| p.iter().any(|w| l.name.to_lowercase().contains(w.as_str()))).collect(),
        None => links,
    };
    if chosen.is_empty() {
        let names: Vec<String> = state.links().iter().map(|l| l.name.clone()).collect();
        return Err(format!("collector 조건에 맞는 콜렉터가 없습니다. 붙은 콜렉터: {names:?}"));
    }
    let mut conns = Vec::new();
    let mut last_err = None;
    for l in chosen {
        if !l.is_connected().await {
            continue;
        }
        match l.acquire_query_conn().await {
            Ok(c) => conns.push((l, c)),
            Err(e) => last_err = Some(e),
        }
    }
    if conns.is_empty() {
        return Err(match last_err {
            Some(e) => format!("{NOT_CONNECTED} ({e})"),
            None => NOT_CONNECTED.into(),
        });
    }
    let h2 = h.clone();
    let (conns, result) = tokio::task::spawn_blocking(move || {
        let state = h2.get();
        let r = f(&mut conns, &state);
        (conns, r)
    })
    .await
    .map_err(|e| format!("조회 작업이 중간에 끝났습니다: {e}"))?;
    if result.is_ok() {
        for (l, c) in conns {
            l.release_query_conn(c).await;
        }
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

/// 사전에서 못 찾은 글을 채운다. 그 콜렉터의 공유 캐시를 쓴다 — 화면이 이미 푼 것은 다시 묻지 않는다
fn fill_texts(conn: &mut ScouterConnection, link: &CollectorLink, wants: &[(&'static str, i32)]) -> Result<(), String> {
    let mut by_kind: HashMap<&str, Vec<i32>> = HashMap::new();
    for (k, h) in wants {
        if *h != 0 {
            by_kind.entry(k).or_default().push(*h);
        }
    }
    let mut cache = link.text_cache.blocking_lock();
    for (kind, hashes) in by_kind {
        let missing = cache.missing(kind, &hashes);
        if !missing.is_empty() {
            fetch_texts(conn, &mut cache, kind, &missing).map_err(|e| format!("텍스트 조회 실패 ({}): {e}", link.name))?;
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
    /// 붙은 콜렉터가 둘 이상 — 행에 콜렉터를 싣는다
    multi: bool,
}

/// 앱 설정의 «서비스로 묶기» 규칙
async fn group_rule(state: &AppState) -> GroupRule {
    let cfg = state.config.lock().await;
    GroupRule::new(&cfg.group_rule.tag_key, &cfg.group_rule.pattern)
}

/// 콜렉터 하나에서 훑을 것 — 날짜마다 그날 붙었던 서버(원래 해시), 조각들
struct LinkPlan {
    by_date: HashMap<String, Vec<i32>>,
    slices: Vec<Slice>,
    /// 다음에 가져갈 조각 번호
    next: AtomicUsize,
    /// 끝까지 받은 조각
    done: Vec<AtomicBool>,
}

/// 콜렉터 하나의 훑을 서버를 정한다. 화면용 해시 → 이름을 `names` 에 남긴다
fn plan_link(
    conn: &mut ScouterConnection,
    link: &CollectorLink,
    state: &AppState,
    q: &ScanQuery,
    names: &mut HashMap<i32, String>,
) -> Result<LinkPlan, String> {
    let (window, tz) = (q.window, q.tz);
    let tag = |real: i32, name: String| if state.is_tagged(link, real) { link.tagged_name(&name) } else { name };
    // 오늘 살아 있는 서버는 그날 목록에 아직 없을 수 있다 — 지금 목록을 더한다.
    // 태그(서비스 묶기)는 살아 있는 것만 갖고 있다. 지난 Task 는 이름 규칙으로만 묶인다(화면과 같다)
    let alive: Vec<(i32, String, String, Option<String>)> = realtime_objects(conn)?
        .into_iter()
        .map(|o| {
            state.virt(link, o.obj_hash);
            let name = tag(o.obj_hash, o.obj_name);
            let g = q.rule.service_of(&name, &o.tags);
            (o.obj_hash, name, o.obj_type, g)
        })
        .collect();

    // 날짜마다 훑을 서버. 날짜마다 그날 붙었던 오브젝트가 다르다(ECS Task 는 갈린다)
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
                state.virt(link, o.obj_hash);
                let name = tag(o.obj_hash, o.obj_name);
                let g = q.rule.service_of(&name, &[]);
                (o.obj_hash, name, o.obj_type, g)
            })
            .chain(alive.iter().cloned());
        for (h, name, kind, group) in candidates {
            if q.servers.picks(&name, &kind, group.as_deref()) && !hashes.contains(&h) {
                hashes.push(h);
                names.entry(state.virt(link, h)).or_insert(name);
            }
        }
        if !hashes.is_empty() {
            by_date.insert(date, hashes);
        }
    }
    let slices: Vec<Slice> = plan_slices(window, tz, digest::SLICE_MS, q.sort)
        .into_iter()
        .filter(|s| by_date.contains_key(&s.date))
        .collect();
    let done = slices.iter().map(|_| AtomicBool::new(false)).collect();
    Ok(LinkPlan { by_date, slices, next: AtomicUsize::new(0), done })
}

/// 붙은 콜렉터들을 **한꺼번에** 훑어 한 목록으로 만든다.
///
/// 콜렉터마다 조각을 나눠 받는 일꾼을 띄우고(`perf.scan_parallel`), 걸린 것은 공용 집계 하나에 모은다 —
/// 정렬·상한·서비스별 요약이 콜렉터를 가리지 않는다. 행의 objHash 는 화면용(`crate::hub`)이다.
fn scan(
    conns: &mut [(std::sync::Arc<CollectorLink>, ScouterConnection)],
    state: &AppState,
    q: &ScanQuery,
) -> Result<serde_json::Value, String> {
    let (window, tz, filter) = (q.window, q.tz, &q.filter);

    let mut names: HashMap<i32, String> = HashMap::new();
    let mut plans = Vec::with_capacity(conns.len());
    for (link, conn) in conns.iter_mut() {
        plans.push(plan_link(conn, link, state, q, &mut names)?);
    }
    let any_server = plans.iter().any(|p| !p.by_date.is_empty());

    // 프로파일을 볼 때는 후보를 넉넉히 남긴다. 걸러진 뒤에 `limit` 으로 자른다
    let lim = crate::tuning::mcp();
    let keep = if q.profile.is_some() { digest::PROFILE_CANDIDATES.max(lim.profile_fetch_max as usize) } else { q.limit };
    let shared = SharedScan {
        collector: Mutex::new(Collector::new(q.sort, keep)),
        seen: Mutex::new(HashSet::new()),
        scanned: AtomicU64::new(0),
        stop: AtomicBool::new(false),
        error: Mutex::new(None),
        max_rows: lim.scan_max_rows as u64,
    };

    // **조각을 연결 여럿이 나눠 받는다.** 운영 콜렉터는 왕복이 커서 순서대로 받으면 페이지 수 × 왕복이
    // 그대로 시간이다. 콜렉터마다 첫 일꾼은 빌려 온 연결을, 나머지는 같은 세션으로 새 소켓을 연다(F-1 — 세션은
    // 소켓과 무관하다). 새 소켓을 못 열면 그 일꾼만 빠지고 나머지가 마저 받는다
    let parallel = crate::tuning::perf().scan_parallel as usize;
    std::thread::scope(|sc| {
        let shared = &shared;
        for ((link, conn), plan) in conns.iter_mut().zip(&plans) {
            if plan.slices.is_empty() {
                continue;
            }
            let link: &CollectorLink = link;
            let workers = parallel.min(plan.slices.len()).max(1);
            for _ in 1..workers {
                let (host, port, session) = (link.host.clone(), link.port, conn.session);
                sc.spawn(move || {
                    let Ok(mut c) = ScouterConnection::connect(&host, port) else { return };
                    c.session = session;
                    scan_worker(&mut c, link, state, plan, filter, shared);
                });
            }
            sc.spawn(move || scan_worker(conn, link, state, plan, filter, shared));
        }
    });
    if let Some(e) = shared.error.lock().unwrap_or_else(|p| p.into_inner()).take() {
        return Err(e);
    }
    let scanned = shared.scanned.load(Ordering::Relaxed);
    // 다 못 훑은 구간 — 콜렉터마다 구해 합친다(가장 이른 시작 ~ 가장 늦은 끝)
    let unscanned = plans
        .iter()
        .filter_map(|p| {
            let done: Vec<bool> = p.done.iter().map(|d| d.load(Ordering::Relaxed)).collect();
            unscanned_range(&p.slices, &done)
        })
        .reduce(|(a0, a1), (b0, b1)| (a0.min(b0), a1.max(b1)));
    let collector = shared.collector.into_inner().unwrap_or_else(|p| p.into_inner());

    if !any_server {
        return Err(if q.servers.is_empty() {
            "이 구간에 서버(오브젝트)가 하나도 없습니다".into()
        } else {
            "server/service_group 조건에 맞는 서버가 없습니다. list_servers 로 이름과 service_group 을 확인하세요".into()
        });
    }

    // 행(화면용 해시) → `conns` 의 자리
    let idxs: Vec<usize> = conns.iter().map(|(l, _)| l.idx).collect();
    let link_names: Vec<String> = conns.iter().map(|(l, _)| l.name.clone()).collect();
    let link_pos = |vhash: i32| -> usize {
        state
            .route(vhash)
            .ok()
            .and_then(|(l, _)| idxs.iter().position(|i| *i == l.idx))
            .unwrap_or(0)
    };

    let mut res = collector.finish();
    let mut hits: HashMap<i64, ProfileHitView> = HashMap::new();
    let mut profile_facts = None;
    if let Some(needle) = &q.profile {
        let candidates = res.matched;
        // 캐시에 있는 프로파일은 묻지 않고 바로 연다 — 상한(`profile_fetch_max`)은 새로 물을 것에만 건다
        let all = std::mem::take(&mut res.rows);
        let mut cached: HashSet<i64> = HashSet::new();
        for (i, (link, _)) in conns.iter().enumerate() {
            let mine: Vec<i64> = all.iter().filter(|x| link_pos(x.obj_hash) == i).map(|x| x.txid).collect();
            if let Some(db) = link.cache_handle_blocking() {
                cached.extend(db.profile_has(&mine));
            }
        }
        let mut fetch = 0usize;
        let rows: Vec<XLogPack> = all
            .into_iter()
            .filter(|x| {
                if cached.contains(&x.txid) {
                    return true;
                }
                fetch += 1;
                fetch <= lim.profile_fetch_max as usize
            })
            .collect();
        // 캐시에 있는 것을 앞으로 — 시간 상한에 걸려도 그건 다 본다 (같은 무리 안의 순서는 그대로)
        let mut rows = rows;
        rows.sort_by_key(|x| !cached.contains(&x.txid));

        // 콜렉터마다 제 트랜잭션을 연다 — 동시에(시간 상한은 콜렉터마다 따로 잰다)
        let groups: Vec<Vec<XLogPack>> = (0..conns.len())
            .map(|i| rows.iter().filter(|x| link_pos(x.obj_hash) == i).cloned().collect())
            .collect();
        let outcomes: Vec<Result<(HashMap<i64, ProfileHitView>, usize, usize), String>> = std::thread::scope(|sc| {
            let handles: Vec<_> = conns
                .iter_mut()
                .zip(&groups)
                .map(|((link, conn), g)| {
                    let link: &CollectorLink = link;
                    sc.spawn(move || if g.is_empty() { Ok((HashMap::new(), 0, 0)) } else { search_profiles(conn, link, g, needle, tz) })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("프로파일 검색 스레드 실패".into()))).collect()
        });
        let mut failed = 0;
        let mut opened: HashSet<i64> = HashSet::new();
        for (g, o) in groups.iter().zip(outcomes) {
            let (found, f, searched) = o?;
            failed += f;
            // 콜렉터마다 앞에서부터 `searched` 건을 열었다
            opened.extend(g.iter().take(searched).map(|x| x.txid));
            hits.extend(found);
        }
        let searched = opened.len();
        // 걸린 것만으로 다시 센다 — 요약(건수·서비스별)이 «프로파일에 걸린 것» 의 것이어야 한다
        let mut again = Collector::new(q.sort, q.limit);
        for x in rows {
            if opened.contains(&x.txid) && hits.contains_key(&x.txid) {
                again.add(x);
            }
        }
        res = again.finish();
        profile_facts = Some(ProfileFacts {
            needle: needle.clone(),
            candidates,
            searched,
            failed,
            fetch_max: lim.profile_fetch_max as usize,
            budget_sec: lim.profile_budget_sec,
        });
    }

    // 이름은 그 행의 콜렉터에서 푼다
    for (i, (link, conn)) in conns.iter_mut().enumerate() {
        let mut wants: Vec<(&'static str, i32)> = Vec::new();
        for x in res.rows.iter().filter(|x| link_pos(x.obj_hash) == i) {
            wants.push((text_type::SERVICE, x.service));
            if x.error != 0 {
                wants.push((text_type::ERROR, x.error));
            }
        }
        // 서비스별 요약은 콜렉터를 가리지 않는다 — 콜렉터마다 제 사전에서 푼다(모르는 해시엔 답하지 않는다)
        wants.extend(res.top_services.iter().map(|s| (text_type::SERVICE, s.service)));
        fill_texts(conn, link, &wants)?;
    }

    let facts = ScanFacts {
        window,
        tz_offset_ms: tz,
        scanned,
        unscanned,
        servers: names.len(),
        profile: profile_facts,
        detail_max: lim.detail_max as usize,
        collectors: link_names.clone(),
        multi_collector: q.multi,
    };
    let guards: Vec<_> = conns.iter().map(|(l, _)| l.text_cache.blocking_lock()).collect();
    let texts = |kind: &str, h: i32| guards.iter().find_map(|g| g.get(kind, h).map(str::to_string));
    let server_name = |h: i32| names.get(&h).cloned().unwrap_or_else(|| format!("#{h}"));
    let collector_of = |h: i32| q.multi.then(|| link_names.get(link_pos(h)).cloned()).flatten();
    log::debug!(
        "mcp search_transactions: {}~{} 콜렉터 {} · 서버 {} · 훑음 {scanned} · 걸림 {}",
        window.stime,
        window.etime,
        conns.len(),
        names.len(),
        res.matched
    );
    Ok(search_result_json(&res, &facts, &server_name, &collector_of, &texts as &dyn Texts, &hits))
}

/// 일꾼들이 함께 쓰는 것 (콜렉터를 가리지 않는다)
struct SharedScan {
    collector: Mutex<Collector>,
    /// 조각 경계·페이지 경계에서 같은 트랜잭션이 다시 온다 (F-28). (콜렉터 번호, txid)
    seen: Mutex<HashSet<(usize, i64)>>,
    scanned: AtomicU64,
    /// 상한에 닿았거나 오류가 났다 — 새 조각을 가져가지 않는다
    stop: AtomicBool,
    error: Mutex<Option<String>>,
    /// 훑을 트랜잭션 상한 (`mcp.limits.scan_max_rows`) — 콜렉터 전부를 합친 수
    max_rows: u64,
}

/// 콜렉터 하나의 조각을 하나씩 가져가 끝까지 받는다
fn scan_worker(
    conn: &mut ScouterConnection,
    link: &CollectorLink,
    state: &AppState,
    plan: &LinkPlan,
    filter: &RowFilter,
    sh: &SharedScan,
) {
    while !sh.stop.load(Ordering::Relaxed) {
        let i = plan.next.fetch_add(1, Ordering::Relaxed);
        let Some(sl) = plan.slices.get(i) else { break };
        let hashes = &plan.by_date[&sl.date];
        match scan_slice(conn, link, state, sl, hashes, filter, sh) {
            Ok(true) => plan.done[i].store(true, Ordering::Relaxed),
            Ok(false) => {}
            Err(e) => {
                let e = format!("{e} ({})", link.name);
                sh.error.lock().unwrap_or_else(|p| p.into_inner()).get_or_insert(e);
                sh.stop.store(true, Ordering::Relaxed);
            }
        }
        if sh.scanned.load(Ordering::Relaxed) >= sh.max_rows {
            sh.stop.store(true, Ordering::Relaxed);
        }
    }
}

/// 조각 하나를 페이지로 넘겨 가며 받는다. 끝까지 받았으면 true, 상한에 걸려 멈췄으면 false
fn scan_slice(
    conn: &mut ScouterConnection,
    link: &CollectorLink,
    state: &AppState,
    sl: &Slice,
    hashes: &[i32],
    filter: &RowFilter,
    sh: &SharedScan,
) -> Result<bool, String> {
    let name_kinds = filter.name_kinds();
    let cache = link.cache_handle_blocking();
    let seal = link.seal_before_blocking();
    let page_rows = crate::tuning::perf().page_rows as i32;
    let mut cursor = PastCursor::default();
    for _ in 0..MAX_PAGES {
        // 한 번 끝까지 받은 구간은 로컬 캐시에서 준다 (`cache::xlog`)
        let page = past_page(conn, cache.as_deref(), hashes, &sl.date, sl.stime, sl.etime, page_rows, &cursor, seal)?;
        let (raw, next, done) = (page.rows, page.next, page.done);
        let fresh: Vec<XLogPack> = {
            let mut seen = sh.seen.lock().unwrap_or_else(|p| p.into_inner());
            raw.into_iter().filter(|x| seen.insert((link.idx, x.txid))).collect()
        };
        sh.scanned.fetch_add(fresh.len() as u64, Ordering::Relaxed);
        let mut page: Vec<XLogPack> = fresh.into_iter().filter(|x| filter.passes_cheap(x)).collect();

        // 이름 조건(서비스·로그인·설명)은 이름을 풀어야 볼 수 있다 — 싼 조건을 넘은 것만 푼다
        if !name_kinds.is_empty() && !page.is_empty() {
            let wants: Vec<(&'static str, i32)> = page.iter().flat_map(|x| filter.name_hashes(x)).collect();
            fill_texts(conn, link, &wants)?;
            let cache = link.text_cache.blocking_lock();
            let texts = cache_texts(&cache);
            page.retain(|x| filter.passes_names(x, &texts as &dyn Texts));
        }
        if !page.is_empty() {
            // 공용 집계에는 화면용 해시로 넣는다 — 콜렉터를 가려 이름·ref 를 붙일 수 있게
            state.virtualize_xlogs(link, &mut page);
            let mut c = sh.collector.lock().unwrap_or_else(|p| p.into_inner());
            page.into_iter().for_each(|x| c.add(x));
        }

        if done {
            return Ok(true);
        }
        if sh.scanned.load(Ordering::Relaxed) >= sh.max_rows {
            return Ok(false);
        }
        cursor = next;
    }
    // 빗장에 걸렸다 — 끝까지 받았다고 할 수 없다
    Ok(false)
}

/// 후보들의 프로파일을 열어 글자를 찾는다. 화면의 «프로파일 검색» 과 같은 길이다 —
/// 워커 여럿(설정 `perf.profile_workers`)으로 받고, 사전은 한 번에 모아 풀고, `search_steps` 로 맞춘다.
/// **바인딩 값도 찾는다**(`sql-param`) — «이 주문번호가 들어간 쿼리» 가 실제 용도다.
///
/// `rows` 는 모두 이 콜렉터(`link`)의 것이다. 돌려주는 것: txid → 걸린 자리, 프로파일을 못 받은 건수, 앞에서부터 열어 본 건수
fn search_profiles(
    conn: &mut ScouterConnection,
    link: &CollectorLink,
    rows: &[XLogPack],
    needle: &str,
    tz: i64,
) -> Result<(HashMap<i64, ProfileHitView>, usize, usize), String> {
    use crate::commands::{fetch_profiles_parallel, search_workers, SearchTarget};
    use crate::scouter::profile_search::{collect_hashes, search_steps, StepTexts};

    // 프로파일 조회에 objHash 는 쓰지 않는다(txid·날짜면 된다, F-14) — 화면용 해시를 그대로 둔다
    let targets: Vec<SearchTarget> = rows
        .iter()
        .map(|x| SearchTarget { txid: x.txid.to_string(), obj_hash: x.obj_hash, date: date_key(x.end_time, tz) })
        .collect();
    let (host, port) = (link.host.clone(), link.port);
    let cache = link.cache_handle_blocking();
    // 묶음으로 나눠 받고, **시간 상한**(설정 `mcp.limits.profile_budget_sec`)을 넘으면 거기서 멈춘다. 건수 상한만으로는
    // 콜렉터가 멀 때 AI 쪽 호출이 몇 분씩 걸린다(왕복 500ms 면 2,000건에 50초 남짓)
    let started = std::time::Instant::now();
    let mut fetched: Vec<Option<Vec<ProfileStep>>> = Vec::with_capacity(targets.len());
    let budget = std::time::Duration::from_secs(crate::tuning::mcp().profile_budget_sec as u64);
    for chunk in targets.chunks(profile_chunk()) {
        if !fetched.is_empty() && started.elapsed() >= budget {
            break;
        }
        fetched.extend(fetch_profiles_parallel(&host, port, conn.session, chunk, search_workers(), cache.as_deref()));
    }
    let searched = fetched.len();
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
    fill_texts(conn, link, &wants)?;

    let guard = link.text_cache.blocking_lock();
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
    log::debug!("mcp 프로파일 검색({}): {}건 중 {searched}건을 열어 {}건 적중, {failed}건 실패", link.name, rows.len(), out.len());
    Ok((out, failed, searched))
}

// ─── 상세 ────────────────────────────────────────────────────

/// 트랜잭션 한 건의 상세. 이 콜렉터에 그 트랜잭션이 없으면 None — 다음 콜렉터에 묻는다
#[allow(clippy::too_many_arguments)]
fn detail_one(
    conn: &mut ScouterConnection,
    link: &CollectorLink,
    state: &AppState,
    reference: &str,
    txid: i64,
    date: &str,
    tz: i64,
    bind_values: bool,
) -> Result<Option<serde_json::Value>, String> {
    let mut param = MapPack::new();
    param.put("txid", ScouterValue::Decimal(txid));
    param.put("date", ScouterValue::Text(date.to_string()));
    let xlog = request_all(conn, CMD_XLOG_READ_BY_TXID, &param)?.into_iter().find_map(|p| match p {
        AnyPack::XLog(x) => Some(x),
        _ => None,
    });
    let Some(xlog) = xlog else {
        return Ok(None);
    };

    // 한 번 받은 프로파일은 캐시에서 준다 (`cache::profile`)
    let cache = link.cache_handle_blocking();
    let steps: Vec<ProfileStep> = full_profile_steps(conn, cache.as_deref(), txid, date)?;

    let mut wants = detail_hashes(&xlog, &steps);
    wants.push((text_type::OBJECT, xlog.obj_hash));
    fill_texts(conn, link, &wants)?;

    let cache = link.text_cache.blocking_lock();
    let server = cache.get(text_type::OBJECT, xlog.obj_hash).map(str::to_string).unwrap_or_else(|| format!("#{}", xlog.obj_hash));
    // 해시가 겹친 오브젝트는 목록·화면과 같은 이름(` @콜렉터`)으로
    state.virt(link, xlog.obj_hash);
    let server = if state.is_tagged(link, xlog.obj_hash) { link.tagged_name(&server) } else { server };
    let texts = cache_texts(&cache);
    Ok(Some(detail_json(reference, &xlog, &steps, &server, &texts as &dyn Texts, tz, bind_values)))
}
