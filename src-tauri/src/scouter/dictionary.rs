// src-tauri/src/scouter/dictionary.rs
// hash → text 딕셔너리 조회 (GET_TEXT_100)
// 참조: docs/asis/14-collector-tcp-protocol.md 섹션 9

use std::collections::HashMap;
use std::io;
use std::sync::Arc;

use crate::cache::CacheDb;

use super::connection::ScouterConnection;
use super::pack::{AnyPack, MapPack};
use super::protocol::*;
use super::value::ScouterValue;

// ─── TextCache ────────────────────────────────────────────────

/// 텍스트 타입별 hash → text 로컬 캐시.
///
/// 메모리에 없으면 **디스크 캐시**(`crate::cache`, 콜렉터별 SQLite)를 먼저 보고, 거기도 없을 때만
/// 콜렉터에 묻는다. 콜렉터에서 받은 것은 `flush` 때 디스크에 남긴다 — 앱을 다시 켜도 SQL 문장
/// 수천 개를 다시 받지 않는다.
#[derive(Default)]
pub struct TextCache {
    /// (type_key, hash) → text
    inner: HashMap<(String, i32), String>,
    /// 디스크 캐시. 접속한 콜렉터의 것이고, 접속 전·데모에서는 없다
    store: Option<Arc<CacheDb>>,
    /// 콜렉터에서 받았지만 아직 디스크에 안 남긴 것
    pending: Vec<(String, i32, String)>,
}

impl TextCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// 디스크 캐시를 붙이거나 뗀다 (콜렉터를 갈아탈 때)
    pub fn attach(&mut self, store: Option<Arc<CacheDb>>) {
        self.flush();
        self.store = store;
    }

    pub fn get(&self, type_key: &str, hash: i32) -> Option<&str> {
        self.inner.get(&(type_key.to_string(), hash)).map(|s| s.as_str())
    }

    /// 콜렉터에서 받은 글자. 디스크 캐시가 붙어 있으면 `flush` 때 남긴다
    pub fn insert(&mut self, type_key: impl Into<String>, hash: i32, text: impl Into<String>) {
        let (k, t) = (type_key.into(), text.into());
        if self.store.is_some() {
            self.pending.push((k.clone(), hash, t.clone()));
        }
        self.inner.insert((k, hash), t);
    }

    /// 캐시에 없는 hash만 추려 반환. **디스크에 있는 것은 메모리로 올리고 빼 준다**
    pub fn missing(&mut self, type_key: &str, hashes: &[i32]) -> Vec<i32> {
        let mem_miss: Vec<i32> = hashes
            .iter()
            .filter(|&&h| h != 0 && !self.inner.contains_key(&(type_key.to_string(), h)))
            .copied()
            .collect();
        let Some(store) = &self.store else { return mem_miss };
        if mem_miss.is_empty() {
            return mem_miss;
        }
        let found = store.texts(type_key, &mem_miss);
        let rest = mem_miss.into_iter().filter(|h| !found.contains_key(h)).collect();
        for (h, t) in found {
            self.inner.insert((type_key.to_string(), h), t);
        }
        rest
    }

    /// 콜렉터에서 받은 것을 디스크에 남긴다
    pub fn flush(&mut self) {
        if self.pending.is_empty() {
            return;
        }
        if let Some(store) = &self.store {
            store.put_texts(&self.pending);
        }
        self.pending.clear();
    }
}

// ─── GET_TEXT_100 요청 ────────────────────────────────────────

/// 최대 100개의 hash를 한 번에 조회하여 캐시에 추가
/// ASIS: TextProxy.java + RequestCmd.GET_TEXT_100
pub fn fetch_texts(
    conn: &mut ScouterConnection,
    cache: &mut TextCache,
    type_key: &str,
    hashes: &[i32],
) -> io::Result<()> {
    fetch_texts_on(conn, cache, type_key, hashes, None)
}

