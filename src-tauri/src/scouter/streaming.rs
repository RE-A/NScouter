// src-tauri/src/scouter/streaming.rs
// TRANX_REAL_TIME_GROUP 실시간 XLog 스트리밍 루프
// 참조: docs/asis/14-collector-tcp-protocol.md 섹션 8

use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

use super::connection::ScouterConnection;
use super::pack::{AnyPack, MapPack, XLogPack};
use super::protocol::*;
use super::value::ScouterValue;
use super::xlog_columns::XLogColumns;

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

/// 스트림 루프가 끝난 까닭
#[derive(Debug, PartialEq, Eq)]
pub enum StreamEnd {
    /// 멈추라고 했다 (새 스트림이 섰거나 고르기를 다 풀었다)
    Stopped,
    /// 연결이 망가졌다 — 새 연결로 다시 열어야 한다
    Broken,
}

/// XLog 실시간 스트리밍 루프
/// - 최초: TRANX_REAL_TIME_GROUP_LATEST (loop=0, index=0)
/// - 이후: TRANX_REAL_TIME_GROUP (커서 업데이트)
/// - 수신된 XLogPack은 "xlog-data" Tauri 이벤트로 emit
///
/// **오류가 나면 이 연결로는 더 묻지 않는다.** 예전에는 1초 쉬고 같은 연결로 다시 물었는데,
/// 콜렉터가 다시 뜨거나 네트워크가 한 번 끊기면 그 소켓은 영영 죽어 있어 오류만 계속 났다 —
/// 서버를 골라도 XLog 가 안 뜨는 상태가 앱을 다시 켤 때까지 갔다. 끝난 까닭을 돌려주고,
/// 다시 여는 것은 부르는 쪽(`restart_xlog_stream`)이 새 연결로 한다.
pub async fn run_xlog_stream(
    conn: &mut ScouterConnection,
    obj_hashes: Vec<i32>,
    app: AppHandle,
    stop_flag: Arc<AtomicBool>,
) -> StreamEnd {
    log::info!("XLog 스트리밍 시작: {} 오브젝트", obj_hashes.len());
    let mut cursor = StreamCursor::default();
    let mut first = true;

    while !stop_flag.load(Ordering::Relaxed) {
        let result = poll_once(conn, &obj_hashes, &mut cursor, first, &app);
        first = false;

        match result {
            Ok(()) => {}
            Err(e) => {
                // 세션 만료(INVALID_SESSION)도 소켓 오류도 같다 — 새로 붙어 다시 로그인한다
                let why = if e.kind() == io::ErrorKind::PermissionDenied { "세션 만료" } else { "스트리밍 오류" };
                log::warn!("{why} — 새 연결로 다시 엽니다: {e}");
                let _ = app.emit(
                    "xlog-error",
                    XLogErrorPayload {
                        message: format!("{why}: {e} — 다시 연결하는 중"),
                    },
                );
                return StreamEnd::Broken;
            }
        }

        // 폴링 간격 (500ms)
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }

    log::info!("XLog 스트리밍 종료");
    StreamEnd::Stopped
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

    // 한 폴링에서 받은 XLog 를 **모아서** 보낸다. 이유는 EMIT_CHUNK 주석 참고.
    let t_start = std::time::Instant::now();
    let mut batch: Vec<XLogPack> = Vec::new();
    let mut n_xlog: usize = 0;

    // 응답 스트림 수신 루프
    loop {
        match conn.read_next_pack()? {
            Some(AnyPack::Map(map)) => {
                cursor.update_from(&map);
            }
            Some(AnyPack::XLog(xlog)) => {
                n_xlog += 1;
                // 에러·느린 것은 프로파일을 미리 받아 둔다 (`cache::prefetch`) — 막히지 않는다
                if let Some(p) = app.try_state::<crate::cache::prefetch::Prefetcher>() {
                    p.offer(&xlog);
                }
                batch.push(xlog);
                if batch.len() >= EMIT_CHUNK {
                    let _ = app.emit("xlog-data", XLogColumns::from(std::mem::take(&mut batch)));
                }
            }
            // 모르는 팩 타입은 여기까지 오지 않는다 — read_next_pack 이 에러를 낸다 (O-5).
            Some(_) => {} // Object / Profile / PerfCounter / Alert → XLog 스트림에서 무시
            None => break, // FLAG_NO_NEXT: 스트림 종료
        }
    }

    if !batch.is_empty() {
        let _ = app.emit("xlog-data", XLogColumns::from(batch));
    }
    // 대량으로 올 때 어디에 시간이 갔는지 보려면 이 줄이 필요하다 (F-56).
    if n_xlog > 0 {
        log::debug!("폴링 {}건 · {:.1}ms", n_xlog, t_start.elapsed().as_secs_f64() * 1000.0);
    }
    Ok(())
}

/// 한 번에 웹뷰로 보낼 XLog 개수.
///
/// **한 건마다 보내면 안 된다.** 첫 폴링에서 10,000건이 오는데 건별로 보내면
/// 화면도 콜백을 1만 번 받는다. 다만 **묶는 것만으로는 거의 안 줄었다**
/// (590ms → 501ms) — 비용은 호출 횟수가 아니라 직렬화였고, 그건 `XLogColumns` 가 푼다.
///
/// 그렇다고 10,000건을 한 덩어리로 보내면 페이로드가 커진다
/// (CLAUDE.md 3.3: «대용량은 청크 분할»). 나눠 보내면 화면이 첫 묶음부터 그리기 시작한다.
const EMIT_CHUNK: usize = 500;

/// 1회 폴링으로 가져올 XLog 최대 건수.
/// ASIS: scouter.webapp XLogConsumer.handleRealTimeXLog() 의 firstRetrieveLimit
const XLOG_RETRIEVE_LIMIT: i64 = 10_000;

/// XLog 실시간 조회 파라미터 구성.
/// 실서버 대상 통합 테스트(tests/live_collector.rs)에서도 같은 구성을 검증하므로 pub 이다.
pub fn build_request_param(obj_hashes: &[i32], cursor: &StreamCursor) -> MapPack {
    let mut param = MapPack::new();

    // objHash: ListValue of Decimal
    let hash_list: Vec<ScouterValue> = obj_hashes
        .iter()
        .map(|h| ScouterValue::Decimal(*h as i64))
        .collect();
    param.put("objHash", ScouterValue::List(hash_list));
    param.put("loop", ScouterValue::Decimal(cursor.loop_val));
    param.put("index", ScouterValue::Decimal(cursor.index));
    // count(ParamConstant.XLOG_COUNT)가 없으면 Collector가 에러 없이 0건을 반환한다.
    param.put("count", ScouterValue::Decimal(XLOG_RETRIEVE_LIMIT));

    param
}
