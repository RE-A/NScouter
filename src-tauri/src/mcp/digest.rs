// MCP 도구가 돌려줄 글을 만든다 — 통신 없이 값만 다룬다(그래서 여기서 시험한다).
//
// **AI 에게 넘기는 양이 곧 비용이다.** 주 용도는 «문제 있는 트랜잭션을 찾아서 고치기» 라,
// 목록은 한 줄을 짧게(열 이름은 한 번만), 상세는 한 건에 10KB 남짓으로 줄여서 준다.
// 원본 스텝 수천 개를 그대로 넘기지 않는다 — 고칠 자리를 고르는 데 필요한 것만 추린다:
// 에러 · 느린 스텝 · 되풀이된 SQL/API · 앞부분 흐름.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::config::SavedFilterPrefs;
use crate::scouter::objtype::{civil_from_days, date_key};
use crate::scouter::pack::XLogPack;
use crate::scouter::profile::ProfileStep;
use crate::scouter::protocol::text_type;

const DAY_MS: i64 = 86_400_000;

// ─── 구간 ────────────────────────────────────────────────────

/// 목록 조회의 기본 구간(분)
pub const DEFAULT_MINUTES: u32 = 30;
/// 한 번에 훑을 수 있는 가장 긴 구간(분). 이보다 넓으면 콜렉터를 오래 붙잡는다
pub const MAX_MINUTES: u32 = 360;

/// 훑을 구간 (epoch ms, `[stime, etime)`)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Window {
    pub stime: i64,
    pub etime: i64,
}

/// 도구 인자에서 구간을 정한다.
///
/// - 아무것도 없으면 «지금부터 `minutes` 전까지» (기본 30분)
/// - `from` 만 있으면 그때부터 `minutes` 동안 (지금을 넘지 않게)
/// - `to` 만 있으면 그때까지 `minutes` 전부터
/// - 둘 다 있으면 그대로
///
/// 시각은 **이 PC 의 시간대**로 읽는다 — 화면에 보이는 시각과 같아야 사람이 말한 시각이 맞는다.
/// `now_ms` 는 콜렉터 시계다(PC 시계가 틀려도 «최근 30분» 이 빈 구간이 되지 않게).
pub fn resolve_window(
    now_ms: i64,
    tz_offset_ms: i64,
    minutes: Option<u32>,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<Window, String> {
    let minutes = minutes.unwrap_or(DEFAULT_MINUTES);
    if minutes == 0 || minutes > MAX_MINUTES {
        return Err(format!("minutes 는 1~{MAX_MINUTES} 사이여야 합니다 (받은 값 {minutes})"));
    }
    let span = minutes as i64 * 60_000;
    let from = from.map(str::trim).filter(|s| !s.is_empty());
    let to = to.map(str::trim).filter(|s| !s.is_empty());
    let parse = |s: &str| parse_local_time(s, tz_offset_ms);

    let (stime, etime) = match (from, to) {
        (None, None) => (now_ms - span, now_ms),
        (Some(f), None) => {
            let s = parse(f)?;
            (s, (s + span).min(now_ms))
        }
        (None, Some(t)) => {
            let e = parse(t)?;
            (e - span, e)
        }
        (Some(f), Some(t)) => (parse(f)?, parse(t)?),
    };
    if etime <= stime {
        return Err("구간의 끝이 시작보다 앞섭니다 (from < to 여야 하고, from 은 지금보다 앞이어야 합니다)".into());
    }
    if etime - stime > MAX_MINUTES as i64 * 60_000 {
        return Err(format!("구간은 최대 {}시간입니다. 좁혀서 다시 물어 주세요", MAX_MINUTES / 60));
    }
    Ok(Window { stime, etime })
}

/// `YYYY-MM-DD HH:MM[:SS]` (이 PC 시간대) → epoch ms. `T` 로 이어도 받는다
pub fn parse_local_time(s: &str, tz_offset_ms: i64) -> Result<i64, String> {
    let bad = || format!("시각 형식이 아닙니다: «{s}» (예: 2026-11-01 13:05 또는 2026-11-01 13:05:30)");
    let s = s.trim();
    let (date, time) = s.split_once(['T', ' ']).ok_or_else(bad)?;
    let d: Vec<&str> = date.split('-').collect();
    let t: Vec<&str> = time.trim().split(':').collect();
    if d.len() != 3 || !(2..=3).contains(&t.len()) {
        return Err(bad());
    }
    let num = |v: &str| v.parse::<i64>().map_err(|_| bad());
    let (y, mo, da) = (num(d[0])?, num(d[1])?, num(d[2])?);
    let (h, mi) = (num(t[0])?, num(t[1])?);
    // 초에 소수가 붙어 와도 받는다 (`13:05:30.250`)
    let sec_ms = match t.get(2) {
        Some(v) => (v.parse::<f64>().map_err(|_| bad())? * 1000.0).round() as i64,
        None => 0,
    };
    if !(1..=12).contains(&mo) || !(1..=31).contains(&da) || !(0..24).contains(&h) || !(0..60).contains(&mi)
        || !(0..60_000).contains(&sec_ms)
    {
        return Err(bad());
    }
    let days = days_from_civil(y, mo as u32, da as u32);
    Ok(days * DAY_MS + h * 3_600_000 + mi * 60_000 + sec_ms - tz_offset_ms)
}

/// (년, 월, 일) → 에폭 기준 며칠째. `civil_from_days` 의 거꾸로 (Howard Hinnant)
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let mp = if m > 2 { m - 3 } else { m + 9 } as u64;
    let doy = (153 * mp + 2) / 5 + d as u64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe as i64 - 719_468
}

/// epoch ms → `YYYY-MM-DD HH:MM:SS.mmm` (이 PC 시간대)
pub fn fmt_local(ms: i64, tz_offset_ms: i64) -> String {
    let local = ms + tz_offset_ms;
    let (y, m, d) = civil_from_days(local.div_euclid(DAY_MS));
    let in_day = local.rem_euclid(DAY_MS);
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}.{:03}",
        in_day / 3_600_000,
        in_day / 60_000 % 60,
        in_day / 1000 % 60,
        in_day % 1000
    )
}

/// `+09:00` 같은 시간대 표기
pub fn fmt_tz(tz_offset_ms: i64) -> String {
    let sign = if tz_offset_ms < 0 { '-' } else { '+' };
    let m = tz_offset_ms.abs() / 60_000;
    format!("{sign}{:02}:{:02}", m / 60, m % 60)
}

// ─── 트랜잭션 참조 ───────────────────────────────────────────

/// 목록이 주고 상세가 받는 참조 — `txid:yyyymmdd`.
///
/// **날짜가 꼭 있어야 한다.** 콜렉터는 XLog 를 날짜별로 저장해서, 날짜가 틀리면 에러가 아니라
/// 빈 결과가 온다(F-15). txid 만 주면 AI 가 날짜를 짐작해야 한다.
pub fn make_ref(txid: i64, end_time: i64, tz_offset_ms: i64) -> String {
    format!("{txid}:{}", date_key(end_time, tz_offset_ms))
}

