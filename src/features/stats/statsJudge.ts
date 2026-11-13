// 특이사항 판정 — «과거보다 느리다 · 에러가 많다» 를 숫자로 가린다
//
// Rust 는 숫자만 낸다. 판정은 여기서 한다 — 기준값을 바꿔 가며 같은 결과를 다시 볼 수 있게.
// 몇 건 안 되는 서비스는 한 건만 느려도 경보가 되므로 `minCount` 보다 적으면 판정하지 않고 «표본 적음» 으로 둔다.

import type { DaySummary, ServiceStats, StatsJudgePrefs, StatsSummary } from './statsApi';

export interface JudgeRules {
  /** 평균 또는 p90 이 기준의 몇 배 넘게 늘면 «느려짐» */
  slowRatio: number;
  /** 그리고 그 차이가 이만큼(ms) 이상일 때만 — 3ms → 6ms 는 두 배여도 문제가 아니다 */
  slowMinMs: number;
  /** 에러율이 기준의 몇 배 이상이면 «에러 증가» */
  errorRatio: number;
  /** 그리고 그 차이가 이만큼(0~1) 이상일 때만 */
  errorMinDelta: number;
  /** TPS 가 기준에서 이 비율(0~1) 넘게 변하면 «호출량 급변» */
  volumeRatio: number;
  /** 한쪽 건수가 이보다 적으면 판정하지 않는다 */
  minCount: number;
  /** «느려짐» 을 볼 지표 — 하나라도 걸리면 느려짐 */
  slowOn: SlowMetric[];
  /** 과거 구간이 여럿이면 **과거 날들 중 가장 나빴던 날보다도 나쁠 때만** 느려짐·에러 증가 — 날마다 들쭉날쭉한 서비스가 늘 뜨지 않게 */
  beyondWorst: boolean;
  /** 느려짐에 배율·차이를 쓰나 — 둘 다 켜면 둘 다 넘어야 한다(AND). 적어도 하나는 켠다 */
  slowUseRatio: boolean;
  slowUseMs: boolean;
  /** 에러 증가에 배율·차이를 쓰나 — 같은 방식 */
  errorUseRatio: boolean;
  errorUsePp: boolean;
  /** 배율·차이를 둘 다 쓸 때 묶는 법 — and: 둘 다 넘어야, or: 하나만 넘어도 */
  slowCombine: Combine;
  errorCombine: Combine;
}

export type Combine = 'and' | 'or';

/** «느려짐» 을 볼 수 있는 지표 */
export type SlowMetric = 'avg' | 'p50' | 'p90' | 'p99';
export const SLOW_METRICS: SlowMetric[] = ['avg', 'p50', 'p90', 'p99'];

/** 지표의 응답시간 */
export function slowValue(s: StatsSummary, m: SlowMetric): number {
  return m === 'avg' ? s.avg_ms : m === 'p50' ? s.p50_ms : m === 'p90' ? s.p90_ms : s.p99_ms;
}

export const DEFAULT_RULES: JudgeRules = {
  slowRatio: 1.3,
  slowMinMs: 1000,
  errorRatio: 2,
  errorMinDelta: 0.01,
  volumeRatio: 0.5,
  minCount: 30,
  slowOn: ['avg', 'p90'],
  beyondWorst: true,
  slowUseRatio: true,
  slowUseMs: true,
  errorUseRatio: true,
  errorUsePp: true,
  slowCombine: 'and',
  errorCombine: 'and',
};

/** 배율·차이 스위치 — 없으면 켬. 한 판정에서 둘 다 꺼져 있으면(손으로 고친 파일) 둘 다 켠다 */
function useFlags(p: StatsJudgePrefs): Pick<JudgeRules, 'slowUseRatio' | 'slowUseMs' | 'errorUseRatio' | 'errorUsePp'> {
  let slowUseRatio = p.slow_use_ratio !== false;
  let slowUseMs = p.slow_use_ms !== false;
  let errorUseRatio = p.error_use_ratio !== false;
  let errorUsePp = p.error_use_pp !== false;
  if (!slowUseRatio && !slowUseMs) slowUseRatio = slowUseMs = true;
  if (!errorUseRatio && !errorUsePp) errorUseRatio = errorUsePp = true;
  return { slowUseRatio, slowUseMs, errorUseRatio, errorUsePp };
}

