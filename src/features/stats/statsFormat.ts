// 비교 표기 — 앱 표·상세·HTML 보고서가 같은 함수로 적는다
//
// 용어: **기준** = 살펴보는 시점(요청의 current), **과거** = 견줄 지난 시점들(요청의 baselines).
// 과거 구간이 여럿이면 건수는 **구간당 평균**으로 적는다 — 합계를 그대로 견주면 과거 7개일 때 «▼86%» 처럼 거꾸로 읽힌다.

import type { ServiceStats, StatsSummary } from './statsApi';
import { change, slowValue, type Flag, type JudgeRules, type SlowMetric } from './statsJudge';

/** «느려짐» 지표의 이름 */
export function slowName(m: SlowMetric, tr: (s: string) => string = x => x): string {
  return m === 'avg' ? tr('평균') : m;
}

/** 표에 두는 지표 */
export type MetricKey = 'count' | 'avg' | 'p90' | 'p99' | 'err';

export const METRICS: MetricKey[] = ['count', 'avg', 'p90', 'p99', 'err'];

/** 지표의 기준·과거 값. 과거 건수는 구간당 평균 */
export function metricValue(s: StatsSummary | null | undefined, k: MetricKey, pastRanges = 1): number | undefined {
  if (!s) return undefined;
  switch (k) {
    case 'count':
      return s.count / Math.max(1, pastRanges);
    case 'avg':
      return s.avg_ms;
    case 'p90':
      return s.p90_ms;
    case 'p99':
      return s.p99_ms;
    case 'err':
      return s.error_rate;
  }
}

/**
 * 과거 대비 — 2배 이상은 배수(`×4.1`, `×213`), 그 밖은 퍼센트(`+78%`, `−31%`).
 * 10% 안쪽 흔들림은 빈 칸(다 적으면 큰 변화가 묻힌다). 과거가 0 이면 빈 칸
 */
export function fmtVs(cur: number | undefined, base: number | undefined): string {
  const c = change(cur, base);
  if (c === null) return '';
  const ratio = c + 1;
  if (ratio >= 2) return `×${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio).toLocaleString()}`;
  const p = Math.round(c * 100);
  if (Math.abs(p) < 10) return '';
  return `${p > 0 ? '+' : '−'}${Math.abs(p)}%`;
}

/** 에러율 차이 — 퍼센트포인트(`+14.2%p`). 0.1%p 안쪽은 빈 칸 */
export function fmtPp(cur: number | undefined, base: number | undefined): string {
  if (cur === undefined || base === undefined) return '';
  const d = (cur - base) * 100;
  if (Math.abs(d) < 0.1) return '';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}%p`;
}

export function fmtMetric(k: MetricKey, v: number | undefined): string {
  if (v === undefined) return '–';
  if (k === 'err') return `${(v * 100).toFixed(2)}%`;
  if (k === 'count' && v < 100 && !Number.isInteger(v)) return v.toFixed(1);
  return Math.round(v).toLocaleString();
}

export function fmtMetricVs(k: MetricKey, cur: number | undefined, base: number | undefined): string {
  return k === 'err' ? fmtPp(cur, base) : fmtVs(cur, base);
}

/**
 * 이 칸의 변화가 **판정에 걸렸나** — 빨간색은 이것만. 건수는 색을 안 쓴다(늘고 줄어드는 게 나쁜 일이 아니다).
 * p99 는 «p99 도 본다» 를 켰을 때만
 */
export function metricBad(k: MetricKey, row: ServiceStats, r: JudgeRules): boolean {
  const c = row.current;
  const b = row.baseline;
  if (!c || !b || c.count < r.minCount || b.count < r.minCount) return false;
  const slower = (x: number, y: number) => x - y >= r.slowMinMs && x >= y * r.slowRatio;
  switch (k) {
    case 'avg':
    case 'p90':
    case 'p99':
      return r.slowOn.includes(k) && slower(slowValue(c, k), slowValue(b, k));
    case 'err':
      return c.error_rate - b.error_rate >= r.errorMinDelta && (b.error_rate === 0 || c.error_rate >= b.error_rate * r.errorRatio);
    case 'count':
      return false;
  }
}

/** 판정 이유 — 칩 옆에 짧게. 걸린 지표 중 가장 크게 변한 것 (p50 처럼 표에 없는 지표도 적는다) */
export function flagReason(f: Flag, row: ServiceStats, r: JudgeRules, tr: (s: string) => string = x => x): string {
  const c = row.current;
  const b = row.baseline;
  if (!c || !b) return '';
  if (f === 'errors') return `${fmtPp(c.error_rate, b.error_rate)}`;
  if (f === 'volume') return `TPS ${fmtVs(c.tps, b.tps) || `${Math.round((c.tps / b.tps - 1) * 100)}%`}`;
  if (f === 'slow') {
    const slower = (x: number, y: number) => x - y >= r.slowMinMs && x >= y * r.slowRatio;
    const hits = r.slowOn.filter(m => slower(slowValue(c, m), slowValue(b, m)));
    const best = hits.sort((x, y) => (change(slowValue(c, y), slowValue(b, y)) ?? 0) - (change(slowValue(c, x), slowValue(b, x)) ?? 0))[0];
    if (!best) return '';
    return `${slowName(best, tr)} ${fmtVs(slowValue(c, best), slowValue(b, best))}`;
  }
  return '';
}

/** 서비스 이름을 «흐린 앞부분 + 진한 끝부분» 으로 — 끝부분이 실제로 무엇인지 알려 준다
 *
 *   /com/controller/x/cj.com.sa.SalesService.getInfo  →  끝: `SalesService.getInfo`
 *   /com/htmlExcel/downloadExcel.fo                     →  끝: `downloadExcel.fo`
 *   /com/services/BIP0150Service.Endpoint/              →  끝: `BIP0150Service.Endpoint/`
 *   /shop/products/{id}<GET>                            →  끝: `products/{id}<GET>` (점이 없으면 경로 마지막 두 마디)
 */
export function splitService(name: string): { head: string; tail: string } {
  const trimmed = name.replace(/\/+$/, '');
  const trail = name.slice(trimmed.length);
  const cut = trimmed.lastIndexOf('/');
  const last = trimmed.slice(cut + 1);
  let tailStart: number;
  if (last.includes('.')) {
    const dots = last.split('.');
    const keep = dots.length >= 2 ? dots.slice(-2).join('.') : last;
    tailStart = cut + 1 + (last.length - keep.length);
  } else {
    const prev = trimmed.lastIndexOf('/', cut - 1);
    tailStart = prev >= 0 && cut > 0 ? prev + 1 : cut + 1;
  }
  return { head: trimmed.slice(0, tailStart), tail: trimmed.slice(tailStart) + trail };
}
