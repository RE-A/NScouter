// 프로파일 본문 텍스트 검색
//
// XLog 목록은 "무엇이 느렸나"까지만 말한다. **어떤 SQL 이 돌았나**, **어떤 예외가 났나**로
// 트랜잭션을 찾으려면 프로파일 안을 봐야 하는데, 그건 트랜잭션 한 건당 요청 하나다.
//
// **그래서 프론트로 옮겨 놓고 찾지 않는다.** 실측에서 프로파일 하나가 수십 KB 고
// 드래그 한 번에 수백 건이 잡힌다 — 웹뷰로 다 보내면 그 자체로 멎는다 (CLAUDE.md 3.3).
// 여기서 훑고 **걸린 것만** 돌려준다.

use serde::Serialize;

use super::profile::ProfileStep;

/// 스텝 하나에서 검색 대상이 되는 텍스트들.
///
/// 해시는 이미 풀려 있어야 한다 — 여기서 조회하지 않는다.
pub struct StepTexts<'a> {
    pub method: &'a dyn Fn(i32) -> Option<String>,
    pub sql: &'a dyn Fn(i32) -> Option<String>,
    pub apicall: &'a dyn Fn(i32) -> Option<String>,
    pub error: &'a dyn Fn(i32) -> Option<String>,
    pub hmsg: &'a dyn Fn(i32) -> Option<String>,
}

/// 걸린 스텝 하나.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StepHit {
    /// 프로파일 안에서의 스텝 순번. 상세를 열었을 때 그 자리로 데려가는 데 쓴다
    pub index: usize,
    /// sql / apicall / method / message / socket / error
    pub kind: String,
    /// 걸린 텍스트. 길면 자른다
    pub snippet: String,
}

/// 스니펫 최대 길이. 표 한 줄에 들어갈 만큼만.
const SNIPPET: usize = 160;

/// 걸린 자리를 **가운데 두고** 자른다.
///
/// 앞에서 자르면 SQL 처럼 앞부분이 다 비슷한 텍스트에서 매번 같은 조각만 보인다 —
/// 정작 찾은 단어가 잘려 나간다.
pub fn snippet_around(text: &str, at: usize, max: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max {
        return text.to_string();
    }
    // `at` 은 바이트 위치다. 문자 위치로 옮긴다.
    let at_char = text[..at].chars().count();
    let half = max / 2;
    let start = at_char.saturating_sub(half);
    let end = (start + max).min(chars.len());
    let start = end.saturating_sub(max);

    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    out.extend(&chars[start..end]);
    if end < chars.len() {
        out.push('…');
    }
    out
}

fn find(haystack: &str, needle_lower: &str) -> Option<usize> {
    if needle_lower.is_empty() {
        return None;
    }
    haystack.to_lowercase().find(needle_lower)
}

fn hit(index: usize, kind: &str, text: &str, needle: &str) -> Option<StepHit> {
    let at = find(text, needle)?;
    Some(StepHit {
        index,
        kind: kind.to_string(),
        snippet: snippet_around(text, at, SNIPPET),
    })
}