/// `txid:yyyymmdd` → (txid, 날짜)
pub fn parse_ref(r: &str) -> Result<(i64, String), String> {
    let bad = || format!("ref 형식이 아닙니다: «{r}» (search_transactions 가 준 `txid:yyyymmdd` 를 그대로 넘겨 주세요)");
    let (txid, date) = r.trim().split_once(':').ok_or_else(bad)?;
    let txid: i64 = txid.trim().parse().map_err(|_| bad())?;
    let date = date.trim();
    if date.len() != 8 || !date.bytes().all(|b| b.is_ascii_digit()) {
        return Err(bad());
    }
    Ok((txid, date.to_string()))
}

// ─── 목록 ────────────────────────────────────────────────────

/// 목록에 돌려줄 수 있는 가장 많은 건수
pub const MAX_LIMIT: usize = 500;
/// 기본 건수
pub const DEFAULT_LIMIT: usize = 50;

/// 무엇으로 줄 세우나
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortBy {
    /// 느린 것부터 (기본) — 고칠 것을 찾는 자리
    Slowest,
    /// 최근 것부터
    Latest,
}

impl SortBy {
    pub fn parse(s: Option<&str>) -> Result<Self, String> {
        match s.map(str::trim).unwrap_or("slowest") {
            "" | "slowest" => Ok(Self::Slowest),
            "latest" => Ok(Self::Latest),
            other => Err(format!("sort 는 slowest 또는 latest 입니다 (받은 값 {other})")),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Slowest => "slowest",
            Self::Latest => "latest",
        }
    }
}

/// 포함·제외 글자 묶음 (소문자). **화면 `passesPatterns` 와 같은 규칙이다** —
/// 포함끼리는 OR(하나라도 맞으면), 제외는 하나라도 맞으면 뺀다(제외가 이긴다).
/// 빈 글자는 조건이 아니다 — 빈 제외로 전부를 지우면 안 된다.
#[derive(Debug, Clone, Default)]
pub struct Patterns {
    include: Vec<String>,
    exclude: Vec<String>,
}

impl Patterns {
    pub fn new(include: &[String], exclude: &[String]) -> Self {
        let mut p = Self::default();
        include.iter().for_each(|t| p.add(t, false));
        exclude.iter().for_each(|t| p.add(t, true));
        p
    }

    pub fn add(&mut self, text: &str, exclude: bool) {
        let t = text.trim().to_lowercase();
        if t.is_empty() {
            return;
        }
        if exclude { self.exclude.push(t) } else { self.include.push(t) }
    }

    pub fn is_empty(&self) -> bool {
        self.include.is_empty() && self.exclude.is_empty()
    }

    pub fn passes(&self, value: &str) -> bool {
        let v = value.to_lowercase();
        if self.exclude.iter().any(|e| v.contains(e.as_str())) {
            return false;
        }
        self.include.is_empty() || self.include.iter().any(|i| v.contains(i.as_str()))
    }
}

/// 소문자로 낮춘 «포함» 글자. 빈 글자는 조건이 아니다
pub fn contains_rule(s: Option<&str>) -> Option<String> {
    s.map(|v| v.trim().to_lowercase()).filter(|v| !v.is_empty())
}

/// 트랜잭션 조건 — XLog 화면의 필터(에러만 · 응답 이상/미만 · 서비스/IP 포함·제외 여러 줄)와
/// 트랜잭션 찾기 창의 로그인·설명·text1~5. 콜렉터의 과거 조회는 구간·서버만 받으므로 여기서 거른다.
#[derive(Debug, Clone, Default)]
pub struct RowFilter {
    pub error_only: bool,
    /// 이 응답시간(ms) **이상**만. 0 이면 조건 없음
    pub min_elapsed_ms: i32,
    /// 이 응답시간(ms) **미만**만 (화면의 `미만`). 0 이면 조건 없음
    pub max_elapsed_ms: i32,
    pub service: Patterns,
    pub ip: Patterns,
    /// 로그인 이름에 들어 있는 글자 (소문자)
    pub login: Option<String>,
    /// 설명(desc)에 들어 있는 글자 (소문자)
    pub desc: Option<String>,
    /// 앱 자유 필드 text1~5 에 들어 있는 글자 (소문자)
    pub text: [Option<String>; 5],
}

impl RowFilter {
    /// 이름을 풀지 않고 볼 수 있는 조건 — 사전 조회를 아끼려고 먼저 거른다
    pub fn passes_cheap(&self, x: &XLogPack) -> bool {
        if self.error_only && x.error == 0 {
            return false;
        }
        if self.min_elapsed_ms > 0 && x.elapsed < self.min_elapsed_ms {
            return false;
        }
        if self.max_elapsed_ms > 0 && x.elapsed >= self.max_elapsed_ms {
            return false;
        }
        if !self.ip.passes(&x.ipaddr) {
            return false;
        }
        let fields = [&x.text1, &x.text2, &x.text3, &x.text4, &x.text5];
        self.text
            .iter()
            .zip(fields)
            .all(|(want, have)| want.as_ref().is_none_or(|w| have.to_lowercase().contains(w.as_str())))
    }

    /// 이름을 풀어야 볼 수 있는 조건에 쓰는 사전 종류들
    pub fn name_kinds(&self) -> Vec<&'static str> {
        let mut k = Vec::new();
        if !self.service.is_empty() {
            k.push(text_type::SERVICE);
        }
        if self.login.is_some() {
            k.push(text_type::LOGIN);
        }
        if self.desc.is_some() {
            k.push(text_type::DESC);
        }
        k
    }

    /// 이 트랜잭션에서 풀어야 할 (사전 종류, 해시)
    pub fn name_hashes(&self, x: &XLogPack) -> Vec<(&'static str, i32)> {
        self.name_kinds()
            .into_iter()
            .map(|k| match k {
                text_type::SERVICE => (k, x.service),
                text_type::LOGIN => (k, x.login),
                _ => (k, x.desc),
            })
            .collect()
    }

    /// 이름 조건. **못 푼 이름은 빈 이름으로 본다** (화면과 같다) — 포함이면 빠지고 제외면 남는다
    pub fn passes_names(&self, x: &XLogPack, texts: &dyn Texts) -> bool {
        if !self.service.is_empty() && !self.service.passes(&texts.text(text_type::SERVICE, x.service).unwrap_or_default()) {
            return false;
        }
        let has = |want: &Option<String>, kind: &str, h: i32| match want {
            None => true,
            Some(w) => h != 0 && texts.text(kind, h).is_some_and(|n| n.to_lowercase().contains(w.as_str())),
        };
        has(&self.login, text_type::LOGIN, x.login) && has(&self.desc, text_type::DESC, x.desc)
    }

    /// 화면에서 이름 붙여 담아 둔 조건을 얹는다. 서비스·IP 줄은 더하고(같은 규칙으로 합쳐진다),
    /// «에러만» 은 둘 중 하나라도 켜져 있으면 켠다. 응답시간은 **직접 준 값이 없을 때만** 담아 둔 값을 쓴다
    pub fn apply_saved(&mut self, saved: &SavedFilterPrefs) {
        for p in &saved.patterns {
            match p.field.as_str() {
                "service" => self.service.add(&p.text, p.exclude),
                "ip" => self.ip.add(&p.text, p.exclude),
                _ => {}
            }
        }
        self.error_only |= saved.error_only;
        if self.min_elapsed_ms == 0 && self.max_elapsed_ms == 0 && saved.elapsed_ms > 0 {
            let ms = saved.elapsed_ms.min(i32::MAX as i64) as i32;
            if saved.elapsed_exclude { self.max_elapsed_ms = ms } else { self.min_elapsed_ms = ms }
        }
    }
}

