// 차트용 데이터 — 기준 구간의 5분 칸마다 «과거» 를 겹쳐 놓는다
//
// 과거 구간들은 날짜가 다르다(어제·그제 같은 시각). 그래서 **구간 시작에서 얼마나 지났나**로 맞춘다 —
// 현재 10:05 칸에는 각 과거 구간의 «시작 + 5분» 칸이 온다. 여러 과거 구간은
//   · 평균 응답시간: 건수로 가중한 평균(선) 과 구간별 최소~최대(띠)
//   · 건수: 구간당 평균(선)
// 으로 줄인다. 과거 구간 길이가 현재와 다르면 겹치는 칸까지만 쓴다.

import type { SeriesPoint, StatsRange } from './statsApi';

export const STEP_MS = 5 * 60 * 1000;

export interface OverlaySlot {
  /** 기준 구간 기준 칸 시작 시각 */
  t: number;
  cur: { count: number; errors: number; avg: number | null; max: number | null };
  base: { avg: number | null; lo: number | null; hi: number | null; count: number | null };
}

export function overlay(
  current: readonly SeriesPoint[],
  baseline: readonly SeriesPoint[],
  cur: StatsRange,
  bases: readonly StatsRange[],
): OverlaySlot[] {
  const n = Math.max(1, Math.ceil((cur.etime - cur.stime) / STEP_MS));
  const start = Math.floor(cur.stime / STEP_MS) * STEP_MS;
  const slots: OverlaySlot[] = Array.from({ length: n }, (_, i) => ({
    t: start + i * STEP_MS,
    cur: { count: 0, errors: 0, avg: null, max: null },
    base: { avg: null, lo: null, hi: null, count: null },
  }));
  const idx = (offset: number) => Math.floor(offset / STEP_MS);

  for (const p of current) {
    const i = idx(p.t - start);
    if (i < 0 || i >= n) continue;
    const c = slots[i].cur;
    c.avg = c.count + p.count > 0 ? ((c.avg ?? 0) * c.count + p.avg_ms * p.count) / (c.count + p.count) : null;
    c.count += p.count;
    c.errors += p.errors;
    c.max = Math.max(c.max ?? 0, p.max_ms);
  }

  // 칸마다 과거 구간별 (건수, 평균) 을 모은다
  const per: { count: number; sum: number }[][] = Array.from({ length: n }, () => []);
  const covering: number[] = new Array(n).fill(0);
  bases.forEach((b, bi) => {
    const bStart = Math.floor(b.stime / STEP_MS) * STEP_MS;
    const bn = Math.ceil((b.etime - b.stime) / STEP_MS);
    for (let i = 0; i < Math.min(n, bn); i++) covering[i] += 1;
    for (const p of baseline) {
      if (p.t < b.stime - STEP_MS || p.t >= b.etime) continue;
      const i = idx(p.t - bStart);
      if (i < 0 || i >= n || i >= bn) continue;
      const cell = (per[i][bi] ??= { count: 0, sum: 0 });
      cell.count += p.count;
      cell.sum += p.avg_ms * p.count;
    }
  });
  for (let i = 0; i < n; i++) {
    const cells = per[i].filter(c => c && c.count > 0);
    const b = slots[i].base;
    if (covering[i] > 0) b.count = cells.reduce((s, c) => s + c.count, 0) / covering[i];
    if (cells.length === 0) continue;
    const total = cells.reduce((s, c) => s + c.count, 0);
    b.avg = cells.reduce((s, c) => s + c.sum, 0) / total;
    const avgs = cells.map(c => c.sum / c.count);
    b.lo = Math.min(...avgs);
    b.hi = Math.max(...avgs);
  }
  return slots;
}

/** 누적 분포 — (칸 위쪽 끝 ms, 그 이하 비율 0~1). 응답시간이 오른쪽으로 밀렸는지 한눈에 본다 */
export function cdf(dist: readonly [number, number][]): [number, number][] {
  const total = dist.reduce((s, [, c]) => s + c, 0);
  if (total === 0) return [];
  let acc = 0;
  return [...dist].sort((a, b) => a[0] - b[0]).map(([ms, c]) => {
    acc += c;
    return [ms, acc / total];
  });
}
