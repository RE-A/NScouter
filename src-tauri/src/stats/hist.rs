// 응답시간 히스토그램 — 1% 폭의 로그 구간
//
// 통계 작업은 하루치(시간당 50만 건이면 1,200만 건)를 훑는다. 원본을 들고 있으면 메모리가 터지므로 받는 즉시
// 여기에 세고 버린다. 응답시간 분포의 `Accumulator` 는 1ms 칸을 60초까지 두어(서비스당 수백 KB) 서비스가
// 수백 개면 무거워서, 서비스마다 쓰는 이건 **칸 폭을 값의 1% 로** 둔다 — 백분위의 상대 오차가 1% 안이다.
//
// 칸 i (≥1) 는 `[1.01^(i-1), 1.01^i)` ms, 칸 0 은 0ms(1ms 미만). 24일(i32 최대)까지 2,200칸 남짓이고
// 실제로 쓰는 칸까지만 늘린다 — 대개 서비스당 수 KB 다.

use serde::{Deserialize, Serialize};

const STEP: f64 = 1.01;

fn index(ms: i32) -> usize {
    if ms < 1 {
        return 0;
    }
    ((ms as f64).ln() / STEP.ln()).floor() as usize + 1
}

/// 칸 i 의 대표값 — 칸의 위쪽 끝(올림). «p90 이 X 이하» 로 읽히게 위쪽을 쓴다
fn upper(i: usize) -> i32 {
    if i == 0 {
        return 0;
    }
    STEP.powi(i as i32).ceil().min(i32::MAX as f64) as i32
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct LogHist {
    counts: Vec<u32>,
    total: u64,
    max_ms: i32,
}

impl LogHist {
    pub fn add(&mut self, ms: i32) {
        let ms = ms.max(0);
        let i = index(ms);
        if self.counts.len() <= i {
            self.counts.resize(i + 1, 0);
        }
        self.counts[i] += 1;
        self.total += 1;
        self.max_ms = self.max_ms.max(ms);
    }

    pub fn merge(&mut self, other: &LogHist) {
        if self.counts.len() < other.counts.len() {
            self.counts.resize(other.counts.len(), 0);
        }
        for (a, b) in self.counts.iter_mut().zip(&other.counts) {
            *a += b;
        }
        self.total += other.total;
        self.max_ms = self.max_ms.max(other.max_ms);
    }

    pub fn total(&self) -> u64 {
        self.total
    }

    /// p 백분위 (0~100). 실제 최댓값을 넘지 않는다 — 칸 위쪽 끝이 최댓값보다 크게 나오면 거짓이 된다
    pub fn percentile(&self, p: f64) -> i32 {
        if self.total == 0 {
            return 0;
        }
        let want = ((p / 100.0) * self.total as f64).ceil().max(1.0) as u64;
        let mut acc = 0u64;
        for (i, c) in self.counts.iter().enumerate() {
            acc += *c as u64;
            if acc >= want {
                return upper(i).min(self.max_ms);
            }
        }
        self.max_ms
    }

    /// 분포를 화면용 칸으로 — (칸 위쪽 끝 ms, 건수). 빈 칸은 뺀다
    pub fn buckets(&self) -> Vec<(i32, u32)> {
        self.counts.iter().enumerate().filter(|(_, c)| **c > 0).map(|(i, c)| (upper(i), *c)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 백분위의_상대_오차가_1퍼센트_안이다() {
        let mut h = LogHist::default();
        let mut v: Vec<i32> = (0..10_000).map(|i| (i * 7919) % 30_000 + 1).collect();
        for x in &v {
            h.add(*x);
        }
        v.sort_unstable();
        for p in [50.0, 90.0, 95.0, 99.0] {
            let exact = v[((p / 100.0) * v.len() as f64).ceil() as usize - 1];
            let got = h.percentile(p);
            let err = (got - exact).abs() as f64 / exact as f64;
            assert!(err <= 0.0101, "p{p}: 정확 {exact}, 히스토그램 {got} (오차 {err:.4})");
        }
        assert_eq!(h.percentile(100.0), *v.last().unwrap());
    }

    #[test]
    fn 나눠_센_것을_더하면_한꺼번에_센_것과_같다() {
        let (mut a, mut b, mut all) = (LogHist::default(), LogHist::default(), LogHist::default());
        for i in 0..1000 {
            let ms = (i * 37) % 5000;
            all.add(ms);
            if i % 2 == 0 { a.add(ms) } else { b.add(ms) }
        }
        a.merge(&b);
        assert_eq!(a, all);
    }

    #[test]
    fn 영과_음수는_0ms_칸이고_최댓값을_넘지_않는다() {
        let mut h = LogHist::default();
        h.add(0);
        h.add(-5);
        assert_eq!(h.percentile(99.0), 0);
        h.add(1234);
        assert_eq!(h.percentile(100.0), 1234, "칸 위쪽 끝이 최댓값보다 커도 최댓값으로 누른다");
        assert_eq!(LogHist::default().percentile(50.0), 0);
    }
}