/** 설정의 «느려짐» 지표 — 없으면 예전 설정(평균·p90, use_p99 면 p99 도) */
function slowFromPrefs(p: StatsJudgePrefs): SlowMetric[] {
  const picked = (p.slow_metrics ?? []).filter((m): m is SlowMetric => (SLOW_METRICS as string[]).includes(m));
  if (picked.length > 0) return SLOW_METRICS.filter(m => picked.includes(m));
  return p.use_p99 === true ? ['avg', 'p90', 'p99'] : ['avg', 'p90'];
}

/** 설정 파일(`config.stats.judge`)의 값 → 판정 기준. 못 쓸 값은 기본값으로 */
export function rulesFromPrefs(p: StatsJudgePrefs | undefined): JudgeRules {
  if (!p) return DEFAULT_RULES;
  const pos = (v: number, d: number) => (Number.isFinite(v) && v > 0 ? v : d);
  return {
    slowRatio: pos(p.slow_ratio, DEFAULT_RULES.slowRatio),
    slowMinMs: Number.isFinite(p.slow_min_ms) && p.slow_min_ms >= 0 ? p.slow_min_ms : DEFAULT_RULES.slowMinMs,
    errorRatio: pos(p.error_ratio, DEFAULT_RULES.errorRatio),
    errorMinDelta: Number.isFinite(p.error_min_pp) && p.error_min_pp >= 0 ? p.error_min_pp / 100 : DEFAULT_RULES.errorMinDelta,
    volumeRatio: pos(p.volume_pct, DEFAULT_RULES.volumeRatio * 100) / 100,
    minCount: Number.isFinite(p.min_count) && p.min_count >= 0 ? Math.round(p.min_count) : DEFAULT_RULES.minCount,
    slowOn: slowFromPrefs(p),
    beyondWorst: p.beyond_worst !== false,
    ...useFlags(p),
    slowCombine: p.slow_combine === 'or' ? 'or' : 'and',
    errorCombine: p.error_combine === 'or' ? 'or' : 'and',
  };
}

export function prefsFromRules(r: JudgeRules): StatsJudgePrefs {
  return {
    slow_ratio: r.slowRatio,
    slow_min_ms: r.slowMinMs,
    error_ratio: r.errorRatio,
    error_min_pp: r.errorMinDelta * 100,
    volume_pct: r.volumeRatio * 100,
    min_count: r.minCount,
    use_p99: r.slowOn.includes('p99'),
    slow_metrics: [...r.slowOn],
    beyond_worst: r.beyondWorst,
    slow_use_ratio: r.slowUseRatio,
    slow_use_ms: r.slowUseMs,
    error_use_ratio: r.errorUseRatio,
    error_use_pp: r.errorUsePp,
    slow_combine: r.slowCombine,
    error_combine: r.errorCombine,
  };
}

export type Flag = 'slow' | 'errors' | 'new' | 'gone' | 'volume' | 'few';

export const FLAG_LABEL: Record<Flag, string> = {
  slow: '느려짐',
  errors: '에러 증가',
  new: '기준에만 있음',
  gone: '과거에만 있음',
  volume: '호출량 급변',
  few: '표본 적음',
};

/** 위쪽 것이 더 나쁜 일 — 표의 «특이사항» 칸과 정렬에 쓴다 */
export const FLAG_ORDER: Flag[] = ['errors', 'slow', 'volume', 'gone', 'new', 'few'];

/** 날마다 따로 센 과거 중 건수가 있는 날 */
function pastDays(row: ServiceStats): DaySummary[] {
  return (row.baseline_days ?? []).filter(d => d.count > 0);
}

/** 그날의 지표 값 */
export function dayValue(d: DaySummary, m: SlowMetric | 'err'): number {
  return m === 'err' ? d.error_rate : m === 'avg' ? d.avg_ms : m === 'p50' ? d.p50_ms : m === 'p90' ? d.p90_ms : d.p99_ms;
}

/** 과거 날들 중 가장 나빴던 날의 값 — 날이 둘 이상일 때만(하나면 «최악» 이 평균과 같다) */
export function worstDay(row: ServiceStats, m: SlowMetric | 'err'): number | null {
  const ds = pastDays(row);
  return ds.length >= 2 ? Math.max(...ds.map(d => dayValue(d, m))) : null;
}

