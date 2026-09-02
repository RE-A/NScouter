// Y축 눈금 정하기 (순수 함수)
//
// **축보다 큰 점은 그려지지 않는다.** `valueToY` 가 `값/최대` 로 자리를 잡고,
// 그 자리가 그림 밖이면 렌더러가 건너뛴다 — 조용히 사라진다.
// 기본 최대가 9초였고, 현장에서 «30초짜리 타임아웃이 확인이 안 된다» 가 나왔다.
// 30초짜리는 9초 축에서 **한 점도 안 보인다.**
//
// 그래서 두 가지를 둔다:
//   1. 자동 — 창 안에서 가장 큰 값에 맞춰 축을 늘린다. 다 보이는 것이 먼저다
//   2. 넘친 건수 — 고정 축을 쓰기로 했을 때, 몇 개가 축 위로 나갔는지 말한다.
//      조용히 빠지면 «없는 것» 으로 읽힌다

/**
 * 눈금으로 쓰기 좋은 수들.
 *
 * 아무 수나 쓰면 축 라벨이 `7.3` `14.6` 처럼 나와 읽는 데 품이 든다.
 * 이 목록을 넘어가면 **위쪽 자리에서 올림**한다(120 → 200, 1,700 → 2,000).
 */
const NICE = [
  0.1, 0.2, 0.3, 0.5, 1, 2, 3, 5, 9, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600,
];

/** `v` 이상인 가장 작은 «보기 좋은» 수 */
export function niceCeil(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return NICE[0];
  const found = NICE.find(n => n >= v);
  if (found !== undefined) return found;

  // 목록 밖 — 가장 큰 자릿수에서 올린다
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / mag) * mag;
}

/**
 * 자동 축 최대.
 *
 * **가장 큰 값이 들어가야 한다.** 백분위로 자르면 «튀는 것 하나» 가 안 보이는데,
 * 이 화면에서 찾는 것이 대개 그 하나다(타임아웃·행). 대신 여백을 조금 둬서
 * 맨 위 점이 축선에 겹치지 않게 한다.
 *
 * 값이 없으면 `fallback` 을 그대로 쓴다 — 빈 구간마다 축이 튀면 눈이 피로하다.
 */
export function autoYMax(values: readonly number[], fallback: number): number {
  let max = 0;
  for (const v of values) {
    if (Number.isFinite(v) && v > max) max = v;
  }
  if (max <= 0) return fallback;
  return niceCeil(max * 1.05);
}

/** 고를 수 있는 고정 최대(초). 자동이 싫을 때 쓴다 */
export const Y_MAX_PRESETS_SEC = [1, 3, 5, 9, 30, 60, 300] as const;

/**
 * 한 단계 확대/축소.
 *
 * Ctrl+휠로 부른다. **눈금 목록을 따라 움직인다** — 곱셈으로 늘리면
 * `9 → 11.7 → 15.2` 같은 축이 나온다.
 */
export function stepYMax(current: number, dir: 1 | -1): number {
  const idx = NICE.findIndex(n => n >= current - 1e-9);
  if (idx < 0) {
    // 목록 밖이면 자릿수로 움직인다
    return dir > 0 ? current * 2 : Math.max(NICE[0], current / 2);
  }
  const next = NICE[Math.min(NICE.length - 1, Math.max(0, idx + dir))];
  return next;
}
