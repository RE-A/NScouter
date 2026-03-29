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
                    if let Ok(hash) = key.parse::<i32>() {
                        if let Some(text) = val.as_text() {
                            cache.insert(type_key, hash, text);
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
