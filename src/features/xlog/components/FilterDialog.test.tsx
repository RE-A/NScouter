// 조회 조건 창의 계약
//
// 여기서 지키려는 것:
//   · 포함·제외를 **여러 줄** 걸 수 있다 (툴바 한 칸으로는 안 되던 것)
//   · 방금 추가한 빈 줄이 전부를 지우지 않는다
//   · 서버는 여기서 바꾸지 않는다 — 어디서 바꾸는지만 알려 준다
//   · 규칙(자리 안 OR, 자리끼리 AND)을 창이 말해 준다

import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilterDialog } from './FilterDialog';
import { DEFAULT_FILTER, type XLogFilterState } from '../types/xlog';

function open(filter: Partial<XLogFilterState> = {}, servers = 0) {
  const onChange = vi.fn();
  render(
    <FilterDialog
      filter={{ ...DEFAULT_FILTER, ...filter }}
      onChange={onChange}
      onClose={vi.fn()}
      selectedServers={servers}
    />,
  );
  return onChange;
}

afterEach(() => vi.clearAllMocks());

describe('FilterDialog', () => {
  it('규칙을 창이 말해 준다', () => {
    // 모르면 «포함 두 줄» 결과를 못 읽는다.
    open();
    expect(screen.getByText(/같은 자리의 포함은 하나만 맞아도 통과/)).toBeTruthy();
  });

  it('포함 줄을 더한다', () => {
    const onChange = open();
    fireEvent.click(screen.getAllByRole('button', { name: '+ 포함' })[0]);

    expect(onChange).toHaveBeenCalledWith({
      patterns: [{ field: 'service', text: '', exclude: false }],
    });
  });

  it('제외 줄을 더한다', () => {
    const onChange = open();
    // 두 번째 자리(IP)의 제외
    fireEvent.click(screen.getAllByRole('button', { name: '+ 제외' })[1]);

    expect(onChange).toHaveBeenCalledWith({
      patterns: [{ field: 'ip', text: '', exclude: true }],
    });
  });

  it('줄마다 포함·제외를 뒤집는다', () => {
    const onChange = open({
      patterns: [{ field: 'service', text: '/shop', exclude: false }],
    });
    fireEvent.click(screen.getByRole('button', { name: '포함' }));

    expect(onChange).toHaveBeenCalledWith({
      patterns: [{ field: 'service', text: '/shop', exclude: true }],
    });
  });

  it('줄을 지운다', () => {
    const onChange = open({
      patterns: [
        { field: 'service', text: '/a', exclude: false },
        { field: 'service', text: '/b', exclude: true },
      ],
    });
    fireEvent.click(screen.getByLabelText('서비스 1 지우기'));

    expect(onChange).toHaveBeenCalledWith({
      patterns: [{ field: 'service', text: '/b', exclude: true }],
    });
  });

  it('조건이 없으면 전부 통과라고 적는다', () => {
    open();
    expect(screen.getAllByText('조건 없음 — 전부 통과합니다')).toHaveLength(2);
  });

  it('서버는 여기서 바꾸지 않고 어디서 바꾸는지 알려 준다', () => {
    // 두 곳에서 같은 것을 바꾸면 어느 쪽이 이겼는지 알 수 없다.
    open({}, 3);
    expect(screen.getByText(/3개 — 왼쪽 목록에서 바꿉니다/)).toBeTruthy();
  });

  it('모두 지우기는 줄과 수치 조건을 함께 비운다', () => {
    const onChange = open({
      patterns: [{ field: 'ip', text: '10.', exclude: false }],
      errorOnly: true,
      elapsedMs: 3000,
    });
    fireEvent.click(screen.getByRole('button', { name: '조건 모두 지우기' }));

    expect(onChange).toHaveBeenCalledWith({
      patterns: [], errorOnly: false, elapsedMs: 0, elapsedExclude: false,
    });
  });
});
