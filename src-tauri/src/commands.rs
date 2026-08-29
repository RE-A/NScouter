// src-tauri/src/commands.rs
// Tauri Command 정의
// 참조: docs/plans/tauri-backend-scouter-client.md

use std::collections::HashMap;
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, State};

use crate::config::AppConfig;
use crate::scouter::configure::{
    escape_config_text, parse_config_entries, parse_config_text, parse_save_result, ConfigView,
};
use crate::scouter::connection::ScouterConnection;
use crate::scouter::counter::{build_counter_multi_param, parse_counter_multi, CounterUpdate, CounterValue};
use crate::scouter::dictionary::fetch_texts;
use crate::scouter::object::{
    build_class_list_param, build_dump_file_param, build_object_param, parse_active_services,
    parse_class_list, parse_dump_file_list, parse_heap_histogram, parse_object_env,
    build_heap_dump_param, build_pstack_param, build_stack_range_param,
    build_thread_detail_param, parse_socket_list,
    parse_thread_detail, parse_thread_list, ActiveService, ThreadDetail,
    ClassListPage, DumpFile, EnvEntry, HeapHistoRow, SocketInfo, ThreadInfo,
};
use crate::scouter::objtype::{
    build_active_service_param, build_objtype_param, build_past_date_counter_param,
    build_service_group_param, build_today_counter_param, is_complete, parse_active_speed,
    parse_counter_series, parse_service_group, ActiveSpeed, CounterSeries, ServiceGroupRow,
    TypeActiveServices,
};
use crate::scouter::pack::{AnyPack, InteractionCounterPack, MapPack, ObjectPack, XLogPack};
use crate::scouter::past::{build_past_xlog_param, parse_past_cursor, PastCursor};
use crate::scouter::search::{
    build_search_xlog_param, parse_search_max, SearchXLogFilter, DEFAULT_SEARCH_MAX,
};
use crate::scouter::profile::{build_full_profile_param, parse_profile_steps, XLogProfilePack};
use crate::scouter::protocol::*;
use crate::scouter::alert::build_alert_param;
use crate::scouter::streaming::{run_xlog_stream, StreamCursor};
use crate::scouter::summary::{build_summary_param, parse_error_summary, parse_summary, ErrorSummaryRow, SummaryRow};
use crate::scouter::trace::build_gxid_param;
use crate::scouter::value::ScouterValue;
use crate::state::{AppState, StreamKind};

// ─── connect_scouter ─────────────────────────────────────────

/// Collector TCP 연결 + 로그인
#[tauri::command]
pub async fn connect_scouter(
    host: String,
    port: u16,
    user: String,
    pass: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::debug!("connect_scouter: host={host}, port={port}, user={user}");

    let mut conn = ScouterConnection::connect(&host, port)
        .map_err(|e| format!("연결 실패: {e}"))?;

    conn.login(&user, &pass)
        .map_err(|e| format!("로그인 실패: {e}"))?;

    let server_id = conn.server_id.clone();
    *state.connection.lock().await = Some(conn);

    // 재연결용 파라미터 저장 (streaming 전용 connection 생성에 사용)
    *state.conn_host.lock().await = host.clone();
    *state.conn_port.lock().await = port;
    *state.conn_user.lock().await = user.clone();
    let pass_for_config = pass.clone();
    *state.conn_pass.lock().await = pass;

    // 마지막 접속 정보를 config에 자동 저장
    {
        let config_path = state.config_path.clone();
        let mut cfg = state.config.lock().await;
        cfg.last_host = Some(host);
        cfg.last_port = Some(port);
        cfg.last_user = Some(user);
        // 비밀번호는 자동 연결을 켰을 때만 남긴다 (평문 저장이라 기본은 안 남김)
        cfg.last_pass = if cfg.auto_connect { Some(pass_for_config) } else { None };
        let _ = cfg.save(&config_path);
    }

    log::info!("Collector 연결 완료: server_id={server_id}");
    let _ = app.emit("scouter-connected", server_id);
    Ok(())
}

// ─── disconnect_scouter ──────────────────────────────────────

/// 연결 종료 + 스트리밍 중지
#[tauri::command]
pub async fn disconnect_scouter(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    log::info!("disconnect_scouter: 연결 종료");
    state.streams.stop_all().await;
    *state.connection.lock().await = None;
    let _ = app.emit("scouter-disconnected", ());
    Ok(())
}

// ─── start_xlog_stream ───────────────────────────────────────

/// 실시간 XLog 스트리밍 시작 (별도 connection으로 spawn)
#[tauri::command]
pub async fn start_xlog_stream(
    obj_hashes: Vec<i32>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::debug!("start_xlog_stream: obj_hashes={obj_hashes:?}");
    let stop_flag = state.streams.take_token(StreamKind::XLog).await;

    let host = state.conn_host.lock().await.clone();
    let port = *state.conn_port.lock().await;
    let user = state.conn_user.lock().await.clone();
    let pass = state.conn_pass.lock().await.clone();

    tokio::spawn(async move {
        let mut stream_conn = match ScouterConnection::connect(&host, port) {
            Ok(c) => c,
            Err(e) => {
                log::error!("XLog 스트림 연결 실패: {e}");
                let _ = app.emit("xlog-error", serde_json::json!({ "message": format!("스트림 연결 실패: {e}") }));
                return;
            }
        };
        if let Err(e) = stream_conn.login(&user, &pass) {
            log::error!("XLog 스트림 로그인 실패: {e}");
            return;
        }
        run_xlog_stream(&mut stream_conn, obj_hashes, app, stop_flag).await;
    });

    Ok(())
}

// ─── stop_xlog_stream ────────────────────────────────────────

/// 실시간 XLog 스트리밍 중지
#[tauri::command]
pub async fn stop_xlog_stream(state: State<'_, AppState>) -> Result<(), String> {
    log::info!("stop_xlog_stream: 스트리밍 중지");
    state.streams.stop(StreamKind::XLog).await;
    Ok(())
}

// ─── resolve_texts ───────────────────────────────────────────

/// hash → text 일괄 조회
/// type_key: "service" | "sql" | "method" | "error" | ... (text_type 모듈 참조)
#[tauri::command]
pub async fn resolve_texts(
    type_key: String,
    hashes: Vec<i32>,
    state: State<'_, AppState>,
) -> Result<HashMap<i32, String>, String> {
    log::debug!("resolve_texts: type_key={type_key}, count={}", hashes.len());

    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;

    let mut cache_guard = state.text_cache.lock().await;
    let missing = cache_guard.missing(&type_key, &hashes);

    if !missing.is_empty() {
        fetch_texts(conn, &mut cache_guard, &type_key, &missing)
            .map_err(|e| format!("텍스트 조회 실패: {e}"))?;
    }

    let result: HashMap<i32, String> = hashes
        .iter()
        .filter_map(|&h| {
            cache_guard
                .get(&type_key, h)
                .map(|t| (h, t.to_string()))
        })
        .collect();

    Ok(result)
}

// ─── get_object_list ─────────────────────────────────────────

/// 실시간 오브젝트(에이전트) 목록 조회
/// 반환: ObjectPack 목록 (obj_hash, obj_type, obj_name, address, version, alive)
#[tauri::command]
pub async fn get_object_list(
    state: State<'_, AppState>,
) -> Result<Vec<ObjectPack>, String> {
    log::debug!("get_object_list: 오브젝트 목록 요청");

    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;

    let param = MapPack::new();
    let session = conn.session;
    conn.send_request(CMD_OBJECT_LIST_REAL_TIME, session, &param)
        .map_err(|e| format!("오브젝트 목록 요청 실패: {e}"))?;

    let mut objects = Vec::new();
    loop {
        match conn.read_next_pack().map_err(|e| format!("응답 수신 실패: {e}"))? {
            Some(AnyPack::Object(obj)) => objects.push(obj),
            Some(AnyPack::Map(_)) => {} // 커서 MapPack 무시
            Some(_) => {}
            None => break,
        }
    }

    log::debug!("get_object_list: {}개 오브젝트 수신", objects.len());
    Ok(objects)
}

// ─── 오브젝트 단건 명령 (OBJECT_*) ───────────────────────────

/// 오브젝트 명령 1회 왕복. 응답은 MapPack 하나다 (실측).
///
/// 파라미터가 틀리면 에러가 아니라 **NoNEXT(빈 응답)** 가 온다 (F-15).
/// 그래서 "0건"과 "실패"를 호출부가 구분할 수 있게 빈 MapPack 이 아니라
/// None 을 돌려준다.
async fn request_object_map(
    state: &State<'_, AppState>,
    cmd: &str,
    obj_hash: i32,
) -> Result<Option<MapPack>, String> {
    request_map(state, cmd, build_object_param(obj_hash)).await
}

