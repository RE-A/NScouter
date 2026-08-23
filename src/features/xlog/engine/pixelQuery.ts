// 클릭 지점 근처의 점 찾기 (순수 함수 — 캔버스 없이 테스트 가능)

/**
 * `index`(픽셀키 → XLog 인덱스)에서 (px, py) 반경 안의 가장 가까운 값을 찾는다.
 *
 * 스캐터의 점은 2~4px 이라 클릭이 정확히 같은 픽셀에 떨어지지 않는다.
 * 그래서 반경 검색이 필요하다.
 *
 * @param canvasWidth 픽셀키 계산 기준 (`y * canvasWidth + x`)
 */
export function findNearestPixel(
  index: Map<number, number>,
  canvasWidth: number,
  px: number,
  py: number,
  radius: number,
): number | undefined {
  if (index.size === 0) return undefined;

  const cx = Math.round(px);
  const cy = Math.round(py);

  let best: number | undefined;
  let bestDist = Infinity;

  for (let dy = -radius; dy <= radius; dy++) {
    const y = cy + dy;
    if (y < 0) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      // 행을 넘어가면 이웃 행의 픽셀을 잘못 집는다
      if (x < 0 || x >= canvasWidth) continue;

      const hit = index.get(y * canvasWidth + x);
      if (hit === undefined) continue;

      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = hit;
      }
    }
  }

  return best;
}