// ─── 서버 고르기 ─────────────────────────────────────────────

/// 논리 서비스 묶기 규칙 — 화면 `instanceGroup.serviceNameOf` 와 같다.
/// 태그(`tag_key`)가 있으면 그 값, 없으면 짧은 이름에 정규식을 걸어 `svc` 이름 그룹(없으면 첫 캡처).
///
/// **정규식은 Rust 문법으로 읽는다.** 화면(JavaScript)과 거의 같지만 lookbehind 같은 일부는
/// 못 쓴다 — 그때는 컴파일이 안 돼 이름 규칙으로는 묶이지 않는다(태그로는 묶인다).
pub struct GroupRule {
    tag_key: String,
    re: Option<regex::Regex>,
}

impl GroupRule {
    pub fn new(tag_key: &str, pattern: &str) -> Self {
        Self { tag_key: tag_key.to_string(), re: regex::Regex::new(pattern).ok() }
    }

    pub fn service_of(&self, obj_name: &str, tags: &[(String, String)]) -> Option<String> {
        if let Some((_, v)) = tags.iter().find(|(k, v)| *k == self.tag_key && !v.trim().is_empty()) {
            return Some(v.trim().to_string());
        }
        let short = obj_name.split('/').rfind(|s| !s.is_empty()).unwrap_or(obj_name);
        let c = self.re.as_ref()?.captures(short)?;
        let name = c.name("svc").or_else(|| c.get(1))?.as_str().trim();
        (!name.is_empty()).then(|| name.to_string())
    }
}

/// 어느 서버(오브젝트)를 훑을지. 화면에서 «서비스로 묶어 고른 것» 과 «낱개로 고른 것» 을
/// 합쳐 보듯 **이름 포함과 서비스 묶음은 OR**, 제외는 어느 쪽이든 뺀다
#[derive(Debug, Clone, Default)]
pub struct ServerFilter {
    /// 이름·종류에 들어 있는 글자
    pub names: Patterns,
    /// 논리 서비스 이름 (소문자, 완전 일치)
    pub groups: Vec<String>,
}

impl ServerFilter {
    pub fn is_empty(&self) -> bool {
        self.names.is_empty() && self.groups.is_empty()
    }

    pub fn picks(&self, name: &str, kind: &str, group: Option<&str>) -> bool {
        let (n, k) = (name.to_lowercase(), kind.to_lowercase());
        if self.names.exclude.iter().any(|e| n.contains(e.as_str()) || k.contains(e.as_str())) {
            return false;
        }
        if self.names.include.is_empty() && self.groups.is_empty() {
            return true;
        }
        self.names.include.iter().any(|i| n.contains(i.as_str()) || k.contains(i.as_str()))
            || group.is_some_and(|g| self.groups.iter().any(|w| *w == g.to_lowercase()))
    }
}

/// 서비스 하나의 합계
#[derive(Debug, Clone, Default)]
struct ServiceAgg {
    count: u64,
    errors: u64,
    sum_ms: i64,
    max_ms: i32,
}

/// 훑으면서 걸린 것을 모은다. **위 `limit` 건만 남긴다** — 20만 건을 다 들고 있지 않는다
pub struct Collector {
    sort: SortBy,
    limit: usize,
    kept: Vec<XLogPack>,
    pub matched: u64,
    pub matched_errors: u64,
    by_service: HashMap<i32, ServiceAgg>,
}

impl Collector {
    pub fn new(sort: SortBy, limit: usize) -> Self {
        Self { sort, limit, kept: Vec::new(), matched: 0, matched_errors: 0, by_service: HashMap::new() }
    }

    pub fn add(&mut self, x: XLogPack) {
        self.matched += 1;
        if x.error != 0 {
            self.matched_errors += 1;
        }
        let agg = self.by_service.entry(x.service).or_default();
        agg.count += 1;
        agg.errors += (x.error != 0) as u64;
        agg.sum_ms += x.elapsed as i64;
        agg.max_ms = agg.max_ms.max(x.elapsed);

        self.kept.push(x);
        // 매번 정렬하지 않고, 두 배로 불면 한 번 잘라낸다
        if self.kept.len() >= self.limit.max(1) * 2 {
            self.trim();
        }
    }

    fn trim(&mut self) {
        match self.sort {
            SortBy::Slowest => self.kept.sort_by(|a, b| b.elapsed.cmp(&a.elapsed).then(b.end_time.cmp(&a.end_time))),
            SortBy::Latest => self.kept.sort_by(|a, b| b.end_time.cmp(&a.end_time).then(b.elapsed.cmp(&a.elapsed))),
        }
        self.kept.truncate(self.limit);
    }

    /// 줄 세워 위 `limit` 건
    pub fn finish(mut self) -> CollectorResult {
        self.trim();
        let mut services: Vec<(i32, ServiceAgg)> = self.by_service.into_iter().collect();
        // 많이 걸린 서비스부터 — «어디가 문제인가» 를 먼저 본다
        services.sort_by(|a, b| b.1.count.cmp(&a.1.count).then(b.1.max_ms.cmp(&a.1.max_ms)));
        services.truncate(TOP_SERVICES);
        CollectorResult {
            sort: self.sort,
            rows: self.kept,
            matched: self.matched,
            matched_errors: self.matched_errors,
            top_services: services
                .into_iter()
                .map(|(h, a)| TopService {
                    service: h,
                    count: a.count,
                    errors: a.errors,
                    avg_ms: if a.count > 0 { a.sum_ms / a.count as i64 } else { 0 },
                    max_ms: a.max_ms,
                })
                .collect(),
        }
    }
}

/// 요약에 올릴 서비스 수
const TOP_SERVICES: usize = 10;

pub struct TopService {
    pub service: i32,
    pub count: u64,
    pub errors: u64,
    pub avg_ms: i64,
    pub max_ms: i32,
}

pub struct CollectorResult {
    pub sort: SortBy,
    pub rows: Vec<XLogPack>,
    pub matched: u64,
    pub matched_errors: u64,
    pub top_services: Vec<TopService>,
}

/// 훑은 결과에 대한 사실들
pub struct ScanFacts {
    pub window: Window,
    pub tz_offset_ms: i64,
    pub scanned: u64,
    /// 상한에 걸려 구간을 다 못 훑었다. 그때 어디까지 봤나(epoch ms)
    pub truncated_at: Option<i64>,
    pub servers: usize,
    /// 프로파일 본문 검색을 했으면 그 사실들
    pub profile: Option<ProfileFacts>,
}

