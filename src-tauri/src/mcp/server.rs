// MCP 도구 — 읽기만 한다. 콜렉터에는 조회용 연결 풀로 묻는다.
//
// **화면의 주 연결을 쓰지 않는다.** 6시간 구간을 훑는 동안 주 연결을 잡고 있으면 화면의
// 프로파일·사전 조회가 그만큼 멈춘다. 풀에서 빌려 쓰고, 끝까지 읽은 연결만 돌려준다.
//
// 훑기는 막히는(blocking) 소켓 읽기라 `spawn_blocking` 으로 돌린다 — 몇 초짜리 훑기가
// 비동기 일꾼 하나를 붙잡으면 화면 명령과 MCP 응답이 같이 밀린다.

use std::collections::{HashMap, HashSet};

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{Implementation, ServerCapabilities, ServerConfig},
    schemars, tool, tool_handler, tool_router, ServerHandler,
};
use serde_json::json;
use tauri::{AppHandle, Manager};

use super::digest::{
    self, detail_hashes, detail_json, parse_ref, resolve_window, search_result_json, Collector,
    RowFilter, ScanFacts, SortBy, Texts, Window,
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

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SearchArgs {
    /// 지금부터 몇 분 전까지 볼지. 기본 30, 최대 360. from/to 를 주면 구간 길이로 쓴다
    pub minutes: Option<u32>,
    /// 구간 시작. 이 PC 시간대의 `YYYY-MM-DD HH:MM[:SS]`
    pub from: Option<String>,
    /// 구간 끝. 이 PC 시간대의 `YYYY-MM-DD HH:MM[:SS]`
    pub to: Option<String>,
    /// 서버(오브젝트) 이름이나 종류에 들어 있는 글자. 대소문자 무시. 비우면 전체 서버
    pub server: Option<String>,
    /// 서비스(URL·메서드) 이름에 들어 있는 글자. 대소문자 무시
    pub service: Option<String>,
    /// 호출한 IP 에 들어 있는 글자
    pub ip: Option<String>,
    /// 에러난 트랜잭션만
    pub error_only: Option<bool>,
    /// 이 응답시간(ms) 이상만
    pub min_elapsed_ms: Option<i32>,
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
        let mut rows: Vec<_> = objects.into_iter().map(|o| (o.obj_name, o.obj_type, o.alive)).collect();
        rows.sort();
        let total = rows.len();
        rows.truncate(MAX_SERVERS);
        let out = json!({
            "total": total,
            "returned": rows.len(),
            "columns": ["name", "type", "alive"],
            "rows": rows.iter().map(|(n, t, a)| json!([n, t, a])).collect::<Vec<_>>(),
        });
        Ok(out.to_string())
    }

    #[tool(
        name = "search_transactions",
        description = "구간 안의 트랜잭션(XLog)을 훑어 조건에 맞는 것을 짧은 행으로 돌려준다 — 프로파일은 싣지 않는다. 기본은 최근 30분·느린 순 50건, 최대 6시간·500건. 행마다 `ref` 가 있으니 자세히 볼 것만 골라 get_transaction_details 에 넘긴다. top_services 는 걸린 것을 서비스별로 센 요약이다."
    )]
    async fn search_transactions(&self, Parameters(a): Parameters<SearchArgs>) -> Result<String, String> {
        let tz = self.app.state::<McpState>().tz_offset_ms();
        let offset = self.app.state::<AppState>().clock_offset_ms.lock().await.unwrap_or(0);
        let window = resolve_window(local_now_ms() + offset, tz, a.minutes, a.from.as_deref(), a.to.as_deref())?;
        let sort = SortBy::parse(a.sort.as_deref())?;
        let limit = (a.limit.unwrap_or(digest::DEFAULT_LIMIT as u32) as usize).clamp(1, digest::MAX_LIMIT);
        let lower = |s: Option<String>| s.map(|v| v.trim().to_lowercase()).filter(|v| !v.is_empty());
        let filter = RowFilter {
            service: lower(a.service),
            ip: a.ip.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()),
            error_only: a.error_only.unwrap_or(false),
            min_elapsed_ms: a.min_elapsed_ms.unwrap_or(0).max(0),
        };
        let server = lower(a.server);

        with_conn(&self.app, move |conn, state| {
            let out = scan(conn, state, window, tz, server.as_deref(), &filter, sort, limit)?;
            Ok(out.to_string())
        })
        .await
    }

    #[tool(
        name = "get_transaction_details",
        description = "트랜잭션 몇 건(최대 5)의 상세 — 헤더(서비스·서버·응답시간·에러), 스텝에 붙은 에러, 느린 스텝, 같은 SQL/API 를 묶은 합계(되풀이 = N+1 의심), 앞부분 흐름. 한 건에 10KB 남짓으로 줄여 준다. SQL 바인딩 값은 앱 설정에서 허용했을 때만 싣는다."
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