/// 파라미터를 직접 넘기는 버전. 파라미터가 아예 없는 커맨드에도 쓴다.
async fn request_map(
    state: &State<'_, AppState>,
    cmd: &str,
    param: MapPack,
) -> Result<Option<MapPack>, String> {
    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;

    let session = conn.session;
    conn.send_request(cmd, session, &param)
        .map_err(|e| format!("{cmd} 요청 실패: {e}"))?;

    let mut found = None;
    loop {
        match conn.read_next_pack().map_err(|e| format!("{cmd} 응답 수신 실패: {e}"))? {
            Some(AnyPack::Map(m)) => {
                if found.is_none() {
                    found = Some(m);
                }
            }
            Some(_) => {}
            None => break,
        }
    }
    Ok(found)
}

/// 에이전트 JVM 의 시스템 프로퍼티
#[tauri::command]
pub async fn get_object_env(
    state: State<'_, AppState>,
    obj_hash: i32,
) -> Result<Vec<EnvEntry>, String> {
    let map = request_object_map(&state, CMD_OBJECT_ENV, obj_hash).await?;
    let env = map.as_ref().map(parse_object_env).unwrap_or_default();
    log::debug!("get_object_env: objHash={obj_hash} → {}건", env.len());
    Ok(env)
}

/// 에이전트 JVM 의 스레드 목록
#[tauri::command]
pub async fn get_object_thread_list(
    state: State<'_, AppState>,
    obj_hash: i32,
) -> Result<Vec<ThreadInfo>, String> {
    let map = request_object_map(&state, CMD_OBJECT_THREAD_LIST, obj_hash).await?;
    let threads = map.as_ref().map(parse_thread_list).unwrap_or_default();
    log::debug!("get_object_thread_list: objHash={obj_hash} → {}건", threads.len());
    Ok(threads)
}

/// 에이전트가 열고 있는 소켓 목록
#[tauri::command]
pub async fn get_object_sockets(
    state: State<'_, AppState>,
    obj_hash: i32,
) -> Result<Vec<SocketInfo>, String> {
    let map = request_object_map(&state, CMD_OBJECT_SOCKET, obj_hash).await?;
    let list = map.as_ref().map(parse_socket_list).unwrap_or_default();
    log::debug!("get_object_sockets: objHash={obj_hash} → {}건", list.len());
    Ok(list)
}

/// 에이전트 설정 — 파일 원문 + key/value/default 표.
///
/// 커맨드가 둘로 나뉘어 있어 요청도 두 번이다 (F-1: 연결 1개당 커맨드 1개).
/// **원문이 비어도 표는 채워질 수 있다** — 에이전트가 설정 파일 없이 기본값으로
/// 도는 경우다. 그래서 둘 중 하나만 실패해도 나머지는 보여준다.
#[tauri::command]
pub async fn get_agent_config(
    state: State<'_, AppState>,
    obj_hash: i32,
) -> Result<ConfigView, String> {
    let text = request_object_map(&state, CMD_GET_CONFIGURE_WAS, obj_hash)
        .await?
        .as_ref()
        .map(parse_config_text)
        .unwrap_or_default();
    let entries = request_object_map(&state, CMD_LIST_CONFIGURE_WAS, obj_hash)
        .await?
        .as_ref()
        .map(parse_config_entries)
        .unwrap_or_default();

    log::debug!("get_agent_config: objHash={obj_hash} → 원문 {}자, {}개 항목", text.len(), entries.len());
    Ok(ConfigView { text, entries })
}

/// 에이전트 설정 저장.
///
/// **파일을 통째로 덮어쓴다.** 에이전트는 받은 텍스트를 `Configure.saveText()` 로 쓰고
/// `reload()` 한다 — 한 줄만 보내면 나머지 설정이 사라진다 (F-40).
/// 그래서 호출부는 반드시 **원문 전체**를 보내야 한다.
///
/// 빈 텍스트는 거절한다. 실수로 빈 편집기를 저장하면 그 에이전트의 설정이 날아간다.
#[tauri::command]
pub async fn save_agent_config(
    state: State<'_, AppState>,
    obj_hash: i32,
    text: String,
) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("빈 설정은 저장하지 않습니다 — 에이전트 설정이 통째로 지워집니다".into());
    }

    let mut param = build_object_param(obj_hash);
    param.put(
        "setConfig",
        crate::scouter::value::ScouterValue::Text(escape_config_text(&text)),
    );

    let map = request_map(&state, CMD_SET_CONFIGURE_WAS, param).await?;
    let map = map.ok_or("콜렉터가 저장 결과를 주지 않았습니다")?;
    parse_save_result(&map)?;

    log::debug!("save_agent_config: objHash={obj_hash} → {}자 저장", text.len());
    Ok(())
}

/// 요약 조회 종류. 커맨드 이름을 화면이 직접 넘기면 오타가 조용한 0건이 된다 (F-15).
#[derive(serde::Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SummaryKind {
    Service,
    Sql,
    ApiCall,
    Ip,
    Ua,
}

impl SummaryKind {
    fn cmd(self) -> &'static str {
        match self {
            Self::Service => CMD_LOAD_SERVICE_SUMMARY,
            Self::Sql => CMD_LOAD_SQL_SUMMARY,
            Self::ApiCall => CMD_LOAD_APICALL_SUMMARY,
            Self::Ip => CMD_LOAD_IP_SUMMARY,
            Self::Ua => CMD_LOAD_UA_SUMMARY,
        }
    }
}

/// 구간 요약 — 서비스 / SQL / API / IP / UA.
///
/// `obj_hash` 가 0 이면 타입 전체다. `id` 는 해시이므로 화면에서 사전으로 풀어야 한다.
#[tauri::command]
pub async fn get_summary(
    state: State<'_, AppState>,
    kind: SummaryKind,
    date: String,
    stime: i64,
    etime: i64,
    obj_type: String,
    obj_hash: i32,
) -> Result<Vec<SummaryRow>, String> {
    let param = build_summary_param(&date, stime, etime, &obj_type, obj_hash);
    let rows = request_map(&state, kind.cmd(), param)
        .await?
        .as_ref()
        .map(parse_summary)
        .unwrap_or_default();
    log::debug!("get_summary: {} → {}행", kind.cmd(), rows.len());
    Ok(rows)
}

/// 에러 요약. 리스트 구성이 달라 별도 커맨드다.
#[tauri::command]
pub async fn get_error_summary(
    state: State<'_, AppState>,
    date: String,
    stime: i64,
    etime: i64,
    obj_type: String,
    obj_hash: i32,
) -> Result<Vec<ErrorSummaryRow>, String> {
    let param = build_summary_param(&date, stime, etime, &obj_type, obj_hash);
    let rows = request_map(&state, CMD_LOAD_SERVICE_ERROR_SUMMARY, param)
        .await?
        .as_ref()
        .map(parse_error_summary)
        .unwrap_or_default();
    log::debug!("get_error_summary: {}행", rows.len());
    Ok(rows)
}

/// 인터랙션(토폴로지) — 누가 누구를 부르나.
///
/// **에이전트가 기본으로 수집하지 않는다** (`counter_interaction_enabled`, F-40).
/// 꺼져 있으면 에러가 아니라 **0건**이 온다 — 화면이 그 차이를 말해 줘야 한다.
#[tauri::command]
pub async fn get_interaction(
    state: State<'_, AppState>,
    obj_type: String,
) -> Result<Vec<InteractionCounterPack>, String> {
    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;

    let mut param = MapPack::new();
    param.put("objType", ScouterValue::Text(obj_type.clone()));
    // 빈 리스트를 보내면 콜렉터가 살아 있는 오브젝트로 채운다 (F-40)
    param.put("objHash", ScouterValue::List(Vec::new()));

    let session = conn.session;
    conn.send_request(CMD_INTR_COUNTER_REAL_TIME_BY_OBJ, session, &param)
        .map_err(|e| format!("인터랙션 요청 실패: {e}"))?;

    let mut rows = Vec::new();
    loop {
        match conn.read_next_pack().map_err(|e| format!("인터랙션 수신 실패: {e}"))? {
            Some(AnyPack::Interaction(i)) => rows.push(i),
            Some(_) => {}
            None => break,
        }
    }
    log::debug!("get_interaction: {obj_type} → {}행", rows.len());
    Ok(rows)
}

/// 콜렉터 설정 — 파라미터가 없다.
#[tauri::command]
pub async fn get_server_config(state: State<'_, AppState>) -> Result<ConfigView, String> {
    let text = request_map(&state, CMD_GET_CONFIGURE_SERVER, MapPack::new())
        .await?
        .as_ref()
        .map(parse_config_text)
        .unwrap_or_default();
    let entries = request_map(&state, CMD_LIST_CONFIGURE_SERVER, MapPack::new())
        .await?
        .as_ref()
        .map(parse_config_entries)
        .unwrap_or_default();

    log::debug!("get_server_config: 원문 {}자, {}개 항목", text.len(), entries.len());
    Ok(ConfigView { text, entries })
}

