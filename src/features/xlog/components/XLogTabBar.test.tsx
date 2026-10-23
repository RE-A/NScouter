// XLog 탭 줄의 이름 바꾸기
//
//   · 두 번 누르면 이름 칸이 열리고 Enter 로 정한다
//   · Esc 는 물린다 — 바꾸지 않는다
//   · 한글 조합 중의 Enter 는 정하는 키가 아니다
//   · 안 붙인 이름이 겹치면 순번이 붙는다

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { XLogTabBar } from './XLogTabBar';
import { addTab, initialTabs } from '../hooks/xlogTabs';

function bar() {
  const s = addTab(initialTabs());
  const onRename = vi.fn();
  render(
    <XLogTabBar
      tabs={s.tabs}
      activeKey={s.activeKey}
      panes={s.panes}
      detached={s.detached}
      onDetach={vi.fn()}
      onAttach={vi.fn()}
      onActivate={vi.fn()}
      onClose={vi.fn()}
      onAdd={vi.fn()}
      onRename={onRename}
    />,
  );
  return { s, onRename };
}

describe('XLogTabBar 이름', () => {
  it('안 붙인 실시간 탭 둘은 «실시간» · «실시간 2» 로 갈린다', () => {
    bar();
    expect(screen.getByRole('tab', { name: '실시간' })).toBeDefined();
    expect(screen.getByRole('tab', { name: '실시간 2' })).toBeDefined();
  });

  it('두 번 눌러 고치고 Enter 로 정한다', () => {
    const { s, onRename } = bar();
    fireEvent.doubleClick(screen.getByRole('tab', { name: '실시간 2' }));
    const input = screen.getByLabelText('탭 이름');
    fireEvent.change(input, { target: { value: '주문' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith(s.tabs[1].key, '주문');
    expect(screen.queryByLabelText('탭 이름')).toBeNull();
  });

  it('Esc 는 물린다', () => {
    const { onRename } = bar();
    fireEvent.doubleClick(screen.getByRole('tab', { name: '실시간' }));
    const input = screen.getByLabelText('탭 이름');
    fireEvent.change(input, { target: { value: '버릴 이름' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    // 칸이 사라지며 blur 가 뒤따라도 물린 것은 물린 것이다
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('탭 이름')).toBeNull();
  });

  it('한글 조합 중의 Enter 로는 정하지 않는다', () => {
    const { onRename } = bar();
    fireEvent.doubleClick(screen.getByRole('tab', { name: '실시간' }));
    const input = screen.getByLabelText('탭 이름');
    fireEvent.change(input, { target: { value: '결ㅈ' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onRename).not.toHaveBeenCalled();
  });

  it('칸을 벗어나도 정한다 — 바깥을 누르면 고친 것이 사라지면 안 된다', () => {
    const { s, onRename } = bar();
    fireEvent.doubleClick(screen.getByRole('tab', { name: '실시간' }));
    const input = screen.getByLabelText('탭 이름');
    fireEvent.change(input, { target: { value: '결제' } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith(s.tabs[0].key, '결제');
  });
});
