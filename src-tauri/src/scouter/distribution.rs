// 응답시간 분포 집계
//
// «평균 320ms» 는 두 가지 전혀 다른 상황에서 똑같이 나온다 — 전부 320ms 인 것과,
// 95%가 80ms 인데 5%가 5초인 것. **뒤쪽만 장애다.** 평균 하나로는 그 둘을 가를 수 없고,
// 그래서 제니퍼도 응답시간 분포를 대시보드 한가운데 놓는다.
//
// **콜렉터에는 분포를 주는 커맨드가 없다** (`RequestCmd` 전수 확인). 트랜잭션을
// 직접 세는 수밖에 없는데, 1시간이 실측 78,000건이라 그걸 그대로 웹뷰로 넘기면
// CLAUDE.md 3.3 이 말하는 «크거나 잦은 페이로드» 가 된다 —
// 6시간 카운터가 56MB 를 나르던 것과 같은 실수다(`objtype::downsample` 주석).
//
// 그래서 **여기서 세고 결과만 넘긴다.** 78,000건이 버킷 여덟 개와 숫자 몇 개로 줄어든다.

use serde::Serialize;

/// 화면에 그리는 구간의 위 경계(ms). 마지막은 «그 이상» 이라 경계가 없다.
///
/// **로그 눈금이 아니라 사람이 쓰는 경계다.** 0.1초·0.3초·0.5초·1초·3초·5초·10초는
/// 운영에서 실제로 말이 갈리는 자리다(«1초 넘으면 느린 것», «3초면 사용자가 떠난다»).
/// 액티브 서비스의 3단계(1초 · 1~3초 · 3초 이상, `objtype::ActiveSpeed`)도 이 안에 있다.
pub const BUCKET_BOUNDS_MS: [i32; 7] = [100, 300, 500, 1_000, 3_000, 5_000, 10_000];

/// 백분위를 재는 상한(ms).
///
/// 1ms 해상도의 내부 히스토그램을 쓰므로 이만큼의 칸이 필요하다(30,001칸 = 120KB).
/// **이보다 느린 건은 이 값으로 눌러 센다** — p99 가 «30초 이상» 까지만 정확하다는 뜻이라
/// 결과에 이 값을 같이 실어 화면이 그렇게 말할 수 있게 한다.
pub const PERCENTILE_CAP_MS: i32 = 30_000;

/// 구간 하나
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ElapsedBucket {
    /// 위 경계(ms). `None` 이면 «그 이상»
    pub lt_ms: Option<i32>,
    pub count: i64,
    /// 그중 실패한 건수.
    ///
    /// **정상에 묻으면 안 된다.** «느린데 성공» 과 «느려서 터짐» 은 다른 이야기이고,
    /// 3초 칸이 통째로 에러면 그건 분포가 아니라 장애다.
    pub error: i64,
}

/// 집계 결과. 원본 트랜잭션은 넘기지 않는다.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ElapsedDistribution {
    /// `BUCKET_BOUNDS_MS` + «그 이상» 한 칸. 길이는 늘 경계 수 + 1
    pub buckets: Vec<ElapsedBucket>,
    pub total: i64,
    pub error: i64,
    /// 소요 시간 합(ms). **나눗셈은 화면에서 한다** — 두 곳에서 나누면 값이 갈린다
    pub sum_ms: i64,
    pub max_ms: i32,
    pub p50_ms: i32,
    pub p90_ms: i32,
    pub p99_ms: i32,
    /// 백분위를 잰 상한. 이보다 느린 건은 이 값으로 눌러 세었다
    pub percentile_cap_ms: i32,
    /// 상한에 걸려 **다 세지 못했다.**
    ///
    /// 조용히 두면 «이 구간에 이만큼뿐» 으로 읽힌다 — 검색 결과의 `truncated` 와 같은 이유다.
    pub truncated: bool,
}

impl ElapsedDistribution {
    /// 한 건도 못 센 결과. «아직 안 물었다» 와 «물었는데 없다» 는 화면이 가른다
    pub fn empty() -> Self {
        Accumulator::new().finish(false)
    }
}