/// 과거 XLog 한 페이지 조회 결과
#[derive(serde::Serialize)]
pub struct PastXLogPage {
    pub xlogs: Vec<XLogPack>,
    pub cursor: PastCursor,
}

/// 과거 XLog 시간 범위 조회 (한 페이지).
///
/// 지금까지 앱은 "현재"만 봤다. 이게 LoadTimeXLog / ZoomTime /
/// 과거 카운터 차트의 **공통 선행 조건**이다.
///
/// 호출부가 `cursor.has_more` 를 보고 이어서 부른다. 페이지 경계에서
/// 같은 시각의 트랜잭션이 다시 오므로 **txid 로 걸러야 한다** (F-28).
#[tauri::command]
pub async fn load_past_xlog(
    state: State<'_, AppState>,
    obj_hashes: Vec<i32>,
    date: String,
    stime: i64,
    etime: i64,
    page_count: i32,
    cursor: Option<PastCursor>,
) -> Result<PastXLogPage, String> {
    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;

    let cur = cursor.unwrap_or_default();
    let param = build_past_xlog_param(&obj_hashes, &date, stime, etime, page_count, &cur);
    let session = conn.session;
    conn.send_request(CMD_TRANX_LOAD_TIME_GROUP_V2, session, &param)
        .map_err(|e| format!("과거 XLog 요청 실패: {e}"))?;

    let mut xlogs = Vec::new();
    let mut next = PastCursor::default();
    loop {
        match conn.read_next_pack().map_err(|e| format!("과거 XLog 수신 실패: {e}"))? {
            Some(AnyPack::XLog(x)) => xlogs.push(x),
            Some(AnyPack::Map(m)) => next = parse_past_cursor(&m),
            Some(_) => {}
            None => break,
        }
    }

    log::debug!(
        "load_past_xlog: {}건, hasMore={}, nextTime={}",
        xlogs.len(),
        next.has_more,
        next.last_xlog_time
    );
    Ok(PastXLogPage { xlogs, cursor: next })
}

/// 넓은 구간 검색 결과.
///
/// **`truncated` 를 반드시 화면에 보여야 한다.** 서버는 상한에서 그냥 끊고
/// «잘렸다» 는 신호를 아무것도 주지 않는다 — 그대로 두면 «없다» 로 읽힌다 (F-54).
#[derive(serde::Serialize)]
pub struct SearchXLogResult {
    pub xlogs: Vec<XLogPack>,
    /// 서버 상한. 못 읽었으면 기본값을 쓴다
    pub max: i32,
    /// 상한을 서버 설정에서 실제로 읽었는가. 아니면 `max` 는 추측이다
    pub max_known: bool,
    /// 상한에 닿았다 — **더 있었을 수 있다**
    pub truncated: bool,
}

/// 서버가 한 번에 돌려주는 검색 결과의 상한.
///
/// **찾기 전에 물어본다.** 창을 열자마자 «최대 500건» 이라고 적어 두려면 그 500 이
/// 어디서 온 값인지 알아야 한다 — 안 물어보고 기본값을 단정하면, 서버가 상한을
/// 올려 뒀을 때 화면이 거짓말을 한다.
#[derive(serde::Serialize)]
pub struct SearchMax {
    pub max: i32,
    /// 서버 설정에서 실제로 읽었는가. 아니면 기본값을 쓴 것이다
    pub known: bool,
}

#[tauri::command]
pub async fn get_search_max(state: State<'_, AppState>) -> Result<SearchMax, String> {
    let found = request_map(&state, CMD_GET_CONFIGURE_SERVER, MapPack::new())
        .await
        .ok()
        .flatten()
        .map(|m| parse_config_text(&m))
        .as_deref()
        .and_then(parse_search_max);
    Ok(SearchMax { max: found.unwrap_or(DEFAULT_SEARCH_MAX), known: found.is_some() })
}

/// 넓은 구간에서 조건으로 XLog 찾기 (SEARCH_XLOG_LIST).
///
/// 스캐터 드래그를 대체하지 않는다. 좁은 구간은 다 받는 편이 낫다 —
/// 잘림이 없고 오브젝트를 여럿 다룬다. 이건 «넓은 구간에서 몇 건» 을 위한 입구다.
///
/// 상한은 서버 설정에서 읽어 온다. `req_search_xlog_max_count` 를 못 찾으면
/// 기본값(500)을 쓰되 `max_known=false` 로 «추측» 임을 알린다.
#[tauri::command]
pub async fn search_xlog_list(
    state: State<'_, AppState>,
    filter: SearchXLogFilter,
) -> Result<SearchXLogResult, String> {
    // 상한을 먼저 읽는다. 실패해도 검색은 한다 — 상한을 모른다고 못 찾을 이유는 없다.
    let max_from_server = request_map(&state, CMD_GET_CONFIGURE_SERVER, MapPack::new())
        .await
        .ok()
        .flatten()
        .map(|m| parse_config_text(&m))
        .as_deref()
        .and_then(parse_search_max);

    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;

    let param = build_search_xlog_param(&filter);
    let session = conn.session;
    conn.send_request(CMD_SEARCH_XLOG_LIST, session, &param)
        .map_err(|e| format!("XLog 검색 요청 실패: {e}"))?;

    let mut xlogs = Vec::new();
    loop {
        match conn.read_next_pack().map_err(|e| format!("XLog 검색 수신 실패: {e}"))? {
            Some(AnyPack::XLog(x)) => xlogs.push(x),
            Some(_) => {}
            None => break,
        }
    }

    let max = max_from_server.unwrap_or(DEFAULT_SEARCH_MAX);
    let truncated = xlogs.len() as i32 >= max;
    log::debug!(
        "search_xlog_list: {}건 (상한 {max}{}) truncated={truncated}",
        xlogs.len(),
        if max_from_server.is_some() { "" } else { ", 추측" }
    );
    Ok(SearchXLogResult { xlogs, max, max_known: max_from_server.is_some(), truncated })
}

/// 힙 히스토그램 — 클래스별 인스턴스 수와 점유 바이트.
///
/// 앱 컨테이너가 JDK 여야 한다 (JRE 는 `jdk.attach` 가 없어 빈 목록이 온다, F-25).
#[tauri::command]
pub async fn get_object_heap_histogram(
    state: State<'_, AppState>,
    obj_hash: i32,
) -> Result<Vec<HeapHistoRow>, String> {
    let map = request_object_map(&state, CMD_OBJECT_HEAPHISTO, obj_hash).await?;
    let rows = map.as_ref().map(parse_heap_histogram).unwrap_or_default();
    log::debug!("get_object_heap_histogram: objHash={obj_hash} → {}행", rows.len());
    Ok(rows)
}

/// 덤프를 **만든다**. 에이전트에 파일이 생기고 그 이름을 돌려준다.
///
/// 네 종류가 같은 응답 모양(`name` 하나)을 쓴다 (F-35).
/// 부수효과가 있는 명령이다 — 호출부가 사용자에게 확인을 받아야 한다.
#[tauri::command]
pub async fn trigger_dump(
    state: State<'_, AppState>,
    obj_hash: i32,
    kind: String,
) -> Result<String, String> {
    let cmd = match kind.as_str() {
        "threaddump" => CMD_TRIGGER_THREAD_DUMP,
        "activeservice" => CMD_TRIGGER_ACTIVE_SERVICE_LIST,
        "threadlist" => CMD_TRIGGER_THREAD_LIST,
        "heaphisto" => CMD_TRIGGER_HEAPHISTO,
        other => return Err(format!("알 수 없는 덤프 종류: {other}")),
    };

    let map = request_object_map(&state, cmd, obj_hash).await?;
    let name = map
        .as_ref()
        .and_then(|m| m.get_text("name"))
        .unwrap_or_default()
        .to_string();
    if name.is_empty() {
        // 간헐적으로 빈 응답이 온다 (F-35). 다시 누르면 되는 경우가 대부분이다.
        return Err("덤프 파일이 만들어지지 않았습니다. 잠시 후 다시 시도해 주세요".into());
    }
    log::debug!("trigger_dump({kind}): objHash={obj_hash} → {name}");
    Ok(name)
}

/// 응답을 기대하지 않는 명령. **보냈다는 것 말고는 확인할 방법이 없다.**
///
/// `OBJECT_SYSTEM_GC` / `OBJECT_RESET_CACHE` 는 성공/실패를 돌려주지 않는다 (F-35).
/// 그래도 스트림은 끝까지 비워야 다음 요청이 어긋나지 않는다.
async fn send_object_command(
    state: &State<'_, AppState>,
    cmd: &str,
    param: &MapPack,
) -> Result<(), String> {
    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;

    let session = conn.session;
    conn.send_request(cmd, session, param)
        .map_err(|e| format!("{cmd} 요청 실패: {e}"))?;

    while conn
        .read_next_pack()
        .map_err(|e| format!("{cmd} 응답 수신 실패: {e}"))?
        .is_some()
    {}
    Ok(())
}