/** 이 지표로 느려졌나 — 비율·차이 조건, 그리고 켜져 있으면 과거 최악보다도 나쁜가 */
export function slowHit(row: ServiceStats, m: SlowMetric, r: JudgeRules): boolean {
  const c = row.current;
  const b = row.baseline;
  if (!c || !b) return false;
  if (!slower(slowValue(c, m), slowValue(b, m), r)) return false;
  const w = r.beyondWorst ? worstDay(row, m) : null;
  return w === null || slowValue(c, m) > w;
}

/** 에러가 늘었나 — 같은 방식 */
export function errHit(row: ServiceStats, r: JudgeRules): boolean {
  const c = row.current;
  const b = row.baseline;
  if (!c || !b) return false;
  if (!errorUp(c.error_rate, b.error_rate, r)) return false;
  const w = r.beyondWorst ? worstDay(row, 'err') : null;
  return w === null || c.error_rate > w;
}

/** 켠 조건만 묶는다 — 하나만 켜면 그것, 둘 다 켜면 and/or. 둘 다 꺼진 일은 `useFlags` 가 막는다 */
function combine(useA: boolean, a: boolean, useB: boolean, b: boolean, how: Combine): boolean {
  if (useA && useB) return how === 'or' ? a || b : a && b;
  if (useA) return a;
  if (useB) return b;
  return false;
}

/** 응답시간이 늘었나 — 켠 조건만 본다(둘 다 켜면 and/or). 배율만 쓸 때도 늘기는 해야 한다 */
export function slower(cur: number, base: number, r: JudgeRules): boolean {
  if (!(cur > base)) return false;
  return combine(r.slowUseMs, cur - base >= r.slowMinMs, r.slowUseRatio, cur >= base * r.slowRatio, r.slowCombine);
}

/** 에러율이 늘었나 — 같은 방식. 과거가 0 이면 배율은 «늘었으면 넘은 것» 으로 본다 */
export function errorUp(cur: number, base: number, r: JudgeRules): boolean {
  if (!(cur > base)) return false;
  return combine(r.errorUsePp, cur - base >= r.errorMinDelta, r.errorUseRatio, base === 0 || cur >= base * r.errorRatio, r.errorCombine);
}

export function judge(row: ServiceStats, r: JudgeRules = DEFAULT_RULES): Flag[] {
  const { current: c, baseline: b } = row;
  if (c && !b) return ['new'];
  if (!c && b) return ['gone'];
  if (!c || !b) return [];
  if (c.count < r.minCount || b.count < r.minCount) return ['few'];
  const out: Flag[] = [];
  if (errHit(row, r)) out.push('errors');
  if (r.slowOn.some(m => slowHit(row, m, r))) out.push('slow');
  if (b.tps > 0 && Math.abs(c.tps / b.tps - 1) > r.volumeRatio) out.push('volume');
  return out;
}

/** 변화율 (현재/기준 − 1). 기준이 0 이면 null — 무한대 % 를 적으면 읽을 수 없다 */
export function change(cur: number | undefined, base: number | undefined): number | null {
  if (cur === undefined || base === undefined || base === 0) return null;
  return cur / base - 1;
}

/**
 * «얼마나 나빠졌나» — 가장 나빠진 순으로 줄 세울 때 쓴다.
 * 에러율이 늘어난 폭(%p × 10)과 평균·p90 이 늘어난 비율 중 큰 것. 판정 깃발이 있으면 먼저 온다
 */
export function severity(row: ServiceStats, r: JudgeRules = DEFAULT_RULES): number {
  const flags = judge(row, r);
  const c: StatsSummary | null = row.current;
  const b: StatsSummary | null = row.baseline;
  let score = 0;
  if (c && b && !flags.includes('few')) {
    score = Math.max(
      (c.error_rate - b.error_rate) * 1000,
      ...r.slowOn.map(m => change(slowValue(c, m), slowValue(b, m)) ?? 0),
    );
  }
  const bonus = flags.includes('errors') ? 2000 : flags.includes('slow') ? 1000 : flags.includes('volume') ? 500 : 0;
  return bonus + score;
}
