// 밀집 구간 (순수 로직)
//
// **점 하나가 5x5 를 막는다.** 촘촘한 구간에서는 대부분이 안 그려져서, 실측에서
// 5,000건 남짓한 구간의 점이 339개였다. 그러면 화면은 «여기 좀 있네» 로 보이는데
// 실제로는 한 덩어리다 — 부하가 어디에 몰렸는지가 통째로 안 보인다.
//
// 점을 다 그리면 될 일이 아니다. 십만 개를 그리면 프레임이 무너지고, 다 그려도
// 같은 자리에 겹쳐 색만 진해질 뿐 «몇 배인지» 는 여전히 안 보인다.
//
// 그래서 **센다.** 화면을 성긴 격자로 나눠 칸마다 건수를 세고, 그 수를 밝기로 얹는다.
// 점은 그대로 두므로 «어느 서버인가»(색)는 잃지 않는다.

/**
 * 격자 한 칸의 크기(px).
 *
 * 점(5px)보다 조금 작게 잡는다. 점보다 크면 한 칸에 여러 점이 들어가 «겹쳤다» 가
 * 아닌데도 밝아지고, 훨씬 작으면 칸 수가 늘어 세는 값이 없어진다.
 */
export const CELL_PX = 4;

/**
 * 이만큼 겹쳐야 «밀집» 으로 본다.
 *
 * 둘이 겹친 것은 어디에나 있다. 그것까지 칠하면 화면 전체가 옅게 밝아져서
 * 정작 몰린 자리가 안 도드라진다.
 */
export const MIN_COUNT = 3;

/** 가장 진한 칸의 불투명도. 이보다 진하면 점을 덮는다 */
const MAX_ALPHA = 0.45;

/**
 * 화면 크기에 맞는 칸 수.
 *
 * 폭·높이가 0 이하일 수 있다(패널을 접었을 때). 그때는 0칸이고,
 * 부르는 쪽은 아무것도 그리지 않는다.
 */
export function gridSize(width: number, height: number): { cols: number; rows: number } {
  return {
    cols: Math.max(0, Math.ceil(width / CELL_PX)),
    rows: Math.max(0, Math.ceil(height / CELL_PX)),
  };
}

/**
 * 픽셀 좌표 → 칸 번호. 격자 밖이면 -1.
 *
 * **원점을 빼고 센다.** 플롯 영역은 축 라벨만큼 안쪽에서 시작하므로, 캔버스 좌표를
 * 그대로 나누면 칸이 축 쪽으로 밀린다.
 */
export function cellIndex(
  px: number,
  py: number,
  originX: number,
  originY: number,
  cols: number,
  rows: number,
): number {
  const cx = Math.floor((px - originX) / CELL_PX);
  const cy = Math.floor((py - originY) / CELL_PX);
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return -1;
  return cy * cols + cx;
}

/**
 * 건수 → 불투명도 (0~`MAX_ALPHA`).
 *
 * **로그로 누른다.** 한 칸이 3건이고 다른 칸이 3,000건인데 선형으로 칠하면
 * 3건짜리는 보이지도 않는다 — 몰린 자리 하나만 하얗고 나머지는 검은 화면이 된다.
 *
 * `max` 는 이 화면에서 가장 붐빈 칸이다. **절대 기준을 쓰지 않는다** — 한가한
 * 시간대에는 어떤 칸도 안 밝아져서, 그때는 이 보기가 아무 말도 하지 않게 된다.
 */
export function densityAlpha(count: number, max: number): number {
  if (count < MIN_COUNT || max < MIN_COUNT) return 0;
  const ratio = Math.log(count - MIN_COUNT + 1) / Math.log(Math.max(max - MIN_COUNT + 1, Math.E));
  return Math.min(MAX_ALPHA, MAX_ALPHA * Math.min(1, ratio));
}

/** 격자에서 가장 붐빈 칸의 건수 */
export function peakOf(counts: Int32Array): number {
  let peak = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > peak) peak = counts[i];
  }
  return peak;
}
