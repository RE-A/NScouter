// 통계 비교 — 요청과 서비스별 집계, 결과의 모양
//
// **무엇을 비교하나:** 서비스 묶음(또는 서버) 하나의 **현재 구간**과 **기준 구간들**(평소). 기준 구간이 여럿이거나
// 그 사이에 서버(Task)가 여럿이었어도 서버·구간별로 나누지 않고 **하나의 기준 통계로 합친다** — 알고 싶은 것은
// «평소보다 느린가·에러가 많은가» 이지 어느 Task 였나가 아니다.
//
// 판정(느려짐·에러 증가 등)은 화면이 한다(`statsJudge.ts`) — 기준값을 바꿔 가며 다시 볼 수 있게 여기서는
// 숫자만 낸다.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use super::hist::LogHist;
use crate::scouter::pack::XLogPack;

/// 한 구간 (epoch ms, `[stime, etime)`)
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatsRange {
    pub stime: i64,
    pub etime: i64,
}

impl StatsRange {
    pub fn secs(&self) -> f64 {
        ((self.etime - self.stime).max(0) as f64) / 1000.0
    }
}

/// 구간 하나의 최대 길이 — 하루
pub const MAX_RANGE_MS: i64 = 24 * 3600 * 1000;
/// 기준 구간 최대 개수 (하루짜리를 이만큼이면 이미 무거운 작업이다)
pub const MAX_BASELINES: usize = 14;

/// 통계 비교 요청
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct StatsRequest {
    /// 보기 좋은 이름. 비면 대상·구간으로 만든다
    pub title: String,
    /// 대상 — 서비스 묶음 이름들 (완전 일치, 대소문자 무시). 서버 이름 글자(`servers`)와 OR
    pub groups: Vec<String>,
    /// 대상 — 서버(오브젝트) 이름에 든 글자. 예전 요청을 읽으려고 남긴다 — 지금 화면은 `task_patterns` 를 쓴다
    pub servers: Vec<String>,
    /// 대상 — Task 이름 규칙. `*` 가 있으면 그 모양 그대로(대소문자 무시), 없으면 «포함».
    /// 서비스 묶음 규칙(태그)이 지난 Task 에는 안 걸려서(그날 목록에 태그가 없다) 이름으로 묶는 길을 둔다
    pub task_patterns: Vec<String>,
    /// 현재 구간
    pub current: StatsRange,
    /// 기준(평소) 구간들 — 하나의 기준 통계로 합친다
    pub baselines: Vec<StatsRange>,
    /// 직접 지정한 서비스 이름(완전 일치, 대소문자 무시). **비면 현재 구간에 찍힌 서비스 전부**
    pub services: Vec<String>,
    /// 서비스 이름에 든 글자 — 포함(OR) · 제외(하나라도 맞으면 뺀다). XLog 화면 필터와 같은 규칙
    pub service_include: Vec<String>,
    pub service_exclude: Vec<String>,
    /// 호출한 IP 에 든 글자 — 포함 · 제외
    pub ip_include: Vec<String>,
    pub ip_exclude: Vec<String>,
    /// 화면의 시간대(ms). 콜렉터 날짜 디렉토리(F-18)를 고를 때 쓴다
    pub tz_offset_ms: i64,
    /// 통계에 들어간 트랜잭션을 원본 CSV 로도 남긴다 (내보내기 폴더)
    pub raw: bool,
}

