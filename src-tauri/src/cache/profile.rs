// 프로파일 캐시.
//
// **한 번 받은 프로파일은 다시 받지 않는다.** 프로파일은 트랜잭션이 끝날 때 한 번 쓰이고 바뀌지
// 않는다. 상세 열기·흐름(gxid)·프로파일 검색(화면·MCP)이 모두 `full_profile_steps` 를 지난다.
//
// 콜렉터가 주는 그대로(`TRANX_PROFILE_FULL` 의 스텝 바이트)를 deflate 로 줄여 담는다 —
// 사전을 푼 글자를 담지 않는 이유는 사전 캐시가 따로 있고(`text`), 그러면 크기가 몇 배가 되기 때문이다.
//
// **크기**: 건수 상한(`max_rows`)을 넘으면 오래 담아 둔 것부터 지운다. 파일 전체 상한(설정 «로컬 캐시 상한»)은
// XLog 쪽 정리가 맡는다.

use std::io::{Read, Write};
use std::sync::atomic::Ordering;

use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use flate2::Compression;
use rusqlite::{params, Connection};

use super::CacheDb;
use crate::scouter::connection::{local_now_ms, ScouterConnection};
use crate::scouter::profile::{build_full_profile_param, parse_profile_steps, ProfileStep};
use crate::scouter::protocol::CMD_TRANX_PROFILE_FULL;

/// 압축한 프로파일 한 건의 대략 크기 — 건수 상한을 정하는 데만 쓴다
const APPROX_BYTES: u64 = 4_096;

/// 담아 둘 프로파일 수. 캐시 상한의 1/3 쯤 — 2GB 면 17만 건 남짓
pub fn max_rows(max_bytes: u64) -> i64 {
    ((max_bytes / 3 / APPROX_BYTES) as i64).max(1_000)
}

/// 몇 건 담을 때마다 상한을 볼지 — 셈(COUNT)이 공짜가 아니다
const CHECK_EVERY: u32 = 500;

pub(super) fn create_tables(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS profile (
            txid INTEGER PRIMARY KEY,
            at INTEGER NOT NULL,
            body BLOB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS profile_at ON profile (at);",
    )
}

impl CacheDb {
    /// 담아 둔 프로파일 바이트 (콜렉터가 준 그대로)
    pub fn profile_blob(&self, txid: i64) -> Option<Vec<u8>> {
        let z: Option<Vec<u8>> = self
            .with(|c| {
                let mut st = c.prepare_cached("SELECT body FROM profile WHERE txid = ?1")?;
                let mut rows = st.query(params![txid])?;
                Ok(match rows.next()? {
                    Some(r) => Some(r.get::<_, Vec<u8>>(0)?),
                    None => None,
                })
            })
            .unwrap_or(None);
        let mut out = Vec::new();
        DeflateDecoder::new(z?.as_slice()).read_to_end(&mut out).ok()?;
        Some(out)
    }

    /// 담겨 있는 txid 들
    pub fn profile_has(&self, txids: &[i64]) -> std::collections::HashSet<i64> {
        self.with(|c| {
            let mut st = c.prepare_cached("SELECT 1 FROM profile WHERE txid = ?1")?;
            let mut out = std::collections::HashSet::new();
            for &t in txids {
                if st.exists(params![t])? {
                    out.insert(t);
                }
            }
            Ok(out)
        })
        .unwrap_or_default()
    }

    /// 콜렉터에서 받은 프로파일 바이트를 담는다. 빈 것은 담지 않는다(아직 안 쓰였을 수 있다)
    pub fn put_profile_blob(&self, txid: i64, raw: &[u8]) {
        if raw.is_empty() {
            return;
        }
        let mut enc = DeflateEncoder::new(Vec::new(), Compression::fast());
        if enc.write_all(raw).is_err() {
            return;
        }
        let Ok(z) = enc.finish() else { return };
        let r = self.with(|c| {
            c.execute(
                "INSERT OR REPLACE INTO profile (txid, at, body) VALUES (?1, ?2, ?3)",
                params![txid, local_now_ms(), z],
            )
        });
        if let Err(e) = r {
            log::warn!("캐시 프로파일 쓰기 실패: {e}");
            return;
        }
        if self.profile_puts.fetch_add(1, Ordering::Relaxed) % CHECK_EVERY == CHECK_EVERY - 1 {
            self.evict_profiles(max_rows(self.max_bytes()));
        }
    }

