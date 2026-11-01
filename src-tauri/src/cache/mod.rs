// 로컬 캐시 — 콜렉터 하나에 SQLite 파일 하나 (`{data_dir}/cache/{호스트_포트}.db`).
//
// **콜렉터에서 이미 받은 것은 다시 받지 않는다.** 운영 콜렉터는 멀어서(왕복 수십 ms) 요청 수가 곧
// 시간이고, 많은 서비스는 시간당 50만 건이라 같은 구간을 다시 받는 값이 크다.
// 여기 담는 것은 **한 번 정해지면 바뀌지 않는 것**뿐이다:
//   · 이름 사전 (해시 → 글자) — 해시는 글자에서 나온다
//   · 지난 XLog (`xlog.rs`) — 끝난 트랜잭션은 바뀌지 않는다. 최근 5분은 늦게 오는 것이 있어 덮었다고 적지 않는다
//   · 프로파일 (`profile.rs`) — 트랜잭션이 끝날 때 한 번 쓰인다
//
// **캐시는 덤이다.** 파일을 못 열거나 쓰다 실패해도 조회는 콜렉터로 그대로 간다 — 여기서 난
// 오류를 화면으로 올리지 않고 로그만 남긴다.
//
// 콜렉터별로 파일을 나누는 이유: 운영·QA 를 갈아 가며 보는데, 날짜·txid 를 키로 하는 것들이
// 섞이면 남의 트랜잭션이 나온다.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection};

pub mod prefetch;
pub mod profile;
pub mod xlog;

/// 스키마 판. 바꾸면 `migrate` 에 단계를 더한다
const SCHEMA_VERSION: i64 = 3;

/// 캐시 폴더 이름 (`{data_dir}/cache/`)
pub const DIR_NAME: &str = "cache";

/// 설정을 읽기 전의 상한 (설정 기본값과 같다 — `config::default_cache_max_mb`)
const DEFAULT_MAX_BYTES: u64 = 2048 * 1024 * 1024;

/// 캐시 폴더의 파일들 — (경로, 크기, 마지막으로 바뀐 때). WAL·SHM 은 본 파일 크기에 더한다
pub fn files(dir: &Path) -> Vec<(PathBuf, u64, std::time::SystemTime)> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out = Vec::new();
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("db") {
            continue;
        }
        let meta = |q: &Path| std::fs::metadata(q).ok();
        let Some(m) = meta(&p) else { continue };
        let side: u64 = ["db-wal", "db-shm"]
            .iter()
            .filter_map(|x| meta(&p.with_extension(x)).map(|m| m.len()))
            .sum();
        out.push((p.clone(), m.len() + side, m.modified().unwrap_or(std::time::UNIX_EPOCH)));
    }
    out
}

/// 지금 콜렉터 파일 말고 다른 파일들이 `budget` 을 넘으면 안 쓴 지 오래된 것부터 지운다.
/// 남은 몫(지금 콜렉터가 쓸 수 있는 바이트)을 돌려준다
pub fn prune_others(dir: &Path, current: &Path, budget: u64) -> u64 {
    let mut others: Vec<_> = files(dir).into_iter().filter(|(p, _, _)| p != current).collect();
    others.sort_by_key(|(_, _, t)| *t);
    let mut total: u64 = others.iter().map(|(_, n, _)| n).sum();
    // 지금 콜렉터에 적어도 절반은 남긴다
    let keep_for_current = budget / 2;
    for (p, n, _) in &others {
        if total + keep_for_current <= budget {
            break;
        }
        for ext in ["db", "db-wal", "db-shm"] {
            let _ = std::fs::remove_file(p.with_extension(ext));
        }
        log::info!("캐시 상한 때문에 다른 콜렉터의 캐시를 지웠다: {}", p.display());
        total -= n;
    }
    budget.saturating_sub(total)
}

pub struct CacheDb {
    db: Mutex<Connection>,
    path: PathBuf,
    /// 프로파일을 담은 횟수 — 몇 번마다 상한을 본다 (`profile.rs`)
    profile_puts: std::sync::atomic::AtomicU32,
    /// 이 파일이 쓸 수 있는 바이트 (설정 «로컬 캐시 상한» 에서 다른 콜렉터 몫을 뺀 것)
    max_bytes: std::sync::atomic::AtomicU64,
}