/// 날짜를 붙여 묻는다 (F-70).
///
/// 콜렉터는 날짜가 없으면 **오늘** 사전을 본다. 서비스·API·UA 이름은 콜렉터 설정
/// `mgr_text_db_daily_*_enabled` 를 켜면 날짜별 사전에만 남는다 — 그때 오늘 없는 지난 서비스는
/// 이름을 못 찾아 해시로 남는다. 지난 구간을 훑는 쪽(통계)은 그 트랜잭션의 날짜를 넘긴다
pub fn fetch_texts_on(
    conn: &mut ScouterConnection,
    cache: &mut TextCache,
    type_key: &str,
    hashes: &[i32],
    date: Option<&str>,
) -> io::Result<()> {
    if hashes.is_empty() {
        return Ok(());
    }

    // 최대 100개씩 분할 요청
    let chunks: Vec<&[i32]> = hashes.chunks(100).collect();
    let r = if chunks.len() <= 1 {
        chunks.iter().try_for_each(|chunk| fetch_chunk(conn, cache, type_key, chunk, date))
    } else {
        fetch_chunks_parallel(conn, cache, type_key, &chunks, date)
    };
    // 받은 만큼은 실패해도 남긴다
    cache.flush();
    r
}

/// 묶음이 여럿이면 소켓을 몇 개 더 열어 **동시에** 묻는다.
///
/// 요청 하나가 소켓 하나라(F-1) 왕복이 크면 묶음 수 × 왕복 둘이 그대로 쌓인다 — 왕복 500ms 에서
/// SQL 3,000개(30묶음)를 순서대로 물으면 30초다. 프로파일 검색을 처음 돌릴 때 이만큼을 푼다.
/// 동시 수는 설정 `perf.text_workers` (기본 8).
fn fetch_chunks_parallel(
    conn: &mut ScouterConnection,
    cache: &mut TextCache,
    type_key: &str,
    chunks: &[&[i32]],
    date: Option<&str>,
) -> io::Result<()> {
    let workers = (crate::tuning::perf().text_workers as usize).clamp(1, chunks.len());
    let siblings: Vec<io::Result<ScouterConnection>> = (1..workers).map(|_| conn.sibling()).collect();
    let results: Vec<io::Result<TextCache>> = std::thread::scope(|sc| {
        let mine: Vec<&[i32]> = chunks.iter().step_by(workers).copied().collect();
        let mut handles = Vec::new();
        for (w, sib) in siblings.into_iter().enumerate() {
            let part: Vec<&[i32]> = chunks.iter().skip(w + 1).step_by(workers).copied().collect();
            handles.push(sc.spawn(move || -> io::Result<TextCache> {
                let mut c = sib?;
                let mut local = TextCache::new();
                part.iter().try_for_each(|chunk| fetch_chunk(&mut c, &mut local, type_key, chunk, date))?;
                Ok(local)
            }));
        }
        let mut local = TextCache::new();
        let first = mine.iter().try_for_each(|chunk| fetch_chunk(conn, &mut local, type_key, chunk, date)).map(|_| local);
        std::iter::once(first)
            .chain(handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Err(io::Error::other("사전 조회 스레드 실패")))))
            .collect()
    });
    let mut err = None;
    for r in results {
        match r {
            // 받은 만큼은 담는다 — 한 일꾼이 실패해도 나머지 몫은 쓸 수 있다
            Ok(local) => {
                for ((k, h), t) in local.inner {
                    cache.insert(k, h, t);
                }
            }
            Err(e) => {
                err.get_or_insert(e);
            }
        }
    }
    err.map_or(Ok(()), Err)
}

