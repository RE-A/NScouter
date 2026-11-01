// 로컬 캐시 — 콜렉터 하나에 SQLite 파일 하나 (`{data_dir}/cache/{호스트_포트}.db`).
//
// **콜렉터에서 이미 받은 것은 다시 받지 않는다.** 운영 콜렉터는 멀어서(왕복 수십 ms) 요청 수가 곧
// 시간이고, 많은 서비스는 시간당 50만 건이라 같은 구간을 다시 받는 값이 크다.
// 여기 담는 것은 **한 번 정해지면 바뀌지 않는 것**뿐이다:
//   · 이름 사전 (해시 → 글자) — 해시는 글자에서 나온다
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

/// 스키마 판. 바꾸면 `migrate` 에 단계를 더한다
const SCHEMA_VERSION: i64 = 1;

/// 캐시 폴더 이름 (`{data_dir}/cache/`)
pub const DIR_NAME: &str = "cache";

pub struct CacheDb {
    db: Mutex<Connection>,
    path: PathBuf,
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
        Ok(Self { db: Mutex::new(conn), path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn with<T>(&self, f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>) -> rusqlite::Result<T> {
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
