// 특이사항 판정 — 기본값: 1.5배·100ms 이상이면 느려짐, 2배·1%p 이상이면 에러 증가, ±50% 면 호출량 급변

import { describe, expect, it } from 'vitest';
import type { ServiceStats, StatsSummary } from './statsApi';
import { change, judge, severity } from './statsJudge';

const s = (over: Partial<StatsSummary> = {}): StatsSummary => ({
  count: 1000,
  errors: 0,
  error_rate: 0,
  tps: 10,
  avg_ms: 200,
  p50_ms: 150,
  p90_ms: 400,
  p95_ms: 500,
  p99_ms: 900,
  max_ms: 2000,
  sql_count_avg: 3,
  sql_ms_avg: 50,
  api_count_avg: 1,
  api_ms_avg: 20,
  cpu_ms_avg: 5,
  series: [],
  dist: [],
  slowest: [],
  errored: [],
  ...over,
});
const row = (current: StatsSummary | null, baseline: StatsSummary | null): ServiceStats => ({ service: '/a', current, baseline });

describe('judge', () => {
  it('평소와 같으면 깃발이 없다', () => {
    expect(judge(row(s(), s()))).toEqual([]);
  });

  it('평균이 1.5배 넘고 100ms 이상 늘면 느려짐', () => {
    expect(judge(row(s({ avg_ms: 320 }), s()))).toEqual(['slow']);
  });

  it('p90 만 늘어도 느려짐', () => {
    expect(judge(row(s({ p90_ms: 700 }), s()))).toEqual(['slow']);
  });

  it('두 배여도 차이가 100ms 미만이면 아니다 — 3ms → 6ms', () => {
    expect(judge(row(s({ avg_ms: 6, p90_ms: 8 }), s({ avg_ms: 3, p90_ms: 4 })))).toEqual([]);
  });

  it('에러율이 두 배 넘고 1%p 이상 늘면 에러 증가 — 기준이 0 이어도', () => {
    expect(judge(row(s({ error_rate: 0.05 }), s({ error_rate: 0.02 })))).toEqual(['errors']);
    expect(judge(row(s({ error_rate: 0.02 }), s({ error_rate: 0 })))).toEqual(['errors']);
    expect(judge(row(s({ error_rate: 0.005 }), s({ error_rate: 0 }))), '1%p 미만').toEqual([]);
  });

  it('TPS 가 ±50% 넘게 변하면 호출량 급변', () => {
    expect(judge(row(s({ tps: 4 }), s()))).toEqual(['volume']);
    expect(judge(row(s({ tps: 16 }), s()))).toEqual(['volume']);
  });

  it('한쪽에만 있으면 신규·사라짐, 건수가 적으면 판정하지 않는다', () => {
    expect(judge(row(s(), null))).toEqual(['new']);
    expect(judge(row(null, s()))).toEqual(['gone']);
    expect(judge(row(s({ count: 10, avg_ms: 5000 }), s()))).toEqual(['few']);
  });
});

describe('change · severity', () => {
  it('변화율 — 기준 0 이면 null', () => {
    expect(change(150, 100)).toBeCloseTo(0.5);
    expect(change(1, 0)).toBeNull();
  });

  it('에러 증가가 느려짐보다, 느려짐이 평소보다 나쁘다', () => {
    const err = severity(row(s({ error_rate: 0.05 }), s()));
    const slow = severity(row(s({ avg_ms: 400 }), s()));
    const same = severity(row(s(), s()));
    expect(err).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThan(same);
  });
});