/// 스텝들을 훑어 걸린 것을 모은다.
///
/// **한 스텝이 여러 텍스트를 가진다.** SQL 스텝은 SQL 문과 바인딩 파라미터가 따로고,
/// ApiCall 은 URL 과 주소가 따로다. 어느 쪽에서 걸렸는지가 곧 답이라 나눠 본다.
///
/// 검색어는 **소문자로 정규화된 것**을 받는다 — 스텝마다 다시 낮추면 낭비다.
pub fn search_steps(steps: &[ProfileStep], texts: &StepTexts, needle_lower: &str) -> Vec<StepHit> {
    let mut out = Vec::new();
    if needle_lower.is_empty() {
        return out;
    }

    for (i, step) in steps.iter().enumerate() {
        match step {
            ProfileStep::Method(m) => {
                if let Some(t) = (texts.method)(m.hash) {
                    if let Some(h) = hit(i, "method", &t, needle_lower) {
                        out.push(h);
                    }
                }
            }
            ProfileStep::Sql(s) => {
                if let Some(t) = (texts.sql)(s.hash) {
                    if let Some(h) = hit(i, "sql", &t, needle_lower) {
                        out.push(h);
                        continue;
                    }
                }
                // 바인딩 값으로도 찾는다 — "이 주문번호가 들어간 쿼리" 를 찾는 게 실제 용도다.
                if let Some(h) = hit(i, "sql-param", &s.param, needle_lower) {
                    out.push(h);
                    continue;
                }
                if s.error != 0 {
                    if let Some(t) = (texts.error)(s.error) {
                        if let Some(h) = hit(i, "error", &t, needle_lower) {
                            out.push(h);
                        }
                    }
                }
            }
            ProfileStep::ApiCall(a) => {
                if let Some(t) = (texts.apicall)(a.hash) {
                    if let Some(h) = hit(i, "apicall", &t, needle_lower) {
                        out.push(h);
                        continue;
                    }
                }
                if let Some(h) = hit(i, "apicall-addr", &a.address, needle_lower) {
                    out.push(h);
                    continue;
                }
                if a.error != 0 {
                    if let Some(t) = (texts.error)(a.error) {
                        if let Some(h) = hit(i, "error", &t, needle_lower) {
                            out.push(h);
                        }
                    }
                }
            }
            ProfileStep::Message(m) => {
                // 해시가 0이면 본문이 직접 들어 있다 (MessageStep).
                let text = if m.hash != 0 {
                    (texts.hmsg)(m.hash).unwrap_or_default()
                } else {
                    m.message.clone()
                };
                if let Some(h) = hit(i, "message", &text, needle_lower) {
                    out.push(h);
                }
            }
            ProfileStep::Socket(s) => {
                let text = format!("{}:{}", s.ipaddr, s.port);
                if let Some(h) = hit(i, "socket", &text, needle_lower) {
                    out.push(h);
                }
            }
            ProfileStep::ThreadCall(t) => {
                // 이름은 apicall 사전에 있다 (XLogFlowView 와 같다).
                if let Some(name) = (texts.apicall)(t.hash) {
                    if let Some(h) = hit(i, "threadcall", &name, needle_lower) {
                        out.push(h);
                    }
                }
            }
            ProfileStep::Unknown { .. } => {}
        }
    }
    out
}

/// 프로파일에서 풀어야 할 해시들. 종류별로 나눠 담는다.
#[derive(Debug, Default, PartialEq)]
pub struct StepHashes {
    pub method: Vec<i32>,
    pub sql: Vec<i32>,
    pub apicall: Vec<i32>,
    pub error: Vec<i32>,
    pub hmsg: Vec<i32>,
}

