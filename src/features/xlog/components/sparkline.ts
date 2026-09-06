// 스파크라인 좌표 (순수 로직)
//
// 오늘 누적 카운터는 5분 간격 288포인트다. 축도 눈금도 필요 없고
// **모양만** 보면 되므로 폭에 맞춰 접는다.

export interface Point {
  x: number;
  y: number;
}

/**
 * 값 배열을 주어진 상자 안의 점들로 옮긴다.
 *
 * y 는 아래로 자라므로 **최댓값이 0**이다.
 *
 * **`null` 은 점을 만들지 않는다.** 5분 집계는 수집이 없던 슬롯을 null 로 주는데,
 * 그걸 0 으로 두면 없던 골짜기가 생긴다. 다만 **x 는 자리(인덱스)로 잡으므로**
 * 빠진 자리를 건너뛴 선이 곧게 이어진다 — 스파크라인은 축도 눈금도 없이
 * «모양만» 보는 그림이라 여기까지가 값에 맞는 정확도다.
 */
export function sparklinePoints(
  values: readonly (number | null)[],
  width: number,
  height: number,
): Point[] {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return [];
  if (values.length === 1 || present.length === 1) return [{ x: 0, y: height / 2 }];

  let min = Infinity;
  let max = -Infinity;
  for (const v of present) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  // 값이 모두 같으면 범위가 0이다. 그대로 나누면 NaN 이 되어 선이 통째로 사라진다.
  const span = max - min;
  const step = width / (values.length - 1);

  const out: Point[] = [];
  values.forEach((v, i) => {
    if (v === null) return;
    out.push({
      x: i * step,
      y: span === 0 ? height / 2 : height - ((v - min) / span) * height,
    });
  });
  return out;
}

/** `<polyline points="...">` 에 넣을 문자열 */
export function toPolyline(points: readonly Point[]): string {
  return points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}