#[allow(clippy::too_many_arguments)]
fn scan(
    conn: &mut ScouterConnection,
    state: &AppState,
    window: Window,
    tz: i64,
    server: Option<&str>,
    filter: &RowFilter,
    sort: SortBy,
    limit: usize,
) -> Result<serde_json::Value, String> {
    // 오늘 살아 있는 서버는 그날 목록에 아직 없을 수 있다 — 지금 목록을 더한다
    let alive: Vec<(i32, String, String)> =
        realtime_objects(conn)?.into_iter().map(|o| (o.obj_hash, o.obj_name, o.obj_type)).collect();
    let picks = |name: &str, kind: &str| match server {
        None => true,
        Some(s) => name.to_lowercase().contains(s) || kind.to_lowercase().contains(s),
    };

    let mut names: HashMap<i32, String> = HashMap::new();
    let mut collector = Collector::new(sort, limit);
    let mut seen: HashSet<i64> = HashSet::new();
    let mut scanned = 0u64;
    let mut truncated_at = None;
    let mut any_server = false;

    'days: for (day_start, day_end) in split_by_day(window.stime, window.etime, tz) {
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
            .map(|o| (o.obj_hash, o.obj_name, o.obj_type))
            .chain(alive.iter().cloned());
        for (h, name, kind) in candidates {
            if picks(&name, &kind) && !hashes.contains(&h) {
                hashes.push(h);
                names.entry(h).or_insert(name);
            }
        }
        if hashes.is_empty() {
            continue;
        }
        any_server = true;

        let mut cursor = PastCursor::default();
        for _ in 0..MAX_PAGES {
            let param = build_past_xlog_param(&hashes, &date, day_start, day_end, PAGE_COUNT, &cursor);
            let mut next = PastCursor::default();
            let mut rows = 0u32;
            let mut page: Vec<XLogPack> = Vec::new();
            for p in request_all(conn, CMD_TRANX_LOAD_TIME_GROUP_V2, &param)? {
                match p {
                    AnyPack::XLog(x) => {
                        rows += 1;
                        // 페이지 경계에서 같은 시각의 트랜잭션이 다시 온다 (F-28)
                        if !seen.insert(x.txid) {
                            continue;
                        }
                        scanned += 1;
                        if filter.passes_cheap(&x) {
                            page.push(x);
                        }
                    }
                    AnyPack::Map(m) => next = parse_past_cursor(&m),
                    _ => {}
                }
            }

            // 서비스 이름 조건은 이름을 풀어야 볼 수 있다 — 싼 조건을 넘은 것만 푼다
            if filter.service.is_some() && !page.is_empty() {
                let wants: Vec<(&'static str, i32)> = page.iter().map(|x| (text_type::SERVICE, x.service)).collect();
                fill_texts(conn, state, &wants)?;
                let cache = state.text_cache.blocking_lock();
                page.retain(|x| filter.passes_service(cache.get(text_type::SERVICE, x.service)));
            }
            for x in page {
                collector.add(x);
            }

            if scanned >= MAX_SCAN_ROWS {
                truncated_at = Some(next.last_xlog_time.max(day_start));
                break 'days;
            }
            if !next.has_more || rows == 0 || next.last_xlog_time <= cursor.last_xlog_time {
                break;
            }
            cursor = next;
        }
    }

    if !any_server {
        return Err(match server {
            Some(s) => format!("«{s}» 에 맞는 서버가 없습니다. list_servers 로 이름을 확인하세요"),
            None => "이 구간에 서버(오브젝트)가 하나도 없습니다".into(),
        });
    }

    let res = collector.finish();
    let mut wants: Vec<(&'static str, i32)> = Vec::new();
    for x in &res.rows {
        wants.push((text_type::SERVICE, x.service));
        if x.error != 0 {
            wants.push((text_type::ERROR, x.error));
        }
    }
    wants.extend(res.top_services.iter().map(|s| (text_type::SERVICE, s.service)));
    fill_texts(conn, state, &wants)?;

    let facts = ScanFacts { window, tz_offset_ms: tz, scanned, truncated_at, servers: names.len() };
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
    Ok(search_result_json(&res, &facts, &server_name, &texts as &dyn Texts))
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
