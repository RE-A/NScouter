// 지난 XLog 캐시.
//
// **한 번 받은 구간은 다시 받지 않는다.** 과거 조회·트랜잭션 찾기·응답시간 분포·MCP 목록 조회가
// 모두 «오브젝트 몇 개의 [시작, 끝] 을 페이지로 넘겨 받기»(TRANX_LOAD_TIME_GROUP_V2)라,
// 그 한 곳(`past_page`)에 캐시를 둔다.
//
// 무엇을 «받았다» 고 치나 — **오브젝트마다 덮은 구간**(`xlog_cover`)을 적어 둔다. 구간을 끝까지
// 받았을 때만 적고, 겹치거나 맞닿은 구간은 합친다. 다음 조회가 그 안에 들면 콜렉터에 묻지 않는다.
// 건이 하나도 없던 구간도 «없음» 으로 덮인다 — 빈 구간을 매번 다시 묻지 않게.
//
// **최근 5분(`SEAL_MS`)은 덮었다고 적지 않는다.** 트랜잭션은 끝난 뒤 조금 늦게 콜렉터에 닿고
// (에이전트가 모아서 보낸다), 그 사이에 받은 구간을 «다 받았다» 고 적으면 늦게 온 것이 영영 빠진다.
//
// 한 건은 콜렉터가 보내는 모양 그대로(`XLogPack::to_blob`) 담는다 — 100바이트 남짓이다.

use rusqlite::{params, params_from_iter, Connection};

use super::CacheDb;
use crate::scouter::connection::ScouterConnection;
use crate::scouter::pack::{AnyPack, XLogPack};
use crate::scouter::past::{build_past_xlog_param, parse_past_cursor, PastCursor};
use crate::scouter::protocol::CMD_TRANX_LOAD_TIME_GROUP_V2;

/// 이보다 최근은 «다 받았다» 고 적지 않는다
pub const SEAL_MS: i64 = 5 * 60_000;


/// 넘었을 때 한 번에 지우는 폭 — 가장 오래된 것부터 한 시간씩
const EVICT_STEP_MS: i64 = 3_600_000;

