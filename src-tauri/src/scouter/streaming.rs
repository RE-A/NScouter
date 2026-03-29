// src-tauri/src/scouter/streaming.rs
// TRANX_REAL_TIME_GROUP 실시간 XLog 스트리밍 루프
// 참조: docs/asis/14-collector-tcp-protocol.md 섹션 8

use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter};

use super::connection::ScouterConnection;
use super::pack::{AnyPack, MapPack};
use super::protocol::*;
use super::value::ScouterValue;

// ─── 스트리밍 커서 ────────────────────────────────────────────

#[derive(Debug, Clone, Default)]
pub struct StreamCursor {
    pub loop_val: i64,
    pub index: i64,
}

impl StreamCursor {
    /// 응답 MapPack에서 loop/index 업데이트
    pub fn update_from(&mut self, map: &MapPack) {
        if let Some(v) = map.get_decimal("loop") {
            self.loop_val = v;
        }
        if let Some(v) = map.get_decimal("index") {
            self.index = v;
        }
    }
}

// ─── Tauri 이벤트 페이로드 ───────────────────────────────────

/// "xlog-error" 이벤트 페이로드
#[derive(serde::Serialize, Clone)]
pub struct XLogErrorPayload {
    pub message: String,
}

// ─── 스트리밍 루프 ────────────────────────────────────────────

/// XLog 실시간 스트리밍 루프
/// - 최초: TRANX_REAL_TIME_GROUP_LATEST (loop=0, index=0)
/// - 이후: TRANX_REAL_TIME_GROUP (커서 업데이트)
/// - 수신된 XLogPack은 "xlog-data" Tauri 이벤트로 emit
pub async fn run_xlog_stream(
    conn: &mut ScouterConnection,
    obj_hashes: Vec<i32>,
    app: AppHandle,
    stop_flag: Arc<AtomicBool>,
) {
    log::info!("XLog 스트리밍 시작: {} 오브젝트", obj_hashes.len());
    let mut cursor = StreamCursor::default();
    let mut first = true;

    while !stop_flag.load(Ordering::Relaxed) {
        let result = poll_once(conn, &obj_hashes, &mut cursor, first, &app);
        first = false;

        match result {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
                // INVALID_SESSION: 재로그인 필요, 루프 종료
                log::error!("세션 만료로 스트리밍 중단: {e}");
                let _ = app.emit(
                    "xlog-error",
                    XLogErrorPayload {
                        message: format!("세션 만료: {e}"),
                    },
                );
                break;
            }
            Err(e) => {
                log::warn!("스트리밍 일시 오류, 1초 후 재시도: {e}");
                let _ = app.emit(
                    "xlog-error",
                    XLogErrorPayload {
                        message: format!("스트리밍 오류: {e}"),
                    },
                );
                tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
            }
        }

        // 폴링 간격 (500ms)
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }

    log::info!("XLog 스트리밍 종료");
}

/// 단일 폴링 요청/응답 처리
fn poll_once(
    conn: &mut ScouterConnection,
    obj_hashes: &[i32],
    cursor: &mut StreamCursor,
    is_first: bool,
    app: &AppHandle,
) -> io::Result<()> {
    let cmd = if is_first {
        CMD_TRANX_REAL_TIME_GROUP_LATEST
    } else {
        CMD_TRANX_REAL_TIME_GROUP
    };

    let param = build_request_param(obj_hashes, cursor);
    let session = conn.session;
    conn.send_request(cmd, session, &param)?;

    // 응답 스트림 수신 루프
    loop {
        match conn.read_next_pack()? {
            Some(AnyPack::Map(map)) => {
                cursor.update_from(&map);
            }
            Some(AnyPack::XLog(xlog)) => {
                log::trace!("XLog 수신: txid={}, elapsed={}ms", xlog.txid, xlog.elapsed);
                let _ = app.emit("xlog-data", xlog);
            }
            Some(AnyPack::Unknown(t)) => {
                log::trace!("알 수 없는 Pack 타입 무시: 0x{t:02X}");
            }
            Some(_) => {} // Object / Profile / PerfCounter / Alert → XLog 스트림에서 무시
            None => break, // FLAG_NO_NEXT: 스트림 종료
        }
    }

    Ok(())
}

fn build_request_param(obj_hashes: &[i32], cursor: &StreamCursor) -> MapPack {
    let mut param = MapPack::new();

    // objHash: ListValue of Decimal
    let hash_list: Vec<ScouterValue> = obj_hashes
        .iter()
        .map(|h| ScouterValue::Decimal(*h as i64))
        .collect();
    param.put("objHash", ScouterValue::List(hash_list));
    param.put("loop", ScouterValue::Decimal(cursor.loop_val));
    param.put("index", ScouterValue::Decimal(cursor.index));

    param
}