/// 파일 이름으로 쓸 콜렉터 키. 호스트에 든 `:`·`/` 같은 글자는 `_` 로 바꾼다
pub fn collector_key(host: &str, port: u16) -> String {
    let host: String = host
        .trim()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' })
        .collect();
    format!("{host}_{port}")
}

impl CacheDb {
    /// 콜렉터 하나의 캐시를 연다. 폴더가 없으면 만든다
    pub fn open(dir: &Path, key: &str) -> Result<Self, String> {
        std::fs::create_dir_all(dir).map_err(|e| format!("캐시 폴더를 만들 수 없음 ({}): {e}", dir.display()))?;
        let path = dir.join(format!("{key}.db"));
        let conn = Connection::open(&path).map_err(|e| format!("캐시 파일을 열 수 없음 ({}): {e}", path.display()))?;
        Self::init(conn, path)
    }

    /// 시험용 — 파일 없이
    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        Self::init(conn, PathBuf::from(":memory:"))
    }

    fn init(conn: Connection, path: PathBuf) -> Result<Self, String> {
        // WAL: 읽는 쪽(화면)과 쓰는 쪽(MCP)이 서로 막지 않는다.
        // synchronous=NORMAL: 전원이 나가면 마지막 몇 건을 잃을 수 있다 — 캐시라 괜찮다
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
            .map_err(|e| e.to_string())?;
        migrate(&conn).map_err(|e| format!("캐시 스키마 실패: {e}"))?;
        Ok(Self {
            db: Mutex::new(conn),
            path,
            profile_puts: std::sync::atomic::AtomicU32::new(0),
            max_bytes: std::sync::atomic::AtomicU64::new(DEFAULT_MAX_BYTES),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// 이 파일이 쓸 수 있는 바이트
    pub fn max_bytes(&self) -> u64 {
        self.max_bytes.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// 상한을 바꾼다. 줄었으면 바로 정리한다
    pub fn set_max_bytes(&self, v: u64) {
        let before = self.max_bytes.swap(v, std::sync::atomic::Ordering::Relaxed);
        if v < before {
            self.evict_xlog(v);
            self.evict_profiles(profile::max_rows(v));
        }
    }

    /// 이 파일이 실제로 쓰는 바이트
    pub fn used_bytes(&self) -> u64 {
        self.with(|c| xlog::used_bytes(c)).unwrap_or(0)
    }

    /// 다 비운다 (설정 «비우기»)
    pub fn clear(&self) {
        let r = self.with(|c| {
            c.execute_batch(
                "DELETE FROM text; DELETE FROM xlog; DELETE FROM xlog_cover; DELETE FROM profile; VACUUM;",
            )
        });
        if let Err(e) = r {
            log::warn!("캐시 비우기 실패: {e}");
        }
    }

    pub(crate) fn with<T>(&self, f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>) -> rusqlite::Result<T> {
        // 다른 스레드가 쥔 채 죽었어도 연결 자체는 멀쩡하다 — 독을 걷고 쓴다
        let mut g = self.db.lock().unwrap_or_else(|p| p.into_inner());
        f(&mut g)
    }

    // ─── 이름 사전 ───────────────────────────────────────────

    /// 저장해 둔 글자들. 없는 해시는 빠진다
    pub fn texts(&self, kind: &str, hashes: &[i32]) -> HashMap<i32, String> {
        let r = self.with(|c| {
            let mut st = c.prepare_cached("SELECT text FROM text WHERE kind = ?1 AND hash = ?2")?;
            let mut out = HashMap::new();
            for &h in hashes {
                if let Ok(t) = st.query_row(params![kind, h], |r| r.get::<_, String>(0)) {
                    out.insert(h, t);
                }
            }
            Ok(out)
        });
        r.unwrap_or_else(|e| {
            log::warn!("캐시 사전 읽기 실패: {e}");
            HashMap::new()
        })
    }

    /// 콜렉터에서 받은 글자들을 남긴다. 한 묶음을 한 트랜잭션으로
    pub fn put_texts(&self, items: &[(String, i32, String)]) {
        if items.is_empty() {
            return;
        }
        let r = self.with(|c| {
            let tx = c.transaction()?;
            {
                let mut st = tx.prepare_cached("INSERT OR REPLACE INTO text (kind, hash, text) VALUES (?1, ?2, ?3)")?;
                for (k, h, t) in items {
                    st.execute(params![k, h, t])?;
                }
            }
            tx.commit()
        });
        if let Err(e) = r {
            log::warn!("캐시 사전 쓰기 실패: {e}");
        }
    }
}

/// 스키마를 맞춘다. 판(`user_version`)을 보고 모자란 단계만 돈다
fn migrate(c: &Connection) -> rusqlite::Result<()> {
    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if v < 1 {
        c.execute_batch(
            "CREATE TABLE IF NOT EXISTS text (
                kind TEXT NOT NULL,
                hash INTEGER NOT NULL,
                text TEXT NOT NULL,
                PRIMARY KEY (kind, hash)
            ) WITHOUT ROWID;",
        )?;
    }
    if v < 2 {
        xlog::create_tables(c)?;
    }
    if v < 3 {
        profile::create_tables(c)?;
    }
    c.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 콜렉터_키는_파일_이름으로_쓸_수_있다() {
        assert_eq!(collector_key("10.0.0.1", 6100), "10.0.0.1_6100");
        assert_eq!(collector_key(" my-host.local ", 6100), "my-host.local_6100");
        assert_eq!(collector_key("::1", 6100), "__1_6100");
        assert_eq!(collector_key("a/b\\c", 1), "a_b_c_1");
    }

    #[test]
    fn 사전은_넣은_것만_돌려준다() {
        let db = CacheDb::open_in_memory().unwrap();
        db.put_texts(&[("sql".into(), 1, "select 1".into()), ("service".into(), 1, "/a".into())]);
        let got = db.texts("sql", &[1, 2]);
        assert_eq!(got.len(), 1);
        assert_eq!(got[&1], "select 1");
        assert_eq!(db.texts("service", &[1])[&1], "/a", "종류가 다르면 다른 글자다");
    }

    #[test]
    fn 상한을_넘으면_안_쓴_지_오래된_콜렉터_파일부터_지운다() {
        let dir = std::env::temp_dir().join(format!("nscouter-prune-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let write = |name: &str, n: usize| std::fs::write(dir.join(name), vec![0u8; n]).unwrap();
        write("old_1.db", 400);
        std::thread::sleep(std::time::Duration::from_millis(20));
        write("new_1.db", 300);
        std::thread::sleep(std::time::Duration::from_millis(20));
        write("cur_1.db", 10);
        let cur = dir.join("cur_1.db");
        // 상한 1000, 지금 콜렉터에 절반(500)은 남긴다 → 다른 파일 합 700 이 500 아래로 — 오래된 것만 지운다
        let mine = prune_others(&dir, &cur, 1000);
        assert!(!dir.join("old_1.db").exists(), "오래된 것부터");
        assert!(dir.join("new_1.db").exists());
        assert!(cur.exists(), "지금 콜렉터 파일은 안 지운다");
        assert_eq!(mine, 700);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 비우면_다_없어진다() {
        let db = CacheDb::open_in_memory().unwrap();
        db.put_texts(&[("sql".into(), 1, "select 1".into())]);
        db.put_profile_blob(1, &[1, 2, 3]);
        db.clear();
        assert!(db.texts("sql", &[1]).is_empty());
        assert!(db.profile_blob(1).is_none());
    }

    #[test]
    fn 파일로_남아_다시_열어도_있다() {
        let dir = std::env::temp_dir().join(format!("nscouter-cache-test-{}", std::process::id()));
        {
            let db = CacheDb::open(&dir, "h_1").unwrap();
            db.put_texts(&[("sql".into(), -5, "update t".into())]);
        }
        let db = CacheDb::open(&dir, "h_1").unwrap();
        assert_eq!(db.texts("sql", &[-5])[&-5], "update t");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