/// 프로파일 본문 검색
pub struct ProfileFacts {
    pub needle: String,
    /// XLog 조건에 걸린 건수 (프로파일을 열어 볼 후보)
    pub candidates: u64,
    /// 그중 실제로 열어 본 건수 (상한 `PROFILE_CANDIDATES`)
    pub searched: usize,
    /// 프로파일을 못 받은 건수 — 조용히 빼면 «안 걸렸다» 와 구별되지 않는다
    pub failed: usize,
}

/// 프로파일 본문 검색에서 열어 볼 후보의 상한. 건당 요청 하나라 수가 곧 시간이다
/// (가까운 콜렉터 약 2.5ms/건, 왕복 40ms 면 약 8.5ms/건 — `SEARCH_WORKERS` 주석)
pub const PROFILE_CANDIDATES: usize = 2_000;

/// 프로파일에서 걸린 자리 — 표에 실을 한 줄
pub struct ProfileHitView {
    /// 이 트랜잭션에서 걸린 스텝 수
    pub count: usize,
    /// 처음 걸린 스텝: sql / sql-param / apicall / apicall-addr / method / message / socket / error / threadcall
    pub kind: String,
    pub snippet: String,
}

/// 이름 찾기. (사전 종류, 해시) → 글
pub trait Texts {
    fn text(&self, kind: &str, hash: i32) -> Option<String>;
}

impl<F: Fn(&str, i32) -> Option<String>> Texts for F {
    fn text(&self, kind: &str, hash: i32) -> Option<String> {
        self(kind, hash)
    }
}

/// 목록 결과 → JSON. 행은 배열로 싣고 열 이름은 한 번만 적는다 (500행이면 꽤 차이가 난다)
pub fn search_result_json(
    res: &CollectorResult,
    facts: &ScanFacts,
    server_name: &dyn Fn(i32) -> String,
    texts: &dyn Texts,
    hits: &HashMap<i64, ProfileHitView>,
) -> Value {
    let tz = facts.tz_offset_ms;
    let service = |h: i32| texts.text(text_type::SERVICE, h).unwrap_or_else(|| format!("#{h}"));
    let rows: Vec<Value> = res
        .rows
        .iter()
        .map(|x| {
            let err = (x.error != 0).then(|| {
                clip(&texts.text(text_type::ERROR, x.error).unwrap_or_else(|| format!("#{}", x.error)), 120)
            });
            let mut row = json!([
                make_ref(x.txid, x.end_time, tz),
                fmt_local(x.end_time, tz),
                server_name(x.obj_hash),
                clip(&service(x.service), 200),
                x.elapsed,
                err,
                x.cpu,
                x.sql_count,
                x.sql_time,
                x.apicall_count,
                x.apicall_time,
                x.ipaddr,
            ]);
            if facts.profile.is_some() {
                let hit = hits.get(&x.txid).map(|h| {
                    let more = if h.count > 1 { format!(" (+{})", h.count - 1) } else { String::new() };
                    format!("{}: {}{more}", h.kind, h.snippet)
                });
                if let Value::Array(a) = &mut row {
                    a.push(json!(hit));
                }
            }
            row
        })
        .collect();

    let mut note = String::new();
    if let Some(at) = facts.truncated_at {
        note = format!(
            "검사 상한({}건)에 걸려 {} 까지만 훑었습니다. 구간을 좁히거나 server/service 조건을 더해 주세요.",
            facts.scanned,
            fmt_local(at, tz)
        );
    }
    if let Some(p) = &facts.profile {
        if !note.is_empty() {
            note.push(' ');
        }
        if p.candidates as usize > p.searched {
            note.push_str(&format!(
                "프로파일 검색: XLog 조건에 걸린 {}건 중 {}건({} 순)만 열어 봤습니다. 조건을 좁히면 빠짐없이 찾습니다. ",
                p.candidates,
                p.searched,
                res.sort.name()
            ));
        }
        if p.failed > 0 {
            note.push_str(&format!("프로파일 {}건은 받지 못해 못 찾았습니다. ", p.failed));
        }
    }
    if res.matched as usize > res.rows.len() {
        if !note.is_empty() && !note.ends_with(' ') {
            note.push(' ');
        }
        note.push_str(&format!(
            "걸린 {}건 중 {}건만 실었습니다({} 순). 상세는 get_transaction_details 에 ref 를 최대 5개씩 넘기세요.",
            res.matched,
            res.rows.len(),
            res.sort.name()
        ));
    }

    let note = note.trim_end().to_string();
    let mut columns = vec!["ref", "time", "server", "service", "elapsed_ms", "error", "cpu_ms",
                           "sql_count", "sql_ms", "api_count", "api_ms", "ip"];
    if facts.profile.is_some() {
        columns.push("profile_hit");
    }
    let mut out = json!({
        "window": {
            "from": fmt_local(facts.window.stime, tz),
            "to": fmt_local(facts.window.etime, tz),
            "tz": fmt_tz(tz),
        },
        "servers_scanned": facts.servers,
        "scanned": facts.scanned,
        "matched": res.matched,
        "matched_errors": res.matched_errors,
        "returned": res.rows.len(),
        "sort": res.sort.name(),
        "truncated": facts.truncated_at.is_some(),
        "note": note,
        "top_services": res.top_services.iter().map(|s| json!({
            "service": clip(&service(s.service), 200),
            "count": s.count,
            "errors": s.errors,
            "avg_ms": s.avg_ms,
            "max_ms": s.max_ms,
        })).collect::<Vec<_>>(),
        "columns": columns,
        "rows": rows,
    });
    if let Some(p) = &facts.profile {
        out["profile_search"] = json!({
            "text": p.needle,
            "candidates": p.candidates,
            "searched": p.searched,
            "failed": p.failed,
        });
    }
    out
}

// ─── 상세 ────────────────────────────────────────────────────

/// 한 번에 볼 수 있는 트랜잭션 수
pub const MAX_DETAIL_REFS: usize = 5;

/// 트랜잭션 하나에 쓸 글자 예산(바이트). 넘으면 흐름·글 길이를 줄여 다시 만든다
pub const DETAIL_BUDGET_BYTES: usize = 12_000;

/// 줄이는 단계: (흐름 줄 수, SQL·메시지 글 길이)
const SHRINK_LEVELS: [(usize, usize); 4] = [(40, 600), (20, 300), (10, 160), (0, 100)];

/// 느린 스텝 · SQL 묶음 · API 묶음 · 에러 를 각각 몇 개까지
const TOP_STEPS: usize = 10;
const TOP_SQL: usize = 10;
const TOP_API: usize = 8;
const TOP_ERRORS: usize = 10;

/// 흐름에 올릴 메서드의 문턱(ms). 메서드 스텝은 수가 많아 다 올리면 흐름이 메서드로 덮인다
const TIMELINE_METHOD_MIN_MS: i32 = 10;