fn fetch_chunk(
    conn: &mut ScouterConnection,
    cache: &mut TextCache,
    type_key: &str,
    hashes: &[i32],
    date: Option<&str>,
) -> io::Result<()> {
    let mut param = MapPack::new();
    param.put("type", ScouterValue::Text(type_key.to_string()));
    if let Some(d) = date.filter(|d| !d.is_empty()) {
        param.put("date", ScouterValue::Text(d.to_string()));
    }

    let hash_list: Vec<ScouterValue> = hashes
        .iter()
        .map(|h| ScouterValue::Decimal(*h as i64))
        .collect();
    param.put("hash", ScouterValue::List(hash_list));

    let session = conn.session;
    conn.send_request(CMD_GET_TEXT_100, session, &param)?;

    // 응답 수신: [HasNEXT][MapPack { hash_str: text_value }]...[NoNEXT]
    loop {
        match conn.read_next_pack()? {
            Some(AnyPack::Map(map)) => {
                for (key, val) in &map.entries {
                    // **응답 키는 Hexa32 다.** 10진수로 파싱하면 전부 실패해
                    // 텍스트를 하나도 못 얻는다 (N-18, F-21).
                    if let Some(hash) = hexa32_to_i64(key) {
                        if let Some(text) = val.as_text() {
                            if !text.is_empty() {
                                cache.insert(type_key, hash as i32, text);
                            }
                        }
                    }
                }
            }
            Some(_) => {} // MAP만 기대, 다른 pack 무시
            None => break,
        }
    }

    Ok(())
}

// ─── XLogPack 관련 hash 일괄 조회 ────────────────────────────

/// XLogPack에서 자주 사용되는 텍스트 hash들을 백그라운드 조회
pub fn prefetch_xlog_hashes(
    conn: &mut ScouterConnection,
    cache: &mut TextCache,
    service: i32,
    error: i32,
    thread_name_hash: i32,
) -> io::Result<()> {
    let missing_service = cache.missing(text_type::SERVICE, &[service]);
    if !missing_service.is_empty() {
        fetch_texts(conn, cache, text_type::SERVICE, &missing_service)?;
    }

    if error != 0 {
        let missing_error = cache.missing(text_type::ERROR, &[error]);
        if !missing_error.is_empty() {
            fetch_texts(conn, cache, text_type::ERROR, &missing_error)?;
        }
    }

    if thread_name_hash != 0 {
        let missing_thread = cache.missing(text_type::THREAD_NAME, &[thread_name_hash]);
        if !missing_thread.is_empty() {
            fetch_texts(conn, cache, text_type::THREAD_NAME, &missing_thread)?;
        }
    }

    Ok(())
}

// ─── Hexa32 ──────────────────────────────────────────────────

