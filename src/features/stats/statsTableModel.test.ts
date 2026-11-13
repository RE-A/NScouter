import { describe, expect, it } from 'vitest';
import type { ServiceStats, StatsSummary } from './statsApi';
import { clampWidth, DEFAULT_SORT, nextSort, parseWidths, sortRows } from './statsTableModel';

const s = (over: Partial<StatsSummary> = {}): StatsSummary => ({
  count: 100, errors: 0, error_rate: 0, tps: 1, avg_ms: 200, p50_ms: 150, p90_ms: 400, p95_ms: 500, p99_ms: 900,
  max_ms: 2000, sql_count_avg: 3, sql_ms_avg: 50, api_count_avg: 1, api_ms_avg: 20, cpu_ms_avg: 5,
  series: [], dist: [], slowest: [], errored: [], ...over,
});
const r = (service: string, c: StatsSummary | null, b: StatsSummary | null, score = 0): { row: ServiceStats; score: number } => ({
  row: { service, current: c, baseline: b },
  score,
});

describe('정렬', () => {
  const list = [
    r('/b', s({ p90_ms: 900 }), s({ p90_ms: 300 }), 5),
    r('/a', s({ p90_ms: 500 }), s({ p90_ms: 450 }), 1),
    r('/new', s({ p90_ms: 700 }), null, 9),
  ];
  const names = (x: typeof list) => x.map(y => y.row.service);

  it('같은 머리를 다시 누르면 방향이 바뀌고, 다른 머리는 숫자 큰 것부터·이름은 가나다순', () => {
    expect(nextSort(DEFAULT_SORT, 'verdict')).toEqual({ col: 'verdict', dir: 'asc' });
    expect(nextSort(DEFAULT_SORT, 'p90.cur')).toEqual({ col: 'p90.cur', dir: 'desc' });
    expect(nextSort(DEFAULT_SORT, 'service')).toEqual({ col: 'service', dir: 'asc' });
  });

  it('기준·과거·과거 대비 열로 줄 세운다 — 값이 없는 줄은 어느 방향이든 맨 아래', () => {
    expect(names(sortRows(list, { col: 'p90.cur', dir: 'desc' }))).toEqual(['/b', '/new', '/a']);
    expect(names(sortRows(list, { col: 'p90.vs', dir: 'desc' }))).toEqual(['/b', '/a', '/new']);
    expect(names(sortRows(list, { col: 'p90.vs', dir: 'asc' }))).toEqual(['/a', '/b', '/new']);
    expect(names(sortRows(list, { col: 'p90.past', dir: 'asc' }))).toEqual(['/b', '/a', '/new']);
    expect(names(sortRows(list, { col: 'service', dir: 'asc' }))).toEqual(['/a', '/b', '/new']);
    expect(names(sortRows(list, DEFAULT_SORT))).toEqual(['/new', '/b', '/a']);
  });

  it('에러율 과거 대비는 %p 차이로 견준다', () => {
    const e = [r('/x', s({ error_rate: 0.5 }), s({ error_rate: 0.45 })), r('/y', s({ error_rate: 0.02 }), s({ error_rate: 0.001 }))];
    // 비율로는 /y(×20) 가 크지만 %p 로는 /x(+5%p) 가 크다
    expect(names(sortRows(e, { col: 'err.vs', dir: 'desc' }))).toEqual(['/x', '/y']);
  });
});

describe('너비', () => {
  it('최소·최대로 자르고, 모르는 열·못 쓸 값은 버린다', () => {
    expect(clampWidth('p90.cur', 10)).toBe(44);
    expect(clampWidth('service', 50)).toBe(120);
    expect(parseWidths({ 'p90.cur': 100, bogus: 50, 'avg.vs': -1, service: 'x' })).toEqual({ 'p90.cur': 100 });
    expect(parseWidths(null)).toEqual({});
  });
});
