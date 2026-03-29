// src-tauri/src/commands.rs
// Tauri Command 정의
// 참조: docs/plans/tauri-backend-scouter-client.md

use std::collections::HashMap;
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, State};

use crate::config::AppConfig;
use crate::scouter::connection::ScouterConnection;
use crate::scouter::dictionary::fetch_texts;
use crate::scouter::pack::{AnyPack, MapPack, ObjectPack, XLogPack};
use crate::scouter::profile::XLogProfilePack;
use crate::scouter::protocol::*;
use crate::scouter::streaming::run_xlog_stream;
use crate::scouter::value::ScouterValue;
use crate::state::AppState;

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
    *state.conn_pass.lock().await = pass;

    // 마지막 접속 정보를 config에 자동 저장
    {
        let config_path = state.config_path.clone();
        let mut cfg = state.config.lock().await;
        cfg.last_host = Some(host);
        cfg.last_port = Some(port);
        cfg.last_user = Some(user);
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
    state.stream_stop.store(true, Ordering::Relaxed);
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
    state.stream_stop.store(false, Ordering::Relaxed);

    let host = state.conn_host.lock().await.clone();
    let port = *state.conn_port.lock().await;
    let user = state.conn_user.lock().await.clone();
    let pass = state.conn_pass.lock().await.clone();

    let stop_flag = state.stream_stop.clone();
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
    state.stream_stop.store(true, Ordering::Relaxed);
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
    conn.send_request(CMD_GET_OBJECT_LIST_REAL_TIME, session, &param)
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

    let mut profile: Option<XLogProfilePack> = None;
    loop {
        match conn.read_next_pack().map_err(|e| format!("프로파일 응답 수신 실패: {e}"))? {
            Some(AnyPack::Profile(p)) => {
                if p.txid == txid_i64 {
                    if let Some(existing) = profile.as_mut() {
                        // XLogProfilePack2 분할 전송: step 합산
                        existing.steps.extend(p.steps);
                    } else {
                        profile = Some(*p);
                    }
                }
            }
            Some(_) => {}
            None => break,
        }
    }

    profile.ok_or_else(|| format!("프로파일 없음: txid={txid_i64}"))
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

// ─── start_counter_stream ────────────────────────────────────

/// 실시간 성능 카운터 스트리밍 시작 (2초 폴링, 별도 connection으로 spawn)
#[tauri::command]
pub async fn start_counter_stream(
    obj_hashes: Vec<i32>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("start_counter_stream: {} 오브젝트", obj_hashes.len());

    let host = state.conn_host.lock().await.clone();
    let port = *state.conn_port.lock().await;
    let user = state.conn_user.lock().await.clone();
    let pass = state.conn_pass.lock().await.clone();
    let stop_flag = state.stream_stop.clone();

    tokio::spawn(async move {
        let mut conn = match ScouterConnection::connect(&host, port) {
            Ok(c) => c,
            Err(e) => { log::error!("카운터 스트림 연결 실패: {e}"); return; }
        };
        if let Err(e) = conn.login(&user, &pass) {
            log::error!("카운터 스트림 로그인 실패: {e}"); return;
        }
        run_counter_stream(&mut conn, obj_hashes, app, stop_flag).await;
    });

    Ok(())
}

/// 카운터 폴링 루프 (2초 주기)
async fn run_counter_stream(
    conn: &mut ScouterConnection,
    obj_hashes: Vec<i32>,
    app: AppHandle,
    stop_flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    while !stop_flag.load(Ordering::Relaxed) {
        let result = poll_counter_once(conn, &obj_hashes, &app);
        if let Err(e) = result {
            log::warn!("카운터 폴링 오류: {e}");
            let _ = app.emit("counter-error", serde_json::json!({ "message": e.to_string() }));
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(2000)).await;
    }
    log::info!("카운터 스트리밍 종료");
}

fn poll_counter_once(
    conn: &mut ScouterConnection,
    obj_hashes: &[i32],
    app: &AppHandle,
) -> std::io::Result<()> {
    let mut param = MapPack::new();
    let hash_list: Vec<ScouterValue> = obj_hashes
        .iter()
        .map(|h| ScouterValue::Decimal(*h as i64))
        .collect();
    param.put("objHash", ScouterValue::List(hash_list));

    let session = conn.session;
    conn.send_request(CMD_COUNTER_REAL_TIME_ALL, session, &param)?;

    loop {
        match conn.read_next_pack()? {
            Some(AnyPack::PerfCounter(counter)) => {
                log::trace!("카운터 수신: obj={}", counter.obj_name);
                let _ = app.emit("counter-data", counter);
            }
            Some(_) => {}
            None => break,
        }
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
    let stop_flag = state.stream_stop.clone();

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
    while !stop_flag.load(Ordering::Relaxed) {
        let result = poll_alert_once(conn, &app);
        if let Err(e) = result {
            log::warn!("알림 폴링 오류: {e}");
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(2000)).await;
    }
    log::info!("알림 스트리밍 종료");
}

fn poll_alert_once(conn: &mut ScouterConnection, app: &AppHandle) -> std::io::Result<()> {
    let param = MapPack::new();
    let session = conn.session;
    conn.send_request(CMD_ALERT_REAL_TIME, session, &param)?;

    loop {
        match conn.read_next_pack()? {
            Some(AnyPack::Alert(alert)) => {
                log::debug!("알림 수신: level={}, title={}", alert.level, alert.title);
                let _ = app.emit("alert-data", alert);
            }
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

/// Demo Mode: 실제 Collector 없이 합성 XLog 데이터를 "xlog-data" 이벤트로 emit
/// 500ms마다 다양한 elapsed 분포의 XLogPack 생성
#[tauri::command]
pub async fn start_mock_stream(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.stream_stop.store(false, Ordering::Relaxed);
    let stop_flag = state.stream_stop.clone();

    log::info!("Demo Mode 스트림 시작");

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
