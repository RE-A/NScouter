// 액티브 서비스 막대 (순수 로직)
//
// 지금 돌고 있는 요청을 소요 시간 단계로 나눈 값이다.
// **합계로 뭉개면 안 된다** — 10건이어도 전부 3초 이상이면 장애고,
// 100건이어도 전부 1초 미만이면 그냥 바쁜 것이다.

import type { ActiveSpeed } from '../api/scouterApi';

/** 1 = 1초 미만, 2 = 1~3초, 3 = 3초 이상 */
export type SpeedStep = 1 | 2 | 3;

export interface SpeedSegment {
  step: SpeedStep;
  count: number;
  /** 막대에서 차지할 비율 (%) */
  pct: number;
}

/** 느린 단계 한 건은 이만큼은 보여야 한다 */
const MIN_PCT = 6;

export function speedTotal(a: ActiveSpeed): number {
  return a.act1 + a.act2 + a.act3;
}

/** 지금 존재하는 가장 느린 단계. 없으면 0 */
export function worstStep(a: ActiveSpeed): SpeedStep | 0 {
  if (a.act3 > 0) return 3;
  if (a.act2 > 0) return 2;
  if (a.act1 > 0) return 1;
  return 0;
}

/**
 * 막대 구간. 0인 단계는 뺀다.
 *
 * 99:0:1 이면 act3 이 1% 라 사실상 안 보이는데, **그게 봐야 할 것이다.**
 * 그래서 최소 폭을 주고, 넘친 만큼은 큰 구간에서 비례로 덜어낸다.
 */
export function speedSegments(a: ActiveSpeed): SpeedSegment[] {
  const total = speedTotal(a);
  if (total === 0) return [];

  const raw: SpeedSegment[] = ([
    [1, a.act1],
    [2, a.act2],
    [3, a.act3],
  ] as [SpeedStep, number][])
    .filter(([, count]) => count > 0)
    .map(([step, count]) => ({ step, count, pct: (count / total) * 100 }));

  const small = raw.filter(s => s.pct < MIN_PCT);
  if (small.length === 0) return raw;

  // 끌어올린 만큼을 큰 구간들이 나눠 낸다. 안 그러면 합이 100을 넘어 막대가 삐져나온다.
  const debt = small.reduce((sum, s) => sum + (MIN_PCT - s.pct), 0);
  const big = raw.filter(s => s.pct >= MIN_PCT);
  const bigSum = big.reduce((sum, s) => sum + s.pct, 0);

  return raw.map(s =>
    s.pct < MIN_PCT
      ? { ...s, pct: MIN_PCT }
      : { ...s, pct: bigSum > 0 ? s.pct - debt * (s.pct / bigSum) : s.pct },
  );
}

/**
 * 막대 눈금의 상한 (ASIS `ChartUtil.getEqMaxValue`).
 *
 * **막대 길이가 양을 뜻하려면 오브젝트끼리 같은 자를 써야 한다.**
 * 각자 100% 로 채우면 1건인 서버와 50건인 서버가 똑같아 보인다 —
 * 색은 달라도 "어디에 몰렸나"를 못 읽는다. EQ 화면이 답하는 게 그 질문이다.
 *
 * 실제 최댓값을 그대로 쓰지 않고 계단으로 올린다. 값이 1↔2 로 오갈 때마다
 * 자가 바뀌면 모든 막대가 같이 출렁여 변화를 못 읽는다.
 */
export function eqMaxValue(val: number): number {
  if (val < 7) return 10;
  if (val < 20) return 30;
  if (val < 40) return 60;
  if (val < 70) return 100;
  if (val < 300) return 500;
  return rounding(val * 100) / 100;
}

/** ASIS `ChartUtil.rounding` — 자릿수를 보고 2 / 5 / 10 배로 올린다 */
function rounding(val: number): number {
  const value = Math.trunc(val);
  let dec = 1;
  for (let x = value; x >= 10; x = Math.trunc(x / 10)) dec *= 10;
  if (value > dec * 5) return dec * 10;
  if (value > dec * 2) return dec * 5;
  return dec * 2;
}

/**
 * 막대가 차지할 폭 (%).
 *
 * 1건이라도 있으면 보여야 한다 — 상한이 500이면 1건은 0.2% 라 화면에서 사라진다.
 * 사라진 막대는 0건과 구별되지 않는다.
 */
export function barFillPct(total: number, max: number): number {
  if (total <= 0) return 0;
  if (max <= 0) return 100;
  return Math.min(100, Math.max(2, (total / max) * 100));
}

/**
 * 오늘 누적 총계 — 모든 버킷을 더한다.
 *
 * **마지막 값을 총계로 쓰면 안 된다.** 응답은 5분 단위 버킷이고 진행 중인 버킷은
 * 아직 안 채워져 0으로 온다. 마지막 값만 보면 "오늘 0건" 이 되어 버린다.
 * ASIS 도 시간대별로 버킷을 더한다 (CounterTodayCountView).
 */
export function todayTotal(series: readonly { values: number[] }[]): number {
  return series.reduce((sum, s) => sum + s.values.reduce((a, v) => a + v, 0), 0);
}
