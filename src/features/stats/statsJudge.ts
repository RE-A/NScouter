// 특이사항 판정 — «평소보다 느리다 · 에러가 많다» 를 숫자로 가린다
//
// Rust 는 숫자만 낸다. 판정은 여기서 한다 — 기준값을 바꿔 가며 같은 결과를 다시 볼 수 있게.
// 몇 건 안 되는 서비스는 한 건만 느려도 경보가 되므로 `minCount` 보다 적으면 판정하지 않고 «표본 적음» 으로 둔다.

import type { ServiceStats, StatsJudgePrefs, StatsSummary } from './statsApi';

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
  /** «느려짐» 에 p99 도 본다 */
  useP99: boolean;
}

export const DEFAULT_RULES: JudgeRules = {
  slowRatio: 1.5,
  slowMinMs: 100,
  errorRatio: 2,
  errorMinDelta: 0.01,
  volumeRatio: 0.5,
  minCount: 30,
  useP99: false,
};

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
    useP99: p.use_p99 === true,
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
    use_p99: r.useP99,
  };
}

export type Flag = 'slow' | 'errors' | 'new' | 'gone' | 'volume' | 'few';

export const FLAG_LABEL: Record<Flag, string> = {
  slow: '느려짐',
  errors: '에러 증가',
  new: '신규',
  gone: '사라짐',
  volume: '호출량 급변',
  few: '표본 적음',
};

/** 위쪽 것이 더 나쁜 일 — 표의 «특이사항» 칸과 정렬에 쓴다 */
export const FLAG_ORDER: Flag[] = ['errors', 'slow', 'volume', 'gone', 'new', 'few'];

function slower(cur: number, base: number, r: JudgeRules): boolean {
  return cur - base >= r.slowMinMs && cur >= base * r.slowRatio;
}

export function judge(row: ServiceStats, r: JudgeRules = DEFAULT_RULES): Flag[] {
  const { current: c, baseline: b } = row;
  if (c && !b) return ['new'];
  if (!c && b) return ['gone'];
  if (!c || !b) return [];
  if (c.count < r.minCount || b.count < r.minCount) return ['few'];
  const out: Flag[] = [];
  if (c.error_rate - b.error_rate >= r.errorMinDelta && (b.error_rate === 0 || c.error_rate >= b.error_rate * r.errorRatio)) {
    out.push('errors');
  }
  if (slower(c.avg_ms, b.avg_ms, r) || slower(c.p90_ms, b.p90_ms, r) || (r.useP99 && slower(c.p99_ms, b.p99_ms, r))) {
    out.push('slow');
  }
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
      change(c.avg_ms, b.avg_ms) ?? 0,
      change(c.p90_ms, b.p90_ms) ?? 0,
      r.useP99 ? (change(c.p99_ms, b.p99_ms) ?? 0) : 0,
    );
  }
  const bonus = flags.includes('errors') ? 2000 : flags.includes('slow') ? 1000 : flags.includes('volume') ? 500 : 0;
  return bonus + score;
}
