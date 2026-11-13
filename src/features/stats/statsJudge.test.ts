// 특이사항 판정 — 기본값: 1.5배·100ms 이상이면 느려짐, 2배·1%p 이상이면 에러 증가, ±50% 면 호출량 급변

import { describe, expect, it } from 'vitest';
import type { ServiceStats, StatsSummary } from './statsApi';
import { change, DEFAULT_RULES, judge as judgeWith, prefsFromRules, rulesFromPrefs, severity as severityWith, type JudgeRules } from './statsJudge';

// 판정 논리를 보는 시험 — 기본값(1.3배·1000ms)이 아니라 고정한 규칙으로 본다
const R: JudgeRules = { ...DEFAULT_RULES, slowRatio: 1.5, slowMinMs: 100 };
const judge = (row: ServiceStats, r: JudgeRules = R) => judgeWith(row, r);
const severity = (row: ServiceStats, r: JudgeRules = R) => severityWith(row, r);

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
  it('과거와 같으면 깃발이 없다', () => {
    expect(judge(row(s(), s()))).toEqual([]);
  });

  it('평균이 1.5배 넘고 100ms 이상 늘면 느려짐', () => {
    expect(judge(row(s({ avg_ms: 320 }), s()))).toEqual(['slow']);
  });

  it('p90 만 늘어도 느려짐', () => {
    expect(judge(row(s({ p90_ms: 700 }), s()))).toEqual(['slow']);
  });

  it('느려짐은 고른 지표로만 본다 — p50·p90·p99·평균', () => {
    const r = row(s({ p99_ms: 3000 }), s());
    // 기본은 평균·p90
    expect(judge(r)).toEqual([]);
    expect(judge(r, { ...R, slowOn: ['p99'] })).toEqual(['slow']);
    const mid = row(s({ p50_ms: 500 }), s());
    expect(judge(mid)).toEqual([]);
    expect(judge(mid, { ...R, slowOn: ['p50'] })).toEqual(['slow']);
    // 평균을 빼면 평균만 늘어난 것은 안 걸린다
    expect(judge(row(s({ avg_ms: 900 }), s()), { ...R, slowOn: ['p90'] })).toEqual([]);
  });

  it('설정 값을 판정 기준으로 — 못 쓸 값은 기본값, 예전 use_p99 도 읽는다', () => {
    const r = rulesFromPrefs({ slow_ratio: 2, slow_min_ms: 0, error_ratio: -1, error_min_pp: 0.5, volume_pct: 30, min_count: 10, use_p99: true });
    expect(r).toEqual({ ...DEFAULT_RULES, slowRatio: 2, slowMinMs: 0, errorMinDelta: 0.005, volumeRatio: 0.3, minCount: 10, slowOn: ['avg', 'p90', 'p99'], beyondWorst: true });
    expect(rulesFromPrefs({ ...prefsFromRules(DEFAULT_RULES), slow_metrics: ['p99', 'p50', 'bogus'] }).slowOn).toEqual(['p50', 'p99']);
    expect(rulesFromPrefs(prefsFromRules(DEFAULT_RULES))).toEqual(DEFAULT_RULES);
  });

  it('과거가 여럿이면 과거 최악의 날보다도 나쁠 때만 — 끄면 평균만 본다', () => {
    const d = (p90: number, err = 0) => ({ count: 500, errors: 0, error_rate: err, tps: 1, avg_ms: 100, p50_ms: 80, p90_ms: p90, p99_ms: 900, max_ms: 1000 });
    // 평소 p90 은 400 이지만 날마다 200~1000 으로 들쭉날쭉 — 기준 700 은 최악(1000)보다 낫다
    const base = s({ p90_ms: 400 });
    const r: ServiceStats = { service: '/a', current: s({ p90_ms: 700 }), baseline: base, baseline_days: [d(200), d(1000)] };
    expect(judge(r)).toEqual([]);
    expect(judge(r, { ...R, beyondWorst: false })).toEqual(['slow']);
    expect(judge({ ...r, current: s({ p90_ms: 1200 }) })).toEqual(['slow']);
    // 하루뿐이면 쓰지 않는다
    expect(judge({ ...r, baseline_days: [d(1000)] })).toEqual(['slow']);
    // 에러도 같다
    const e: ServiceStats = { service: '/e', current: s({ error_rate: 0.05 }), baseline: s({ error_rate: 0.01 }), baseline_days: [d(400, 0.001), d(400, 0.08)] };
    expect(judge(e)).toEqual([]);
    expect(judge({ ...e, current: s({ error_rate: 0.09 }) })).toEqual(['errors']);
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

  it('한쪽에만 있으면 신규·과거에만 있음, 건수가 적으면 판정하지 않는다', () => {
    expect(judge(row(s(), null))).toEqual(['new']);
    expect(judge(row(null, s()))).toEqual(['gone']);
    expect(judge(row(s({ count: 10, avg_ms: 5000 }), s()))).toEqual(['few']);
  });
});