/// 트랜잭션을 하나씩 받아 세는 통.
///
/// 페이지를 넘겨 가며 채우므로 상태를 들고 있어야 한다.
pub struct Accumulator {
    counts: [i64; BUCKET_BOUNDS_MS.len() + 1],
    errors: [i64; BUCKET_BOUNDS_MS.len() + 1],
    /// 1ms 칸. 백분위를 정확히 내려면 이게 있어야 한다 —
    /// 위의 굵은 버킷으로 p90 을 내면 «1초와 3초 사이» 까지밖에 말 못 한다.
    fine: Vec<u32>,
    total: i64,
    error: i64,
    sum_ms: i64,
    max_ms: i32,
}

impl Default for Accumulator {
    fn default() -> Self {
        Self::new()
    }
}

impl Accumulator {
    pub fn new() -> Self {
        Self {
            counts: [0; BUCKET_BOUNDS_MS.len() + 1],
            errors: [0; BUCKET_BOUNDS_MS.len() + 1],
            fine: vec![0; PERCENTILE_CAP_MS as usize + 1],
            total: 0,
            error: 0,
            sum_ms: 0,
            max_ms: 0,
        }
    }

    /// 한 건 센다.
    ///
    /// **음수는 0 으로 본다.** 에이전트가 시계를 되돌리면(NTP 보정) 음수 elapsed 가
    /// 오는데, 그대로 더하면 합이 줄어 평균이 실제보다 빨라진다.
    pub fn add(&mut self, elapsed_ms: i32, failed: bool) {
        let e = elapsed_ms.max(0);
        let idx = bucket_index(e);

        self.counts[idx] += 1;
        if failed {
            self.errors[idx] += 1;
            self.error += 1;
        }
        self.total += 1;
        self.sum_ms += e as i64;
        if e > self.max_ms {
            self.max_ms = e;
        }
        self.fine[e.min(PERCENTILE_CAP_MS) as usize] += 1;
    }

    pub fn count(&self) -> i64 {
        self.total
    }

    pub fn finish(self, truncated: bool) -> ElapsedDistribution {
        let buckets = (0..self.counts.len())
            .map(|i| ElapsedBucket {
                lt_ms: BUCKET_BOUNDS_MS.get(i).copied(),
                count: self.counts[i],
                error: self.errors[i],
            })
            .collect();

        ElapsedDistribution {
            buckets,
            total: self.total,
            error: self.error,
            sum_ms: self.sum_ms,
            max_ms: self.max_ms,
            p50_ms: percentile(&self.fine, self.total, 50),
            p90_ms: percentile(&self.fine, self.total, 90),
            p99_ms: percentile(&self.fine, self.total, 99),
            percentile_cap_ms: PERCENTILE_CAP_MS,
            truncated,
        }
    }
}

/// 이 소요 시간이 몇 번째 칸인가. 경계는 **미만**이다 (100 은 «100 이상» 칸으로 간다)
fn bucket_index(elapsed_ms: i32) -> usize {
    for (i, bound) in BUCKET_BOUNDS_MS.iter().enumerate() {
        if elapsed_ms < *bound {
            return i;
        }
    }
    BUCKET_BOUNDS_MS.len()
}

