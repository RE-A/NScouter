// 툴바 인라인 조건칸의 계약
//
// 여기서 지키려는 것:
//   · 빈 칸에서도 포함↔제외가 뒤집힌다 (조건 줄이 없어 방향이 안 바뀌던 것)
//   · 그렇게 정해 둔 방향으로 줄이 만들어진다 — 방향 먼저, 글자 나중이 막히면 안 된다
//   · 글자를 지워 줄이 사라져도 방향 표시는 남는다

import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { XLogToolbar } from './XLogToolbar';
import { DEFAULT_CHART_CONFIG, DEFAULT_FILTER, type XLogFilterState } from '../types/xlog';

function open(filter: Partial<XLogFilterState> = {}) {
  const onFilterChange = vi.fn();
  const view = render(
    <XLogToolbar
      config={DEFAULT_CHART_CONFIG}
      filter={{ ...DEFAULT_FILTER, ...filter }}
      onConfigChange={vi.fn()}
      onFilterChange={onFilterChange}
      mode="live"
      onModeChange={vi.fn()}
      pastRange={null}
      onPastRangeChange={vi.fn()}
      onWideSearch={vi.fn()}
      onOpenSaved={vi.fn()}
      onOpenFilters={vi.fn()}
    />,
  );
  return { onFilterChange, view };
}

/** 두 줄째는 **접힌 것이 기본**이다. 펼쳐야 Y축·범위·저장본·응답 칸이 나온다 */
function expand() {
  fireEvent.click(screen.getByRole('button', { name: /조건 더보기/ }));
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

describe('조건 접기', () => {
  it('서비스·IP 는 첫 줄에 있다 — 가장 자주 거는 조건이다', () => {
    open();
    expect(screen.getByPlaceholderText('URL 일부')).toBeDefined();
    expect(screen.getByPlaceholderText('IP 일부')).toBeDefined();
  });

  it('Y축·범위·저장본은 두 줄째다 — 한 번 정하면 잘 안 바꾼다', () => {
    open();
    expect(screen.queryByText('Y축')).toBeNull();
    expect(screen.queryByText('범위')).toBeNull();
    expect(screen.queryByRole('button', { name: '저장본' })).toBeNull();
    expand();
    expect(screen.getByText('Y축')).toBeDefined();
    expect(screen.getByText('범위')).toBeDefined();
    expect(screen.getByRole('button', { name: '저장본' })).toBeDefined();
  });

  it('접힌 줄에 걸려 있는 조건이 있으면 펼쳐진 채로 시작한다', () => {
    open({ elapsedMs: 3_000 });
    expect(screen.getByText('Y축')).toBeDefined();
  });

  it('첫 줄의 서비스·IP 조건은 접힌 수에 안 센다 — 보이는 것을 숨었다고 하면 안 된다', () => {
    open({ patterns: [{ field: 'ip', text: '10.89.', exclude: false }] });
    expect(screen.getByRole('button', { name: /^조건 더보기$/ })).toBeDefined();
  });

  it('접힌 조건 수를 버튼에 적는다 — 숨은 거름을 모르면 «왜 이만큼만» 이 된다', () => {
    open({ elapsedMs: 3_000 });
    expect(screen.getByRole('button', { name: /조건 접기 1/ })).toBeDefined();
  });
});

describe('트랜잭션 찾기', () => {
  it('첫 줄에 늘 있고 누르면 찾기 창을 연다 — 더보기 안에 숨지 않는다', () => {
    const onWideSearch = vi.fn();
    render(
      <XLogToolbar
        config={DEFAULT_CHART_CONFIG}
        filter={DEFAULT_FILTER}
        onConfigChange={vi.fn()}
        onFilterChange={vi.fn()}
        mode="live"
        onModeChange={vi.fn()}
        pastRange={null}
        onPastRangeChange={vi.fn()}
        onWideSearch={onWideSearch}
        onOpenSaved={vi.fn()}
        onOpenFilters={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /트랜잭션 찾기/ }));
    expect(onWideSearch).toHaveBeenCalled();
  });
});
