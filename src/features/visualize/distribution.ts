// 응답시간 분포의 파생값 (순수 로직)
//
// 집계는 Rust 가 한다(`scouter::distribution`). 여기서 하는 일은 **읽을 수 있게 만드는 것**뿐이다.
//
// 두 가지를 지킨다:
//   1. **나눗셈은 여기서만.** Rust 는 합계만 보낸다 — 두 곳에서 나누면 값이 갈린다.
//   2. **0 건일 때 수를 만들어 내지 않는다.** «평균 0ms» 는 «빨랐다» 로 읽힌다.

import type { ElapsedBucket, ElapsedDistribution } from '../xlog/api/scouterApi';

/** 화면에 그리는 구간 하나 */
export interface BucketView {
  /** `~100ms` · `0.3~0.5s` · `10s+` */
  label: string;
  /** 아래 경계(ms). 색을 정할 때 쓴다 — 이 칸이 «얼마나 느린 칸» 인지가 여기 있다 */
  fromMs: number;
  count: number;
  error: number;
  /** 가장 큰 칸 대비 폭 (0~1). 전체 대비로 하면 한 칸이 90% 일 때 나머지가 안 보인다 */
  ratio: number;
  /** 전체 대비 비중 (0~1). 옆에 적는 % 는 이 값이다 */
  share: number;
}

/**
 * ms 를 짧게.
 *
 * 1초를 넘으면 초로 적는다 — `10000ms` 는 자릿수를 세어야 읽히고, 축에 그렇게 적힌 수가
 * 여덟 개면 읽는 데만 시간이 든다.
 */
export function shortMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  // 0.5s 같은 반 자리는 남기고, 3.0s 는 3s 로 적는다.
  return `${Number.isInteger(sec) ? sec : sec.toFixed(1)}s`;
}

/**
 * 칸 이름.
 *
 * 첫 칸은 아래가 0 이라 `~100ms` 로, 마지막 칸은 위가 없어 `10s+` 로 적는다.
 * **양쪽을 다 적으면(`0~100ms`) 이름이 길어져 칸 폭을 넘는다.**
 */
export function bucketLabel(fromMs: number, ltMs: number | null): string {
  if (ltMs === null) return `${shortMs(fromMs)}+`;
  if (fromMs === 0) return `~${shortMs(ltMs)}`;
  return `${shortMs(fromMs)}~${shortMs(ltMs)}`;
}

/**
 * 그리기 좋은 모양으로.
 *
 * **막대 폭은 «가장 큰 칸» 대비다.** 전체 대비로 하면 대부분이 첫 칸에 몰리는
 * 정상 상태에서 나머지 일곱 칸이 전부 실선이 되어, 정작 보려던 «꼬리» 가 안 보인다.
 */
export function bucketViews(d: ElapsedDistribution): BucketView[] {
  const peak = d.buckets.reduce((m, b) => Math.max(m, b.count), 0);
  let from = 0;
  const out: BucketView[] = [];
  for (const b of d.buckets) {
    out.push({
      label: bucketLabel(from, b.lt_ms),
      fromMs: from,
      count: b.count,
      error: b.error,
      ratio: peak > 0 ? b.count / peak : 0,
      share: d.total > 0 ? b.count / d.total : 0,
    });
    from = b.lt_ms ?? from;
  }
  return out;
}

/**
 * 평균(ms).
 *
 * **0 건이면 `null` 이다.** 0 을 돌려주면 «평균 0ms» 가 되어 빨랐던 것으로 읽힌다.
 */
export function avgMs(d: ElapsedDistribution): number | null {
  return d.total > 0 ? Math.round(d.sum_ms / d.total) : null;
}

/** 에러 비율 (0~1). 0 건이면 `null` — 없는 것을 «0%» 로 적지 않는다 */
export function errorRate(d: ElapsedDistribution): number | null {
  return d.total > 0 ? d.error / d.total : null;
}

/**
 * 이 백분위를 곧이곧대로 믿어도 되는가.
 *
 * Rust 는 상한(기본 30초)보다 느린 건을 그 값으로 눌러 센다. p99 가 상한에 닿아 있으면
 * **«30초» 가 아니라 «30초 이상» 이다** — 화면이 그렇게 적어야 한다.
 */
export function isCapped(ms: number, d: ElapsedDistribution): boolean {
  return ms >= d.percentile_cap_ms;
}

/** 느린 칸인가 — 색 규칙은 `durationTone` 과 같은 경계(300ms)를 쓴다 */
export function isSlowBucket(fromMs: number): boolean {
  return fromMs >= 300;
}

/** 표시용 백분율. 0.4% 를 «0%» 로 적으면 없는 것이 된다 */
export function percent(ratio: number): string {
  const pct = ratio * 100;
  // 진짜 0 은 «0%» 다. `0.0%` 로 적으면 «재 봤더니 거의 0» 처럼 읽힌다.
  if (pct === 0) return '0%';
  if (pct < 0.1) return '<0.1%';
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

/** 화면에 그릴 것이 있는가. `null` 은 «아직 안 물었다» 라 화면이 따로 말한다 */
export function isEmpty(d: ElapsedDistribution | null): boolean {
  return d === null || d.total === 0;
}

/** 빈 버킷을 뺀 목록 — 꼬리가 전부 0 일 때 표 아래가 비어 보이지 않게 */
export function nonEmpty(views: readonly BucketView[]): BucketView[] {
  return views.filter(v => v.count > 0);
}

export type { ElapsedBucket, ElapsedDistribution };