/// 1ms 히스토그램에서 백분위.
///
/// **«p 퍼센트가 이 값 이하» 인 가장 작은 값**을 고른다. 건수가 0 이면 0 이다 —
/// 없는 값을 만들어 내면 «0ms 였다» 로 읽힌다.
fn percentile(fine: &[u32], total: i64, p: i64) -> i32 {
    if total <= 0 {
        return 0;
    }
    // 올림. p90 에 10건이면 9번째가 아니라 9번째 «이상» 이 기준이다.
    let need = ((total * p + 99) / 100).max(1);
    let mut seen: i64 = 0;
    for (ms, n) in fine.iter().enumerate() {
        seen += *n as i64;
        if seen >= need {
            return ms as i32;
        }
    }
    PERCENTILE_CAP_MS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 빈_통은_모두_0_이다() {
        let d = ElapsedDistribution::empty();
        assert_eq!(d.total, 0);
        assert_eq!(d.p90_ms, 0, "없는 값을 만들면 «0ms 였다» 로 읽힌다");
        assert_eq!(d.buckets.len(), BUCKET_BOUNDS_MS.len() + 1);
        assert!(d.buckets.iter().all(|b| b.count == 0));
    }

    #[test]
    fn 경계는_미만이다() {
        // 100 은 «100 미만» 이 아니다. 경계값이 어느 칸에 가는지가 흔들리면
        // 같은 데이터로 그린 두 화면의 막대가 달라진다.
        assert_eq!(bucket_index(99), 0);
        assert_eq!(bucket_index(100), 1);
        assert_eq!(bucket_index(9_999), 6);
        assert_eq!(bucket_index(10_000), 7);
    }

    #[test]
    fn 마지막_칸에는_위_경계가_없다() {
        let mut a = Accumulator::new();
        a.add(60_000, false);
        let d = a.finish(false);
        assert_eq!(d.buckets.last().unwrap().lt_ms, None);
        assert_eq!(d.buckets.last().unwrap().count, 1);
    }

    #[test]
    fn 에러는_같은_칸에서_따로_센다() {
        // 3초 칸이 통째로 에러면 그건 분포가 아니라 장애다.
        let mut a = Accumulator::new();
        a.add(3_500, true);
        a.add(3_600, false);
        let d = a.finish(false);
        let slow = &d.buckets[5];
        assert_eq!((slow.count, slow.error), (2, 1));
        assert_eq!(d.error, 1);
    }

    #[test]
    fn 백분위는_1ms_해상도다() {
        // 굵은 버킷으로 내면 «1초와 3초 사이» 까지밖에 말 못 한다.
        let mut a = Accumulator::new();
        for ms in 1..=100 {
            a.add(ms, false);
        }
        let d = a.finish(false);
        assert_eq!(d.p50_ms, 50);
        assert_eq!(d.p90_ms, 90);
        assert_eq!(d.p99_ms, 99);
    }

    #[test]
    fn 상한보다_느린_건은_상한으로_눌러_센다() {
        // p99 가 «30초 이상» 까지만 정확하다는 뜻이고, 그 사실을 결과가 들고 나간다.
        let mut a = Accumulator::new();
        a.add(120_000, false);
        let d = a.finish(false);
        assert_eq!(d.p99_ms, PERCENTILE_CAP_MS);
        assert_eq!(d.percentile_cap_ms, PERCENTILE_CAP_MS);
        assert_eq!(d.max_ms, 120_000, "최댓값은 눌리지 않는다 — 그건 정확히 알 수 있다");
    }

    #[test]
    fn 음수_소요시간은_0_으로_본다() {
        // NTP 보정으로 시계가 되돌면 음수가 온다. 그대로 더하면 합이 줄어
        // 평균이 실제보다 빨라진다.
        let mut a = Accumulator::new();
        a.add(-5, false);
        a.add(10, false);
        let d = a.finish(false);
        assert_eq!(d.sum_ms, 10);
        assert_eq!(d.buckets[0].count, 2);
        assert_eq!(d.max_ms, 10);
    }

    #[test]
    fn 합계는_모든_칸의_합과_같다() {
        let mut a = Accumulator::new();
        for ms in [5, 150, 400, 800, 2_000, 4_000, 7_000, 20_000] {
            a.add(ms, ms > 5_000);
        }
        let d = a.finish(false);
        assert_eq!(d.total, 8);
        assert_eq!(d.buckets.iter().map(|b| b.count).sum::<i64>(), d.total);
        assert_eq!(d.buckets.iter().map(|b| b.error).sum::<i64>(), d.error);
    }

    #[test]
    fn 잘렸다는_사실은_결과가_들고_나간다() {
        // 조용히 두면 «이 구간에 이만큼뿐» 으로 읽힌다.
        let mut a = Accumulator::new();
        a.add(1, false);
        assert!(a.finish(true).truncated);
    }
}