/// 실행 중인 트랜잭션 한 건의 상세 — 스택 트레이스가 여기 있다.
///
/// **순간 상태다.** 목록에서 본 트랜잭션이 여는 사이에 끝나면 빈 응답이 온다.
/// 그건 오류가 아니라 "이미 끝났다"이므로 그대로 알려 준다 (F-46).
#[tauri::command]
pub async fn get_thread_detail(
    state: State<'_, AppState>,
    obj_hash: i32,
    thread_id: i64,
    // i64 를 JS 숫자로 넘기면 정밀도가 깨진다. XLog 쪽과 같이 문자열로 받는다.
    txid: String,
) -> Result<Option<ThreadDetail>, String> {
    let txid_i64: i64 = txid.parse().map_err(|_| format!("잘못된 txid: {txid}"))?;
    let map = request_map(
        &state,
        CMD_OBJECT_THREAD_DETAIL,
        build_thread_detail_param(obj_hash, thread_id, txid_i64),
    )
    .await?;

    // 스레드 이름조차 없으면 빈 껍데기다 — 그걸 상세라고 내놓으면 화면이 0으로 찬다.
    Ok(map
        .as_ref()
        .map(parse_thread_detail)
        .filter(|d| !d.thread_name.is_empty() || !d.stack_trace.is_empty()))
}

/// 모인 스택의 **시각 목록**.
///
/// 응답이 Pack 이 아니라 raw long 나열이라 `read_long_stream` 으로 읽는다 (F-45).
/// 오름차순으로 돌려준다 — 콜렉터가 순서를 보장하지 않고, ASIS 도 받아서 정렬한다.
#[tauri::command]
pub async fn get_stack_index(
    state: State<'_, AppState>,
    obj_name: String,
    from: i64,
    to: i64,
) -> Result<Vec<i64>, String> {
    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;

    let session = conn.session;
    conn.send_request(
        CMD_GET_STACK_INDEX,
        session,
        &build_stack_range_param(&obj_name, from, to),
    )
    .map_err(|e| format!("GET_STACK_INDEX 요청 실패: {e}"))?;

    let mut times = conn
        .read_long_stream()
        .map_err(|e| format!("GET_STACK_INDEX 수신 실패: {e}"))?;
    times.sort_unstable();
    log::debug!("get_stack_index: {} 건", times.len());
    Ok(times)
}

/// 스택 **한 장**의 원문.
///
/// **구간 전체를 한 번에 받지 않는다.** 실측에서 하루치가 124장 6.4MB 였다 —
/// 그대로 IPC 에 실으면 웹뷰가 멎는다(CLAUDE.md 3.3). ASIS `FetchSingleStackJob` 도
/// `from=time, to=time+1` 로 한 장씩 받는다.
#[tauri::command]
pub async fn get_stack_dump(
    state: State<'_, AppState>,
    obj_name: String,
    time: i64,
) -> Result<String, String> {
    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;

    let session = conn.session;
    conn.send_request(
        CMD_GET_STACK_ANALYZER,
        session,
        &build_stack_range_param(&obj_name, time, time + 1),
    )
    .map_err(|e| format!("GET_STACK_ANALYZER 요청 실패: {e}"))?;

    let mut out = String::new();
    while let Some(pack) = conn
        .read_next_pack()
        .map_err(|e| format!("GET_STACK_ANALYZER 수신 실패: {e}"))?
    {
        if let AnyPack::Stack(sp) = pack {
            out.push_str(&sp.stack);
        }
    }
    Ok(out)
}

/// 에이전트 JVM 에 Full GC 를 시킨다.
///
/// **운영에서는 응답이 잠깐 멈춘다.** 호출부가 확인을 받아야 한다.
/// 콜렉터가 성공 여부를 주지 않으므로(F-35) 화면은 "요청했다"까지만 말할 수 있다.
#[tauri::command]
pub async fn object_system_gc(state: State<'_, AppState>, obj_hash: i32) -> Result<(), String> {
    log::info!("object_system_gc: objHash={obj_hash}");
    send_object_command(&state, CMD_OBJECT_SYSTEM_GC, &build_object_param(obj_hash)).await
}

/// 에이전트의 텍스트 캐시를 비운다.
///
/// 해시→이름 사전이 어긋났을 때 쓴다. 다음 전송부터 이름이 다시 올라온다.
#[tauri::command]
pub async fn object_reset_cache(state: State<'_, AppState>, obj_hash: i32) -> Result<(), String> {
    log::info!("object_reset_cache: objHash={obj_hash}");
    send_object_command(&state, CMD_OBJECT_RESET_CACHE, &build_object_param(obj_hash)).await
}

/// 스택 샘플링 켜기/끄기.
///
/// 같은 명령으로 둘 다 한다 — `time` 이 있으면 켜기, 없으면 끄기 (F-35).
#[tauri::command]
pub async fn object_stack_sampling(
    state: State<'_, AppState>,
    obj_hash: i32,
    duration_ms: Option<i64>,
) -> Result<(), String> {
    log::info!("object_stack_sampling: objHash={obj_hash} duration={duration_ms:?}");
    send_object_command(&state, CMD_PSTACK_ON, &build_pstack_param(obj_hash, duration_ms)).await
}

/// 힙 덤프를 만든다.
///
/// **`fName`·`time` 을 빠뜨리면 조용히 빈 응답이 온다** (F-35).
/// 힙 크기만 한 파일이 에이전트 디스크에 생긴다 — 확인을 받아야 한다.
#[tauri::command]
pub async fn object_heap_dump(
    state: State<'_, AppState>,
    obj_hash: i32,
) -> Result<String, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let param = build_heap_dump_param(obj_hash, &obj_hash.to_string(), now);

    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;
    let session = conn.session;
    conn.send_request(CMD_OBJECT_CALL_HEAP_DUMP, session, &param)
        .map_err(|e| format!("힙 덤프 요청 실패: {e}"))?;

    let mut result: Option<MapPack> = None;
    while let Some(pack) = conn
        .read_next_pack()
        .map_err(|e| format!("힙 덤프 응답 수신 실패: {e}"))?
    {
        if let AnyPack::Map(m) = pack {
            result = Some(m);
        }
    }

    let map = result.ok_or("힙 덤프 응답이 없습니다 — fName/time 파라미터를 확인할 것")?;
    let msg = map.get_text("msg").unwrap_or("").to_string();
    let ok = matches!(map.entries.get("success"), Some(ScouterValue::Boolean(true)));
    if !ok {
        return Err(if msg.is_empty() { "힙 덤프 실패".into() } else { msg });
    }
    log::info!("object_heap_dump: objHash={obj_hash} → {msg}");
    Ok(msg)
}

/// 에이전트에 쌓인 덤프 파일 목록 (최신순)
#[tauri::command]
pub async fn get_dump_file_list(
    state: State<'_, AppState>,
    obj_hash: i32,
) -> Result<Vec<DumpFile>, String> {
    let map = request_object_map(&state, CMD_OBJECT_DUMP_FILE_LIST, obj_hash).await?;
    let files = map.as_ref().map(parse_dump_file_list).unwrap_or_default();
    log::debug!("get_dump_file_list: objHash={obj_hash} → {}건", files.len());
    Ok(files)
}