impl StatsRequest {
    /// 쓸 수 있는 요청인가
    pub fn validate(&self) -> Result<(), String> {
        let blank = |v: &[String]| v.iter().all(|s| s.trim().is_empty());
        if blank(&self.groups) && blank(&self.servers) && blank(&self.task_patterns) {
            return Err("대상(서비스 묶음 또는 서버)을 고르세요".into());
        }
        if self.baselines.is_empty() {
            return Err("비교할 기준 구간을 하나 이상 넣으세요".into());
        }
        if self.baselines.len() > MAX_BASELINES {
            return Err(format!("기준 구간은 {MAX_BASELINES}개까지입니다"));
        }
        for (i, r) in std::iter::once(&self.current).chain(&self.baselines).enumerate() {
            let what = if i == 0 { "현재 구간".to_string() } else { format!("기준 구간 {i}") };
            if r.etime <= r.stime {
                return Err(format!("{what}: 끝이 시작보다 앞섭니다"));
            }
            if r.etime - r.stime > MAX_RANGE_MS {
                return Err(format!("{what}: 구간은 하루까지입니다"));
            }
        }
        Ok(())
    }
}

/// 5분 칸 길이
pub const SERIES_MS: i64 = 5 * 60_000;
/// 서비스마다 남기는 가장 느린 트랜잭션 수 · 에러 트랜잭션 수
pub const KEEP_SAMPLES: usize = 5;

/// 트랜잭션 하나 — 표에서 바로 상세를 연다
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sample {
    /// i64 라 화면에는 문자열로
    pub txid: String,
    /// `yyyymmdd` (콜렉터 날짜)
    pub date: String,
    pub end_time: i64,
    pub elapsed: i32,
    pub error: bool,
    /// 화면용 objHash
    pub obj_hash: i32,
}

/// 5분 칸 하나
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct SeriesBucket {
    pub count: u64,
    pub errors: u64,
    pub sum_ms: u64,
    pub max_ms: i32,
}

/// 서비스 하나의 한쪽(현재 또는 기준) 집계
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Agg {
    pub hist: LogHist,
    pub errors: u64,
    pub sum_ms: u64,
    pub sql_count: u64,
    pub sql_ms: u64,
    pub api_count: u64,
    pub api_ms: u64,
    pub cpu_ms: u64,
    /// 5분 칸 시작(epoch ms) → 칸
    pub series: BTreeMap<i64, SeriesBucket>,
    /// 가장 느린 것들 (느린 순)
    pub slowest: Vec<Sample>,
    /// 에러 난 것들 (최근 순)
    pub errored: Vec<Sample>,
}

impl Agg {
    /// 한 건 센다. `sample` 은 표에 남길 때만 만든다 — 대부분은 안 남긴다
    pub fn add(&mut self, x: &XLogPack, sample: impl Fn() -> Sample) {
        let e = x.elapsed.max(0);
        self.hist.add(e);
        self.sum_ms += e as u64;
        let err = x.error != 0;
        if err {
            self.errors += 1;
        }
        self.sql_count += x.sql_count.max(0) as u64;
        self.sql_ms += x.sql_time.max(0) as u64;
        self.api_count += x.apicall_count.max(0) as u64;
        self.api_ms += x.apicall_time.max(0) as u64;
        self.cpu_ms += x.cpu.max(0) as u64;
        let b = self.series.entry(x.end_time - x.end_time.rem_euclid(SERIES_MS)).or_default();
        b.count += 1;
        b.sum_ms += e as u64;
        b.max_ms = b.max_ms.max(e);
        if err {
            b.errors += 1;
        }
        if self.slowest.len() < KEEP_SAMPLES || self.slowest.last().is_some_and(|s| s.elapsed < e) {
            push_top(&mut self.slowest, sample(), |s| s.elapsed);
        }
        if err && (self.errored.len() < KEEP_SAMPLES || self.errored.last().is_some_and(|s| s.end_time < x.end_time)) {
            push_recent(&mut self.errored, sample());
        }
    }

