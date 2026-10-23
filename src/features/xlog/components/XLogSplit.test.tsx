// XLog 화면 분할의 계약
//
//   · 끌어 놓을 자리는 가장 가까운 가장자리, 띠 밖이면 가운데
//   · 탭 줄에서 끈 것만 받는다 (파일 끌기 등은 무시)
//   · 판 하나면 머리줄이 없다 — 분할이 아니다
//   · 숨긴 탭도 그려 둔다 — 판을 옮길 때 차트가 다시 서지 않게
//   · 판을 누르면 지금 판이 된다, 지금 판을 누르면 아무 일도 없다

import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { dropSideAt, TAB_DRAG_TYPE, XLogSplit } from './XLogSplit';
import { addTab, dropTab, initialTabs, type XLogTabsState } from '../hooks/xlogTabs';

describe('dropSideAt', () => {
  it('가장자리 띠 안이면 그 가장자리', () => {
    expect(dropSideAt(0.1, 0.5)).toBe('left');
    expect(dropSideAt(0.9, 0.5)).toBe('right');
    expect(dropSideAt(0.5, 0.05)).toBe('top');
    expect(dropSideAt(0.5, 0.95)).toBe('bottom');
  });

  it('띠 밖이면 가운데', () => {
    expect(dropSideAt(0.5, 0.5)).toBe('center');
    expect(dropSideAt(0.3, 0.7)).toBe('center');
  });

  it('모서리에서는 더 가까운 가장자리가 이긴다', () => {
    expect(dropSideAt(0.05, 0.2)).toBe('left');
    expect(dropSideAt(0.2, 0.05)).toBe('top');
  });
});

/** 탭 둘, 판 하나 — 처음 탭이 지금 판 */
function twoTabs(): XLogTabsState {
  const s = addTab(initialTabs());
  return { ...s, activeKey: s.tabs[0].key, panes: [s.tabs[0].key] };
}

function view(s: XLogTabsState) {
  const onDrop = vi.fn();
  const onFocus = vi.fn();
  const onClosePane = vi.fn();
  const utils = render(
    <XLogSplit
      tabs={s.tabs}
      labels={s.tabs.map((_, i) => `탭${i + 1}`)}
      panes={s.panes}
      activeKey={s.activeKey}
      dir={s.dir}
      ratio={s.ratio}
      renderTab={(tab, visible) => <div data-testid={`chart-${tab.key}`} data-visible={String(visible)} />}
      onFocus={onFocus}
      onDrop={onDrop}
      onClosePane={onClosePane}
      onRatioDelta={vi.fn()}
    />,
  );
  return { onDrop, onFocus, onClosePane, ...utils };
}

/** 탭 줄에서 끈 것처럼 꾸민 dataTransfer */
const tabTransfer = (key: string) => ({
  types: [TAB_DRAG_TYPE],
  getData: (type: string) => (type === TAB_DRAG_TYPE ? key : ''),
  dropEffect: 'none',
});

/**
 * 끌기 이벤트를 자리와 함께 쏜다. jsdom 에는 DragEvent 가 없어 `clientX` 를 init 으로 못 넘긴다
 */
function drag(kind: 'dragOver' | 'drop', el: HTMLElement, dataTransfer: object, x: number, y: number) {
  const ev = createEvent[kind](el, { dataTransfer });
  Object.defineProperty(ev, 'clientX', { value: x });
  Object.defineProperty(ev, 'clientY', { value: y });
  fireEvent(el, ev);
}

/** jsdom 에는 배치가 없어 판 크기를 꾸민다 */
function sized(el: HTMLElement) {
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return el;
}

describe('XLogSplit', () => {
  it('판 하나면 머리줄이 없다', () => {
    view(twoTabs());
    expect(screen.queryByRole('button', { name: /판 내리기/ })).toBeNull();
  });

  it('숨긴 탭도 그려 둔다 — 판을 옮길 때 차트가 다시 서지 않게', () => {
    const s = twoTabs();
    view(s);
    expect(screen.getByTestId(`chart-${s.tabs[0].key}`).dataset.visible).toBe('true');
    expect(screen.getByTestId(`chart-${s.tabs[1].key}`).dataset.visible).toBe('false');
  });

  it('탭을 판 오른쪽 가장자리에 놓으면 그 자리로 알린다', () => {
    const s = twoTabs();
    const { onDrop } = view(s);
    const pane = sized(screen.getByTestId(`chart-${s.tabs[0].key}`).parentElement!.parentElement!);
    drag('dragOver', pane, tabTransfer(s.tabs[1].key), 95, 50);
    drag('drop', pane, tabTransfer(s.tabs[1].key), 95, 50);
    expect(onDrop).toHaveBeenCalledWith(s.tabs[1].key, s.tabs[0].key, 'right');
  });

  it('가운데에 놓으면 가운데로 알린다', () => {
    const s = twoTabs();
    const { onDrop } = view(s);
    const pane = sized(screen.getByTestId(`chart-${s.tabs[0].key}`).parentElement!.parentElement!);
    drag('drop', pane, tabTransfer(s.tabs[1].key), 50, 50);
    expect(onDrop).toHaveBeenCalledWith(s.tabs[1].key, s.tabs[0].key, 'center');
  });

  it('탭 줄에서 끈 것이 아니면 받지 않는다', () => {
    const s = twoTabs();
    const { onDrop } = view(s);
    const pane = sized(screen.getByTestId(`chart-${s.tabs[0].key}`).parentElement!.parentElement!);
    const file = { types: ['Files'], getData: () => '', dropEffect: 'none' };
    drag('dragOver', pane, file, 95, 50);
    drag('drop', pane, file, 95, 50);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('나뉘면 판마다 머리줄과 내리기가 있고, 옆 판을 누르면 그 판이 지금 판이 된다', () => {
    let s = twoTabs();
    s = dropTab(s, s.tabs[1].key, s.tabs[0].key, 'right'); // 지금 판은 둘째
    const { onFocus, onClosePane } = view(s);
    expect(screen.getAllByRole('button', { name: /판 내리기/ })).toHaveLength(2);

    fireEvent.mouseDown(screen.getByTestId(`chart-${s.tabs[0].key}`));
    expect(onFocus).toHaveBeenCalledWith(s.tabs[0].key);

    // 지금 판을 눌러도 다시 알리지 않는다 — 누를 때마다 목록이 지워지면 안 된다
    onFocus.mockClear();
    fireEvent.mouseDown(screen.getByTestId(`chart-${s.tabs[1].key}`));
    expect(onFocus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '탭1 판 내리기' }));
    expect(onClosePane).toHaveBeenCalledWith(s.tabs[0].key);
  });
});
