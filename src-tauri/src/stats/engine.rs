// 통계 작업의 몸통 — 구간들을 훑어 서비스별로 센다
//
// 흐름:
//   1. 구간마다·콜렉터마다 **그때 그 대상에 속했던 서버**를 찾는다 — 그날의 오브젝트 목록 + 지금 목록에
//      묶기 규칙을 건다(MCP 목록 조회와 같다). 지난주 Task 가 오늘 없어도 된다
//   2. 구간을 날짜·5분 조각으로 자른다
//   3. 콜렉터마다 일꾼 `perf.stats_parallel` 개가 조각을 하나씩 가져가 페이지를 넘기며 받는다.
//      받은 행은 IP·서비스 조건으로 거르고 **서비스별로 세고 버린다** — 원본을 들고 있지 않는다
//   4. 조각 하나가 실패하면 새 연결로 한 번 더 받고, 그래도 안 되면 «못 받은 조각» 으로 남긴다 —
//      몇 시간짜리 작업이 조각 하나 때문에 통째로 실패하면 안 되고, 빠진 채로 믿어도 안 된다(커버리지)
//
// **로컬 캐시를 쓰지 않는다.** 하루치를 담으면 캐시 상한(기본 2GB)을 다 차지해 화면이 쓰던 것을 밀어낸다.
// 막히는 소켓 읽기라 부르는 쪽이 일꾼 스레드에서 돌린다.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::raw::RawSink;
use super::model::{Book, RangeCoverage, Sample, StatsRange, StatsRequest};
use crate::cache::xlog::past_page;
use crate::hub::CollectorLink;
use crate::mcp::digest::{plan_slices, GroupRule, Patterns, Slice, SortBy, Window, SLICE_MS};
use crate::mcp::server::{fill_texts_on, realtime_objects, request_all};
use crate::scouter::connection::{local_now_ms, ScouterConnection};
use crate::scouter::object::{build_daily_object_param, parse_daily_objects};
use crate::scouter::objtype::{date_key, split_by_day};
use crate::scouter::pack::{AnyPack, XLogPack};
use crate::scouter::past::PastCursor;
use crate::scouter::protocol::text_type;
use crate::scouter::summary::{build_summary_param, parse_summary};
use crate::state::AppState;

/// 커서가 안 밀릴 때를 대비한 빗장 (조각 하나에서)
const MAX_PAGES: u32 = 400;

/// 작업 조종 — 화면이 일시정지·취소를 건다
#[derive(Default)]
pub struct Control {
    pub cancel: AtomicBool,
    pub pause: AtomicBool,
}

/// 진행 상황 (화면용)
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize)]
pub struct Progress {
    /// `plan` (서버 찾는 중) · `scan` · `done`
    pub phase: String,
    pub slices_total: usize,
    pub slices_done: usize,
    /// 콜렉터가 준 건수 (거르기 전)
    pub scanned: u64,
    /// 조건에 걸려 센 건수
    pub matched: u64,
    pub started_at: i64,
    /// 남은 시간 추정(ms). 아직 모르면 None
    pub eta_ms: Option<i64>,
    pub paused: bool,
}

/// 구간 하나·콜렉터 하나에서 훑을 것 — 날짜마다 그날 그 대상에 속했던 서버(원래 해시)
struct Plan {
    by_date: HashMap<String, Vec<i32>>,
    servers: Vec<String>,
    /// 원래 해시 → 서버 이름 (원본 CSV 의 «서버» 칸)
    names: HashMap<i32, String>,
}

/// 조각 하나의 일
struct Task {
    range: usize,
    slice: Slice,
    hashes: Arc<Vec<i32>>,
}

/// 구간·서비스 조건
struct Filters {
    service: Patterns,
    ip: Patterns,
    /// 직접 지정한 서비스(소문자). 비면 전부
    picked: HashSet<String>,
}

impl Filters {
    fn of(req: &StatsRequest) -> Self {
        Self {
            service: Patterns::new(&req.service_include, &req.service_exclude),
            ip: Patterns::new(&req.ip_include, &req.ip_exclude),
            picked: req.services.iter().map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()).collect(),
        }
    }

    fn passes_name(&self, name: &str) -> bool {
        self.service.passes(name) && (self.picked.is_empty() || self.picked.contains(&name.to_lowercase()))
    }
}