    pub fn merge(&mut self, o: &Agg) {
        self.hist.merge(&o.hist);
        self.errors += o.errors;
        self.sum_ms += o.sum_ms;
        self.sql_count += o.sql_count;
        self.sql_ms += o.sql_ms;
        self.api_count += o.api_count;
        self.api_ms += o.api_ms;
        self.cpu_ms += o.cpu_ms;
        for (t, b) in &o.series {
            let m = self.series.entry(*t).or_default();
            m.count += b.count;
            m.errors += b.errors;
            m.sum_ms += b.sum_ms;
            m.max_ms = m.max_ms.max(b.max_ms);
        }
        for s in &o.slowest {
            push_top(&mut self.slowest, s.clone(), |s| s.elapsed);
        }
        for s in &o.errored {
            push_recent(&mut self.errored, s.clone());
        }
    }

    pub fn count(&self) -> u64 {
        self.hist.total()
    }

    /// 화면으로 낼 요약. `secs` 는 이쪽 구간들을 합친 길이(초) — TPS 를 낸다
    pub fn summary(&self, secs: f64) -> Summary {
        let n = self.count();
        let per = |v: u64| if n == 0 { 0.0 } else { v as f64 / n as f64 };
        Summary {
            count: n,
            errors: self.errors,
            error_rate: per(self.errors),
            tps: if secs > 0.0 { n as f64 / secs } else { 0.0 },
            avg_ms: per(self.sum_ms),
            p50_ms: self.hist.percentile(50.0),
            p90_ms: self.hist.percentile(90.0),
            p95_ms: self.hist.percentile(95.0),
            p99_ms: self.hist.percentile(99.0),
            max_ms: self.hist.percentile(100.0),
            sql_count_avg: per(self.sql_count),
            sql_ms_avg: per(self.sql_ms),
            api_count_avg: per(self.api_count),
            api_ms_avg: per(self.api_ms),
            cpu_ms_avg: per(self.cpu_ms),
            series: self
                .series
                .iter()
                .map(|(t, b)| SeriesPoint {
                    t: *t,
                    count: b.count,
                    errors: b.errors,
                    avg_ms: if b.count == 0 { 0.0 } else { b.sum_ms as f64 / b.count as f64 },
                    max_ms: b.max_ms,
                })
                .collect(),
            dist: self.hist.buckets(),
            slowest: self.slowest.clone(),
            errored: self.errored.clone(),
        }
    }
}

/// 상위 `KEEP_SAMPLES` 개만 남긴다 — 같은 txid 는 한 번만(조각 경계에서 같은 트랜잭션이 다시 온다)
fn push_top(v: &mut Vec<Sample>, s: Sample, key: impl Fn(&Sample) -> i32) {
    if v.iter().any(|x| x.txid == s.txid) {
        return;
    }
    v.push(s);
    v.sort_by_key(|x| std::cmp::Reverse(key(x)));
    v.truncate(KEEP_SAMPLES);
}

/// 최근 것 `KEEP_SAMPLES` 개만 남긴다 — 같은 txid 는 한 번만
fn push_recent(v: &mut Vec<Sample>, s: Sample) {
    if v.iter().any(|x| x.txid == s.txid) {
        return;
    }
    v.push(s);
    v.sort_by(|a, b| b.end_time.cmp(&a.end_time));
    v.truncate(KEEP_SAMPLES);
}

/// 5분 칸 하나 (화면용)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SeriesPoint {
    pub t: i64,
    pub count: u64,
    pub errors: u64,
    pub avg_ms: f64,
    pub max_ms: i32,
}

/// 서비스 하나의 한쪽 요약 (화면용)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Summary {
    pub count: u64,
    pub errors: u64,
    /// 0~1
    pub error_rate: f64,
    pub tps: f64,
    pub avg_ms: f64,
    pub p50_ms: i32,
    pub p90_ms: i32,
    pub p95_ms: i32,
    pub p99_ms: i32,
    pub max_ms: i32,
    pub sql_count_avg: f64,
    pub sql_ms_avg: f64,
    pub api_count_avg: f64,
    pub api_ms_avg: f64,
    pub cpu_ms_avg: f64,
    /// 5분 추이
    pub series: Vec<SeriesPoint>,
    /// 응답시간 분포 — (칸 위쪽 끝 ms, 건수)
    pub dist: Vec<(i32, u32)>,
    pub slowest: Vec<Sample>,
    pub errored: Vec<Sample>,
}

