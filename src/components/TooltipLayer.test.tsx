// 툴팁 한 벌의 계약
//
//   · 올라가면 기본 툴팁이 못 뜨게 `title` 을 떼고, 머물면 우리 툴팁을 띄운다
//   · 누르면(오른쪽 클릭 포함) 내리고, 그 요소를 떠날 때까지 다시 안 띄운다 — 메뉴를 덮던 것
//   · 떠나면 `title` 을 돌려놓는다
//   · 자리는 아래, 모자라면 위, 좌우는 화면 안

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOOLTIP_DELAY_MS, TooltipLayer, placeTooltip } from './TooltipLayer';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function setup() {
  render(
    <div>
      <TooltipLayer />
      <button title={'서버\n127.0.0.1'}>
        <span>안쪽</span>
      </button>
      <p>빈 곳</p>
    </div>,
  );
  return screen.getByRole('button');
}

describe('TooltipLayer', () => {
  it('머물면 띄우고, 그동안 기본 툴팁용 title 은 떼어 둔다', () => {
    const btn = setup();
    fireEvent.pointerOver(btn);
    expect(btn.hasAttribute('title')).toBe(false);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS); });
    expect(screen.getByRole('tooltip').textContent).toBe('서버\n127.0.0.1');
  });

  it('자식으로 옮겨 가도 그대로다', () => {
    const btn = setup();
    fireEvent.pointerOver(btn);
    fireEvent.pointerOver(screen.getByText('안쪽'));
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS); });
    expect(screen.getByRole('tooltip')).toBeDefined();
  });

  it('누르면 내리고, 떠날 때까지 다시 안 띄운다', () => {
    const btn = setup();
    fireEvent.pointerOver(btn);
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS); });
    fireEvent.contextMenu(btn);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerOver(screen.getByText('안쪽'));
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 2); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('떠나면 title 을 돌려놓는다', () => {
    const btn = setup();
    fireEvent.pointerOver(btn);
    fireEvent.pointerOver(screen.getByText('빈 곳'));
    expect(btn.getAttribute('title')).toBe('서버\n127.0.0.1');
    act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('placeTooltip', () => {
  const vp = { width: 1000, height: 600 };
  const size = { width: 120, height: 30 };

  it('요소 아래 가운데', () => {
    const r = { left: 100, top: 100, right: 200, bottom: 120, width: 100 };
    expect(placeTooltip(r, size, vp)).toEqual({ left: 90, top: 126 });
  });

  it('아래가 모자라면 위', () => {
    const r = { left: 100, top: 560, right: 200, bottom: 580, width: 100 };
    expect(placeTooltip(r, size, vp).top).toBe(560 - 6 - 30);
  });

  it('좌우는 화면 안으로', () => {
    const r = { left: 960, top: 100, right: 1000, bottom: 120, width: 40 };
    expect(placeTooltip(r, size, vp).left).toBe(1000 - 8 - 120);
  });
});
