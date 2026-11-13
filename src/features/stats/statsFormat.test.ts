import { describe, expect, it } from 'vitest';
import type { ServiceStats, StatsSummary } from './statsApi';
import { DEFAULT_RULES as D } from './statsJudge';

// 판정 논리 시험 — 고정한 규칙으로(기본값 1.3배·1000ms 와 상관없이)
const DEFAULT_RULES = { ...D, slowRatio: 1.5, slowMinMs: 100 };
import { flagReason, fmtMetric, fmtPp, fmtVs, metricBad, metricValue, pastView, splitService } from './statsFormat';

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

  it('과거는 일자별 평균 — 응답시간은 날마다 값의 평균(같은 무게), 건수는 모든 구간의 평균', () => {
    const d = (count: number, p90: number, err = 0) => ({ count, errors: 0, error_rate: err, tps: count / 60, avg_ms: p90 / 2, p50_ms: p90 / 3, p90_ms: p90, p99_ms: p90 * 2, max_ms: p90 * 3 });
    const row: ServiceStats = { service: '/a', current: s(), baseline: s({ count: 1100, p90_ms: 999 }), baseline_days: [d(1000, 100), d(100, 300, 0.1), d(0, 0)] };
    const v = pastView(row, 3)!;
    expect(v.p90_ms).toBe(200); // (100 + 300) / 2 — 건수가 없던 날은 빼고, 날마다 같은 무게
    expect(v.count).toBeCloseTo(1100 / 3); // 건수는 세 구간 평균
    expect(v.error_rate).toBeCloseTo(0.05);
    expect(v.max_ms).toBe(900);
    // 예전 결과(일자별 없음)는 합쳐 센 값에 건수만 나눈다
    expect(pastView({ service: '/b', current: null, baseline: s({ count: 700 }) }, 7)!.count).toBe(100);
    expect(metricValue(v, 'p90')).toBe(200);
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
