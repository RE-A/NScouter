// 분할 패널 크기 제한
//
// 이전 모델은 워크스페이스를 ResizeObserver 로 재서 패널을 절대 좌표로 놓았다.
// 측정값과 실제 가용 공간이 어긋나면 패널이 창 밖으로 나가고,
// 그 안의 XLog 목록이 잘렸다 — 창을 세로로 늘려야 보이는 증상이 이것이다.
//
// 이제 배치는 flexbox 가 한다(넘칠 수 없다). 여기서 정하는 건 하나뿐:
// **사용자가 경계를 끌 때 어디까지 허용할 것인가.**

import { describe, it, expect } from 'vitest';
import { clampPane, sideRoom, tableRoom, PANE } from './paneSizing';

describe('clampPane', () => {
  it('여유가 충분하면 끌린 값을 그대로 쓴다', () => {
    expect(clampPane(300, 140, 800)).toBe(300);
  });

  it('최소보다 작게 끌면 최소에서 멈춘다', () => {
    expect(clampPane(20, 140, 800)).toBe(140);
  });

  it('남은 공간보다 크게 끌면 남은 공간에서 멈춘다', () => {
    expect(clampPane(900, 140, 800)).toBe(800);
  });

  // 창이 아주 좁으면 최소조차 보장할 수 없다.
  // 이때는 최소를 어기더라도 **남은 공간을 넘지 않는 쪽**을 택한다 — 넘치면 잘리니까.
  it('공간이 최소보다도 좁으면 공간에 맞춘다', () => {
    expect(clampPane(300, 140, 90)).toBe(90);
  });

  it('음수 공간에서도 0 아래로 내려가지 않는다', () => {
    expect(clampPane(300, 140, -50)).toBe(0);
  });
});

describe('sideRoom', () => {
  it('가운데 열의 최소 폭과 구분선을 뺀 나머지가 사이드 패널의 상한이다', () => {
    // 1200 - (반대쪽 0) - 구분선 1개 - 차트 최소
    expect(sideRoom(1200, 0, 1)).toBe(1200 - PANE.divider - PANE.chartMinW);
  });

  it('반대쪽 패널이 차지한 폭도 뺀다', () => {
    const room = sideRoom(1200, 320, 2);
    expect(room).toBe(1200 - 320 - 2 * PANE.divider - PANE.chartMinW);
  });

  it('창이 좁으면 상한이 최소보다 작아지고, 그때는 상한이 이긴다', () => {
    const room = sideRoom(300, 0, 1); // 300 - 4 - 280 = 16
    expect(room).toBeLessThan(PANE.servicesMin);
    expect(clampPane(200, PANE.servicesMin, room)).toBe(room);
  });

  it('반대쪽 패널까지 있으면 상한이 음수가 되고, 그때는 0 이다', () => {
    const room = sideRoom(300, 320, 2);
    expect(room).toBeLessThan(0);
    expect(clampPane(200, PANE.servicesMin, room)).toBe(0);
  });
});

describe('tableRoom', () => {
  it('차트가 최소 높이를 지키도록 목록 높이를 제한한다', () => {
    expect(tableRoom(800)).toBe(800 - PANE.divider - PANE.chartMinH);
  });

  // 목록이 기본으로 보여야 한다는 게 이번 요구다.
  // 기본값이 최소보다 넉넉해야 "몇 줄이라도 보이는" 상태가 된다.
  it('기본 목록 높이는 최소보다 크다', () => {
    expect(PANE.tableDefaultH).toBeGreaterThan(PANE.tableMinH);
  });

  it('기본 목록 높이는 일반적인 창에서 그대로 쓰인다', () => {
    expect(clampPane(PANE.tableDefaultH, PANE.tableMinH, tableRoom(700))).toBe(PANE.tableDefaultH);
  });
});
