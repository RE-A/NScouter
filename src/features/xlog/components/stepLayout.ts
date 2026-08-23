// 프로파일 스텝 레이아웃 계산 (순수 함수)

export interface WaterfallGeometry {
  /** 트랙 왼쪽에서의 시작 위치 (%) */
  leftPct: number;
  /** 막대 폭 (%) */
  widthPct: number;
}

/** elapsed 0 인 스텝도 위치는 보여야 하므로 최소 폭을 준다 */
const MIN_WIDTH_PCT = 1.5;

/** 깊이가 깊어도 좁은 패널에서 내용이 밀려나지 않게 상한을 둔다 */
const MAX_DEPTH = 6;

/**
 * 스텝을 트랜잭션 전체 시간축 위에 놓는다.
 *
 * "어느 스텝이 시간을 먹었나"를 숫자 암산이 아니라 막대 위치·길이로 읽게 하는 게 목적이다.
 * 막대 사이의 빈 구간은 **어떤 스텝도 설명하지 못한 시간**이라 그 자체로 단서다.
 */
export function waterfallGeometry(
  startMs: number,
  elapsedMs: number,
  totalMs: number,
): WaterfallGeometry {
  if (!(totalMs > 0)) return { leftPct: 0, widthPct: MIN_WIDTH_PCT };

  const start = Math.max(0, startMs);
  const elapsed = Math.max(0, elapsedMs);

  const leftPct = Math.min(100 - MIN_WIDTH_PCT, (start / totalMs) * 100);
  const rawWidth = (elapsed / totalMs) * 100;
  const widthPct = Math.min(100 - leftPct, Math.max(MIN_WIDTH_PCT, rawWidth));

  return { leftPct, widthPct };
}

/**
 * 스텝의 중첩 깊이.
 *
 * **`parent` 는 부모 스텝의 index 지 깊이가 아니다.** 그대로 들여쓰기에 쓰면
 * parent=50 인 스텝이 화면 밖으로 밀려난다. 부모 사슬을 따라 실제 깊이를 센다.
 */
export function stepDepth(parents: readonly number[], index: number): number {
  let depth = 0;
  let cur = index;
  const seen = new Set<number>([index]);

  for (let guard = 0; guard < parents.length; guard++) {
    const parent = parents[cur];
    // -1(루트) / 범위 밖 / 자기 자신 / 순환이면 중단
    if (parent === undefined || parent < 0 || parent >= parents.length) break;
    if (parent === cur || seen.has(parent)) break;

    seen.add(parent);
    cur = parent;
    depth++;
    if (depth >= MAX_DEPTH) break;
  }

  return Math.min(depth, MAX_DEPTH);
}