/// 덤프 파일 내용.
///
/// 이 응답만 **Pack 이 아니라 blob 청크 스트림**이라 `read_next_pack` 을 쓰면 안 된다 (F-26).
#[tauri::command]
pub async fn get_dump_file_content(
    state: State<'_, AppState>,
    obj_hash: i32,
    name: String,
) -> Result<String, String> {
    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;

    let param = build_dump_file_param(obj_hash, &name);
    let session = conn.session;
    conn.send_request(CMD_OBJECT_DUMP_FILE_DETAIL, session, &param)
        .map_err(|e| format!("덤프 내용 요청 실패: {e}"))?;

    let bytes = conn
        .read_blob_stream()
        .map_err(|e| format!("덤프 내용 수신 실패: {e}"))?;

    log::debug!("get_dump_file_content: {name} → {}바이트", bytes.len());
    // 덤프는 텍스트지만 잘린 멀티바이트가 섞일 수 있으므로 손실 변환을 쓴다.
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// 지금 돌고 있는 트랜잭션 목록
#[tauri::command]
pub async fn get_object_active_services(
    state: State<'_, AppState>,
    obj_hash: i32,
) -> Result<Vec<ActiveService>, String> {
    let map = request_object_map(&state, CMD_OBJECT_ACTIVE_SERVICE_LIST, obj_hash).await?;
    let list = map.as_ref().map(parse_active_services).unwrap_or_default();
    log::debug!("get_object_active_services: objHash={obj_hash} → {}건", list.len());
    Ok(list)
}

/// 에이전트 JVM 이 로드한 클래스 목록 (페이지 단위).
///
/// 총 17,000개가 넘어 한 번에 오지 않는다. `total_page` 를 보고 호출부가 넘긴다.
#[tauri::command]
pub async fn get_object_class_list(
    state: State<'_, AppState>,
    obj_hash: i32,
    page: i32,
) -> Result<ClassListPage, String> {
    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;

    let param = build_class_list_param(obj_hash, page);
    let session = conn.session;
    conn.send_request(CMD_OBJECT_CLASS_LIST, session, &param)
        .map_err(|e| format!("클래스 목록 요청 실패: {e}"))?;

    let mut found = None;
    loop {
        match conn.read_next_pack().map_err(|e| format!("클래스 목록 응답 수신 실패: {e}"))? {
            Some(AnyPack::Map(m)) => {
                if found.is_none() {
                    found = Some(m);
                }
            }
            Some(_) => {}
            None => break,
        }
    }

    let page_data = found.as_ref().map(parse_class_list).unwrap_or(ClassListPage {
        page,
        total_page: 1,
        classes: Vec::new(),
    });
    log::debug!(
        "get_object_class_list: objHash={obj_hash} page={}/{} → {}건",
        page_data.page,
        page_data.total_page,
        page_data.classes.len()
    );
    Ok(page_data)
}

// ─── get_xlog_profile ────────────────────────────────────────

/// txid에 해당하는 XLog 프로파일 (SQL/API/메서드 Step 목록) 조회
/// txid: i64를 string으로 전달 (JS Number.MAX_SAFE_INTEGER 초과 방지)
/// date: "yyyyMMdd" 형식 (endTime에서 추출)
#[tauri::command]
pub async fn get_xlog_profile(
    txid: String,
    date: String,
    obj_hash: i32,
    state: State<'_, AppState>,
) -> Result<XLogProfilePack, String> {
    let txid_i64: i64 = txid.parse().map_err(|_| format!("잘못된 txid: {txid}"))?;
    log::debug!("get_xlog_profile: txid={txid_i64}, date={date}");

    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;

    let mut param = MapPack::new();
    param.put("txid", ScouterValue::Decimal(txid_i64));
    param.put("date", ScouterValue::Text(date));
    param.put("objHash", ScouterValue::Decimal(obj_hash as i64));

    let session = conn.session;
    conn.send_request(CMD_TRANX_PROFILE, session, &param)
        .map_err(|e| format!("프로파일 요청 실패: {e}"))?;

    // **응답의 txid 로 거르면 안 된다.** 콜렉터는 프로파일 blob 만 채우고
    // time / objHash / service / txid 는 전부 0으로 보낸다 (N-16, live_profile_pack_header_is_empty).
    // 요청 자체가 txid 단위라 응답도 그 txid 것이 맞다.
    // ASIS ProfileConsumer.retrieveProfilePack() 도 검사하지 않는다.
    let mut profile: Option<XLogProfilePack> = None;
    loop {
        match conn.read_next_pack().map_err(|e| format!("프로파일 응답 수신 실패: {e}"))? {
            Some(AnyPack::Profile(p)) => {
                if let Some(existing) = profile.as_mut() {
                    // XLogProfilePack2 분할 전송: step 합산
                    existing.steps.extend(p.steps);
                } else {
                    let mut pack = *p;
                    // 응답에 없는 값이라 요청 값으로 채워준다.
                    pack.txid = txid_i64;
                    pack.obj_hash = obj_hash;
                    profile = Some(pack);
                }
            }
            Some(_) => {}
            None => break,
        }
    }

    profile.ok_or_else(|| format!("프로파일 없음: txid={txid_i64}"))
}

// ─── search_profiles ─────────────────────────────────────────

/// 검색 대상 한 건.
#[derive(Clone, serde::Deserialize)]
pub struct SearchTarget {
    /// i64 를 JS 숫자로 넘기면 정밀도가 깨진다
    pub txid: String,
    pub obj_hash: i32,
    /// "yyyyMMdd" — endTime 에서 뽑은 값
    pub date: String,
}

/// 걸린 트랜잭션 하나.
#[derive(serde::Serialize)]
pub struct ProfileHit {
    pub txid: String,
    /// 이 트랜잭션에서 걸린 스텝 수
    pub count: usize,
    /// 처음 걸린 스텝
    pub first: crate::scouter::profile_search::StepHit,
}

/// 검색 한 묶음의 결과.
#[derive(serde::Serialize)]
pub struct SearchBatch {
    pub hits: Vec<ProfileHit>,
    /// 프로파일을 못 가져온 건수. 조용히 빼면 "안 걸렸다"와 구별되지 않는다
    pub failed: usize,
}

/// 프로파일 본문에서 텍스트를 찾는다.
///
/// **한 번에 다 넘기지 않는다.** 트랜잭션 한 건이 요청 하나라 수백 건이면 몇 초가 걸리고,
/// 그동안 커넥션이 잠긴다. 화면이 묶음으로 잘라 부르며 진행률을 보이고 중간에 멈출 수 있게 한다.
///
/// 프로파일 자체는 돌려주지 않는다 — 실측에서 한 건이 수십 KB 다 (CLAUDE.md 3.3).
#[tauri::command]
pub async fn search_profiles(
    state: State<'_, AppState>,
    targets: Vec<SearchTarget>,
    query: String,
) -> Result<SearchBatch, String> {
    use crate::scouter::profile_search::{collect_hashes, search_steps, StepHashes, StepTexts};

    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(SearchBatch { hits: Vec::new(), failed: 0 });
    }

    // 접속 정보만 잠깐 빌린다. **훑는 동안 커넥션을 쥐고 있지 않는다** —
    // 예전에는 검색이 끝날 때까지 상세 열기가 뒤에서 기다렸다.
    let session = {
        let guard = state.connection.lock().await;
        guard.as_ref().ok_or("연결되지 않음")?.session
    };
    let host = state.conn_host.lock().await.clone();
    let port = *state.conn_port.lock().await;

    // 1) 프로파일은 워커 여러 개로 나눠 받는다. 여기가 검색 시간의 거의 전부다.
    let fetch_targets = targets.clone();
    let fetched = tokio::task::spawn_blocking(move || {
        fetch_profiles_parallel(&host, port, session, &fetch_targets, SEARCH_WORKERS)
    })
    .await
    .map_err(|e| format!("검색 작업 실패: {e}"))?;

    let failed = fetched.iter().filter(|f| f.is_none()).count();

    // 2) 사전은 **한 번에 모아** 푼다. 프로파일마다 묻던 것을 묶으면 왕복이 크게 준다.
    //    종류를 섞으면 에러 없이 빈 결과가 온다 (F-15).
    let mut want = StepHashes::default();
    for steps in fetched.iter().flatten() {
        let h = collect_hashes(steps);
        want.method.extend(h.method);
        want.sql.extend(h.sql);
        want.apicall.extend(h.apicall);
        want.error.extend(h.error);
        want.hmsg.extend(h.hmsg);
    }
    for list in [
        &mut want.method,
        &mut want.sql,
        &mut want.apicall,
        &mut want.error,
        &mut want.hmsg,
    ] {
        list.sort_unstable();
        list.dedup();
    }

    {
        let mut conn_guard = state.connection.lock().await;
        let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;
        let mut cache = state.text_cache.lock().await;
        for (key, list) in [
            (text_type::METHOD, &want.method),
            (text_type::SQL, &want.sql),
            (text_type::APICALL, &want.apicall),
            (text_type::ERROR, &want.error),
            (text_type::HASH_MSG, &want.hmsg),
        ] {
            let missing = cache.missing(key, list);
            if !missing.is_empty() {
                // 사전 조회가 실패해도 검색은 이어간다 — 푼 만큼은 찾을 수 있다.
                let _ = fetch_texts(conn, &mut cache, key, &missing);
            }
        }
    }

    // 3) 맞춰 보는 데는 네트워크가 필요 없다. 사전만 읽으면 된다.
    let cache = state.text_cache.lock().await;
    let mf = |x: i32| cache.get(text_type::METHOD, x).map(|s| s.to_string());
    let sf = |x: i32| cache.get(text_type::SQL, x).map(|s| s.to_string());
    let af = |x: i32| cache.get(text_type::APICALL, x).map(|s| s.to_string());
    let ef = |x: i32| cache.get(text_type::ERROR, x).map(|s| s.to_string());
    let hf = |x: i32| cache.get(text_type::HASH_MSG, x).map(|s| s.to_string());
    let texts = StepTexts { method: &mf, sql: &sf, apicall: &af, error: &ef, hmsg: &hf };

    // 순서는 targets 그대로다 — 화면이 목록 순서로 결과를 쌓는다.
    let mut hits = Vec::new();
    for (t, steps) in targets.iter().zip(fetched.iter()) {
        let Some(steps) = steps else { continue };
        let found = search_steps(steps, &texts, &needle);
        if let Some(first) = found.first() {
            hits.push(ProfileHit {
                txid: t.txid.clone(),
                count: found.len(),
                first: first.clone(),
            });
        }
    }

    log::debug!(
        "search_profiles: {}건 중 {}건 적중, {}건 실패",
        targets.len(),
        hits.len(),
        failed
    );
    Ok(SearchBatch { hits, failed })
}

