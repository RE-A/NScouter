// 응답시간 분포 — 읽을 수 있게 만드는 부분
//
// 집계 자체는 Rust 가 검증한다(`scouter::distribution`). 여기서 지키는 것은
// **없는 값을 만들어 내지 않는 것**이다 — 0건일 때 «평균 0ms» 를 적으면
// «빨랐다» 로 읽히고, 그건 «아무 일도 없었다» 와 정반대의 말이다.

import { describe, expect, it } from 'vitest';
import {
  avgMs,
  bucketLabel,
  bucketViews,
  errorRate,
  isCapped,
  isEmpty,
  nonEmpty,
  percent,
  shortMs,
} from './distribution';
import type { ElapsedDistribution } from '../xlog/api/scouterApi';

/** Rust 가 보내는 모양 그대로 (버킷 경계 7개 + «그 이상») */
function dist(counts: number[], errors: number[] = [], over: Partial<ElapsedDistribution> = {}): ElapsedDistribution {
  const bounds = [100, 300, 500, 1_000, 3_000, 5_000, 10_000, null];
  const buckets = bounds.map((lt, i) => ({
    lt_ms: lt,
    count: counts[i] ?? 0,
    error: errors[i] ?? 0,
  }));
  const total = buckets.reduce((n, b) => n + b.count, 0);
  return {
    buckets,
    total,
    error: buckets.reduce((n, b) => n + b.error, 0),
    sum_ms: 0,
    max_ms: 0,
    p50_ms: 0,
    p90_ms: 0,
    p99_ms: 0,
    percentile_cap_ms: 30_000,
    truncated: false,
    ...over,
  };
}

describe('shortMs', () => {
  it('1초부터는 초로 적는다', () => {
    // `10000ms` 는 자릿수를 세어야 읽힌다.
    expect(shortMs(999)).toBe('999ms');
    expect(shortMs(1_000)).toBe('1s');
    expect(shortMs(1_500)).toBe('1.5s');
    expect(shortMs(30_000)).toBe('30s');
  });
});

describe('bucketLabel', () => {
  it('양 끝은 한쪽만 적는다', () => {
    expect(bucketLabel(0, 100)).toBe('~100ms');
    expect(bucketLabel(10_000, null)).toBe('10s+');
  });

  it('가운데는 구간으로 적는다', () => {
    expect(bucketLabel(300, 500)).toBe('300ms~500ms');
    expect(bucketLabel(1_000, 3_000)).toBe('1s~3s');
  });
});

describe('bucketViews', () => {
  it('막대 폭은 가장 큰 칸 대비다', () => {
    // 전체 대비로 하면 대부분이 첫 칸에 몰리는 정상 상태에서 나머지가 전부
    // 실선이 되어 정작 보려던 꼬리가 안 보인다.
    const v = bucketViews(dist([900, 90, 9, 1]));
    expect(v[0].ratio).toBe(1);
    expect(v[1].ratio).toBeCloseTo(0.1);
    expect(v[0].share).toBeCloseTo(0.9);
  });

  it('아래 경계가 이어진다', () => {
    const v = bucketViews(dist([1, 1, 1, 1, 1, 1, 1, 1]));
    expect(v.map(b => b.fromMs)).toEqual([0, 100, 300, 500, 1_000, 3_000, 5_000, 10_000]);
  });

  it('한 건도 없으면 폭이 0 이다', () => {
    // 0 으로 나눠 NaN 을 만들면 막대가 통째로 사라진다.
    const v = bucketViews(dist([]));
    expect(v.every(b => b.ratio === 0 && b.share === 0)).toBe(true);
  });

  it('에러 건수를 칸마다 들고 간다', () => {
    // 3초 칸이 통째로 에러면 그건 분포가 아니라 장애다.
    const v = bucketViews(dist([0, 0, 0, 0, 0, 4], [0, 0, 0, 0, 0, 4]));
    expect(v[5]).toMatchObject({ count: 4, error: 4 });
  });
});

describe('avgMs · errorRate', () => {
  it('0 건이면 수를 만들어 내지 않는다', () => {
    const empty = dist([]);
    expect(avgMs(empty)).toBeNull();
    expect(errorRate(empty)).toBeNull();
    expect(isEmpty(empty)).toBe(true);
    expect(isEmpty(null)).toBe(true);
  });

  it('합계를 건수로 나눈다', () => {
    expect(avgMs(dist([10], [], { sum_ms: 1_234 }))).toBe(123);
    expect(errorRate(dist([8, 2], [1, 1]))).toBeCloseTo(0.2);
  });
});

describe('isCapped', () => {
  it('상한에 닿은 백분위는 «이상» 이다', () => {
    // Rust 가 30초보다 느린 건을 30초로 눌러 센다. 30초라고 적으면 거짓말이 된다.
    const d = dist([1]);
    expect(isCapped(30_000, d)).toBe(true);
    expect(isCapped(29_999, d)).toBe(false);
  });
});

describe('percent', () => {
  it('아주 작은 비율을 0% 로 적지 않는다', () => {
    // 0.04% 를 «0%» 로 적으면 «없다» 가 된다 — 1만 건 중 4건은 있는 것이다.
    expect(percent(0.0004)).toBe('<0.1%');
    expect(percent(0)).toBe('0%');
    expect(percent(0.05)).toBe('5.0%');
    expect(percent(0.5)).toBe('50%');
  });
});

describe('nonEmpty', () => {
  it('빈 칸을 뺀다', () => {
    expect(nonEmpty(bucketViews(dist([5, 0, 3]))).map(v => v.count)).toEqual([5, 3]);
  });
});
