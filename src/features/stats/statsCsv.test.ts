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
  it('머리글 한 줄 + 서비스마다 한 줄, 칸 수가 같다', () => {
    const csv = statsCsv(
      [
        { service: '/a,b', current: s({ avg_ms: 400 }), baseline: s() },
        { service: '/new', current: s(), baseline: null },
      ],
      DEFAULT_RULES,
    );
    const lines = csv.split('\r\n');
    expect(lines.length).toBe(3);
    expect(lines[1].startsWith('"/a,b",느려짐,')).toBe(true);
    expect(lines[1].endsWith(',100,0,0,0')).toBe(true);
    expect(lines[2].startsWith('/new,신규,')).toBe(true);
    // 쉼표가 든 이름은 감싸므로 단순 split 으로 칸 수를 세지 않는다 — 신규 줄로 센다
    expect(lines[2].split(',').length).toBe(lines[0].split(',').length);
  });
});