/// 검색이 동시에 여는 커넥션 수.
///
/// 요청마다 소켓을 새로 여는 구조(F-1)라 **동시에 보내면 그만큼 빨라진다.**
/// 실측(`probe_search_throughput`): 순차 4.0ms/건, 워커 8에서 1.0ms/건(3.9배),
/// 워커 16에서 0.8ms/건(5.3배). 16이 조금 더 빠르지만 그만큼 콜렉터의
/// 동시 연결을 쓴다 — 운영 서버를 생각해 8로 둔다.
pub const SEARCH_WORKERS: usize = 8;

/// 프로파일을 워커 여러 개로 나눠 받는다. **결과는 `targets` 순서 그대로**다.
///
/// 순서가 어긋나면 엉뚱한 트랜잭션이 적중으로 표시되므로 자리를 들고 다닌다.
/// 세션은 소켓과 무관하게 재사용되므로(F-1) 워커마다 다시 로그인하지 않는다.
///
/// 한 건이 실패해도 그 자리만 `None` 이다 — 지워진 트랜잭션이 섞이는 건 정상이고,
/// 그때마다 검색이 멈추면 쓸 수가 없다.
pub fn fetch_profiles_parallel(
    host: &str,
    port: u16,
    session: i64,
    targets: &[SearchTarget],
    workers: usize,
) -> Vec<Option<Vec<crate::scouter::profile::ProfileStep>>> {
    let mut out: Vec<Option<Vec<crate::scouter::profile::ProfileStep>>> =
        targets.iter().map(|_| None).collect();
    if targets.is_empty() {
        return out;
    }
    let workers = workers.clamp(1, targets.len());

    let collected: Vec<(usize, Option<Vec<crate::scouter::profile::ProfileStep>>)> =
        std::thread::scope(|scope| {
            let handles: Vec<_> = (0..workers)
                .map(|w| {
                    // 라운드로빈으로 나눈다 — 무거운 트랜잭션이 앞쪽에 몰려 있어도
                    // 한 워커만 오래 붙잡히지 않는다.
                    let part: Vec<(usize, &SearchTarget)> =
                        targets.iter().enumerate().skip(w).step_by(workers).collect();
                    scope.spawn(move || {
                        let mut conn = match ScouterConnection::connect(host, port) {
                            Ok(c) => c,
                            // 연결 자체가 안 되면 이 몫은 전부 실패로 남는다
                            Err(_) => {
                                return part.into_iter().map(|(i, _)| (i, None)).collect::<Vec<_>>()
                            }
                        };
                        conn.session = session;
                        part.into_iter()
                            .map(|(i, t)| {
                                let steps = t.txid.parse::<i64>().ok().and_then(|txid| {
                                    fetch_profile_steps(&mut conn, txid, &t.date, t.obj_hash).ok()
                                });
                                (i, steps)
                            })
                            .collect()
                    })
                })
                .collect();
            handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
        });

    for (i, steps) in collected {
        out[i] = steps;
    }
    out
}

/// 프로파일 스텝만 꺼낸다 (검색용).
///
/// `get_xlog_profile` 과 같은 요청이지만 **커넥션을 이미 쥔 채** 부른다 —
/// 검색은 수백 번 반복하므로 매번 락을 잡았다 놓으면 그 사이 다른 요청이 끼어든다.
fn fetch_profile_steps(
    conn: &mut crate::scouter::connection::ScouterConnection,
    txid: i64,
    date: &str,
    obj_hash: i32,
) -> Result<Vec<crate::scouter::profile::ProfileStep>, String> {
    let mut param = MapPack::new();
    param.put("txid", ScouterValue::Decimal(txid));
    param.put("date", ScouterValue::Text(date.to_string()));
    param.put("objHash", ScouterValue::Decimal(obj_hash as i64));

    let session = conn.session;
    conn.send_request(CMD_TRANX_PROFILE, session, &param)
        .map_err(|e| format!("프로파일 요청 실패: {e}"))?;

    let mut steps = Vec::new();
    loop {
        match conn.read_next_pack().map_err(|e| format!("프로파일 응답 수신 실패: {e}"))? {
            // 분할 전송이면 이어 붙인다.
            Some(AnyPack::Profile(p)) => steps.extend(p.steps),
            Some(_) => {}
            None => break,
        }
    }
    Ok(steps)
}

/// 상한 없는 프로파일.
///
/// `TRANX_PROFILE` 과 달리 콜렉터가 `max=-1` 로 읽어 **자르지 않는다.**
/// 실측 환경(스텝 202개)에서는 둘의 결과가 같지만, 긴 트랜잭션에서 갈린다.
///
/// 응답이 Pack 이 아니라 `[3][blob]` 청크 스트림이라 `read_next_pack` 으로 읽으면
/// 첫 바이트를 PackType 으로 오해해 멈춘다 (F-26 과 같은 함정).
#[tauri::command]
pub async fn get_xlog_full_profile(
    state: State<'_, AppState>,
    txid: String,
    date: String,
    obj_hash: i32,
) -> Result<XLogProfilePack, String> {
    let txid_i64: i64 = txid.parse().map_err(|_| format!("잘못된 txid: {txid}"))?;

    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;

    let param = build_full_profile_param(&date, txid_i64);
    let session = conn.session;
    conn.send_request(CMD_TRANX_PROFILE_FULL, session, &param)
        .map_err(|e| format!("전체 프로파일 요청 실패: {e}"))?;

    let blob = conn
        .read_blob_stream()
        .map_err(|e| format!("전체 프로파일 수신 실패: {e}"))?;
    let steps = parse_profile_steps(blob);

    log::debug!("get_xlog_full_profile: txid={txid_i64} → 스텝 {}개", steps.len());
    // 응답에 헤더가 없다. 요청 값으로 채운다 (N-16 과 같은 이유).
    Ok(XLogProfilePack { txid: txid_i64, obj_hash, steps })
}

// ─── get_xlog_detail ─────────────────────────────────────────

/// txid로 단건 XLog 상세 조회
#[tauri::command]
pub async fn get_xlog_detail(
    txid: String,
    date: String,
    state: State<'_, AppState>,
) -> Result<XLogPack, String> {
    let txid_i64: i64 = txid.parse().map_err(|_| format!("잘못된 txid: {txid}"))?;
    log::debug!("get_xlog_detail: txid={txid_i64}, date={date}");

    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;

    let mut param = MapPack::new();
    param.put("txid", ScouterValue::Decimal(txid_i64));
    param.put("date", ScouterValue::Text(date));

    let session = conn.session;
    conn.send_request(CMD_XLOG_READ_BY_TXID, session, &param)
        .map_err(|e| format!("XLog 상세 요청 실패: {e}"))?;

    let mut result: Option<XLogPack> = None;
    loop {
        match conn.read_next_pack().map_err(|e| format!("XLog 상세 응답 수신 실패: {e}"))? {
            Some(AnyPack::XLog(xlog)) => {
                result = Some(xlog);
            }
            Some(_) => {}
            None => break,
        }
    }

    result.ok_or_else(|| format!("XLog 없음: txid={txid_i64}"))
}

// ─── load_xlog_by_gxid ───────────────────────────────────────

/// 같은 분산 트랜잭션(gxid)에 속한 XLog 를 **전부** 가져온다.
///
/// 요청 하나가 여러 앱을 거치면 XLog 가 앱마다 따로 남는다.
/// 목록에서는 서로 남남으로 보이지만 `gxid` 가 같으면 한 요청이다.
///
/// `gxid` 는 i64 전 범위를 쓰므로 string 으로 주고받는다.
#[tauri::command]
pub async fn load_xlog_by_gxid(
    state: State<'_, AppState>,
    gxid: String,
    date: String,
) -> Result<Vec<XLogPack>, String> {
    let gxid_i64: i64 = gxid.parse().map_err(|_| format!("잘못된 gxid: {gxid}"))?;

    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;

    let param = build_gxid_param(&date, gxid_i64);
    let session = conn.session;
    conn.send_request(CMD_XLOG_READ_BY_GXID, session, &param)
        .map_err(|e| format!("연관 XLog 요청 실패: {e}"))?;

    let mut xlogs = Vec::new();
    loop {
        match conn.read_next_pack().map_err(|e| format!("연관 XLog 수신 실패: {e}"))? {
            Some(AnyPack::XLog(x)) => xlogs.push(x),
            Some(_) => {}
            None => break,
        }
    }

    log::debug!("load_xlog_by_gxid: gxid={gxid_i64} date={date} → {}건", xlogs.len());
    Ok(xlogs)
}

