import { describe, expect, it } from 'vitest';
import type { ServiceStats, StatsSummary } from './statsApi';
import { DEFAULT_RULES } from './statsJudge';
import { flagReason, fmtMetric, fmtPp, fmtVs, metricBad, metricValue, splitService } from './statsFormat';

const s = (over: Partial<StatsSummary> = {}): StatsSummary => ({
  count: 1000, errors: 0, error_rate: 0, tps: 1, avg_ms: 200, p50_ms: 150, p90_ms: 400, p95_ms: 500, p99_ms: 900,
  max_ms: 2000, sql_count_avg: 3, sql_ms_avg: 50, api_count_avg: 1, api_ms_avg: 20, cpu_ms_avg: 5,
  series: [], dist: [], slowest: [], errored: [], ...over,
});
const row = (c: StatsSummary | null, b: StatsSummary | null): ServiceStats => ({ service: '/a', current: c, baseline: b });

describe('표기', () => {
  it('과거 대비 — 2배 이상은 배수, 그 밖은 %, 10% 안쪽은 빈 칸', () => {
    expect(fmtVs(5045, 82)).toBe('×62');
    expect(fmtVs(820, 200)).toBe('×4.1');
    expect(fmtVs(178, 100)).toBe('+78%');
    expect(fmtVs(69, 100)).toBe('−31%');
    expect(fmtVs(105, 100)).toBe('');
    expect(fmtVs(5, 0)).toBe('');
  });

  it('에러율은 %p', () => {
    expect(fmtPp(0.1897, 0.0476)).toBe('+14.2%p');
    expect(fmtPp(0.0005, 0)).toBe('');
    expect(fmtPp(0.01, 0.03)).toBe('−2.0%p');
  });

  it('과거 건수는 구간당 평균', () => {
    expect(metricValue(s({ count: 700 }), 'count', 7)).toBe(100);
    expect(fmtMetric('count', 12.5)).toBe('12.5');
    expect(fmtMetric('count', 1234)).toBe('1,234');
    expect(fmtMetric('err', 0.0123)).toBe('1.23%');
  });

  it('빨간색은 판정에 걸린 지표만 — 건수는 안 칠한다, 고른 지표만', () => {
    const r = row(s({ avg_ms: 900, p99_ms: 9000, count: 2000 }), s());
    expect(metricBad('avg', r, DEFAULT_RULES)).toBe(true);
    expect(metricBad('p90', r, DEFAULT_RULES)).toBe(false);
    expect(metricBad('p99', r, DEFAULT_RULES)).toBe(false);
    expect(metricBad('p99', r, { ...DEFAULT_RULES, slowOn: ['p99'] })).toBe(true);
    // 고르지 않은 지표는 안 칠한다
    expect(metricBad('avg', r, { ...DEFAULT_RULES, slowOn: ['p99'] })).toBe(false);
    expect(metricBad('count', r, DEFAULT_RULES)).toBe(false);
  });

  it('판정 이유', () => {
    expect(flagReason('slow', row(s({ avg_ms: 400, p90_ms: 1640 }), s()), DEFAULT_RULES)).toBe('p90 ×4.1');
    expect(flagReason('errors', row(s({ error_rate: 0.19 }), s({ error_rate: 0.05 })), DEFAULT_RULES)).toBe('+14.0%p');
    expect(flagReason('volume', row(s({ tps: 0.4 }), s()), DEFAULT_RULES)).toBe('TPS −60%');
  });
});

describe('splitService', () => {
  it.each([
    ['/com/controller/extCommonController/cj.com.sa.bond.SalesService.getInfo', '/com/controller/extCommonController/cj.com.sa.bond.', 'SalesService.getInfo'],
    ['/com/htmlExcel/downloadExcel.fo', '/com/htmlExcel/', 'downloadExcel.fo'],
    ['/com/services/BIP0150Service.BIP0150ServiceHttpSoap11Endpoint/', '/com/services/', 'BIP0150Service.BIP0150ServiceHttpSoap11Endpoint/'],
    ['/shop/products/{id}<GET>', '/shop/', 'products/{id}<GET>'],
    ['/health', '/', 'health'],
    ['plain', '', 'plain'],
  ])('%s', (name, head, tail) => {
    expect(splitService(name)).toEqual({ head, tail });
    expect(head + tail).toBe(name);
  });
});
