// XLog 판 머리 탭 — 이름 바꾸기(예전 탭 줄과 같은 손버릇)와 창 밖으로 끌어 떼기 감지
//
//   · 두 번 누르면 이름 칸이 열리고 Enter 로 정한다 · Esc 는 물린다 · 한글 조합 중 Enter 는 정하지 않는다
//   · 칸을 벗어나도 정한다
//   · 끌던 탭이 문서를 떠난 채 놓이면 «창 밖» — 좌표가 0,0 이어도(WebKitGTK) 떠난 자리로 뗀다

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IDockviewPanelHeaderProps } from 'dockview-react';
import { DockContext, PanelTab, watchDragOut, type DockCtx } from './XLogDock';
import { addTab, initialTabs, tabLabels } from '../hooks/xlogTabs';

function tab(index: number) {
  const s = addTab(initialTabs());
  const labels = tabLabels(s.tabs);
  const onRename = vi.fn();
  const ctx: DockCtx = {
    tabs: new Map(s.tabs.map(t => [t.key, t])),
    labels: new Map(s.tabs.map((t, i) => [t.key, labels[i]])),
    renderTab: () => null,
    slotOf: () => null,
    setSlot: () => {},
    canDetach: true,
    full: false,
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onAdd: vi.fn(),
    onRename,
    onDetach: vi.fn(),
    onPin: vi.fn(),
    onArrange: vi.fn(),
  };
  const key = s.tabs[index].key;
  const props = { api: { id: key, title: labels[index] } } as unknown as IDockviewPanelHeaderProps;
  render(
    <DockContext.Provider value={ctx}>
      <PanelTab {...props} />
    </DockContext.Provider>,
  );
  return { key, onRename, label: labels[index] };
}

describe('판 머리 탭 이름', () => {
  it('안 붙인 실시간 탭 둘은 «실시간» · «실시간 2» 로 갈린다', () => {
    expect(tab(1).label).toBe('실시간 2');
    expect(screen.getByText('실시간 2')).toBeDefined();
  });

  it('두 번 눌러 고치고 Enter 로 정한다', () => {
    const { key, onRename } = tab(1);
    fireEvent.doubleClick(screen.getByText('실시간 2'));
    const input = screen.getByLabelText('탭 이름');
    fireEvent.change(input, { target: { value: '주문' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith(key, '주문');
    expect(screen.queryByLabelText('탭 이름')).toBeNull();
  });

  it('Esc 는 물린다', () => {
    const { onRename } = tab(0);
    fireEvent.doubleClick(screen.getByText('실시간'));
    const input = screen.getByLabelText('탭 이름');
    fireEvent.change(input, { target: { value: '버릴 이름' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('탭 이름')).toBeNull();
  });

  it('한글 조합 중의 Enter 로는 정하지 않는다', () => {
    const { onRename } = tab(0);
    fireEvent.doubleClick(screen.getByText('실시간'));
    const input = screen.getByLabelText('탭 이름');
    fireEvent.change(input, { target: { value: '결ㅈ' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onRename).not.toHaveBeenCalled();
  });

  it('칸을 벗어나도 정한다 — 바깥을 누르면 고친 것이 사라지면 안 된다', () => {
    const { key, onRename } = tab(0);
    fireEvent.doubleClick(screen.getByText('실시간'));
    const input = screen.getByLabelText('탭 이름');
    fireEvent.change(input, { target: { value: '결제' } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith(key, '결제');
  });
});

describe('창 밖으로 끌어 떼기', () => {
  const fire = (type: string, init: MouseEventInit & { relatedTarget?: EventTarget | null }) =>
    document.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));

  it('문서를 떠난 채 놓이면 떠난 자리로 뗀다 — dragend 좌표가 0,0 이어도', () => {
    const onOut = vi.fn();
    watchDragOut(onOut);
    fire('dragleave', { relatedTarget: null, screenX: 4000, screenY: 300 });
    fire('dragend', { screenX: 0, screenY: 0 });
    expect(onOut).toHaveBeenCalledWith({ x: 4000, y: 300 });
  });

  it('떠났다가 다시 들어와 놓으면 떼지 않는다', () => {
    const onOut = vi.fn();
    watchDragOut(onOut);
    fire('dragleave', { relatedTarget: null, screenX: 4000, screenY: 300 });
    fire('dragenter', {});
    fire('dragend', { screenX: 0, screenY: 0 });
    expect(onOut).not.toHaveBeenCalled();
  });

  it('창 안에 놓으면 떼지 않고, 한 번 놓은 뒤에는 듣지 않는다', () => {
    const onOut = vi.fn();
    watchDragOut(onOut);
    fire('dragend', { screenX: window.screenX + 10, screenY: window.screenY + 10 });
    fire('dragleave', { relatedTarget: null, screenX: 4000, screenY: 300 });
    fire('dragend', { screenX: 0, screenY: 0 });
    expect(onOut).not.toHaveBeenCalled();
  });
});