// ─── objType 단위 조회 ───────────────────────────────────────

/// objType 요청 1회. 응답은 MapPack 여러 개다.
async fn request_objtype_maps(
    state: &State<'_, AppState>,
    cmd: &str,
    param: &MapPack,
) -> Result<Vec<MapPack>, String> {
    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;

    let session = conn.session;
    conn.send_request(cmd, session, param)
        .map_err(|e| format!("{cmd} 요청 실패: {e}"))?;

    let mut out = Vec::new();
    loop {
        match conn.read_next_pack().map_err(|e| format!("{cmd} 수신 실패: {e}"))? {
            Some(AnyPack::Map(m)) => out.push(m),
            Some(_) => {}
            None => break,
        }
    }
    Ok(out)
}

/// 타입 전체의 액티브 서비스 합계와 TPS.
///
/// **합계만 보면 안 된다.** 10건이어도 전부 3초 이상이면 장애다.
/// 그래서 act1/act2/act3 을 나눠 둔다.
#[tauri::command]
pub async fn get_active_speed(
    state: State<'_, AppState>,
    obj_type: String,
) -> Result<ActiveSpeed, String> {
    let maps = request_objtype_maps(
        &state,
        CMD_ACTIVESPEED_REAL_TIME_GROUP,
        &build_objtype_param(&obj_type),
    )
    .await?;

    // 응답이 없으면 그 타입의 에이전트가 없는 것이다. 0으로 보여 주는 편이 낫다.
    Ok(maps.first().map(parse_active_speed).unwrap_or(ActiveSpeed {
        obj_hash: 0,
        act1: 0,
        act2: 0,
        act3: 0,
        tps: 0.0,
    }))
}

/// 서비스 그룹 실시간 (TPS / Elapsed).
///
/// **`objType` 이 아니라 `objHash` 목록으로 묻는다.** objType 으로 물으면
/// 에러 없이 0건이 온다 — 오래 "수집이 안 된다"로 오해했던 자리다 (F-44).
#[tauri::command]
pub async fn get_service_group(
    state: State<'_, AppState>,
    obj_hashes: Vec<i32>,
) -> Result<Vec<ServiceGroupRow>, String> {
    if obj_hashes.is_empty() {
        return Ok(Vec::new());
    }
    let maps = request_objtype_maps(
        &state,
        CMD_REALTIME_SERVICE_GROUP,
        &build_service_group_param(&obj_hashes),
    )
    .await?;

    // 응답은 MapPack 하나에 네 병렬 리스트다. 여러 개가 와도 이어 붙인다.
    let rows: Vec<ServiceGroupRow> = maps.iter().flat_map(|m| parse_service_group(m)).collect();
    log::debug!("get_service_group: 그룹 {}개", rows.len());
    Ok(rows)
}

/// 오브젝트별 액티브 서비스 (Vertical EQ)
#[tauri::command]
pub async fn get_active_speed_by_object(
    state: State<'_, AppState>,
    obj_type: String,
) -> Result<Vec<ActiveSpeed>, String> {
    let maps = request_objtype_maps(
        &state,
        CMD_ACTIVESPEED_REAL_TIME,
        &build_objtype_param(&obj_type),
    )
    .await?;
    Ok(maps.iter().map(parse_active_speed).collect())
}

/// 오늘 하루 누적 카운터. `date` 를 주면 그날 것.
#[tauri::command]
pub async fn get_today_counter(
    state: State<'_, AppState>,
    counter: String,
    obj_type: String,
    date: Option<String>,
) -> Result<Vec<CounterSeries>, String> {
    let (cmd, param) = match date.as_deref() {
        Some(d) => (
            CMD_COUNTER_PAST_DATE_ALL,
            build_past_date_counter_param(&counter, &obj_type, d),
        ),
        None => (
            CMD_COUNTER_TODAY_ALL,
            build_today_counter_param(&counter, &obj_type),
        ),
    };

    let maps = request_objtype_maps(&state, cmd, &param).await?;
    let series: Vec<CounterSeries> = maps.iter().map(parse_counter_series).collect();
    log::debug!(
        "get_today_counter: {counter}/{obj_type} → 오브젝트 {}개",
        series.len()
    );
    Ok(series)
}

/// 타입 전체의 액티브 서비스 (지금 돌고 있는 트랜잭션).
///
/// **요청 한 번으로 그 타입의 모든 오브젝트를 받는다** (F-34).
/// 오브젝트마다 따로 부르면 F-1(연결당 명령 1개) 때문에 연결이 오브젝트 수만큼 열린다.
#[tauri::command]
pub async fn get_type_active_services(
    state: State<'_, AppState>,
    obj_type: String,
) -> Result<TypeActiveServices, String> {
    let maps = request_objtype_maps(
        &state,
        CMD_OBJECT_ACTIVE_SERVICE_LIST,
        &build_active_service_param(&obj_type, None),
    )
    .await?;

    let mut rows = Vec::new();
    let mut incomplete = Vec::new();
    for m in &maps {
        if !is_complete(m) {
            incomplete.push(m.get_decimal("objHash").unwrap_or(0) as i32);
        }
        rows.extend(parse_active_services(m));
    }

    // 느린 것부터. 액티브 목록을 여는 이유는 "무엇이 안 끝나고 있나" 하나다.
    rows.sort_by(|a, b| b.elapsed.cmp(&a.elapsed));

    log::debug!(
        "get_type_active_services: {obj_type} → {}행 (미완 {}개)",
        rows.len(),
        incomplete.len()
    );
    Ok(TypeActiveServices { rows, incomplete })
}

/// 오늘 방문자 수.
///
/// **응답이 Pack 이 아니라 Value 하나다** (F-32).
#[tauri::command]
pub async fn get_today_visitor(
    state: State<'_, AppState>,
    obj_type: String,
) -> Result<i64, String> {
    let mut conn_guard = state.connection.lock().await;
    let conn = conn_guard.as_mut().ok_or("연결되지 않음")?;

    let param = build_objtype_param(&obj_type);
    let session = conn.session;
    conn.send_request(CMD_VISITOR_REALTIME_TOTAL, session, &param)
        .map_err(|e| format!("방문자 수 요청 실패: {e}"))?;

    let v = conn
        .read_single_value()
        .map_err(|e| format!("방문자 수 수신 실패: {e}"))?;
    Ok(v.and_then(|v| v.as_decimal()).unwrap_or(0))
}

// ─── start_counter_stream ────────────────────────────────────

/// 실시간 성능 카운터 스트리밍 시작 (2초 폴링, 별도 connection으로 spawn)
///
/// Collector 는 카운터 1개당 요청 1회를 받는다 (verified-facts.md F-15).
/// `counters` 는 counters.xml 표기 그대로여야 한다 (`TPS`, `Cpu`, `HeapUsed` …).
#[tauri::command]
pub async fn start_counter_stream(
    obj_hashes: Vec<i32>,
    counters: Vec<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!(
        "start_counter_stream: 오브젝트 {}개, 카운터 {}개",
        obj_hashes.len(),
        counters.len()
    );

    let host = state.conn_host.lock().await.clone();
    let port = *state.conn_port.lock().await;
    let user = state.conn_user.lock().await.clone();
    let pass = state.conn_pass.lock().await.clone();
    let stop_flag = state.streams.take_token(StreamKind::Counter).await;

    tokio::spawn(async move {
        let mut conn = match ScouterConnection::connect(&host, port) {
            Ok(c) => c,
            Err(e) => { log::error!("카운터 스트림 연결 실패: {e}"); return; }
        };
        if let Err(e) = conn.login(&user, &pass) {
            log::error!("카운터 스트림 로그인 실패: {e}"); return;
        }
        run_counter_stream(&mut conn, obj_hashes, counters, app, stop_flag).await;
    });

    Ok(())
}

/// 카운터 폴링 루프 (2초 주기)
///
/// 카운터당 요청 1회가 아니라 **MULTI 로 한 번에** 받는다.
/// F-1(연결당 명령 1개) 때문에 요청 수가 곧 TCP 연결 수다.
async fn run_counter_stream(
    conn: &mut ScouterConnection,
    obj_hashes: Vec<i32>,
    counters: Vec<String>,
    app: AppHandle,
    stop_flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    let refs: Vec<&str> = counters.iter().map(|s| s.as_str()).collect();
    while !stop_flag.load(Ordering::Relaxed) {
        if let Err(e) = poll_counter_once(conn, &obj_hashes, &refs, &app) {
            log::warn!("카운터 폴링 오류: {e}");
            let _ = app.emit("counter-error", serde_json::json!({ "message": e.to_string() }));
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(2000)).await;
    }
    log::info!("카운터 스트리밍 종료");
}

