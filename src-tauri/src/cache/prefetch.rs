// 문제 트랜잭션의 프로파일을 미리 받아 둔다.
//
// **고칠 것을 찾는 사람은 에러·느린 것부터 연다**(화면 상세, MCP 의 `get_transaction_details`·프로파일 검색).
// 실시간 스트림으로 지나가는 XLog 중 에러이거나 `MIN_ELAPSED_MS` 이상인 것만 골라, 뒤에서 몇 건씩 묶어
// 프로파일을 받아 캐시에 넣는다 — 열 때는 콜렉터에 안 묻는다. 문제 트랜잭션은 전체의 몇 % 라
// 콜렉터 부하는 작고, 그래도 초당 `RATE_PER_SEC` 건을 넘지 않는다.
//
// 지키는 것:
//   · 대기열이 차면(`QUEUE`) 새로 온 것은 버린다 — 스트림을 막지 않는다
//   · XLog 가 끝난 지 `SETTLE_MS` 가 지나서 묻는다. 프로파일은 XLog 보다 조금 늦게 콜렉터에 닿는다 —
//     너무 빨리 물으면 빈 것이 온다(빈 것은 담지 않으니 손해는 없지만 한 번을 버린다)
//   · 캐시가 없으면(접속 전·데모) 아무것도 안 한다

use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio::sync::mpsc;

use crate::commands::{fetch_profiles_parallel, SearchTarget};
use crate::scouter::connection::local_now_ms;
use crate::scouter::objtype::date_key;
use crate::scouter::pack::XLogPack;
use crate::state::AppState;

/// 이 응답시간(ms) 이상이면 미리 받는다
pub const MIN_ELAPSED_MS: i32 = 3_000;
/// 대기열 길이
const QUEUE: usize = 1_000;
/// 초당 최대 건수
const RATE_PER_SEC: u64 = 20;
/// 끝난 뒤 이만큼 지나서 묻는다
const SETTLE_MS: i64 = 10_000;

/// 미리 받을 것을 넣는 입구 (`app.manage` 로 둔다)
pub struct Prefetcher {
    tx: mpsc::Sender<(i64, i64)>,
}

/// 미리 받을 만한가 — 에러이거나 느린 것
pub fn worth(x: &XLogPack) -> bool {
    x.error != 0 || x.elapsed >= MIN_ELAPSED_MS
}

impl Prefetcher {
    /// 스트림에서 부른다. 막히지 않는다 — 차 있으면 버린다
    pub fn offer(&self, x: &XLogPack) {
        if worth(x) {
            let _ = self.tx.try_send((x.txid, x.end_time));
        }
    }
}

/// 한 번에 묶어 받는 수. 요청마다 소켓을 새로 여는 구조(F-1)라 왕복이 크면 하나씩 받을 때
/// 초당 한 건도 못 받는다 — 묶어서 동시에 받는다
const BATCH: usize = 16;
/// 묶음을 받을 때 동시에 여는 연결 수
const WORKERS: usize = 8;

/// 뒤에서 도는 일꾼을 띄우고 입구를 돌려준다
pub fn start(app: AppHandle) -> Prefetcher {
    let (tx, mut rx) = mpsc::channel::<(i64, i64)>(QUEUE);
    tauri::async_runtime::spawn(async move {
        let mut buf: std::collections::VecDeque<(i64, i64)> = std::collections::VecDeque::new();
        loop {
            if buf.is_empty() {
                match rx.recv().await {
                    Some(j) => buf.push_back(j),
                    None => break,
                }
            }
            while let Ok(j) = rx.try_recv() {
                if buf.len() >= QUEUE {
                    buf.pop_front();
                }
                buf.push_back(j);
            }
            // 가장 먼저 온 것이 아직 덜 익었으면(프로파일이 콜렉터에 덜 닿음) 기다렸다 다시 모은다
            let wait = buf[0].1 + SETTLE_MS - local_now_ms();
            if wait > 0 {
                tokio::time::sleep(Duration::from_millis(wait.min(SETTLE_MS) as u64)).await;
                continue;
            }
            let now = local_now_ms();
            let mut batch = Vec::new();
            while batch.len() < BATCH && buf.front().is_some_and(|&(_, e)| e + SETTLE_MS <= now) {
                batch.extend(buf.pop_front());
            }

            let state = app.state::<AppState>();
            let Some(db) = state.cache_handle().await else { continue };
            let have = db.profile_has(&batch.iter().map(|(t, _)| *t).collect::<Vec<_>>());
            let tz = app.state::<crate::mcp::McpState>().tz_offset_ms();
            let targets: Vec<SearchTarget> = batch
                .iter()
                .filter(|(t, _)| !have.contains(t))
                .map(|&(txid, end)| SearchTarget { txid: txid.to_string(), obj_hash: 0, date: date_key(end, tz) })
                .collect();
            if targets.is_empty() {
                continue;
            }
            // 세션은 조회용 연결에서 빌린다 — 세션은 소켓과 무관하게 쓸 수 있다 (F-1)
            let Ok(conn) = state.acquire_query_conn().await else { continue };
            let session = conn.session;
            state.release_query_conn(conn).await;
            let host = state.conn_host.lock().await.clone();
            let port = *state.conn_port.lock().await;
            let n = targets.len();
            // 받은 것은 `full_profile_steps` 가 캐시에 담는다
            let got = tokio::task::spawn_blocking(move || {
                fetch_profiles_parallel(&host, port, session, &targets, WORKERS, Some(&db)).iter().filter(|r| r.is_some()).count()
            })
            .await
            .unwrap_or(0);
            log::debug!("프로파일 미리 받기: {n}건 중 {got}건");
            // 초당 `RATE_PER_SEC` 건을 넘지 않게
            tokio::time::sleep(Duration::from_millis(n as u64 * 1000 / RATE_PER_SEC)).await;
        }
    });
    Prefetcher { tx }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 에러이거나_느린_것만_미리_받는다() {
        let x = |elapsed: i32, error: i32| XLogPack { elapsed, error, ..XLogPack::default() };
        assert!(worth(&x(10, 7)));
        assert!(worth(&x(MIN_ELAPSED_MS, 0)));
        assert!(!worth(&x(MIN_ELAPSED_MS - 1, 0)));
    }
}
