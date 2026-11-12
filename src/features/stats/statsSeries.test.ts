import { describe, expect, it } from 'vitest';
import type { SeriesPoint } from './statsApi';
import { cdf, overlay, STEP_MS } from './statsSeries';

const D = 86_400_000;
const pt = (t: number, count: number, avg: number, errors = 0): SeriesPoint => ({ t, count, errors, avg_ms: avg, max_ms: avg * 2 });

describe('overlay', () => {
  const cur = { stime: 10 * D, etime: 10 * D + 3 * STEP_MS };
  const b1 = { stime: 9 * D, etime: 9 * D + 3 * STEP_MS };
  const b2 = { stime: 8 * D, etime: 8 * D + 3 * STEP_MS };

  it('평소 구간들을 «시작에서 지난 시간» 으로 맞춰 겹친다 — 평균은 건수 가중, 띠는 최소~최대', () => {
    const s = overlay(
      [pt(cur.stime, 10, 100), pt(cur.stime + STEP_MS, 20, 300)],
      [pt(b1.stime, 10, 100), pt(b2.stime, 30, 200), pt(b1.stime + STEP_MS, 10, 100)],
      cur,
      [b1, b2],
    );
    expect(s.map(x => x.t)).toEqual([cur.stime, cur.stime + STEP_MS, cur.stime + 2 * STEP_MS]);
    expect(s[0].cur).toEqual({ count: 10, errors: 0, avg: 100, max: 200 });
    expect(s[0].base).toEqual({ avg: 175, lo: 100, hi: 200, count: 20 });
    // 한 구간에만 있으면 건수는 구간 수로 나눈 평균
    expect(s[1].base).toEqual({ avg: 100, lo: 100, hi: 100, count: 5 });
    expect(s[2].base.avg).toBeNull();
    expect(s[2].base.count).toBe(0);
  });

  it('평소 구간이 짧으면 겹치는 칸까지만', () => {
    const short = { stime: 9 * D, etime: 9 * D + STEP_MS };
    const s = overlay([], [pt(short.stime, 4, 50)], cur, [short]);
    expect(s[0].base.count).toBe(4);
    expect(s[1].base.count).toBeNull();
  });
});

describe('cdf', () => {
  it('누적 비율', () => {
    expect(cdf([[100, 1], [10, 3]])).toEqual([[10, 0.75], [100, 1]]);
    expect(cdf([])).toEqual([]);
  });
});
