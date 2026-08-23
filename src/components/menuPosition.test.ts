// 컨텍스트 메뉴 위치
//
// 클릭 지점에 그냥 놓으면 화면 오른쪽·아래 끝에서 메뉴가 잘려 못 쓴다.
// 잘릴 것 같으면 반대쪽으로 뒤집는다(끝에 붙이는 게 아니라) —
// 커서가 메뉴를 덮지 않아야 항목이 보인다.

import { describe, it, expect } from 'vitest';
import { menuPosition } from './menuPosition';

const VIEW = { w: 1000, h: 800 };
const MENU = { w: 180, h: 120 };

describe('menuPosition', () => {
  it('여유가 있으면 클릭 지점에 놓는다', () => {
    expect(menuPosition(100, 200, MENU, VIEW)).toEqual({ x: 100, y: 200 });
  });

  it('오른쪽이 모자라면 왼쪽으로 뒤집는다', () => {
    // 900 + 180 = 1080 > 1000
    expect(menuPosition(900, 200, MENU, VIEW).x).toBe(900 - MENU.w);
  });

  it('아래가 모자라면 위로 뒤집는다', () => {
    // 750 + 120 = 870 > 800
    expect(menuPosition(100, 750, MENU, VIEW).y).toBe(750 - MENU.h);
  });

  it('오른쪽 아래 모서리에서는 둘 다 뒤집는다', () => {
    expect(menuPosition(950, 780, MENU, VIEW)).toEqual({
      x: 950 - MENU.w,
      y: 780 - MENU.h,
    });
  });

  // 뒤집어도 안 들어가는 좁은 화면에서 음수로 나가면 메뉴 머리가 잘린다.
  it('뒤집어도 넘치면 0 아래로 내려가지 않는다', () => {
    const tiny = { w: 100, h: 80 };
    const p = menuPosition(90, 70, MENU, tiny);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
  });

  it('경계에 정확히 닿으면 뒤집지 않는다', () => {
    // 820 + 180 = 1000 — 딱 맞으므로 그대로 둔다
    expect(menuPosition(820, 100, MENU, VIEW).x).toBe(820);
  });
});
