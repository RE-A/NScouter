// src-tauri/src/scouter/dictionary.rs
// hash → text 딕셔너리 조회 (GET_TEXT_100)
// 참조: docs/asis/14-collector-tcp-protocol.md 섹션 9

use std::collections::HashMap;
use std::io;

use super::connection::ScouterConnection;
use super::pack::{AnyPack, MapPack};
use super::protocol::*;
use super::value::ScouterValue;

// ─── TextCache ────────────────────────────────────────────────

/// 텍스트 타입별 hash → text 로컬 캐시
#[derive(Default)]
pub struct TextCache {
    /// (type_key, hash) → text
    inner: HashMap<(String, i32), String>,
}

impl TextCache {
    pub fn new() -> Self {
        Self { inner: HashMap::new() }
    }

    pub fn get(&self, type_key: &str, hash: i32) -> Option<&str> {
        self.inner.get(&(type_key.to_string(), hash)).map(|s| s.as_str())
    }

    pub fn insert(&mut self, type_key: impl Into<String>, hash: i32, text: impl Into<String>) {
        self.inner.insert((type_key.into(), hash), text.into());
    }

    /// 캐시에 없는 hash만 추려 반환
    pub fn missing(&self, type_key: &str, hashes: &[i32]) -> Vec<i32> {
        hashes
            .iter()
            .filter(|&&h| h != 0 && !self.inner.contains_key(&(type_key.to_string(), h)))
            .copied()
            .collect()
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
    if hashes.is_empty() {
        return Ok(());
    }

    // 최대 100개씩 분할 요청
    for chunk in hashes.chunks(100) {
        fetch_chunk(conn, cache, type_key, chunk)?;
    }
    Ok(())
}

fn fetch_chunk(
    conn: &mut ScouterConnection,
    cache: &mut TextCache,
    type_key: &str,
    hashes: &[i32],
) -> io::Result<()> {
    let mut param = MapPack::new();
    param.put("type", ScouterValue::Text(type_key.to_string()));

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
        let c = TextCache::new();
        assert_eq!(c.missing("service", &[0, 0]), Vec::<i32>::new());
    }

    #[test]
    fn 같은_해시가_여러_번_와도_목록에_그대로_남는다() {
        // 여기서 중복을 지우지 않는다 — 부르는 쪽이 이미 모아서 준다.
        // 지운다고 착각하면 «100개씩 나눠 묻기» 의 셈이 어긋난다.
        let c = TextCache::new();
        assert_eq!(c.missing("service", &[8, 8]), vec![8, 8]);
    }

    #[test]
    fn 캐시가_비어_있으면_전부_물어야_한다() {
        let c = TextCache::new();
        assert_eq!(c.missing("sql", &[1, 2, 3]), vec![1, 2, 3]);
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
