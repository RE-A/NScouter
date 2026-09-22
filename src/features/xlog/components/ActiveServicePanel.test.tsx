// 하루 누적 카드의 계약
//
// 여기서 지키려는 것:
//   · 날짜를 고르면 **그 날짜로** 묻는다 (오늘이면 날짜 없이 — 커맨드가 갈린다)
//   · 오늘로 되돌릴 수 있다
//   · 지난 날에는 방문자 숫자를 내놓지 않는다.
//     VISITOR_REALTIME_TOTAL 에는 날짜가 없어서 오늘 값이 온다 — 그날 것으로 읽히면 거짓이다

import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveServicePanel } from './ActiveServicePanel';
import type { ObjTypeStats } from '../hooks/useObjTypeStats';

const spy = vi.hoisted(() => ({
  calls: [] as (string | undefined)[],
  stats: {} as ObjTypeStats,
}));

vi.mock('../hooks/useObjTypeStats', () => ({
  useObjTypeStats: (_objTypes: readonly string[], _enabled: boolean, date?: string) => {
    spy.calls.push(date);
    return spy.stats;
  },
}));

// 목록은 에이전트에 스레드 스택을 뜨게 하는 요청이라 여기서는 부르지 않는다.
vi.mock('./ActiveServiceList', () => ({
  ActiveServiceList: () => null,
}));

function stats(over: Partial<ObjTypeStats> = {}): ObjTypeStats {
  return {
    group: null,
    perObject: [],
    todayCount: [{ obj_hash: 1, times: [1, 2], values: [10, 20] }],
    visitors: 42,
    error: null,
    ...over,
  } as ObjTypeStats;
}

function panel() {
  return render(
    <ActiveServicePanel objTypes={['tomcat']} enabled agentMap={new Map()} />,
  );
}

/** 마지막으로 훅에 넘어간 날짜 */
const lastDate = () => spy.calls[spy.calls.length - 1];

beforeEach(() => {
  spy.calls = [];
  spy.stats = stats();
});
afterEach(() => vi.clearAllMocks());

describe('ActiveServicePanel — 하루 누적', () => {
  it('처음에는 오늘이라 날짜를 넘기지 않는다', () => {
    panel();
    expect(lastDate()).toBeUndefined();
    expect(screen.getByText('오늘')).toBeTruthy();
  });

  it('날짜를 고르면 yyyyMMdd 로 넘긴다', () => {
    const { container } = panel();
    const input = container.querySelector('input[type="date"]');
    expect(input).toBeTruthy();

    fireEvent.change(input!, { target: { value: '2026-08-29' } });

    expect(lastDate()).toBe('20260829');
    expect(screen.getByText('20260829')).toBeTruthy();
  });

  it('오늘 날짜를 고르면 다시 날짜 없이 묻는다', () => {
    // 값은 같지만(L4 live_past_date_counter) 커맨드가 갈린다.
    // «오늘» 이 어느 쪽인지 코드에서 보이게 둔다.
    const today = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const iso = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;

    const { container } = panel();
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: iso } });

    expect(lastDate()).toBeUndefined();
  });

  it('지난 날에는 방문자 숫자를 내놓지 않는다', () => {
    const { container } = panel();
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '2026-08-29' } });

    expect(screen.getByText('방문자는 오늘만')).toBeTruthy();
    expect(screen.queryByText('42')).toBeNull();
  });

  it('«오늘» 버튼으로 되돌아온다', () => {
    const { container } = panel();
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '2026-08-29' } });
    expect(lastDate()).toBe('20260829');

    fireEvent.click(screen.getByRole('button', { name: '오늘' }));

    expect(lastDate()).toBeUndefined();
  });
});

describe('ActiveServicePanel — 종류가 여럿', () => {
  it('종류가 하나면 그냥 «방문자» 다', () => {
    panel();
    expect(screen.getByText('방문자')).toBeTruthy();
  });

  it('종류가 여럿이면 «종류별 합» 이라고 적는다 — 같은 사용자가 두 번 셀 수 있다', () => {
    // 방문자는 고유 사용자 수라 시스템을 넘어 더하면 겹친다. 그냥 «방문자» 로 적으면
    // 실제보다 많은 수를 사람 수로 읽는다.
    render(
      <ActiveServicePanel objTypes={['ORDER-JVM', 'PAY-JVM']} enabled agentMap={new Map()} />,
    );
    const label = screen.getByText('방문자 (종류별 합)');
    expect(label.getAttribute('title')).toMatch(/두 번 세어집니다/);
  });

  it('부제에 종류를 전부 적는다 — 무엇을 합친 수인지 보여야 한다', () => {
    render(
      <ActiveServicePanel objTypes={['ORDER-JVM', 'PAY-JVM']} enabled agentMap={new Map()} />,
    );
    expect(screen.getByText(/ORDER-JVM · PAY-JVM/)).toBeTruthy();
  });
});