    /// 건수 상한을 넘으면 오래 담아 둔 것부터 1할을 지운다
    pub fn evict_profiles(&self, max_rows: i64) {
        let r = self.with(|c| {
            let n: i64 = c.query_row("SELECT COUNT(*) FROM profile", [], |r| r.get(0))?;
            if n <= max_rows {
                return Ok(());
            }
            let drop = n - max_rows + max_rows / 10;
            c.execute(
                "DELETE FROM profile WHERE txid IN (SELECT txid FROM profile ORDER BY at LIMIT ?1)",
                params![drop],
            )?;
            log::info!("캐시 프로파일이 {n}건이라 오래된 {drop}건을 지웠다");
            Ok(())
        });
        if let Err(e) = r {
            log::warn!("캐시 프로파일 정리 실패: {e}");
        }
    }
}

/// 상한 없는 프로파일(`TRANX_PROFILE_FULL`)의 스텝 — 캐시에 있으면 캐시에서, 없으면 콜렉터에서 받아 담는다.
///
/// 응답이 Pack 이 아니라 `[3][blob]` 청크 스트림이라 `read_next_pack` 으로 읽으면 안 된다 (F-30).
pub fn full_profile_steps(
    conn: &mut ScouterConnection,
    cache: Option<&super::CacheDb>,
    txid: i64,
    date: &str,
) -> Result<Vec<ProfileStep>, String> {
    if let Some(blob) = cache.and_then(|db| db.profile_blob(txid)) {
        return Ok(parse_profile_steps(blob));
    }
    let blob = fetch_full_blob(conn, txid, date)?;
    if let Some(db) = cache {
        db.put_profile_blob(txid, &blob);
    }
    Ok(parse_profile_steps(blob))
}

/// 콜렉터에서 프로파일 바이트를 받는다
pub fn fetch_full_blob(conn: &mut ScouterConnection, txid: i64, date: &str) -> Result<Vec<u8>, String> {
    let session = conn.session;
    conn.send_request(CMD_TRANX_PROFILE_FULL, session, &build_full_profile_param(date, txid))
        .map_err(|e| format!("프로파일 요청 실패: {e}"))?;
    conn.read_blob_stream().map_err(|e| format!("프로파일 수신 실패: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 담은_프로파일은_그대로_돌아온다() {
        let db = CacheDb::open_in_memory().unwrap();
        let raw: Vec<u8> = (0..5000u32).map(|i| (i % 7) as u8).collect();
        db.put_profile_blob(42, &raw);
        assert_eq!(db.profile_blob(42).unwrap(), raw);
        assert!(db.profile_blob(43).is_none());
        assert_eq!(db.profile_has(&[42, 43]).into_iter().collect::<Vec<_>>(), vec![42]);
    }

    #[test]
    fn 빈_프로파일은_담지_않는다() {
        // 아직 안 쓰였을 수 있다 — 담으면 다음에도 빈 것을 준다
        let db = CacheDb::open_in_memory().unwrap();
        db.put_profile_blob(1, &[]);
        assert!(db.profile_blob(1).is_none());
    }

    #[test]
    fn 상한을_넘으면_오래된_것부터_지운다() {
        let db = CacheDb::open_in_memory().unwrap();
        for t in 0..30 {
            db.put_profile_blob(t, &[1, 2, 3]);
        }
        db.evict_profiles(20);
        let left = db.profile_has(&(0..30).collect::<Vec<_>>());
        assert!(left.len() <= 20, "{}", left.len());
        assert!(left.contains(&29), "최근 것은 남는다");
    }
}