pub(super) fn create_tables(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS xlog (
            txid INTEGER PRIMARY KEY,
            obj_hash INTEGER NOT NULL,
            end_time INTEGER NOT NULL,
            body BLOB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS xlog_obj_time ON xlog (obj_hash, end_time);
        CREATE INDEX IF NOT EXISTS xlog_time ON xlog (end_time);
        CREATE TABLE IF NOT EXISTS xlog_cover (
            obj_hash INTEGER NOT NULL,
            s INTEGER NOT NULL,
            e INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS xlog_cover_obj ON xlog_cover (obj_hash, s);",
    )
}

impl CacheDb {
    /// 오브젝트들의 `[s, e]` 가 **모두** 덮여 있나
    pub fn xlog_covered(&self, hashes: &[i32], s: i64, e: i64) -> bool {
        if hashes.is_empty() || e < s {
            return false;
        }
        self.with(|c| {
            let mut st = c.prepare_cached("SELECT 1 FROM xlog_cover WHERE obj_hash = ?1 AND s <= ?2 AND e >= ?3 LIMIT 1")?;
            for &h in hashes {
                if !st.exists(params![h, s, e])? {
                    return Ok(false);
                }
            }
            Ok(true)
        })
        .unwrap_or_else(|err| {
            log::warn!("캐시 XLog 덮음 확인 실패: {err}");
            false
        })
    }

    /// 담아 둔 XLog — `[from, to]`, 끝난 시각 순으로 `limit` 건
    pub fn xlog_page(&self, hashes: &[i32], from: i64, to: i64, limit: usize) -> Vec<XLogPack> {
        if hashes.is_empty() {
            return Vec::new();
        }
        let marks = vec!["?"; hashes.len()].join(",");
        let sql = format!(
            "SELECT body FROM xlog WHERE obj_hash IN ({marks}) AND end_time >= ? AND end_time <= ? ORDER BY end_time, txid LIMIT ?"
        );
        let r = self.with(|c| {
            let mut st = c.prepare_cached(&sql)?;
            let args = hashes.iter().map(|&h| h as i64).chain([from, to, limit as i64]);
            let rows = st.query_map(params_from_iter(args), |r| r.get::<_, Vec<u8>>(0))?;
            let mut out = Vec::new();
            for b in rows {
                if let Ok(x) = XLogPack::read_from_blob(b?) {
                    out.push(x);
                }
            }
            Ok(out)
        });
        r.unwrap_or_else(|err| {
            log::warn!("캐시 XLog 읽기 실패: {err}");
            Vec::new()
        })
    }

    /// 콜렉터에서 받은 XLog 를 담는다
    pub fn put_xlogs(&self, rows: &[XLogPack]) {
        if rows.is_empty() {
            return;
        }
        let r = self.with(|c| {
            let tx = c.transaction()?;
            {
                let mut st = tx.prepare_cached("INSERT OR REPLACE INTO xlog (txid, obj_hash, end_time, body) VALUES (?1, ?2, ?3, ?4)")?;
                for x in rows {
                    st.execute(params![x.txid, x.obj_hash, x.end_time, x.to_blob()])?;
                }
            }
            tx.commit()
        });
        if let Err(e) = r {
            log::warn!("캐시 XLog 쓰기 실패: {e}");
            return;
        }
        self.evict_xlog(self.max_bytes());
    }

    /// 오브젝트들의 `[s, e]` 를 «다 받았다» 고 적는다. 겹치거나 맞닿은 구간은 합친다
    pub fn mark_xlog(&self, hashes: &[i32], s: i64, e: i64) {
        if e < s {
            return;
        }
        let r = self.with(|c| {
            let tx = c.transaction()?;
            for &h in hashes {
                let (mut ns, mut ne) = (s, e);
                {
                    let mut st = tx.prepare_cached(
                        "SELECT rowid, s, e FROM xlog_cover WHERE obj_hash = ?1 AND e >= ?2 - 1 AND s <= ?3 + 1",
                    )?;
                    let near: Vec<(i64, i64, i64)> =
                        st.query_map(params![h, s, e], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;
                    for (id, a, b) in near {
                        ns = ns.min(a);
                        ne = ne.max(b);
                        tx.execute("DELETE FROM xlog_cover WHERE rowid = ?1", params![id])?;
                    }
                }
                tx.execute("INSERT INTO xlog_cover (obj_hash, s, e) VALUES (?1, ?2, ?3)", params![h, ns, ne])?;
            }
            tx.commit()
        });
        if let Err(err) = r {
            log::warn!("캐시 XLog 덮음 쓰기 실패: {err}");
        }
    }

    /// 파일이 상한을 넘으면 가장 오래된 XLog 부터 한 시간씩 지운다. 덮음 기록도 같이 줄인다.
    /// (SQLite 는 지운 자리를 다시 쓴다 — 파일 크기는 상한 근처에서 멈춘다)
    pub fn evict_xlog(&self, max_bytes: u64) {
        let r = self.with(|c| {
            for _ in 0..1000 {
                if used_bytes(c)? <= max_bytes {
                    break;
                }
                let oldest: Option<i64> = c.query_row("SELECT MIN(end_time) FROM xlog", [], |r| r.get(0))?;
                let Some(oldest) = oldest else { break };
                let cut = oldest + EVICT_STEP_MS;
                c.execute("DELETE FROM xlog WHERE end_time < ?1", params![cut])?;
                c.execute("UPDATE xlog_cover SET s = ?1 WHERE s < ?1", params![cut])?;
                c.execute("DELETE FROM xlog_cover WHERE e < s", [])?;
                log::info!("캐시가 상한을 넘어 {oldest} 부터 한 시간을 지웠다");
            }
            Ok(())
        });
        if let Err(e) = r {
            log::warn!("캐시 정리 실패: {e}");
        }
    }
}

/// 파일이 실제로 쓰는 바이트 (지운 뒤 비어 있는 페이지는 뺀다)
pub(crate) fn used_bytes(c: &Connection) -> rusqlite::Result<u64> {
    let pages: i64 = c.query_row("PRAGMA page_count", [], |r| r.get(0))?;
    let free: i64 = c.query_row("PRAGMA freelist_count", [], |r| r.get(0))?;
    let size: i64 = c.query_row("PRAGMA page_size", [], |r| r.get(0))?;
    Ok(((pages - free).max(0) * size) as u64)
}

/// 과거 XLog 한 페이지
pub struct PastPage {
    pub rows: Vec<XLogPack>,
    pub next: PastCursor,
    /// 이 구간을 끝까지 받았다
    pub done: bool,
    /// 캐시에서 왔다
    pub from_cache: bool,
}

/// 과거 XLog 한 페이지 — 캐시가 덮은 앞부분은 캐시에서, 나머지는 콜렉터에서 받아 담는다.
///
/// 페이지를 넘기는 법은 콜렉터와 같다: 다음 페이지는 `cursor.last_xlog_time` 부터(그 시각 포함 —
/// 경계의 같은 시각이 다시 오므로 부르는 쪽이 txid 로 거른다, F-28). 그래서 부르는 쪽은 어디서 왔는지
/// 몰라도 된다. 콜렉터에서 받아 **끝까지 왔으면** 그 구간을 덮었다고 적는다(최근 5분은 빼고).
///
/// `seal_before`: 콜렉터 시계로 «지금 − 5분». 이보다 뒤는 덮었다고 적지 않는다.
#[allow(clippy::too_many_arguments)]
pub fn past_page(
    conn: &mut ScouterConnection,
    cache: Option<&CacheDb>,
    hashes: &[i32],
    date: &str,
    stime: i64,
    etime: i64,
    page_count: i32,
    cursor: &PastCursor,
    seal_before: i64,
) -> Result<PastPage, String> {
    let start = if cursor.last_xlog_time != 0 { cursor.last_xlog_time } else { stime };

    // **확정된 앞부분은 캐시에서, 최근 5분만 콜렉터에서.** 화면의 과거 조회는 «최근 1시간» 처럼
    // 끝이 지금인 구간이 많다 — 구간 전체가 덮여야만 캐시를 쓰면 그런 조회는 한 번도 안 맞는다.
    // 캐시 몫(`[stime, cache_to]`)을 다 주면 커서를 `cache_to` 에 두고 «더 있다» 고 넘긴다.
    // 다음 페이지는 거기서부터 콜렉터에 묻는다.
    if let Some(db) = cache {
        let cache_to = etime.min(seal_before);
        if start < cache_to && db.xlog_covered(hashes, stime, cache_to) {
            let limit = page_count.max(1) as usize;
            let rows = db.xlog_page(hashes, start, cache_to, limit);
            let full = rows.len() >= limit;
            let handoff = !full && cache_to < etime;
            let next = PastCursor {
                has_more: full || handoff,
                last_txid: rows.last().map(|x| x.txid).unwrap_or(0),
                last_xlog_time: if handoff { cache_to } else { rows.last().map(|x| x.end_time).unwrap_or(0) },
            };
            let done = !next.has_more || next.last_xlog_time <= cursor.last_xlog_time;
            return Ok(PastPage { rows, next, done, from_cache: true });
        }
    }

    let param = build_past_xlog_param(hashes, date, stime, etime, page_count, cursor);
    let session = conn.session;
    conn.send_request(CMD_TRANX_LOAD_TIME_GROUP_V2, session, &param)
        .map_err(|e| format!("과거 XLog 요청 실패: {e}"))?;
    let mut rows = Vec::new();
    let mut next = PastCursor::default();
    while let Some(p) = conn.read_next_pack().map_err(|e| format!("과거 XLog 수신 실패: {e}"))? {
        match p {
            AnyPack::XLog(x) => rows.push(x),
            AnyPack::Map(m) => next = parse_past_cursor(&m),
            _ => {}
        }
    }
    // 서버가 `hasMore` 를 계속 주면서 커서를 안 밀면 같은 페이지를 영원히 받는다
    let done = !next.has_more || rows.is_empty() || next.last_xlog_time <= cursor.last_xlog_time;
    if let Some(db) = cache {
        db.put_xlogs(&rows);
        // 끝까지 받았을 때만 «다 받았다» 고 적는다. 빗장(커서가 안 밀림)으로 끝난 것은 아니다.
        // 앞부분을 캐시에서 받았어도 맞다 — 캐시가 덮은 끝(넘겨준 커서)부터 콜렉터가 이어 받았다
        if done && (!next.has_more || rows.is_empty()) {
            let to = etime.min(seal_before);
            if to >= stime {
                db.mark_xlog(hashes, stime, to);
            }
        }
    }
    Ok(PastPage { rows, next, done, from_cache: false })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn x(txid: i64, obj: i32, t: i64) -> XLogPack {
        XLogPack { txid, obj_hash: obj, end_time: t, elapsed: (t % 1000) as i32, ipaddr: "10.0.0.1".into(), ..XLogPack::default() }
    }

    #[test]
    fn 덮은_구간은_합치고_모든_오브젝트가_덮여야_덮인_것이다() {
        let db = CacheDb::open_in_memory().unwrap();
        db.mark_xlog(&[1, 2], 100, 200);
        db.mark_xlog(&[1], 200, 300); // 맞닿음 → 합친다
        db.mark_xlog(&[1], 250, 400); // 겹침 → 합친다
        assert!(db.xlog_covered(&[1], 120, 390));
        assert!(db.xlog_covered(&[1, 2], 100, 200));
        assert!(!db.xlog_covered(&[1, 2], 100, 250), "2 는 200 까지만");
        assert!(!db.xlog_covered(&[3], 100, 101), "모르는 오브젝트");
        assert!(!db.xlog_covered(&[], 100, 101));
        let n: i64 = db.with(|c| c.query_row("SELECT COUNT(*) FROM xlog_cover WHERE obj_hash = 1", [], |r| r.get(0))).unwrap();
        assert_eq!(n, 1, "합쳐져 한 줄이어야 한다");
    }

    #[test]
    fn 담은_것을_시간_순으로_오브젝트별로_페이지씩_꺼낸다() {
        let db = CacheDb::open_in_memory().unwrap();
        db.put_xlogs(&[x(3, 1, 300), x(1, 1, 100), x(2, 2, 200), x(4, 9, 150)]);
        let p = db.xlog_page(&[1, 2], 0, 1000, 10);
        assert_eq!(p.iter().map(|r| r.txid).collect::<Vec<_>>(), vec![1, 2, 3]);
        assert_eq!(db.xlog_page(&[1, 2], 0, 1000, 2).len(), 2);
        assert_eq!(db.xlog_page(&[1], 150, 300, 10).iter().map(|r| r.txid).collect::<Vec<_>>(), vec![3]);
        // 같은 txid 는 덮어쓴다
        db.put_xlogs(&[x(3, 1, 300)]);
        assert_eq!(db.xlog_page(&[1], 0, 1000, 10).len(), 2);
        assert_eq!(db.xlog_page(&[1], 0, 1000, 10)[1].elapsed, 300);
    }

    #[test]
    fn 덮인_앞부분은_캐시에서_주고_최근은_콜렉터로_넘긴다() {
        // 콜렉터 없이 캐시 쪽만 본다 — 캐시 몫을 다 준 페이지가 커서를 경계에 두고 «더 있다» 고 하는가
        let db = CacheDb::open_in_memory().unwrap();
        db.put_xlogs(&[x(1, 1, 100), x(2, 1, 200)]);
        db.mark_xlog(&[1], 0, 500);
        // 캐시 몫만 보는 시험이라 콜렉터에는 아무것도 묻지 않는다 — 받아 주기만 하는 소켓이면 된다
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let mut conn = ScouterConnection::connect("127.0.0.1", port).unwrap();
        let seal = 500; // 500 이후는 아직 확정이 아니다
        let p = past_page(&mut conn, Some(&db), &[1], "d", 0, 900, 10, &PastCursor::default(), seal).unwrap();
        assert!(p.from_cache);
        assert_eq!(p.rows.len(), 2);
        assert!(p.next.has_more && !p.done, "최근 몫이 남았다");
        assert_eq!(p.next.last_xlog_time, 500, "다음은 경계부터 콜렉터에 묻는다");
        // 끝이 확정 구간 안이면 캐시만으로 끝난다
        let q = past_page(&mut conn, Some(&db), &[1], "d", 0, 400, 10, &PastCursor::default(), seal).unwrap();
        assert!(q.from_cache && q.done && !q.next.has_more);
        // 페이지가 꽉 차면 이어서
        let r = past_page(&mut conn, Some(&db), &[1], "d", 0, 400, 1, &PastCursor::default(), seal).unwrap();
        assert!(r.next.has_more && !r.done);
        assert_eq!(r.next.last_xlog_time, 100);
    }

    #[test]
    fn 상한을_넘으면_오래된_것부터_지우고_덮음도_줄인다() {
        let db = CacheDb::open_in_memory().unwrap();
        let hour = EVICT_STEP_MS;
        let rows: Vec<XLogPack> = (0..2000).map(|i| x(i, 1, (i / 1000) * hour * 2 + i)).collect();
        db.put_xlogs(&rows);
        db.mark_xlog(&[1], 0, 3 * hour);
        db.evict_xlog(1); // 무조건 넘게 — 다 지울 때까지
        assert!(db.xlog_page(&[1], 0, i64::MAX, 10).is_empty());
        assert!(!db.xlog_covered(&[1], 0, 10), "지운 구간은 덮었다고 하면 안 된다");
    }
}