/// 통계 대상 — 서비스 묶음 이름(완전 일치) · 서버 이름 글자 · Task 이름 규칙 중 하나라도 맞으면 든다.
/// **이름만 본다** — 종류(`tomcat`)까지 보면 `tomcat` 한 마디에 같은 종류가 전부 걸린다
pub(crate) struct Target {
    groups: Vec<String>,
    names: Vec<String>,
    patterns: Vec<String>,
}

impl Target {
    pub(crate) fn of(req: &StatsRequest) -> Self {
        let low = |v: &[String]| v.iter().map(|g| g.trim().to_lowercase()).filter(|g| !g.is_empty()).collect();
        Self { groups: low(&req.groups), names: low(&req.servers), patterns: low(&req.task_patterns) }
    }

    pub(crate) fn picks(&self, name: &str, group: Option<&str>) -> bool {
        let n = name.to_lowercase();
        // Task 이름은 보통 `/호스트/이름` 의 끝 마디다 — 규칙은 끝 마디와 전체 어느 쪽에 맞아도 된다
        let short = n.rsplit('/').find(|s| !s.is_empty()).unwrap_or(&n).to_string();
        group.is_some_and(|g| self.groups.iter().any(|w| *w == g.to_lowercase()))
            || self.names.iter().any(|w| n.contains(w.as_str()))
            || self.patterns.iter().any(|p| task_match(p, &short) || task_match(p, &n))
    }
}

/// Task 이름 규칙 하나 (이미 소문자). `*` 는 아무 글자 여럿, `?` 는 한 글자. 둘 다 없으면 «포함»
pub fn task_match(pattern: &str, name: &str) -> bool {
    if !pattern.contains(['*', '?']) {
        return name.contains(pattern);
    }
    let (p, t): (Vec<char>, Vec<char>) = (pattern.chars().collect(), name.chars().collect());
    // 별표 되짚기 — 별표 자리를 기억해 두고 안 맞으면 한 글자씩 더 먹인다
    let (mut i, mut j, mut star, mut mark) = (0usize, 0usize, None::<usize>, 0usize);
    while j < t.len() {
        if i < p.len() && (p[i] == '?' || p[i] == t[j]) {
            i += 1;
            j += 1;
        } else if i < p.len() && p[i] == '*' {
            star = Some(i);
            mark = j;
            i += 1;
        } else if let Some(si) = star {
            i = si + 1;
            mark += 1;
            j = mark;
        } else {
            return false;
        }
    }
    p[i..].iter().all(|c| *c == '*')
}

fn group_rule(state: &AppState) -> GroupRule {
    let cfg = state.config.blocking_lock();
    GroupRule::new(&cfg.group_rule.tag_key, &cfg.group_rule.pattern)
}

/// 구간 하나에서 대상에 속했던 서버를 콜렉터 하나에 묻는다
fn plan_range(
    conn: &mut ScouterConnection,
    link: &CollectorLink,
    state: &AppState,
    range: StatsRange,
    tz: i64,
    servers: &Target,
    rule: &GroupRule,
) -> Result<Plan, String> {
    let tag = |real: i32, name: String| {
        state.virt(link, real);
        if state.is_tagged(link, real) { link.tagged_name(&name) } else { name }
    };
    // 지금 살아 있는 서버 — 태그(서비스 묶기)는 살아 있는 것만 갖고 있다
    let alive: Vec<(i32, String, String, Option<String>)> = realtime_objects(conn)?
        .into_iter()
        .map(|o| {
            let name = tag(o.obj_hash, o.obj_name);
            let g = rule.service_of(&name, &o.tags);
            (o.obj_hash, name, o.obj_type, g)
        })
        .collect();
    let mut by_date: HashMap<String, Vec<i32>> = HashMap::new();
    let mut names: Vec<String> = Vec::new();
    let mut by_hash: HashMap<i32, String> = HashMap::new();
    for (day_start, _) in split_by_day(range.stime, range.etime, tz) {
        let date = date_key(day_start, tz);
        let daily = request_all(conn, crate::scouter::protocol::CMD_OBJECT_LIST_LOAD_DATE, &build_daily_object_param(&date))?
            .into_iter()
            .find_map(|p| match p {
                AnyPack::Map(m) => Some(parse_daily_objects(&m)),
                _ => None,
            })
            .unwrap_or_default();
        let mut hashes = Vec::new();
        let candidates = daily
            .into_iter()
            .map(|o| {
                let name = tag(o.obj_hash, o.obj_name);
                let g = rule.service_of(&name, &[]);
                (o.obj_hash, name, o.obj_type, g)
            })
            .chain(alive.iter().cloned());
        for (h, name, _kind, group) in candidates {
            if servers.picks(&name, group.as_deref()) && !hashes.contains(&h) {
                hashes.push(h);
                by_hash.entry(h).or_insert_with(|| name.clone());
                if !names.contains(&name) {
                    names.push(name);
                }
            }
        }
        if !hashes.is_empty() {
            by_date.insert(date, hashes);
        }
    }
    names.sort();
    Ok(Plan { by_date, servers: names, names: by_hash })
}

