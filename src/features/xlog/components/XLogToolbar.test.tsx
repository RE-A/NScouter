// 툴바 인라인 조건칸의 계약
//
// 여기서 지키려는 것:
//   · 빈 칸에서도 포함↔제외가 뒤집힌다 (조건 줄이 없어 방향이 안 바뀌던 것)
//   · 그렇게 정해 둔 방향으로 줄이 만들어진다 — 방향 먼저, 글자 나중이 막히면 안 된다
//   · 글자를 지워 줄이 사라져도 방향 표시는 남는다
//   · 조건은 한 줄이다 — 그리는 모양(Y축·범위)과 저장본은 여기 없다
//   · 과거로 넘어가면 구간 칸은 **그때의** 최근 10분이다 — 툴바가 처음 그려진 때가 아니다

import { render, screen, fireEvent, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { XLogToolbar } from './XLogToolbar';
import { DEFAULT_FILTER, type XLogFilterState } from '../types/xlog';
import { toLocalInput, type XLogMode } from '../types/timeRange';

function open(filter: Partial<XLogFilterState> = {}) {
  const onFilterChange = vi.fn();
  const view = render(
    <XLogToolbar
      filter={{ ...DEFAULT_FILTER, ...filter }}
      onFilterChange={onFilterChange}
      mode="live"
      onModeChange={vi.fn()}
      pastRange={null}
      onPastRangeChange={vi.fn()}
      onWideSearch={vi.fn()}
      onOpenFilters={vi.fn()}
    />,
  );
  return { onFilterChange, view };
}

/** 서비스 칸의 방향 버튼 — 글자가 곧 현재 방향이다 */
function serviceDirection() {
  // 방향 버튼은 응답·서비스·IP 세 자리에 있다 — 입력칸을 먼저 집어 그 묶음 안에서 찾는다
  const field = screen.getByPlaceholderText('URL 일부').parentElement as HTMLElement;
  return within(field).getByTitle(/포함 조건|제외 조건/);
}

describe('툴바 서비스 조건', () => {
  it('빈 칸에서 눌러도 제외로 뒤집힌다', () => {
    open();
    const btn = serviceDirection();
    expect(btn.textContent).toBe('포함');

    fireEvent.click(btn);

    expect(serviceDirection().textContent).toBe('제외');
  });

  it('뒤집어 둔 방향으로 조건 줄이 생긴다', () => {
    const { onFilterChange } = open();
    fireEvent.click(serviceDirection());

    fireEvent.change(screen.getByPlaceholderText('URL 일부'), {
      target: { value: '/shop' },
    });

    expect(onFilterChange).toHaveBeenLastCalledWith({
      patterns: [{ field: 'service', text: '/shop', exclude: true }],
    });
  });

  it('줄이 있을 때의 방향은 상위 상태를 따른다', () => {
    open({ patterns: [{ field: 'service', text: '/health', exclude: true }] });
    expect(serviceDirection().textContent).toBe('제외');
  });
});

describe('한 줄 조건', () => {
  it('서비스·IP·응답이 다 첫 줄에 있다 — 접어 둔 줄이 없다', () => {
    open();
    expect(screen.getByPlaceholderText('URL 일부')).toBeDefined();
    expect(screen.getByPlaceholderText('IP 일부')).toBeDefined();
    expect(screen.getByLabelText('응답시간 (초)')).toBeDefined();
    expect(screen.queryByRole('button', { name: /조건 더보기/ })).toBeNull();
  });

  it('그리는 모양(Y축·범위)과 저장본은 툴바에 없다 — 판 머리·목록 머리로 갔다', () => {
    open();
    expect(screen.queryByText('Y축')).toBeNull();
    expect(screen.queryByText('범위')).toBeNull();
    expect(screen.queryByRole('button', { name: '저장본' })).toBeNull();
  });

  it('응답시간은 초로 받아 ms 로 건다', () => {
    const { onFilterChange } = open();
    fireEvent.change(screen.getByLabelText('응답시간 (초)'), { target: { value: '1.5' } });
    expect(onFilterChange).toHaveBeenLastCalledWith({ elapsedMs: 1500 });
  });
});

describe('트랜잭션 찾기', () => {
  it('첫 줄에 늘 있고 누르면 찾기 창을 연다 — 더보기 안에 숨지 않는다', () => {
    const onWideSearch = vi.fn();
    render(
      <XLogToolbar
          filter={DEFAULT_FILTER}
          onFilterChange={vi.fn()}
        mode="live"
        onModeChange={vi.fn()}
        pastRange={null}
        onPastRangeChange={vi.fn()}
        onWideSearch={onWideSearch}
          onOpenFilters={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /트랜잭션 찾기/ }));
    expect(onWideSearch).toHaveBeenCalled();
  });
});

describe('과거 구간 칸', () => {
  afterEach(() => { vi.useRealTimers(); });

  function toolbar(mode: XLogMode) {
    return (
      <XLogToolbar
          filter={DEFAULT_FILTER}
          onFilterChange={vi.fn()}
        mode={mode}
        onModeChange={vi.fn()}
        pastRange={null}
        onPastRangeChange={vi.fn()}
        onWideSearch={vi.fn()}
          onOpenFilters={vi.fn()}
      />
    );
  }

  it('몇 시간 켜 두고 과거로 가도 그때의 최근 10분이다 — 앱을 켠 때의 10분이 아니다', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const opened = new Date(2026, 9, 26, 9, 0).getTime();
    vi.setSystemTime(opened);
    const view = render(toolbar('live'));

    const later = opened + 6 * 60 * 60_000;
    vi.setSystemTime(later);
    view.rerender(toolbar('past'));

    const [from, to] = Array.from(view.container.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]'));
    expect(from.value).toBe(toLocalInput(later - 10 * 60_000));
    expect(to.value).toBe(toLocalInput(later));
  });
});