/// MULTI 로 전체 카운터를 조회해 **카운터별로** `counter-data` 이벤트를 낸다.
///
/// 프론트의 차트가 카운터 단위라 페이로드도 카운터 단위로 쪼갠다.
fn poll_counter_once(
    conn: &mut ScouterConnection,
    obj_hashes: &[i32],
    counters: &[&str],
    app: &AppHandle,
) -> std::io::Result<()> {
    let param = build_counter_multi_param(obj_hashes, counters);
    let session = conn.session;
    conn.send_request(CMD_COUNTER_REAL_TIME_ALL_MULTI, session, &param)?;

    let mut rows = Vec::new();
    while let Some(pack) = conn.read_next_pack()? {
        if let AnyPack::Map(map) = pack {
            rows = parse_counter_multi(&map);
        }
    }

    if rows.is_empty() {
        log::debug!("카운터: 값 없음");
        return Ok(());
    }

    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    // 카운터별로 묶는다. 순서는 유지할 필요가 없다.
    let mut grouped: HashMap<String, Vec<CounterValue>> = HashMap::new();
    for r in rows {
        grouped
            .entry(r.counter)
            .or_default()
            .push(CounterValue { obj_hash: r.obj_hash, value: r.value, total: r.total });
    }

    log::debug!("카운터 {}종 emit", grouped.len());
    for (counter, values) in grouped {
        let _ = app.emit("counter-data", CounterUpdate { time, counter, values });
    }
    Ok(())
}

// ─── start_alert_stream ──────────────────────────────────────

/// 실시간 알림 스트리밍 시작 (2초 폴링, 별도 connection으로 spawn)
#[tauri::command]
pub async fn start_alert_stream(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("start_alert_stream 시작");

    let host = state.conn_host.lock().await.clone();
    let port = *state.conn_port.lock().await;
    let user = state.conn_user.lock().await.clone();
    let pass = state.conn_pass.lock().await.clone();
    let stop_flag = state.streams.take_token(StreamKind::Alert).await;

    tokio::spawn(async move {
        let mut conn = match ScouterConnection::connect(&host, port) {
            Ok(c) => c,
            Err(e) => { log::error!("알림 스트림 연결 실패: {e}"); return; }
        };
        if let Err(e) = conn.login(&user, &pass) {
            log::error!("알림 스트림 로그인 실패: {e}"); return;
        }
        run_alert_stream(&mut conn, app, stop_flag).await;
    });

    Ok(())
}

async fn run_alert_stream(
    conn: &mut ScouterConnection,
    app: AppHandle,
    stop_flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    // 커서를 안 들고 있으면 폴링마다 같은 알람이 다시 온다 (N-9).
    let mut cursor = StreamCursor::default();
    while !stop_flag.load(Ordering::Relaxed) {
        let result = poll_alert_once(conn, &mut cursor, &app);
        if let Err(e) = result {
            log::warn!("알림 폴링 오류: {e}");
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(2000)).await;
    }
    log::info!("알림 스트리밍 종료");
}

fn poll_alert_once(
    conn: &mut ScouterConnection,
    cursor: &mut StreamCursor,
    app: &AppHandle,
) -> std::io::Result<()> {
    let param = build_alert_param(cursor);
    let session = conn.session;
    conn.send_request(CMD_ALERT_REAL_TIME, session, &param)?;

    loop {
        match conn.read_next_pack()? {
            Some(AnyPack::Alert(alert)) => {
                log::debug!("알림 수신: level={}, title={}", alert.level, alert.title);
                let _ = app.emit("alert-data", alert);
            }
            Some(AnyPack::Map(map)) => cursor.update_from(&map),
            Some(_) => {}
            None => break,
        }
    }

    Ok(())
}

// ─── set_log_level ────────────────────────────────────────────

/// 런타임 로그 레벨 변경
/// level_str: "error" | "warn" | "info" | "debug" | "trace"
#[tauri::command]
pub async fn set_log_level(
    level_str: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (filter, level_u8) = match level_str.as_str() {
        "trace" => (log::LevelFilter::Trace, 4u8),
        "debug" => (log::LevelFilter::Debug, 3u8),
        "info"  => (log::LevelFilter::Info,  2u8),
        "warn"  => (log::LevelFilter::Warn,  1u8),
        _       => (log::LevelFilter::Error, 0u8),
    };

    log::set_max_level(filter);
    state.log_level.store(level_u8, Ordering::Relaxed);
    log::info!("로그 레벨 변경: {level_str}");
    Ok(())
}

// ─── start_mock_stream ───────────────────────────────────────

/// Demo Mode 의 서버 이름. 화면 어디서든 **진짜 콜렉터가 아님**이 드러나야 한다.
pub const DEMO_SERVER_ID: &str = "DEMO (합성 데이터)";

/// Demo Mode: 실제 Collector 없이 합성 XLog 데이터를 "xlog-data" 이벤트로 emit
/// 500ms마다 다양한 elapsed 분포의 XLogPack 생성
#[tauri::command]
pub async fn start_mock_stream(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let stop_flag = state.streams.take_token(StreamKind::XLog).await;

    log::info!("Demo Mode 스트림 시작");

    // **접속 상태를 알리지 않으면 데이터만 흐르고 화면은 "연결되지 않음" 으로 남는다.**
    // 접속 폼이 그대로 떠 있고 차트는 유휴 상태로 그려져, 콜렉터 없이 화면을 보려고
    // 만든 버튼이 정작 아무것도 보여주지 못한다. 화면의 연결 상태는 Rust 가 쥐고 있으므로
    // 여기서 알려야 한다.
    let _ = app.emit("scouter-connected", DEMO_SERVER_ID);

    tokio::spawn(async move {
        let mut seq: u64 = 0;
        while !stop_flag.load(Ordering::Relaxed) {
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64;

            let xlog = build_mock_xlog(now_ms, seq);
            log::trace!("Demo XLog emit: seq={seq}, elapsed={}", xlog.elapsed);
            seq += 1;

            let _ = app.emit("xlog-data", xlog);
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
        log::info!("Demo Mode 스트림 종료");
    });

    Ok(())
}

/// Demo용 합성 XLogPack 생성
fn build_mock_xlog(now_ms: i64, seq: u64) -> XLogPack {
    let base_elapsed = [50i32, 80, 120, 200, 350, 700, 1500, 3000, 6000];
    let elapsed = base_elapsed[(seq as usize) % base_elapsed.len()];
    let has_error = seq % 20 == 0;

    XLogPack {
        end_time: now_ms,
        obj_hash: 0x1001 + ((seq % 3) as i32),
        service: 0x5678 + (seq % 10) as i32,
        txid: (seq as i64) * 1000 + 1,
        caller: 0,
        gxid: (seq as i64) * 1000 + 1,
        elapsed,
        error: if has_error { 1 } else { 0 },
        cpu: elapsed / 10,
        sql_count: (seq % 5) as i32,
        sql_time: ((seq % 5) * 20) as i32,
        ipaddr: format!("192.168.1.{}", (seq % 254) + 1),
        kbytes: ((seq % 100) * 10) as i32,
        status: 200,
        userid: 0,
        user_agent: 0,
        referer: 0,
        group: 0,
        apicall_count: (seq % 3) as i32,
        apicall_time: ((seq % 3) * 50) as i32,
        country_code: String::new(),
        city: 0,
        x_type: 0,
        login: 0,
        desc: 0,
        web_hash: 0,
        web_time: 0,
        has_dump: 0,
        thread_name_hash: 0,
        text1: String::new(),
        text2: String::new(),
        queuing_host_hash: 0,
        queuing_time: 0,
        queuing2nd_host_hash: 0,
        queuing2nd_time: 0,
        text3: String::new(),
        text4: String::new(),
        text5: String::new(),
        profile_count: 0,
        b3_mode: false,
        profile_size: 0,
        discard_type: 0,
        ignore_global_consequent_sampling: false,
    }
}

// ─── get_config / save_config ─────────────────────────────────

/// 현재 앱 설정 반환
#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config.lock().await.clone())
}

/// 화면 배치와 차트 설정만 갈아 끼운다.
///
/// **설정 전체를 덮어쓰지 않는 이유:** 이 저장은 패널을 끌 때마다 일어난다.
/// 화면에서 `get_config` → 고쳐서 → `save_config` 로 하면, 그 사이에 설정 창이
/// 저장한 값(예: 방금 바꾼 언어)을 오래된 사본이 되돌린다. 병합을 여기서 한다.
#[tauri::command]
pub async fn save_ui_state(
    layout: crate::config::UiLayout,
    chart: crate::config::XLogChartPrefs,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = state.config_path.clone();
    let mut cfg = state.config.lock().await;
    cfg.ui_layout = layout;
    cfg.xlog_chart = chart;
    cfg.save(&path)
}

/// 앱 설정 저장 (config.json에 기록)
#[tauri::command]
pub async fn save_config(
    new_config: AppConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = state.config_path.clone();
    new_config.save(&path)?;
    *state.config.lock().await = new_config;
    log::info!("config.json 저장 완료: {}", path.display());
    Ok(())
}