/// 통계 작업을 끝까지 돈다 — **막힌다.** 돌려주는 것: 구간별 커버리지, 서비스별 집계, 훑은 콜렉터 이름들
pub fn run(
    state: &AppState,
    req: &StatsRequest,
    ctl: &Control,
    raw: Option<&RawSink>,
    on_progress: &(dyn Fn(Progress) + Sync),
) -> Result<(Vec<RangeCoverage>, Book, Vec<String>), String> {
    req.validate()?;
    let started_at = local_now_ms();
    let started = Instant::now();
    on_progress(Progress { phase: "plan".into(), started_at, ..Progress::default() });

    let links: Vec<Arc<CollectorLink>> = state.links().into_iter().filter(|l| l.connection.blocking_lock().is_some()).collect();
    if links.is_empty() {
        return Err("연결되지 않음".into());
    }
    let ranges: Vec<StatsRange> = std::iter::once(req.current).chain(req.baselines.iter().copied()).collect();
    let tz = req.tz_offset_ms;
    let servers = Target::of(req);
    let rule = group_rule(state);

    // 1) 구간마다·콜렉터마다 서버를 찾고 조각을 짠다
    let mut coverage: Vec<RangeCoverage> = ranges
        .iter()
        .enumerate()
        .map(|(i, r)| RangeCoverage {
            kind: if i == 0 { "current" } else { "baseline" }.into(),
            stime: r.stime,
            etime: r.etime,
            ..RangeCoverage::default()
        })
        .collect();
    let mut queues: Vec<Mutex<VecDeque<Task>>> = Vec::with_capacity(links.len());
    let mut server_names: Vec<HashMap<i32, String>> = Vec::with_capacity(links.len());
    for link in &links {
        let mut conn = link.open()?;
        let mut q = VecDeque::new();
        let mut link_names: HashMap<i32, String> = HashMap::new();
        for (ri, r) in ranges.iter().enumerate() {
            let plan = plan_range(&mut conn, link, state, *r, tz, &servers, &rule).map_err(|e| format!("{e} ({})", link.name))?;
            for s in &plan.servers {
                if !coverage[ri].servers.contains(s) {
                    coverage[ri].servers.push(s.clone());
                }
            }
            for (h, n) in plan.names {
                link_names.entry(h).or_insert(n);
            }
            let hashes_of: HashMap<String, Arc<Vec<i32>>> = plan.by_date.into_iter().map(|(d, h)| (d, Arc::new(h))).collect();
            for slice in plan_slices(Window { stime: r.stime, etime: r.etime }, tz, SLICE_MS, SortBy::Slowest) {
                if let Some(h) = hashes_of.get(&slice.date) {
                    q.push_back(Task { range: ri, slice, hashes: h.clone() });
                    coverage[ri].slices += 1;
                }
            }
        }
        queues.push(Mutex::new(q));
        server_names.push(link_names);
    }
    if coverage[0].servers.is_empty() && coverage.iter().all(|c| c.servers.is_empty()) {
        return Err("고른 대상(서비스 묶음·서버)에 속한 서버를 어느 구간에서도 찾지 못했습니다".into());
    }
    let slices_total: usize = coverage.iter().map(|c| c.slices).sum();

    // 2) 콜렉터마다 일꾼을 띄워 조각을 받는다
    let filters = Filters::of(req);
    let book = Mutex::new(Book::default());
    let cov = Mutex::new(coverage);
    let slices_done = AtomicUsize::new(0);
    let scanned = AtomicU64::new(0);
    let matched = AtomicU64::new(0);
    let parallel = (crate::tuning::perf().stats_parallel as usize).max(1);
    let workers_left = AtomicUsize::new(0);
    let page_rows = crate::tuning::perf().page_rows as i32;

    std::thread::scope(|sc| {
        for ((link, queue), names) in links.iter().zip(&queues).zip(&server_names) {
            let n = parallel.min(queue.lock().unwrap_or_else(|p| p.into_inner()).len());
            for _ in 0..n {
                workers_left.fetch_add(1, Ordering::Relaxed);
                let (link, queue, filters, book, cov) = (link.clone(), queue, &filters, &book, &cov);
                let raw_out = raw.map(|_| RawOut { names, tz: req.tz_offset_ms });
                let (slices_done, scanned, matched, workers_left) = (&slices_done, &scanned, &matched, &workers_left);
                sc.spawn(move || {
                    let mut conn: Option<ScouterConnection> = None;
                    loop {
                        if ctl.cancel.load(Ordering::Relaxed) {
                            break;
                        }
                        while ctl.pause.load(Ordering::Relaxed) && !ctl.cancel.load(Ordering::Relaxed) {
                            std::thread::sleep(Duration::from_millis(200));
                        }
                        let Some(task) = queue.lock().unwrap_or_else(|p| p.into_inner()).pop_front() else { break };
                        // 한 번 실패하면 새 연결로 한 번 더 — 콜렉터 재기동·세션 만료를 넘긴다
                        let mut outcome = Err(String::new());
                        for attempt in 0..2 {
                            if conn.is_none() || attempt > 0 {
                                conn = link.open().ok();
                            }
                            let Some(c) = conn.as_mut() else { continue };
                            outcome = scan_slice(c, &link, state, &task, filters, page_rows, ctl, raw_out.as_ref());
                            if outcome.is_ok() {
                                break;
                            }
                            conn = None;
                        }
                        let mut cv = cov.lock().unwrap_or_else(|p| p.into_inner());
                        match outcome {
                            Ok((part, n_scanned, n_matched, lines)) => {
                                if let Some(sink) = raw {
                                    sink.append(&lines);
                                }
                                scanned.fetch_add(n_scanned, Ordering::Relaxed);
                                matched.fetch_add(n_matched, Ordering::Relaxed);
                                cv[task.range].scanned += n_scanned;
                                cv[task.range].slices_done += 1;
                                drop(cv);
                                book.lock().unwrap_or_else(|p| p.into_inner()).merge(part);
                            }
                            Err(e) => {
                                if !ctl.cancel.load(Ordering::Relaxed) {
                                    log::warn!("통계: 조각을 못 받았다 ({}) {}~{}: {e}", link.name, task.slice.stime, task.slice.etime);
                                    link.warn(&format!("통계 조각 실패: {e}"));
                                }
                                cv[task.range].missing.push((task.slice.stime, task.slice.etime));
                            }
                        }
                        slices_done.fetch_add(1, Ordering::Relaxed);
                    }
                    workers_left.fetch_sub(1, Ordering::Relaxed);
                });
            }
        }
        // 일꾼들이 도는 동안 진행 상황을 알린다 (0.5초마다)
        loop {
            let done = slices_done.load(Ordering::Relaxed);
            let el = started.elapsed().as_millis() as i64;
            let eta = (done > 0 && done < slices_total).then(|| el * (slices_total - done) as i64 / done as i64);
            on_progress(Progress {
                phase: "scan".into(),
                slices_total,
                slices_done: done,
                scanned: scanned.load(Ordering::Relaxed),
                matched: matched.load(Ordering::Relaxed),
                started_at,
                eta_ms: eta,
                paused: ctl.pause.load(Ordering::Relaxed),
            });
            if workers_left.load(Ordering::Relaxed) == 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    });

    let mut coverage = cov.into_inner().unwrap_or_else(|p| p.into_inner());
    for c in &mut coverage {
        c.missing.sort_unstable();
    }
    // 취소했으면 가져가지 않은 조각도 «못 받음» 이다
    if ctl.cancel.load(Ordering::Relaxed) {
        for q in &queues {
            for t in q.lock().unwrap_or_else(|p| p.into_inner()).drain(..) {
                coverage[t.range].missing.push((t.slice.stime, t.slice.etime));
            }
        }
    }
    on_progress(Progress {
        phase: "done".into(),
        slices_total,
        slices_done: slices_done.load(Ordering::Relaxed),
        scanned: scanned.load(Ordering::Relaxed),
        matched: matched.load(Ordering::Relaxed),
        started_at,
        eta_ms: Some(0),
        paused: false,
    });
    let names = links.iter().map(|l| l.name.clone()).collect();
    Ok((coverage, book.into_inner().unwrap_or_else(|p| p.into_inner()), names))
}

/// 원본 CSV 를 쓸 때 조각이 알아야 할 것
struct RawOut<'a> {
    /// 원래 해시 → 서버 이름 (이 콜렉터)
    names: &'a HashMap<i32, String>,
    tz: i64,
}

