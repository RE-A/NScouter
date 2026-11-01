// 문제 트랜잭션의 프로파일을 미리 받아 둔다.
//
// **고칠 것을 찾는 사람은 에러·느린 것부터 연다**(화면 상세, MCP 의 `get_transaction_details`·프로파일 검색).
// 실시간 스트림으로 지나가는 XLog 중 에러이거나 `MIN_ELAPSED_MS` 이상인 것만 골라, 뒤에서 하나씩
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

use super::profile::fetch_full_blob;
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

/// 뒤에서 도는 일꾼을 띄우고 입구를 돌려준다
pub fn start(app: AppHandle) -> Prefetcher {
    let (tx, mut rx) = mpsc::channel::<(i64, i64)>(QUEUE);
    tauri::async_runtime::spawn(async move {
        let gap = Duration::from_millis(1000 / RATE_PER_SEC);
        while let Some((txid, end_time)) = rx.recv().await {
            let wait = end_time + SETTLE_MS - local_now_ms();
            if wait > 0 {
                tokio::time::sleep(Duration::from_millis(wait.min(SETTLE_MS) as u64)).await;
            }
            let state = app.state::<AppState>();
            let Some(db) = state.cache_handle().await else { continue };
            if !db.profile_has(&[txid]).is_empty() {
                continue;
            }
            let tz = app.state::<crate::mcp::McpState>().tz_offset_ms();
            let date = date_key(end_time, tz);
            let Ok(mut conn) = state.acquire_query_conn().await else { continue };
            let got = tokio::task::spawn_blocking(move || {
                let r = fetch_full_blob(&mut conn, txid, &date);
                (conn, r)
            })
            .await;
            match got {
                Ok((conn, Ok(blob))) => {
                    db.put_profile_blob(txid, &blob);
                    state.release_query_conn(conn).await;
                }
                // 응답을 끝까지 못 읽은 연결은 돌려주지 않는다
                Ok((_, Err(e))) => log::debug!("프로파일 미리 받기 실패 txid={txid}: {e}"),
                Err(e) => log::debug!("프로파일 미리 받기 작업 실패: {e}"),
            }
            tokio::time::sleep(gap).await;
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
