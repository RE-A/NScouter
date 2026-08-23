// 컨텍스트 메뉴 위치 (순수 함수)

export interface Size {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * 클릭 지점에 메뉴를 놓되, 화면 밖으로 나가면 **반대쪽으로 뒤집는다.**
 *
 * 끝에 붙이는(clamp) 방식이면 커서가 메뉴 위에 얹혀 첫 항목을 가린다.
 * 뒤집으면 커서가 항상 메뉴 모서리 바깥에 남는다.
 */
export function menuPosition(
  clickX: number,
  clickY: number,
  menu: Size,
  viewport: Size,
): Point {
  let x = clickX;
  let y = clickY;

  if (x + menu.w > viewport.w) x = clickX - menu.w;
  if (y + menu.h > viewport.h) y = clickY - menu.h;

  // 뒤집어도 안 들어가는 좁은 화면 — 머리가 잘리는 것보다 낫다.
  return { x: Math.max(0, x), y: Math.max(0, y) };
}