/// Scouter 의 해시 키 인코딩 (`scouter.util.Hexa32`).
///
/// **GET_TEXT_100 응답의 MapPack 키가 이 형식이다.** 10진수로 파싱하면
/// 전부 실패해서 텍스트를 하나도 못 얻는다 (N-18).
///
/// ```text
/// 0~9      그대로 10진수      "5"
/// 양수     'x' + base32       "x1jrf6b3"
/// 음수     'z' + base32       "z1pa9p0"
/// i64::MIN "z8000000000000"
/// ```
pub fn hexa32_to_i64(s: &str) -> Option<i64> {
    let mut chars = s.chars();
    match chars.next()? {
        'z' => {
            if s == "z8000000000000" {
                return Some(i64::MIN);
            }
            i64::from_str_radix(&s[1..], 32).ok().map(|v| -v)
        }
        'x' => i64::from_str_radix(&s[1..], 32).ok(),
        _ => s.parse::<i64>().ok(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 실서버 GET_TEXT_100 응답에서 그대로 가져온 값이다.
    // ─ TextCache ─────────────────────────────────────────────
    //
    // 캐시가 틀리면 **화면에 해시가 그대로 남거나**, 같은 해시를 매 프레임 다시 묻는다.
    // 둘 다 조용해서 눈으로는 안 잡힌다.

    #[test]
    fn 타입이_다르면_다른_값이다() {
        // service 의 7 과 sql 의 7 은 남남이다. 한 칸에 넣으면 SQL 자리에 URL 이 뜬다.
        let mut c = TextCache::new();
        c.insert("service", 7, "/shop/order");
        c.insert("sql", 7, "select 1");

        assert_eq!(c.get("service", 7), Some("/shop/order"));
        assert_eq!(c.get("sql", 7), Some("select 1"));
        assert_eq!(c.get("error", 7), None);
    }

    #[test]
    fn 나중에_넣은_것이_이긴다() {
        // 사전은 콜렉터가 다시 만들 수 있다(Reset Text Cache). 옛 값을 붙들면 안 된다.
        let mut c = TextCache::new();
        c.insert("service", 7, "old");
        c.insert("service", 7, "new");
        assert_eq!(c.get("service", 7), Some("new"));
    }

    #[test]
    fn 있는_것은_다시_묻지_않는다() {
        let mut c = TextCache::new();
        c.insert("service", 7, "/shop/order");
        assert_eq!(c.missing("service", &[7, 8, 9]), vec![8, 9]);
    }

    #[test]
    fn 해시_0은_묻지_않는다() {
        // 0 은 «없음» 이다. 물어보면 콜렉터가 빈 값을 주고, 그 빈 값을 캐시에 넣으면
        // 다음부터 «있는데 빈 이름» 이 된다.
        let mut c = TextCache::new();
        assert_eq!(c.missing("service", &[0, 0]), Vec::<i32>::new());
    }

    #[test]
    fn 같은_해시가_여러_번_와도_목록에_그대로_남는다() {
        // 여기서 중복을 지우지 않는다 — 부르는 쪽이 이미 모아서 준다.
        // 지운다고 착각하면 «100개씩 나눠 묻기» 의 셈이 어긋난다.
        let mut c = TextCache::new();
        assert_eq!(c.missing("service", &[8, 8]), vec![8, 8]);
    }

    #[test]
    fn 캐시가_비어_있으면_전부_물어야_한다() {
        let mut c = TextCache::new();
        assert_eq!(c.missing("sql", &[1, 2, 3]), vec![1, 2, 3]);
    }

    #[test]
    fn 디스크에_있는_것은_콜렉터에_묻지_않고_메모리로_올린다() {
        let db = Arc::new(CacheDb::open_in_memory().unwrap());
        db.put_texts(&[("sql".into(), 2, "select 2".into())]);
        let mut c = TextCache::new();
        c.attach(Some(db.clone()));
        assert_eq!(c.missing("sql", &[1, 2]), vec![1], "디스크에 있는 2 는 빠진다");
        assert_eq!(c.get("sql", 2), Some("select 2"));
    }

    #[test]
    fn 콜렉터에서_받은_것은_flush_때_디스크에_남는다() {
        let db = Arc::new(CacheDb::open_in_memory().unwrap());
        let mut c = TextCache::new();
        c.attach(Some(db.clone()));
        c.insert("service", 9, "/a");
        assert!(db.texts("service", &[9]).is_empty(), "flush 전에는 안 쓴다 — 한 묶음으로 쓴다");
        c.flush();
        assert_eq!(db.texts("service", &[9])[&9], "/a");
        // 떼면 더는 남기지 않는다 (데모 데이터가 섞이지 않게)
        c.attach(None);
        c.insert("service", 10, "/demo");
        c.flush();
        assert!(db.texts("service", &[10]).is_empty());
    }

    #[test]
    fn 실서버_응답_키를_해석한다() {
        assert_eq!(hexa32_to_i64("z1pa9p0"), Some(-60106528));
        assert_eq!(hexa32_to_i64("x1jrf6b3"), Some(1740085603));
        assert_eq!(hexa32_to_i64("z173cbsq"), Some(-1312173978));
    }

    // 10 미만은 접두 없이 10진수로 온다 (Hexa32.toString32).
    #[test]
    fn 한자리_숫자는_접두가_없다() {
        assert_eq!(hexa32_to_i64("0"), Some(0));
        assert_eq!(hexa32_to_i64("9"), Some(9));
    }

    #[test]
    fn i64_최솟값은_특수_표기다() {
        assert_eq!(hexa32_to_i64("z8000000000000"), Some(i64::MIN));
    }

    #[test]
    fn 잘못된_키는_none_을_돌려준다() {
        assert_eq!(hexa32_to_i64(""), None);
        assert_eq!(hexa32_to_i64("x!!!"), None);
        assert_eq!(hexa32_to_i64("hello"), None);
    }

    // 10진수 파싱으로는 실서버 키를 하나도 못 읽는다 — N-18 의 원인.
    #[test]
    fn 십진수_파싱으로는_읽히지_않는다() {
        assert!("z1pa9p0".parse::<i32>().is_err());
        assert!("x1jrf6b3".parse::<i32>().is_err());
    }
}