/// 상세 한 건을 만든다. 예산을 넘으면 단계를 내려 다시 만든다
pub fn detail_json(
    reference: &str,
    x: &XLogPack,
    steps: &[ProfileStep],
    server_name: &str,
    texts: &dyn Texts,
    tz_offset_ms: i64,
    bind_values: bool,
) -> Value {
    let mut out = Value::Null;
    for (timeline_max, text_max) in SHRINK_LEVELS {
        out = build_detail(reference, x, steps, server_name, texts, tz_offset_ms, bind_values, timeline_max, text_max);
        if out.to_string().len() <= DETAIL_BUDGET_BYTES {
            break;
        }
    }
    out
}

/// 스텝 하나를 사람이 읽을 모양으로 — (종류, 시작 ms, 걸린 ms, 글, 에러 해시)
struct StepView {
    kind: &'static str,
    start: i64,
    elapsed: i32,
    text: String,
    error: i32,
}

///
/// 바인딩 값은 싣지 않는다 — 허용했을 때도 SQL 묶음의 `slowest_params` 한 곳에만 둔다.
fn view_step(s: &ProfileStep, texts: &dyn Texts) -> Option<StepView> {
    let name = |kind: &str, h: i32| texts.text(kind, h).unwrap_or_else(|| format!("#{h}"));
    Some(match s {
        ProfileStep::Method(m) => StepView {
            kind: "method",
            start: m.base.start_time,
            elapsed: m.elapsed,
            text: name(text_type::METHOD, m.hash),
            error: 0,
        },
        ProfileStep::Sql(q) => StepView {
            kind: "sql",
            start: q.base.start_time,
            elapsed: q.elapsed,
            text: name(text_type::SQL, q.hash),
            error: q.error,
        },
        ProfileStep::ApiCall(a) => {
            let mut text = name(text_type::APICALL, a.hash);
            if !a.address.is_empty() {
                text.push_str(&format!(" ({})", a.address));
            }
            StepView { kind: "api", start: a.base.start_time, elapsed: a.elapsed, text, error: a.error }
        }
        ProfileStep::Message(m) => StepView {
            kind: "message",
            start: m.base.start_time,
            elapsed: 0,
            text: if m.hash != 0 { name(text_type::HASH_MSG, m.hash) } else { m.message.clone() },
            error: 0,
        },
        ProfileStep::Socket(k) => StepView {
            kind: "socket",
            start: k.base.start_time,
            elapsed: k.elapsed,
            text: format!("{}:{}", k.ipaddr, k.port),
            error: k.error,
        },
        ProfileStep::ThreadCall(t) => StepView {
            kind: "thread",
            start: t.base.start_time,
            elapsed: t.elapsed,
            text: if t.threaded && t.txid != 0 {
                format!("{} → txid {}", name(text_type::APICALL, t.hash), t.txid)
            } else {
                name(text_type::APICALL, t.hash)
            },
            error: 0,
        },
        ProfileStep::Unknown { .. } => return None,
    })
}

/// 같은 SQL/API 를 묶은 합계
#[derive(Default)]
struct Group {
    count: u32,
    total_ms: i64,
    max_ms: i32,
    errors: u32,
    rows: i64,
    /// 가장 느렸던 한 번의 바인딩 값 (허용했을 때만)
    slowest_param: Option<String>,
    address: String,
}

#[allow(clippy::too_many_arguments)]
fn build_detail(
    reference: &str,
    x: &XLogPack,
    steps: &[ProfileStep],
    server_name: &str,
    texts: &dyn Texts,
    tz: i64,
    bind_values: bool,
    timeline_max: usize,
    text_max: usize,
) -> Value {
    let name = |kind: &str, h: i32| texts.text(kind, h).unwrap_or_else(|| format!("#{h}"));
    let views: Vec<StepView> = steps.iter().filter_map(|s| view_step(s, texts)).collect();

    // 에러 — 스텝에 붙은 것
    let errors: Vec<Value> = views
        .iter()
        .filter(|v| v.error != 0)
        .take(TOP_ERRORS)
        .map(|v| {
            json!({
                "at_ms": v.start,
                "kind": v.kind,
                "step": clip(&v.text, text_max),
                "error": clip(&name(text_type::ERROR, v.error), text_max),
            })
        })
        .collect();

    // 느린 스텝
    let mut slow: Vec<&StepView> = views.iter().filter(|v| v.elapsed > 0).collect();
    slow.sort_by_key(|v| std::cmp::Reverse(v.elapsed));
    let slowest: Vec<Value> = slow
        .iter()
        .take(TOP_STEPS)
        .map(|v| json!({ "at_ms": v.start, "kind": v.kind, "elapsed_ms": v.elapsed, "text": clip(&v.text, text_max) }))
        .collect();

    // SQL · API 묶음
    let mut sql: HashMap<i32, Group> = HashMap::new();
    let mut api: HashMap<i32, Group> = HashMap::new();
    for s in steps {
        match s {
            ProfileStep::Sql(q) => {
                let g = sql.entry(q.hash).or_default();
                if bind_values && (g.count == 0 || q.elapsed > g.max_ms) && !q.param.is_empty() {
                    g.slowest_param = Some(q.param.clone());
                }
                g.count += 1;
                g.total_ms += q.elapsed as i64;
                g.max_ms = g.max_ms.max(q.elapsed);
                g.errors += (q.error != 0) as u32;
                g.rows += q.updated.max(0) as i64;
            }
            ProfileStep::ApiCall(a) => {
                let g = api.entry(a.hash).or_default();
                g.count += 1;
                g.total_ms += a.elapsed as i64;
                g.max_ms = g.max_ms.max(a.elapsed);
                g.errors += (a.error != 0) as u32;
                if g.address.is_empty() {
                    g.address = a.address.clone();
                }
            }
            _ => {}
        }
    }
    let sql_groups = sql.len();
    let mut sql: Vec<(i32, Group)> = sql.into_iter().collect();
    sql.sort_by(|a, b| b.1.total_ms.cmp(&a.1.total_ms).then(b.1.count.cmp(&a.1.count)));
    let sql: Vec<Value> = sql
        .iter()
        .take(TOP_SQL)
        .map(|(h, g)| {
            let mut v = json!({
                "sql": clip(&name(text_type::SQL, *h), text_max),
                "count": g.count,
                "total_ms": g.total_ms,
                "max_ms": g.max_ms,
                "errors": g.errors,
                "rows": g.rows,
            });
            if let Some(p) = &g.slowest_param {
                v["slowest_params"] = json!(clip(p, text_max));
            }
            v
        })
        .collect();
    let api_groups = api.len();
    let mut api: Vec<(i32, Group)> = api.into_iter().collect();
    api.sort_by_key(|g| std::cmp::Reverse(g.1.total_ms));
    let api: Vec<Value> = api
        .iter()
        .take(TOP_API)
        .map(|(h, g)| {
            json!({
                "api": clip(&name(text_type::APICALL, *h), text_max),
                "address": g.address,
                "count": g.count,
                "total_ms": g.total_ms,
                "max_ms": g.max_ms,
                "errors": g.errors,
            })
        })
        .collect();

    // 흐름 — 앞에서부터. 짧은 메서드는 뺀다
    let flow: Vec<&StepView> = views
        .iter()
        .filter(|v| v.kind != "method" || v.elapsed >= TIMELINE_METHOD_MIN_MS)
        .collect();
    let timeline: Vec<String> = flow
        .iter()
        .take(timeline_max)
        .map(|v| {
            let err = if v.error != 0 { " !ERR" } else { "" };
            format!("+{}ms {} {}ms{} {}", v.start, v.kind, v.elapsed, err, clip(&v.text, text_max.min(200)))
        })
        .collect();

    let mut out = json!({
        "ref": reference,
        "service": clip(&name(text_type::SERVICE, x.service), 300),
        "server": server_name,
        "end_time": fmt_local(x.end_time, tz),
        "elapsed_ms": x.elapsed,
        "cpu_ms": x.cpu,
        "sql_count": x.sql_count,
        "sql_ms": x.sql_time,
        "api_count": x.apicall_count,
        "api_ms": x.apicall_time,
        "ip": x.ipaddr,
        "error": (x.error != 0).then(|| clip(&name(text_type::ERROR, x.error), text_max.max(300))),
        "profile_steps": steps.len(),
        "errors": errors,
        "slowest_steps": slowest,
        "sql": sql,
        "sql_distinct": sql_groups,
        "api": api,
        "api_distinct": api_groups,
        "timeline": timeline,
        "timeline_omitted": flow.len().saturating_sub(timeline_max),
        "timeline_note": format!("{TIMELINE_METHOD_MIN_MS}ms 미만 메서드는 흐름에서 뺐습니다. at_ms·+ms 는 트랜잭션 시작부터"),
    });
    if !bind_values {
        out["bind_values"] = json!("hidden (NScouter 설정에서 허용할 수 있음)");
    }
    if x.gxid != 0 {
        out["gxid"] = json!(x.gxid.to_string());
    }
    if x.caller != 0 {
        out["caller_txid"] = json!(x.caller.to_string());
    }
    if x.login != 0 {
        if let Some(l) = texts.text(text_type::LOGIN, x.login) {
            out["login"] = json!(l);
        }
    }
    if x.desc != 0 {
        if let Some(d) = texts.text(text_type::DESC, x.desc) {
            out["desc"] = json!(clip(&d, 300));
        }
    }
    for (k, v) in [("text1", &x.text1), ("text2", &x.text2), ("text3", &x.text3), ("text4", &x.text4), ("text5", &x.text5)] {
        if !v.is_empty() {
            out[k] = json!(clip(v, 300));
        }
    }
    out
}