/// 조각 하나를 페이지로 넘겨 가며 받아 센다. (집계, 받은 건수, 센 건수, 원본 CSV 줄)
#[allow(clippy::too_many_arguments)]
fn scan_slice(
    conn: &mut ScouterConnection,
    link: &CollectorLink,
    state: &AppState,
    task: &Task,
    f: &Filters,
    page_rows: i32,
    ctl: &Control,
    raw: Option<&RawOut>,
) -> Result<(Book, u64, u64, Vec<String>), String> {
    let mut lines: Vec<String> = Vec::new();
    let current = task.range == 0;
    let sl = &task.slice;
    let mut book = Book::default();
    let (mut n_scanned, mut n_matched) = (0u64, 0u64);
    // 페이지 경계에서 같은 시각의 트랜잭션이 다시 온다(F-28) — 조각 안에서 한 번만 센다
    let mut seen: HashSet<i64> = HashSet::new();
    let mut cursor = PastCursor::default();
    for _ in 0..MAX_PAGES {
        if ctl.cancel.load(Ordering::Relaxed) {
            return Err("취소됨".into());
        }
        let page = past_page(conn, None, &task.hashes, &sl.date, sl.stime, sl.etime, page_rows, &cursor, 0)?;
        n_scanned += page.rows.len() as u64;
        // 조각 밖(경계 시각)은 옆 조각 몫이다 — 두 번 세지 않는다
        let rows: Vec<XLogPack> = page
            .rows
            .into_iter()
            .filter(|x| x.end_time >= sl.stime && x.end_time < sl.etime && f.ip.passes(&x.ipaddr) && seen.insert(x.txid))
            .collect();
        if !rows.is_empty() {
            let wants: Vec<(&'static str, i32)> = rows.iter().map(|x| (text_type::SERVICE, x.service)).collect::<HashSet<_>>().into_iter().collect();
            // 그 조각의 날짜로 묻는다 (F-70)
            fill_texts_on(conn, link, &wants, Some(&sl.date))?;
            let names: HashMap<i32, String> = {
                let cache = link.text_cache.blocking_lock();
                wants.iter().map(|(_, h)| (*h, cache.get(text_type::SERVICE, *h).map(str::to_string).unwrap_or_else(|| format!("#{h}")))).collect()
            };
            for x in &rows {
                let name = &names[&x.service];
                if !f.passes_name(name) {
                    continue;
                }
                n_matched += 1;
                if let Some(r) = raw {
                    let server = r.names.get(&x.obj_hash).map(String::as_str).unwrap_or("");
                    lines.push(super::raw::line(current, x, name, server, r.tz));
                }
                let entry = book.by_service.entry(name.clone()).or_default();
                let agg = if current { &mut entry.0 } else { &mut entry.1 };
                agg.add(x, || Sample {
                    txid: x.txid.to_string(),
                    date: sl.date.clone(),
                    end_time: x.end_time,
                    elapsed: x.elapsed,
                    error: x.error != 0,
                    obj_hash: state.virt(link, x.obj_hash),
                });
            }
        }
        if page.done {
            return Ok((book, n_scanned, n_matched, lines));
        }
        cursor = page.next;
    }
    // 빗장에 걸렸다 — 끝까지 받았다고 할 수 없다
    Err(format!("페이지가 {MAX_PAGES}개를 넘었다 (커서가 안 밀림)"))
}

const SUMMARY_STEP: i64 = 5 * 60 * 1000;

/// 서비스 요약을 물을 창과 덜어 낼 비율 — `[ds, de)` 를 5분 경계로 넓힌 `[S, E)` 를 `[S, E−1]` 로 묻고,
/// 받은 건수에 `(de−ds)/(E−S)` 를 곱한다
fn summary_window(ds: i64, de: i64) -> (i64, i64, f64) {
    let s = ds.div_euclid(SUMMARY_STEP) * SUMMARY_STEP;
    let e = (de + SUMMARY_STEP - 1).div_euclid(SUMMARY_STEP) * SUMMARY_STEP;
    let frac = if e > s { (de - ds) as f64 / (e - s) as f64 } else { 0.0 };
    (s, e - 1, frac)
}

/// 예상 규모 — 구간별로 대상 서버들의 서비스 요약(가벼운 조회)에서 건수를 더한다.
/// 서비스 조건(포함·제외·직접 지정)은 반영하고 IP 조건은 반영하지 못한다(요약에 IP 가 없다)
#[derive(Debug, Clone, Default, Serialize)]
pub struct Estimate {
    pub ranges: Vec<EstimateRange>,
    pub total: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct EstimateRange {
    pub kind: String,
    pub stime: i64,
    pub etime: i64,
    pub servers: Vec<String>,
    pub count: u64,
}

/// 예상 규모를 낸다 — **막힌다**
pub fn estimate(state: &AppState, req: &StatsRequest) -> Result<Estimate, String> {
    req.validate()?;
    let links: Vec<Arc<CollectorLink>> = state.links().into_iter().filter(|l| l.connection.blocking_lock().is_some()).collect();
    if links.is_empty() {
        return Err("연결되지 않음".into());
    }
    let tz = req.tz_offset_ms;
    let servers = Target::of(req);
    let rule = group_rule(state);
    let filters = Filters::of(req);
    let ranges: Vec<StatsRange> = std::iter::once(req.current).chain(req.baselines.iter().copied()).collect();
    let mut out = Estimate::default();
    for (ri, r) in ranges.iter().enumerate() {
        let mut er = EstimateRange { kind: if ri == 0 { "current" } else { "baseline" }.into(), stime: r.stime, etime: r.etime, ..Default::default() };
        let mut counted = 0f64;
        for link in &links {
            let mut conn = link.open()?;
            let plan = plan_range(&mut conn, link, state, *r, tz, &servers, &rule)?;
            er.servers.extend(plan.servers.iter().cloned());
            // 오브젝트 종류가 요약 파라미터에 든다 — 그날 목록에서 종류를 찾는다
            let kinds = object_kinds(&mut conn, r, tz)?;
            for (day_start, day_end) in split_by_day(r.stime, r.etime, tz) {
                let date = date_key(day_start, tz);
                let Some(hashes) = plan.by_date.get(&date) else { continue };
                // 요약은 5분 경계에 찍힌 점이고 점 T 가 [T, T+5분) 몫이다. 조회는 양 끝을 **둘 다** 넣는다(F-69).
                // 그래서 구간을 5분 경계로 넓혀 [S, E−1] 로 묻고(끝 점을 빼야 한 칸이 더 붙지 않는다), 넓힌 만큼 비율로 덜어 낸다
                let (ds, de) = (day_start.max(r.stime), day_end.min(r.etime));
                let (qs, qe, frac) = summary_window(ds, de);
                for h in hashes {
                    let Some(kind) = kinds.get(h) else { continue };
                    let param = build_summary_param(&date, qs, qe, kind, *h);
                    let rows = request_all(&mut conn, crate::scouter::protocol::CMD_LOAD_SERVICE_SUMMARY, &param)?
                        .into_iter()
                        .find_map(|p| match p {
                            AnyPack::Map(m) => Some(parse_summary(&m)),
                            _ => None,
                        })
                        .unwrap_or_default();
                    if filters.service.is_empty() && filters.picked.is_empty() {
                        counted += rows.iter().map(|x| x.count.max(0) as f64).sum::<f64>() * frac;
                        continue;
                    }
                    let wants: Vec<(&'static str, i32)> = rows.iter().map(|x| (text_type::SERVICE, x.id)).collect();
                    fill_texts_on(&mut conn, link, &wants, Some(&date))?;
                    let cache = link.text_cache.blocking_lock();
                    counted += rows
                        .iter()
                        .filter(|x| filters.passes_name(cache.get(text_type::SERVICE, x.id).unwrap_or_default()))
                        .map(|x| x.count.max(0) as f64)
                        .sum::<f64>()
                        * frac;
                }
            }
        }
        er.count = counted.round() as u64;
        er.servers.sort();
        er.servers.dedup();
        out.total += er.count;
        out.ranges.push(er);
    }
    Ok(out)
}

/// 구간에 걸친 날들의 오브젝트 → 종류 (요약 파라미터용)
fn object_kinds(conn: &mut ScouterConnection, r: &StatsRange, tz: i64) -> Result<HashMap<i32, String>, String> {
    let mut out: HashMap<i32, String> = realtime_objects(conn)?.into_iter().map(|o| (o.obj_hash, o.obj_type)).collect();
    for (day_start, _) in split_by_day(r.stime, r.etime, tz) {
        let date = date_key(day_start, tz);
        let daily = request_all(conn, crate::scouter::protocol::CMD_OBJECT_LIST_LOAD_DATE, &build_daily_object_param(&date))?
            .into_iter()
            .find_map(|p| match p {
                AnyPack::Map(m) => Some(parse_daily_objects(&m)),
                _ => None,
            })
            .unwrap_or_default();
        for o in daily {
            out.entry(o.obj_hash).or_insert(o.obj_type);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 서비스_조건은_포함_제외_직접지정을_함께_본다() {
        let req = StatsRequest {
            service_include: vec!["/order".into()],
            service_exclude: vec!["health".into()],
            services: vec![],
            ..Default::default()
        };
        let f = Filters::of(&req);
        assert!(f.passes_name("/Order/list"), "대소문자 무시");
        assert!(!f.passes_name("/order/health"), "제외가 이긴다");
        assert!(!f.passes_name("/shop/list"), "포함에 없다");
        let picked = Filters::of(&StatsRequest { services: vec![" /Order/List ".into()], ..req });
        assert!(picked.passes_name("/order/list"));
        assert!(!picked.passes_name("/order/detail"), "직접 지정하면 그것만");
    }

    #[test]
    fn ip_조건은_포함_제외() {
        let f = Filters::of(&StatsRequest { ip_include: vec!["10.1.".into()], ip_exclude: vec!["10.1.9.".into()], ..Default::default() });
        assert!(f.ip.passes("10.1.2.3"));
        assert!(!f.ip.passes("10.1.9.3"));
        assert!(!f.ip.passes("192.168.0.1"));
    }

    #[test]
    fn 대상은_묶음_이름이나_서버_이름_글자다_종류는_보지_않는다() {
        let s = Target::of(&StatsRequest { groups: vec![" Order ".into()], servers: vec!["batch".into()], ..Default::default() });
        assert!(s.picks("/h/order-7f9", Some("order")));
        assert!(s.picks("/h/batch-1", None));
        assert!(!s.picks("/h/shop-1", Some("shop")));
        let t = Target::of(&StatsRequest { servers: vec!["tomcat".into()], ..Default::default() });
        assert!(!t.picks("/h/shop-1", None), "종류 이름으로 걸리면 안 된다");
    }

    #[test]
    fn 요약_창은_5분_경계로_넓히고_끝점을_뺀다() {
        let m = 60_000;
        assert_eq!(summary_window(10 * m, 20 * m), (10 * m, 20 * m - 1, 1.0), "경계에 맞으면 그대로 — 끝 점(20분)은 다음 칸 몫");
        let (s, e, f) = summary_window(11 * m, 12 * m);
        assert_eq!((s, e), (10 * m, 15 * m - 1));
        assert!((f - 0.2).abs() < 1e-9, "1분 = 5분 칸의 1/5");
        assert_eq!(summary_window(5, 5).2, 0.0);
    }

    #[test]
    fn task_이름_규칙() {
        assert!(task_match("shop-app-*", "shop-app-ip-10-1-2-3"));
        assert!(!task_match("shop-app-*", "my-shop-app-1"));
        assert!(task_match("*shop*", "my-shop-app-1"));
        assert!(task_match("shop-?", "shop-1"));
        assert!(!task_match("shop-?", "shop-12"));
        assert!(task_match("shop", "my-shop-app"), "별표가 없으면 포함");
        assert!(task_match("a*b*c", "axxbyyc"));
        assert!(!task_match("a*b*c", "axxbyy"));
        let t = Target::of(&StatsRequest { task_patterns: vec!["Shop-App-*".into()], ..Default::default() });
        assert!(t.picks("/13fc079be9ec/shop-app-ip-10-0-0-1", None), "끝 마디에 맞춘다");
        assert!(!t.picks("/h/order-app-1", None));
    }
}