/// 사전 조회에 쓸 해시를 모은다.
///
/// **종류를 섞으면 안 된다.** 같은 숫자라도 사전이 다르면 다른 텍스트다 —
/// method 사전으로 hmsg 해시를 물으면 에러 없이 빈 결과가 온다 (F-15).
pub fn collect_hashes(steps: &[ProfileStep]) -> StepHashes {
    let mut h = StepHashes::default();
    for step in steps {
        match step {
            ProfileStep::Method(m) if m.hash != 0 => h.method.push(m.hash),
            ProfileStep::Sql(s) => {
                if s.hash != 0 {
                    h.sql.push(s.hash);
                }
                if s.error != 0 {
                    h.error.push(s.error);
                }
            }
            ProfileStep::ApiCall(a) => {
                if a.hash != 0 {
                    h.apicall.push(a.hash);
                }
                if a.error != 0 {
                    h.error.push(a.error);
                }
            }
            ProfileStep::Message(m) if m.hash != 0 => h.hmsg.push(m.hash),
            ProfileStep::ThreadCall(t) if t.hash != 0 => h.apicall.push(t.hash),
            _ => {}
        }
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scouter::profile::{
        ApiCallProfileStep, MessageProfileStep, MethodProfileStep, SocketProfileStep,
        SqlProfileStep, StepBase,
    };
    use std::collections::HashMap;

    fn base() -> StepBase {
        StepBase { parent: -1, index: 0, start_time: 0, start_cpu: 0 }
    }

    fn sql(hash: i32, param: &str, error: i32) -> ProfileStep {
        ProfileStep::Sql(SqlProfileStep {
            base: base(),
            hash,
            param: param.to_string(),
            elapsed: 1,
            error,
            updated: 0,
        })
    }

    fn dict(pairs: &[(i32, &str)]) -> HashMap<i32, String> {
        pairs.iter().map(|(h, t)| (*h, (*t).to_string())).collect()
    }

    /// 다섯 사전을 한 번에 세운다. 비어 있는 사전은 아무것도 못 푼다.
    struct Dicts {
        method: HashMap<i32, String>,
        sql: HashMap<i32, String>,
        apicall: HashMap<i32, String>,
        error: HashMap<i32, String>,
        hmsg: HashMap<i32, String>,
    }

    impl Dicts {
        fn empty() -> Self {
            Dicts {
                method: dict(&[]),
                sql: dict(&[]),
                apicall: dict(&[]),
                error: dict(&[]),
                hmsg: dict(&[]),
            }
        }
    }

    fn run(d: &Dicts, steps: &[ProfileStep], needle: &str) -> Vec<StepHit> {
        let mf = |x: i32| d.method.get(&x).cloned();
        let sf = |x: i32| d.sql.get(&x).cloned();
        let af = |x: i32| d.apicall.get(&x).cloned();
        let ef = |x: i32| d.error.get(&x).cloned();
        let hf = |x: i32| d.hmsg.get(&x).cloned();
        let t = StepTexts { method: &mf, sql: &sf, apicall: &af, error: &ef, hmsg: &hf };
        search_steps(steps, &t, needle)
    }

    #[test]
    fn sql_문에서_찾는다() {
        let mut d = Dicts::empty();
        d.sql = dict(&[(1, "SELECT * FROM ORDERS WHERE ID=?")]);
        let hits = run(&d, &[sql(1, "", 0)], "orders");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, "sql");
    }

    #[test]
    fn 바인딩_값으로도_찾는다() {
        // "이 주문번호가 들어간 쿼리" 를 찾는 게 실제 용도다.
        let mut d = Dicts::empty();
        d.sql = dict(&[(1, "SELECT * FROM ORDERS WHERE ID=?")]);
        let hits = run(&d, &[sql(1, "[A-99213]", 0)], "a-99213");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, "sql-param");
    }

    #[test]
    fn 대소문자를_가리지_않는다() {
        let mut d = Dicts::empty();
        d.sql = dict(&[(1, "select * from Orders")]);
        assert_eq!(run(&d, &[sql(1, "", 0)], "orders").len(), 1);
    }

    #[test]
    fn 에러_텍스트에서도_찾는다() {
        // 예외 종류로 트랜잭션을 찾는 게 이 기능의 큰 쓰임이다.
        let mut d = Dicts::empty();
        d.sql = dict(&[(1, "SELECT 1")]);
        d.error = dict(&[(9, "java.sql.SQLTimeoutException: timeout")]);
        let hits = run(&d, &[sql(1, "", 9)], "timeoutexception");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, "error");
    }

    #[test]
    fn 한_스텝은_한_번만_센다() {
        // SQL 문과 바인딩 값에 같은 단어가 있어도 스텝 하나다.
        // 두 번 세면 걸린 건수가 실제 트랜잭션 수와 어긋난다.
        let mut d = Dicts::empty();
        d.sql = dict(&[(1, "SELECT * FROM ORDERS")]);
        assert_eq!(run(&d, &[sql(1, "ORDERS", 0)], "orders").len(), 1);
    }

    #[test]
    fn 해시가_0인_메시지는_본문을_쓴다() {
        let d = Dicts::empty();
        let step = ProfileStep::Message(MessageProfileStep {
            base: base(),
            message: "cache miss for key=user:42".into(),
            hash: 0,
        });
        let hits = run(&d, &[step], "user:42");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, "message");
    }

    #[test]
    fn 소켓은_주소와_포트를_합쳐_본다() {
        let d = Dicts::empty();
        let step = ProfileStep::Socket(SocketProfileStep {
            base: base(),
            ipaddr: "10.89.2.13".into(),
            port: 5432,
            elapsed: 1,
            error: 0,
        });
        assert_eq!(run(&d, &[step], "10.89.2.13:5432").len(), 1);
    }

    #[test]
    fn 빈_검색어는_아무것도_걸리지_않는다() {
        // 빈 문자열은 어디에나 있다. 전부 걸리면 검색이 아니다.
        let mut d = Dicts::empty();
        d.sql = dict(&[(1, "SELECT 1")]);
        assert!(run(&d, &[sql(1, "", 0)], "").is_empty());
    }

    #[test]
    fn 못_푼_해시는_건너뛴다() {
        // 사전에 없으면 검색 대상이 없는 것이다. panic 하면 안 된다.
        let d = Dicts::empty();
        assert!(run(&d, &[sql(1, "", 0)], "select").is_empty());
    }

    #[test]
    fn 스텝_순번을_돌려준다() {
        // 상세를 열었을 때 걸린 자리로 데려가려면 순번이 있어야 한다.
        let mut d = Dicts::empty();
        d.sql = dict(&[(1, "A"), (2, "SELECT ORDERS")]);
        let hits = run(&d, &[sql(1, "", 0), sql(2, "", 0)], "orders");
        assert_eq!(hits[0].index, 1);
    }

    #[test]
    fn collect_hashes_는_종류를_섞지_않는다() {
        // method 사전으로 hmsg 해시를 물으면 에러 없이 빈 결과가 온다 (F-15).
        let steps = vec![
            ProfileStep::Method(MethodProfileStep { base: base(), hash: 11, elapsed: 0, cputime: 0 }),
            sql(22, "", 33),
            ProfileStep::Message(MessageProfileStep { base: base(), message: String::new(), hash: 44 }),
            ProfileStep::ApiCall(ApiCallProfileStep {
                base: base(), hash: 55, elapsed: 0, error: 66, txid: 0, address: String::new(),
            }),
        ];
        let h = collect_hashes(&steps);
        assert_eq!(h.method, vec![11]);
        assert_eq!(h.sql, vec![22]);
        assert_eq!(h.hmsg, vec![44]);
        assert_eq!(h.apicall, vec![55]);
        assert_eq!(h.error, vec![33, 66]);
    }

    #[test]
    fn 해시_0은_모으지_않는다() {
        // 0 은 "없음" 이다. 사전에 물으면 낭비고 결과도 없다.
        let steps = vec![ProfileStep::Method(MethodProfileStep {
            base: base(), hash: 0, elapsed: 0, cputime: 0,
        })];
        assert_eq!(collect_hashes(&steps), StepHashes::default());
    }
}

#[cfg(test)]
mod snippet_tests {
    use super::*;

    #[test]
    fn 짧은_텍스트는_그대로다() {
        assert_eq!(snippet_around("SELECT 1", 0, 160), "SELECT 1");
    }

    #[test]
    fn 걸린_자리를_가운데_둔다() {
        // 앞에서 자르면 SQL 처럼 앞부분이 비슷한 텍스트에서 찾은 단어가 잘려 나간다.
        let text = format!("{}NEEDLE{}", "a".repeat(200), "b".repeat(200));
        let at = text.find("NEEDLE").unwrap();
        let out = snippet_around(&text, at, 40);
        assert!(out.contains("NEEDLE"), "out={out}");
        assert!(out.starts_with('…') && out.ends_with('…'), "out={out}");
    }

    #[test]
    fn 한글도_글자_단위로_자른다() {
        // 바이트로 자르면 글자가 쪼개져 깨진다.
        let text = "가".repeat(300);
        let out = snippet_around(&text, 0, 20);
        assert!(out.chars().count() <= 22, "out len={}", out.chars().count());
        assert!(!out.contains('\u{FFFD}'));
    }
}