describe('배율·차이 스위치와 기본값', () => {
  it('기본값은 느려짐 1.3배·1000ms', () => {
    expect(DEFAULT_RULES.slowRatio).toBe(1.3);
    expect(DEFAULT_RULES.slowMinMs).toBe(1000);
    // 1.5배·+300ms 는 기본값으로는 아니다(1000ms 미만)
    expect(judgeWith(row(s({ avg_ms: 500 }), s({ avg_ms: 200 })))).toEqual([]);
    expect(judgeWith(row(s({ avg_ms: 1300 }), s({ avg_ms: 200 })))).toEqual(['slow']);
  });

  it('느려짐 — 배율만 · 차이만', () => {
    const big = row(s({ avg_ms: 9000 }), s({ avg_ms: 8000 })); // ×1.125, +1000ms
    const ratio = row(s({ avg_ms: 30 }), s({ avg_ms: 10 })); // ×3, +20ms
    const both = { ...R, slowRatio: 1.3, slowMinMs: 1000 };
    expect(judge(big, both)).toEqual([]);
    expect(judge(big, { ...both, slowUseRatio: false })).toEqual(['slow']);
    expect(judge(ratio, both)).toEqual([]);
    expect(judge(ratio, { ...both, slowUseMs: false })).toEqual(['slow']);
    // 배율만 써도 줄어든 것은 아니다
    expect(judge(row(s({ avg_ms: 10 }), s({ avg_ms: 30 })), { ...both, slowUseMs: false })).toEqual([]);
  });

  it('에러 증가 — 배율만 · 차이만', () => {
    const smallStep = row(s({ error_rate: 0.004 }), s({ error_rate: 0.001 })); // ×4, +0.3%p
    const bigBase = row(s({ error_rate: 0.3 }), s({ error_rate: 0.2 })); // ×1.5, +10%p
    expect(judge(smallStep)).toEqual([]);
    expect(judge(smallStep, { ...R, errorUsePp: false })).toEqual(['errors']);
    expect(judge(bigBase)).toEqual([]);
    expect(judge(bigBase, { ...R, errorUseRatio: false })).toEqual(['errors']);
  });

  it('배율·차이 묶기 — 또는이면 하나만 넘어도', () => {
    const big = row(s({ avg_ms: 9000 }), s({ avg_ms: 8000 })); // ×1.125, +1000ms
    const base = { ...R, slowRatio: 1.3, slowMinMs: 1000 };
    expect(judge(big, base)).toEqual([]);
    expect(judge(big, { ...base, slowCombine: 'or' })).toEqual(['slow']);
    const err = row(s({ error_rate: 0.004 }), s({ error_rate: 0.001 })); // ×4, +0.3%p
    expect(judge(err)).toEqual([]);
    expect(judge(err, { ...R, errorCombine: 'or' })).toEqual(['errors']);
    expect(rulesFromPrefs({ ...prefsFromRules(DEFAULT_RULES), slow_combine: 'or', error_combine: 'bogus' })).toMatchObject({ slowCombine: 'or', errorCombine: 'and' });
  });

  it('설정 — 스위치는 없으면 켬, 한 판정에서 둘 다 꺼져 있으면 둘 다 켠다', () => {
    const p = prefsFromRules(DEFAULT_RULES);
    expect(rulesFromPrefs({ ...p, slow_use_ratio: false }).slowUseRatio).toBe(false);
    expect(rulesFromPrefs({ ...p, slow_use_ratio: false, slow_use_ms: false })).toMatchObject({ slowUseRatio: true, slowUseMs: true });
    const { error_use_pp: _, ...old } = p;
    expect(rulesFromPrefs(old).errorUsePp).toBe(true);
  });
});

describe('change · severity', () => {
  it('변화율 — 기준 0 이면 null', () => {
    expect(change(150, 100)).toBeCloseTo(0.5);
    expect(change(1, 0)).toBeNull();
  });

  it('에러 증가가 느려짐보다, 느려짐이 과거보다 나쁘다', () => {
    const err = severity(row(s({ error_rate: 0.05 }), s()));
    const slow = severity(row(s({ avg_ms: 400 }), s()));
    const same = severity(row(s(), s()));
    expect(err).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThan(same);
  });
});
