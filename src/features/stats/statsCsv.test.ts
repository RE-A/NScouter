import { describe, expect, it } from 'vitest';
import type { StatsSummary } from './statsApi';
import { statsCsv, statsViewCsv } from './statsCsv';
import { DEFAULT_RULES as D } from './statsJudge';

// 판정 논리 시험 — 고정한 규칙으로(기본값 1.3배·1000ms 와 상관없이)
const DEFAULT_RULES = { ...D, slowRatio: 1.5, slowMinMs: 100 };

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
    // 화면에서 쓰지 않는 열은 뺐다 — 기준·과거 11열씩, 39 → 31열
    for (const gone of ['p95', 'CPU', 'SQL 횟수', 'API 횟수']) expect(head.some(h => h.includes(gone))).toBe(false);
    expect(head).toContain('기준 SQL(ms)');
    expect(head).toContain('과거 일평균 API(ms)');
    expect(head.length).toBe(31);
  });
});

describe('statsViewCsv', () => {
  it('화면 그대로 — 넘긴 줄 순서대로, 판정은 이유까지, 과거 대비는 화면 표기', () => {
    const csv = statsViewCsv(
      [
        { service: '/new', current: s(), baseline: null },
        { service: '/slow', current: s({ avg_ms: 400 }), baseline: s() },
      ],
      DEFAULT_RULES,
      3,
    );
    const lines = csv.split('\r\n');
    const head = lines[0].split(',');
    expect(head.slice(0, 5)).toEqual(['서비스', '판정', '건수 기준', '건수 과거 일평균', '건수 과거 대비']);
    expect(head).toContain('p50(ms) 기준');
    expect(head).toContain('에러율(%) 과거 대비');
    expect(head).not.toContain('SQL(ms)');
    expect(lines.length).toBe(3);
    expect(lines[1].startsWith('/new,기준에만 있음,1000,,')).toBe(true);
    const cells = lines[2].split(',');
    expect(cells[1]).toBe('느려짐 평균 ×2.0');
    expect(cells[head.indexOf('평균(ms) 기준')]).toBe('400');
    expect(cells[head.indexOf('평균(ms) 과거 일평균')]).toBe('200');
    expect(cells[head.indexOf('평균(ms) 과거 대비')]).toBe('×2.0');
    expect(cells[head.indexOf('에러율(%) 기준')]).toBe('1');
    // 작은 변화는 빈 칸(화면과 같다)
    expect(cells[head.indexOf('p90(ms) 과거 대비')]).toBe('');
    expect(cells.length).toBe(head.length);
  });

  it('늘어난 쪽 + 는 ▲ — 엑셀이 + 로 시작하는 칸을 수식으로 읽지 않게', () => {
    const csv = statsViewCsv([{ service: '/up', current: s({ p50_ms: 225, error_rate: 0.03, p90_ms: 300 }), baseline: s() }], DEFAULT_RULES);
    const [h, line] = csv.split('\r\n');
    const head = h.split(',');
    const cells = line.split(',');
    expect(cells[head.indexOf('p50(ms) 과거 대비')]).toBe('▲50%');
    expect(cells[head.indexOf('에러율(%) 과거 대비')]).toBe('▲2.0%p');
    expect(cells[head.indexOf('p90(ms) 과거 대비')]).toBe('−25%');
    expect(cells.slice(2).some(c => c.startsWith('+'))).toBe(false);
  });
});