/// 서비스 하나 — 현재와 기준. 한쪽에만 있으면 다른 쪽은 None (신규 · 사라짐)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServiceStats {
    pub service: String,
    pub current: Option<Summary>,
    pub baseline: Option<Summary>,
}

/// 구간 하나를 얼마나 받았나
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RangeCoverage {
    /// `current` · `baseline`
    pub kind: String,
    pub stime: i64,
    pub etime: i64,
    /// 이 구간에 그 대상으로 찾은 서버 이름들
    pub servers: Vec<String>,
    pub slices: usize,
    pub slices_done: usize,
    /// 못 받은 조각들 `(시작, 끝)` — 비면 다 받았다
    pub missing: Vec<(i64, i64)>,
    /// 콜렉터가 준 건수 (거르기 전)
    pub scanned: u64,
}

/// 작업 결과
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct StatsResult {
    pub id: String,
    pub request: StatsRequest,
    pub started_at: i64,
    pub finished_at: i64,
    /// `done` · `cancelled` · `failed`
    pub status: String,
    pub message: Option<String>,
    pub collectors: Vec<String>,
    pub ranges: Vec<RangeCoverage>,
    pub services: Vec<ServiceStats>,
    /// 원본 CSV 경로 — 남기기로 했을 때만
    #[serde(default)]
    pub raw_path: Option<String>,
    #[serde(default)]
    pub raw_rows: u64,
    /// 원본 CSV 를 쓰다 실패한 까닭
    #[serde(default)]
    pub raw_error: Option<String>,
}

/// 서비스 이름 → (현재, 기준) 집계. 작업 안에서 조각마다 모았다가 합친다
#[derive(Debug, Default)]
pub struct Book {
    pub by_service: HashMap<String, (Agg, Agg)>,
}

impl Book {
    pub fn merge(&mut self, o: Book) {
        for (k, (c, b)) in o.by_service {
            let e = self.by_service.entry(k).or_default();
            e.0.merge(&c);
            e.1.merge(&b);
        }
    }

