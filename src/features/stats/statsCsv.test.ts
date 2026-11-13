import { describe, expect, it } from 'vitest';
import type { StatsSummary } from './statsApi';
import { statsCsv } from './statsCsv';
import { DEFAULT_RULES } from './statsJudge';

const s = (over: Partial<StatsSummary> = {}): StatsSummary => ({
  count: 1000, errors: 10, error_rate: 0.01, tps: 2, avg_ms: 200, p50_ms: 150, p90_ms: 400, p95_ms: 500, p99_ms: 900,
  max_ms: 2000, sql_count_avg: 3, sql_ms_avg: 50, api_count_avg: 1, api_ms_avg: 20, cpu_ms_avg: 5,
  series: [], dist: [], slowest: [], errored: [], ...over,
});

describe('statsCsv', () => {
  it('머리글은 기준·과거 — 과거가 여럿이면 과거는 일평균, 건수 합계도 따로', () => {
    const csv = statsCsv(
      [
        { service: '/a,b', current: s({ avg_ms: 400 }), baseline: s({ count: 7000, errors: 70 }) },
        { service: '/new', current: s(), baseline: null },
      ],
      DEFAULT_RULES,
      7,
    );
    const lines = csv.split('\r\n');
    const head = lines[0].split(',');
    expect(head).toContain('기준 건수');
    expect(head).toContain('과거 일평균 건수');
    expect(head).toContain('과거 건수(합계)');
    expect(head.some(h => h.startsWith('현재') || h.includes('평소'))).toBe(false);
    expect(lines.length).toBe(3);
    expect(lines[1].startsWith('"/a,b",느려짐,1000,10,')).toBe(true);
    // 과거 일평균 1000, 합계 7000
    const cells = lines[1].replace('"/a,b"', 's').split(',');
    expect(cells[head.indexOf('과거 일평균 건수')]).toBe('1000');
    expect(cells[head.indexOf('과거 건수(합계)')]).toBe('7000');
    expect(cells[head.indexOf('평균 과거 대비(%)')]).toBe('100');
    expect(lines[2].startsWith('/new,기준에만 있음,')).toBe(true);
    expect(lines[2].split(',').length).toBe(head.length);
  });
});