/// 상세에 필요한 사전 해시들 (종류, 해시)
pub fn detail_hashes(x: &XLogPack, steps: &[ProfileStep]) -> Vec<(&'static str, i32)> {
    let mut out = vec![(text_type::SERVICE, x.service)];
    if x.error != 0 {
        out.push((text_type::ERROR, x.error));
    }
    if x.login != 0 {
        out.push((text_type::LOGIN, x.login));
    }
    if x.desc != 0 {
        out.push((text_type::DESC, x.desc));
    }
    for s in steps {
        match s {
            ProfileStep::Method(m) => out.push((text_type::METHOD, m.hash)),
            ProfileStep::Sql(q) => {
                out.push((text_type::SQL, q.hash));
                if q.error != 0 {
                    out.push((text_type::ERROR, q.error));
                }
            }
            ProfileStep::ApiCall(a) => {
                out.push((text_type::APICALL, a.hash));
                if a.error != 0 {
                    out.push((text_type::ERROR, a.error));
                }
            }
            ProfileStep::Message(m) if m.hash != 0 => out.push((text_type::HASH_MSG, m.hash)),
            ProfileStep::Socket(k) if k.error != 0 => out.push((text_type::ERROR, k.error)),
            ProfileStep::ThreadCall(t) => out.push((text_type::APICALL, t.hash)),
            _ => {}
        }
    }
    out.retain(|(_, h)| *h != 0);
    out.sort_unstable();
    out.dedup();
    out
}

