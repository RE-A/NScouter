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
 */
export function sparklinePoints(values: readonly number[], width: number, height: number): Point[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [{ x: 0, y: height / 2 }];

  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  // 값이 모두 같으면 범위가 0이다. 그대로 나누면 NaN 이 되어 선이 통째로 사라진다.
  const span = max - min;
  const step = width / (values.length - 1);

  return values.map((v, i) => ({
    x: i * step,
    y: span === 0 ? height / 2 : height - ((v - min) / span) * height,
  }));
}

/** `<polyline points="...">` 에 넣을 문자열 */
export function toPolyline(points: readonly Point[]): string {
  return points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}
