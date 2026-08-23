// 카운터 차트의 시간축 좌표 (순수 함수)

/**
 * 표본 하나의 x 좌표.
 *
 * 시간축은 **표본 수와 무관하게 고정**이다 — 한 칸이 항상 폴링 주기 하나다.
 * 표본이 늘어난다고 이미 그려진 점이 옆으로 밀리면 선이 출렁여서 못 읽는다.
 *
 * 기준점은 **오른쪽 끝(현재)** 이다. 모니터링 차트는 최신값이 오른쪽에 있고
 * 과거가 왼쪽으로 흘러간다. 왼쪽 기준으로 잡으면 버퍼가 찰 때까지
 * 오른쪽이 비어 있어 고장처럼 보인다.
 *
 * @param index    표본 인덱스 (0 = 가장 오래된 것)
 * @param total    현재 표본 수
 * @param width    캔버스 폭(px)
 * @param capacity 버퍼 용량 = 시간축 전체 칸 수
 */
export function sampleX(
  index: number,
  total: number,
  width: number,
  capacity: number,
): number {
  const slots = Math.max(1, capacity - 1);
  const age = total - 1 - index; // 0 이면 최신
  return width - (age / slots) * width;
}

/**
 * 총량 기준선을 같은 축에 그려도 되는가.
 *
 * 쌍으로 오는 카운터에는 상한이 함께 온다 (F-33).
 * Heap 처럼 총 114 / 사용 44 면 나란히 놓아야 "얼마나 남았나"가 보인다.
 *
 * 그런데 FdUsage 는 상한이 1,048,576 이고 열린 것은 36이다. 같은 축에 놓으면
 * **사용량 선이 바닥에 붙어 추세가 통째로 사라진다.** 그때는 숫자로만 보여준다.
 */
const TOTAL_LINE_MAX_RATIO = 4;

export function totalLineVisible(maxUsed: number, total: number | null): boolean {
  if (total === null || !(total > 0) || !(maxUsed > 0)) return false;
  return total <= maxUsed * TOTAL_LINE_MAX_RATIO;
}