    /// 결과로 — `cur_secs`·`base_secs` 는 각 쪽 구간들을 합친 길이(초).
    /// `picked` 가 비면(«현재 전부») 현재에 없고 기준에만 있는 서비스도 «사라짐» 으로 싣는다
    pub fn finish(self, cur_secs: f64, base_secs: f64) -> Vec<ServiceStats> {
        let mut out: Vec<ServiceStats> = self
            .by_service
            .into_iter()
            .map(|(service, (c, b))| ServiceStats {
                service,
                current: (c.count() > 0).then(|| c.summary(cur_secs)),
                baseline: (b.count() > 0).then(|| b.summary(base_secs)),
            })
            .filter(|s| s.current.is_some() || s.baseline.is_some())
            .collect();
        // 현재 건수가 많은 순 — 화면이 다시 줄 세운다
        out.sort_by(|a, b| {
            let n = |s: &ServiceStats| s.current.as_ref().map(|c| c.count).unwrap_or(0);
            n(b).cmp(&n(a)).then_with(|| a.service.cmp(&b.service))
        });
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn x(txid: i64, end: i64, elapsed: i32, error: i32) -> XLogPack {
        XLogPack { txid, end_time: end, elapsed, error, sql_count: 2, sql_time: 10, ..XLogPack::default() }
    }

    fn sample_of(x: &XLogPack) -> Sample {
        Sample { txid: x.txid.to_string(), date: "20261112".into(), end_time: x.end_time, elapsed: x.elapsed, error: x.error != 0, obj_hash: 1 }
    }

    #[test]
    fn 요청은_대상_기준_구간길이를_본다() {
        let r = StatsRange { stime: 0, etime: 3_600_000 };
        let ok = StatsRequest { groups: vec!["order".into()], current: r, baselines: vec![r], ..Default::default() };
        assert!(ok.validate().is_ok());
        assert!(StatsRequest { groups: vec![" ".into()], ..ok.clone() }.validate().is_err(), "대상 없음");
        assert!(StatsRequest { baselines: vec![], ..ok.clone() }.validate().is_err(), "기준 없음");
        let day_plus = StatsRange { stime: 0, etime: MAX_RANGE_MS + 1 };
        assert!(StatsRequest { current: day_plus, ..ok.clone() }.validate().is_err(), "하루 넘음");
        let back = StatsRange { stime: 10, etime: 5 };
        assert!(StatsRequest { baselines: vec![r, back], ..ok }.validate().is_err(), "거꾸로");
    }

    #[test]
    fn 한_쪽_집계는_건수_에러_평균_백분위_5분추이_느린것을_낸다() {
        let mut a = Agg::default();
        let base = 1_000 * SERIES_MS;
        for i in 0..100 {
            let r = x(i, base + i * 6_000, (i as i32 + 1) * 10, if i % 10 == 0 { 1 } else { 0 });
            a.add(&r, || sample_of(&r));
        }
        let s = a.summary(600.0);
        assert_eq!((s.count, s.errors), (100, 10));
        assert!((s.error_rate - 0.1).abs() < 1e-9);
        assert!((s.tps - 100.0 / 600.0).abs() < 1e-9);
        assert!((s.avg_ms - 505.0).abs() < 1e-9);
        assert_eq!(s.max_ms, 1000);
        assert!((s.p90_ms - 900).abs() <= 9, "p90 {}", s.p90_ms);
        assert_eq!(s.series.len(), 2, "6초 간격 100건 = 10분 = 5분 칸 둘");
        assert_eq!(s.series[0].count + s.series[1].count, 100);
        assert_eq!(s.slowest.iter().map(|x| x.elapsed).collect::<Vec<_>>(), vec![1000, 990, 980, 970, 960]);
        assert_eq!(s.errored.len(), KEEP_SAMPLES);
        assert_eq!(s.errored[0].txid, "90", "에러는 최근 것부터");
        assert!((s.sql_count_avg - 2.0).abs() < 1e-9);
    }

    #[test]
    fn 나눠_센_것을_합치면_한꺼번에_센_것과_같고_같은_트랜잭션은_한_번만_남는다() {
        let rows: Vec<XLogPack> = (0..50).map(|i| x(i, i * 1000, (i as i32 * 37) % 900, (i % 7 == 0) as i32)).collect();
        let mut all = Agg::default();
        let (mut a, mut b) = (Agg::default(), Agg::default());
        for (i, r) in rows.iter().enumerate() {
            all.add(r, || sample_of(r));
            if i % 2 == 0 { a.add(r, || sample_of(r)) } else { b.add(r, || sample_of(r)) }
        }
        a.merge(&b);
        assert_eq!(a.summary(1.0), all.summary(1.0));
        let mut twice = a.clone();
        twice.merge(&Agg { slowest: a.slowest.clone(), ..Agg::default() });
        assert_eq!(twice.slowest, a.slowest, "같은 txid 는 한 번만");
    }

    #[test]
    fn 한쪽에만_있는_서비스는_신규_또는_사라짐이다() {
        let mut book = Book::default();
        let r = x(1, 0, 100, 0);
        book.by_service.entry("/new".into()).or_default().0.add(&r, || sample_of(&r));
        book.by_service.entry("/gone".into()).or_default().1.add(&r, || sample_of(&r));
        let out = book.finish(60.0, 60.0);
        let get = |n: &str| out.iter().find(|s| s.service == n).unwrap();
        assert!(get("/new").current.is_some() && get("/new").baseline.is_none());
        assert!(get("/gone").current.is_none() && get("/gone").baseline.is_some());
    }
}
