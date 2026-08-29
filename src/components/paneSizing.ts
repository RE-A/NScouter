// 분할 패널 크기 제한 (순수 함수)
//
// 배치 자체는 flexbox 가 한다 — 가운데 열이 `flex-1 min-w-0` 이라
// 사이드 패널이 아무리 넓어도 **넘칠 수 없다.**
// 여기서 정하는 건 사용자가 경계를 끌 때의 허용 범위뿐이다.

export const PANE = {
  /** 서비스 목록: 이보다 좁으면 에이전트 이름이 안 보인다 */
  servicesMin: 140,
  /** 스캐터를 읽을 수 있는 최소 폭 */
  chartMinW: 280,
  /** 폭포수 막대가 의미를 갖는 최소 폭 */
  detailMin: 220,
  /** 목록: 헤더 두 줄 + 한 행 */
  tableMinH: 72,
  /** 차트가 이보다 낮으면 Y축이 뭉갠다 */
  chartMinH: 140,
  /** 기본 목록 높이 — 약 8행. "기본으로 보여야 한다"가 요구사항이다 */
  tableDefaultH: 220,
  servicesDefaultW: 200,
  detailDefaultW: 320,
  /** 구분선 두께 */
  divider: 4,
} as const;

/**
 * 끌린 값을 [min, room] 으로 자른다.
 *
 * `room` 이 `min` 보다 작으면 최소를 지킬 수 없다.
 * 그때는 **넘치지 않는 쪽**을 택한다 — 넘치면 잘려서 아예 못 보게 된다.
 *
 * **0 이 나올 수 있다.** 그건 «자리가 없다» 는 뜻이지 «크기를 모른다» 는 뜻이 아니다.
 * 아직 못 잰 상태에서 부르면 안 된다 — `isMeasured` 로 먼저 거를 것.
 */
export function clampPane(raw: number, min: number, room: number): number {
  if (room < min) return Math.max(0, room);
  return Math.min(Math.max(raw, min), room);
}

/**
 * 워크스페이스를 **쟀는가.**
 *
 * 탭이나 모드를 바꾸면 워크스페이스가 다시 붙으면서 잠깐 0 이 된다.
 * 그 순간에 경계를 끌면 `sideRoom` 이 음수가 되고 `clampPane` 이 0 을 돌려줘
 * **패널이 통째로 사라진다** — 그리고 그 0 이 설정 파일에 저장된다(실제로 겪었다).
 * 못 잰 동안에는 끌린 값을 계산하지 않고 지금 크기를 그대로 둔다.
 */
export function isMeasured(ws: { w: number; h: number }): boolean {
  return ws.w > 0 && ws.h > 0;
}

/** 사이드 패널이 커질 수 있는 상한. 가운데 열의 최소 폭을 남겨 둔다. */
export function sideRoom(wsW: number, otherSideW: number, dividerCount: number): number {
  return wsW - otherSideW - dividerCount * PANE.divider - PANE.chartMinW;
}

/** 목록이 커질 수 있는 상한. 차트의 최소 높이를 남겨 둔다. */
export function tableRoom(columnH: number): number {
  return columnH - PANE.divider - PANE.chartMinH;
}