/// 글자 수로 자른다 (바이트로 자르면 한글이 깨진다)
pub fn clip(s: &str, max_chars: usize) -> String {
    let mut it = s.char_indices();
    match it.nth(max_chars) {
        None => s.to_string(),
        Some((i, _)) => format!("{}…(+{}자)", &s[..i], s[i..].chars().count()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scouter::profile::{ApiCallProfileStep, MethodProfileStep, SqlProfileStep, StepBase};

    const KST: i64 = 9 * 3_600_000;

    fn xlog(txid: i64, end: i64, elapsed: i32, error: i32) -> XLogPack {
        XLogPack {
            txid,
            end_time: end,
            elapsed,
            error,
            service: 7,
            obj_hash: 1,
            ipaddr: "10.0.0.1".into(),
            ..XLogPack::default()
        }
    }

    fn base(i: i32, start: i64) -> StepBase {
        StepBase { parent: -1, index: i, start_time: start, start_cpu: 0 }
    }

    fn texts() -> impl Fn(&str, i32) -> Option<String> {
        |kind: &str, h: i32| Some(format!("{kind}-{h}"))
    }

    #[test]
    fn 시각은_이_pc_시간대로_읽고_쓴다() {
        let ms = parse_local_time("2026-11-01 13:05:30", KST).unwrap();
        assert_eq!(fmt_local(ms, KST), "2026-11-01 13:05:30.000");
        // KST 13:05:30 = UTC 04:05:30
        assert_eq!(fmt_local(ms, 0), "2026-11-01 04:05:30.000");
        assert_eq!(parse_local_time("2026-11-01T13:05", KST).unwrap(), ms - 30_000);
        assert!(parse_local_time("13:05", KST).is_err());
        assert!(parse_local_time("2026-13-01 10:00", KST).is_err());
    }

    #[test]
    fn 날짜_계산은_양쪽이_맞물린다() {
        for days in [-800_000i64, -1, 0, 1, 11_016, 20_758, 60_000] {
            let (y, m, d) = civil_from_days(days);
            assert_eq!(days_from_civil(y, m, d), days, "{y}-{m}-{d}");
        }
    }

    #[test]
    fn 구간은_기본이_최근_30분이고_6시간을_넘지_못한다() {
        let now = parse_local_time("2026-11-01 13:00", KST).unwrap();
        let w = resolve_window(now, KST, None, None, None).unwrap();
        assert_eq!(w, Window { stime: now - 30 * 60_000, etime: now });

        assert!(resolve_window(now, KST, Some(361), None, None).is_err());
        assert!(resolve_window(now, KST, None, Some("2026-11-01 01:00"), Some("2026-11-01 08:00")).is_err());

        // from 만 주면 그때부터 minutes, 지금을 넘지 않는다
        let w = resolve_window(now, KST, Some(60), Some("2026-11-01 12:30"), None).unwrap();
        assert_eq!(w.etime, now);
        // to 만 주면 그때까지
        let w = resolve_window(now, KST, Some(10), None, Some("2026-11-01 09:00")).unwrap();
        assert_eq!(w.etime - w.stime, 10 * 60_000);
        // 미래에서 시작하면 거른다
        assert!(resolve_window(now, KST, None, Some("2026-11-01 14:00"), None).is_err());
    }

    #[test]
    fn ref_는_날짜를_달고_되읽힌다() {
        // KST 2026-11-01 00:10 은 UTC 로는 10월 31일이다 — 날짜는 이 PC 기준이어야 한다
        let end = parse_local_time("2026-11-01 00:10", KST).unwrap();
        let r = make_ref(-123456789, end, KST);
        assert_eq!(r, "-123456789:20261101");
        assert_eq!(parse_ref(&r).unwrap(), (-123456789, "20261101".to_string()));
        assert!(parse_ref("123").is_err());
        assert!(parse_ref("123:2026-11-01").is_err());
    }

    #[test]
    fn 느린_순으로_위_limit_건만_남긴다() {
        let mut c = Collector::new(SortBy::Slowest, 3);
        for i in 0..100 {
            c.add(xlog(i, 1_000 + i, (i * 37 % 101) as i32, (i % 10 == 0) as i32));
        }
        let r = c.finish();
        assert_eq!(r.matched, 100);
        assert_eq!(r.matched_errors, 10);
        let el: Vec<i32> = r.rows.iter().map(|x| x.elapsed).collect();
        assert_eq!(el.len(), 3);
        assert!(el.windows(2).all(|w| w[0] >= w[1]), "{el:?}");
        assert_eq!(el[0], 99.max(*el.iter().max().unwrap()));
        assert_eq!(r.top_services[0].count, 100);
    }

    #[test]
    fn 최근_순이면_끝난_시각으로_줄_세운다() {
        let mut c = Collector::new(SortBy::Latest, 2);
        for i in 0..10 {
            c.add(xlog(i, 1_000 + i, 5000 - i as i32, 0));
        }
        let r = c.finish();
        assert_eq!(r.rows.iter().map(|x| x.txid).collect::<Vec<_>>(), vec![9, 8]);
    }

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn 포함은_or_제외가_이기고_빈_글자는_조건이_아니다() {
        // 화면 passesPatterns 와 같은 규칙
        let p = Patterns::new(&v(&["/shop/order", "/shop/cart"]), &v(&["/health", " "]));
        assert!(p.passes("/SHOP/order/1"), "대소문자 무시, 둘 중 하나면 통과");
        assert!(p.passes("/shop/cart"));
        assert!(!p.passes("/shop/products"));
        assert!(!p.passes("/shop/order/health"), "제외가 이긴다");
        assert!(Patterns::new(&v(&[""]), &v(&[""])).is_empty(), "빈 줄이 전부를 지우면 안 된다");
        assert!(Patterns::default().passes("아무거나"));
    }

    #[test]
    fn 조건은_에러_응답시간_이상_미만_ip_text_를_본다() {
        let f = RowFilter {
            error_only: true,
            min_elapsed_ms: 1000,
            max_elapsed_ms: 3000,
            ip: Patterns::new(&v(&["10.0."]), &v(&["10.0.0.9"])),
            text: [None, Some("vip".into()), None, None, None],
            ..RowFilter::default()
        };
        let mut x = xlog(1, 0, 1500, 3);
        x.text2 = "grade=VIP".into();
        assert!(f.passes_cheap(&x));
        assert!(!f.passes_cheap(&XLogPack { error: 0, ..x.clone() }), "에러만");
        assert!(!f.passes_cheap(&XLogPack { elapsed: 999, ..x.clone() }), "이상");
        assert!(!f.passes_cheap(&XLogPack { elapsed: 3000, ..x.clone() }), "미만 — 같으면 빠진다");
        assert!(!f.passes_cheap(&XLogPack { ipaddr: "10.0.0.9".into(), ..x.clone() }), "IP 제외");
        assert!(!f.passes_cheap(&XLogPack { text2: String::new(), ..x.clone() }), "text2");
        // 0 은 «조건 없음»
        assert!(RowFilter::default().passes_cheap(&xlog(1, 0, 0, 0)));
    }

    #[test]
    fn 이름_조건은_서비스_로그인_설명을_풀어서_본다() {
        let f = RowFilter {
            service: Patterns::new(&v(&["service-7"]), &[]),
            login: Some("kim".into()),
            ..RowFilter::default()
        };
        assert_eq!(f.name_kinds(), vec![text_type::SERVICE, text_type::LOGIN]);
        let names = |kind: &str, h: i32| match kind {
            "login" => Some(format!("Kim{h}")),
            _ => Some(format!("{kind}-{h}")),
        };
        let mut x = xlog(1, 0, 10, 0);
        x.login = 3;
        assert!(f.passes_names(&x, &names));
        assert!(!f.passes_names(&XLogPack { login: 0, ..x.clone() }, &names), "로그인이 없으면 못 건다");
        // 못 푼 서비스는 빈 이름 — 포함 조건이면 빠진다
        assert!(!f.passes_names(&x, &|_: &str, _: i32| None));
        let only_ex = RowFilter { service: Patterns::new(&[], &v(&["health"])), ..RowFilter::default() };
        assert!(only_ex.passes_names(&x, &|_: &str, _: i32| None), "제외 조건이면 남는다");
    }

    #[test]
    fn 담아_둔_조건을_얹는다() {
        let saved = SavedFilterPrefs {
            name: "결제만".into(),
            patterns: vec![
                crate::config::PatternPrefs { field: "service".into(), text: "/pay".into(), exclude: false },
                crate::config::PatternPrefs { field: "ip".into(), text: "10.9.".into(), exclude: true },
            ],
            error_only: true,
            elapsed_ms: 2000,
            elapsed_exclude: true,
        };
        let mut f = RowFilter::default();
        f.apply_saved(&saved);
        assert!(f.error_only);
        assert_eq!((f.min_elapsed_ms, f.max_elapsed_ms), (0, 2000), "미만으로 담아 뒀다");
        assert!(f.service.passes("/pay/approve") && !f.service.passes("/shop"));
        assert!(!f.ip.passes("10.9.1.1"));
        // 직접 준 응답시간이 이긴다
        let mut g = RowFilter { min_elapsed_ms: 500, ..RowFilter::default() };
        g.apply_saved(&saved);
        assert_eq!((g.min_elapsed_ms, g.max_elapsed_ms), (500, 0));
    }

    #[test]
    fn 서비스_묶기는_태그가_먼저고_없으면_이름_규칙이다() {
        let rule = GroupRule::new("service", "^(?<svc>.+?)-ip-[0-9-]+");
        assert_eq!(rule.service_of("/ecs/safs-ip-10-75-1-3", &[]).as_deref(), Some("safs"));
        let tags = vec![("service".to_string(), "pay".to_string())];
        assert_eq!(rule.service_of("/ecs/safs-ip-10-75-1-3", &tags).as_deref(), Some("pay"));
        assert_eq!(rule.service_of("/vm/order-app", &[]), None);
        // 이름 그룹이 없으면 첫 캡처
        assert_eq!(GroupRule::new("x", "^(.+)-\\d+$").service_of("/a/svc-2", &[]).as_deref(), Some("svc"));
        // 깨진 정규식은 묶지 않는다 (던지지 않는다)
        assert_eq!(GroupRule::new("x", "(").service_of("/a/b", &[]), None);
    }

    #[test]
    fn 서버는_이름_포함과_서비스_묶음이_or_이고_제외가_이긴다() {
        let f = ServerFilter { names: Patterns::new(&v(&["order"]), &v(&["hikari"])), groups: v(&["safs"]) };
        assert!(f.picks("/vm/order-app", "tomcat", None));
        assert!(f.picks("/ecs/safs-ip-1", "tomcat", Some("SAFS")), "묶음 이름은 대소문자 무시");
        assert!(!f.picks("/vm/order-app/HikariPool-1", "datasource", None), "제외가 이긴다");
        assert!(!f.picks("/vm/shop-app", "tomcat", None));
        assert!(f.picks("/vm/x", "linux", None) == false);
        assert!(ServerFilter::default().picks("/vm/x", "linux", None), "비우면 전부");
        let by_type = ServerFilter { names: Patterns::new(&v(&["tomcat"]), &[]), groups: vec![] };
        assert!(by_type.picks("/vm/shop-app", "tomcat", None), "종류로도 고른다");
    }

    #[test]
    fn 목록은_열_이름을_한_번만_적고_ref_를_싣는다() {
        let mut c = Collector::new(SortBy::Slowest, 50);
        c.add(xlog(42, parse_local_time("2026-11-01 10:00", KST).unwrap(), 3000, 5));
        let res = c.finish();
        let facts = ScanFacts {
            window: Window { stime: 0, etime: 1 },
            tz_offset_ms: KST,
            scanned: 10,
            truncated_at: None,
            servers: 2,
            profile: None,
        };
        let v = search_result_json(&res, &facts, &|h| format!("srv{h}"), &texts(), &HashMap::new());
        assert_eq!(v["columns"][0], "ref");
        assert_eq!(v["rows"][0][0], "42:20261101");
        assert_eq!(v["rows"][0][2], "srv1");
        assert_eq!(v["rows"][0][3], "service-7");
        assert_eq!(v["rows"][0][5], "error-5");
        assert_eq!(v["truncated"], false);
        assert_eq!(v["note"], "");
        assert_eq!(v["columns"].as_array().unwrap().len(), 12, "프로파일 검색을 안 했으면 열이 늘지 않는다");
    }

    #[test]
    fn 프로파일_검색을_했으면_걸린_자리를_싣고_다_못_본_것을_말한다() {
        let mut c = Collector::new(SortBy::Slowest, 50);
        c.add(xlog(42, 0, 3000, 0));
        c.add(xlog(43, 0, 2000, 0));
        let res = c.finish();
        let facts = ScanFacts {
            window: Window { stime: 0, etime: 1 },
            tz_offset_ms: 0,
            scanned: 9000,
            truncated_at: None,
            servers: 1,
            profile: Some(ProfileFacts { needle: "ord-77".into(), candidates: 5000, searched: 2000, failed: 3 }),
        };
        let mut hits = HashMap::new();
        hits.insert(42, ProfileHitView { count: 3, kind: "sql-param".into(), snippet: "ORD-77, 1".into() });
        let v = search_result_json(&res, &facts, &|h| format!("srv{h}"), &texts(), &hits);
        assert_eq!(v["columns"][12], "profile_hit");
        assert_eq!(v["rows"][0][12], "sql-param: ORD-77, 1 (+2)");
        assert_eq!(v["rows"][1][12], Value::Null);
        assert_eq!(v["profile_search"]["searched"], 2000);
        let note = v["note"].as_str().unwrap();
        assert!(note.contains("5000건 중 2000건"), "{note}");
        assert!(note.contains("3건은 받지 못해"), "{note}");
    }

    fn sql(i: i32, start: i64, hash: i32, elapsed: i32, param: &str) -> ProfileStep {
        ProfileStep::Sql(SqlProfileStep {
            base: base(i, start),
            hash,
            param: param.into(),
            elapsed,
            error: 0,
            updated: 1,
        })
    }

    #[test]
    fn 상세는_sql_을_묶고_바인딩_값은_기본으로_가린다() {
        let mut steps: Vec<ProfileStep> = (0..30).map(|i| sql(i, i as i64 * 10, 100, 5, "secret-jumin")).collect();
        steps.push(sql(30, 400, 200, 900, "x"));
        steps.push(ProfileStep::ApiCall(ApiCallProfileStep {
            base: base(31, 1500),
            hash: 300,
            elapsed: 700,
            error: 9,
            txid: 0,
            address: "http://pay".into(),
        }));
        steps.push(ProfileStep::Method(MethodProfileStep { base: base(32, 0), hash: 1, elapsed: 2, cputime: 0 }));

        let x = xlog(42, 0, 3000, 0);
        let v = detail_json("42:19700101", &x, &steps, "srv", &texts(), 0, false);
        let s = v.to_string();
        assert!(!s.contains("secret-jumin"), "바인딩 값이 새어 나갔다");
        assert_eq!(v["sql_distinct"], 2);
        // 많이 걸린 순 — 한 번 900ms 가 5ms×30 보다 앞
        assert_eq!(v["sql"][0]["sql"], "sql-200");
        assert_eq!(v["sql"][1]["count"], 30);
        assert_eq!(v["sql"][1]["total_ms"], 150);
        assert_eq!(v["errors"][0]["kind"], "api");
        assert_eq!(v["errors"][0]["error"], "error-9");
        assert_eq!(v["slowest_steps"][0]["elapsed_ms"], 900);
        // 짧은 메서드는 흐름에서 빠진다
        assert!(!s.contains("method-1"));

        let v = detail_json("42:19700101", &x, &steps, "srv", &texts(), 0, true);
        assert!(v.to_string().contains("secret-jumin"), "허용하면 실어야 한다");
        assert!(v.get("bind_values").is_none());
    }

    #[test]
    fn 아주_긴_트랜잭션도_예산_안으로_줄인다() {
        let long_sql = "SELECT ".to_string() + &"col, ".repeat(400);
        let steps: Vec<ProfileStep> = (0..5000).map(|i| sql(i, i as i64, i % 50, 20, "")).collect();
        let big = move |kind: &str, h: i32| Some(format!("{kind}-{h} {long_sql}"));
        let v = detail_json("1:19700101", &xlog(1, 0, 99_000, 0), &steps, "srv", &big, 0, false);
        let n = v.to_string().len();
        assert!(n <= DETAIL_BUDGET_BYTES, "{n} 바이트");
        assert_eq!(v["profile_steps"], 5000);
        assert!(v["timeline_omitted"].as_u64().unwrap() > 0);
    }

    #[test]
    fn 자르기는_글자_단위다() {
        assert_eq!(clip("가나다라", 2), "가나…(+2자)");
        assert_eq!(clip("abc", 3), "abc");
    }

    #[test]
    fn 상세에_필요한_해시만_모은다() {
        let steps = vec![sql(0, 0, 100, 1, ""), sql(1, 1, 100, 1, "")];
        let h = detail_hashes(&xlog(1, 0, 1, 5), &steps);
        assert_eq!(h, vec![(text_type::ERROR, 5), (text_type::SERVICE, 7), (text_type::SQL, 100)]);
    }
}
