// 카운터 차트 — 고른 서버만 그린다
//
// jsdom 에는 2d 컨텍스트가 없어 캔버스를 볼 수 없다. 그래서 머리글 라벨이
// 「무엇을 그리고 있나」를 확인하는 유일한 통로다(CounterChart.test.tsx 와 같은 방식).

import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CounterChart } from './CounterChart';
import type { CounterUpdate } from '../types/counter';

const bus = vi.hoisted(() => ({ send: null as null | ((u: CounterUpdate) => void) }));

vi.mock('../api/scouterApi', () => ({
  onCounterData: (cb: (u: CounterUpdate) => void) => {
    bus.send = cb;
    return Promise.resolve(() => {});
  },
}));
vi.mock('../api/subscribe', () => ({
  subscribe: (p: Promise<() => void>) => {
    void p;
    return () => {};
  },
}));

const agentMap = new Map([
  [11, '/host/shop-app'],
  [22, '/host/order-app'],
  [33, '/host/pay-app'],
]);

function push(values: { obj_hash: number; value: number; total: number | null }[]) {
  act(() => {
    bus.send?.({ counter: 'TPS', time: Date.now(), values } as unknown as CounterUpdate);
  });
}

beforeEach(() => { bus.send = null; });
afterEach(() => vi.clearAllMocks());

describe('CounterChart — 서버 고르기', () => {
  it('안 고르면 받은 전부를 센다', () => {
    render(<CounterChart isStreaming counter="TPS" agentMap={agentMap} />);
    push([
      { obj_hash: 11, value: 1, total: null },
      { obj_hash: 22, value: 2, total: null },
      { obj_hash: 33, value: 3, total: null },
    ]);

    expect(screen.getByText(/3개 에이전트/)).toBeTruthy();
  });

  it('고른 서버 수만 머리글에 적는다', () => {
    // 받은 수를 적으면 «3개» 라고 써 놓고 선은 하나만 그려져 고장으로 읽힌다.
    render(
      <CounterChart isStreaming counter="TPS" agentMap={agentMap} visible={new Set([22])} />,
    );
    push([
      { obj_hash: 11, value: 1, total: null },
      { obj_hash: 22, value: 2, total: null },
      { obj_hash: 33, value: 3, total: null },
    ]);

    expect(screen.getByText(/1개 에이전트/)).toBeTruthy();
  });

  it('고르기를 풀면 지난 값이 그대로 살아 있다', () => {
    // 받는 쪽에서 걸렀다면 여기서 0 이 된다 — 다시 쌓일 때까지 빈 차트를 봐야 한다.
    const { rerender } = render(
      <CounterChart isStreaming counter="TPS" agentMap={agentMap} visible={new Set([22])} />,
    );
    push([
      { obj_hash: 11, value: 1, total: null },
      { obj_hash: 22, value: 2, total: null },
    ]);
    expect(screen.getByText(/1개 에이전트/)).toBeTruthy();

    rerender(<CounterChart isStreaming counter="TPS" agentMap={agentMap} visible={null} />);
    expect(screen.getByText(/2개 에이전트/)).toBeTruthy();
  });
});
