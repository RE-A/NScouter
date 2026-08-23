// CounterChart 상호작용 계약
//
// 덮는 구간: Tauri 이벤트 → React 상태 → DOM
// 덮지 않는 것: Canvas 픽셀 (jsdom 에 2d 컨텍스트가 없다. 수동 확인 항목)
//   → docs/test-design.md D절 "렌더 결과를 픽셀이 아니라 데이터로 검증한다"

import { listen } from '@tauri-apps/api/event';
import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CounterChart } from './CounterChart';
import type { CounterUpdate } from '../types/counter';

type Handler = (e: { payload: CounterUpdate }) => void;

let handlers: Handler[];

beforeEach(() => {
  handlers = [];
  vi.mocked(listen).mockImplementation(((event: string, cb: Handler) => {
    if (event === 'counter-data') handlers.push(cb);
    return Promise.resolve(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
});

afterEach(() => vi.clearAllMocks());

/** 백엔드가 보낸 것과 같은 모양의 이벤트를 흘려보낸다 */
async function emitCounter(update: CounterUpdate) {
  await act(async () => {
    // 리스너 등록은 비동기(then)라 한 틱 넘긴다
    await Promise.resolve();
    handlers.forEach(h => h({ payload: update }));
  });
}

const AGENTS = new Map([[1, '/host-a/shop-app'], [2, '/host-b/order-app']]);

const update = (counter: string, values: Array<[number, number]>): CounterUpdate =>
  ({
    time: 1_700_000_000_000,
    counter: counter as CounterUpdate['counter'],
    values: values.map(([obj_hash, value]) => ({ obj_hash, value })),
  });

describe('CounterChart', () => {
  it('counters.xml 의 표시명과 단위를 보여준다', () => {
    render(<CounterChart isStreaming counter="TPS" agentMap={AGENTS} />);
    expect(screen.getByText(/TPS \(tps\)/)).toBeDefined();
  });

  it('자기 카운터 이벤트를 받으면 에이전트 수를 표시한다', async () => {
    render(<CounterChart isStreaming counter="TPS" agentMap={AGENTS} />);
    await emitCounter(update('TPS', [[1, 15.4], [2, 7.8]]));
    expect(screen.getByText(/2개 에이전트/)).toBeDefined();
  });

  // 이벤트는 카운터 단위로 브로드캐스트되고 차트가 여러 개 붙는다.
  // 필터가 없으면 Heap Used 차트에 TPS 값이 섞인다.
  it('다른 카운터의 이벤트는 무시한다', async () => {
    render(<CounterChart isStreaming counter="HeapUsed" agentMap={AGENTS} />);
    await emitCounter(update('TPS', [[1, 15.4], [2, 7.8]]));
    expect(screen.queryByText(/개 에이전트/)).toBeNull();
  });

  it('같은 오브젝트가 여러 번 와도 에이전트 수는 늘지 않는다', async () => {
    render(<CounterChart isStreaming counter="TPS" agentMap={AGENTS} />);
    await emitCounter(update('TPS', [[1, 15.4]]));
    await emitCounter(update('TPS', [[1, 16.1]]));
    expect(screen.getByText(/1개 에이전트/)).toBeDefined();
  });

  it('스트리밍이 꺼져 있으면 구독하지 않는다', () => {
    render(<CounterChart isStreaming={false} counter="TPS" agentMap={AGENTS} />);
    expect(handlers).toHaveLength(0);
  });
});

// 합계 모드 (ASIS RealTimeTotalCount).
//
// 캔버스는 못 보므로 **라벨이 유일한 통로**다. 여기서 "합계인가 평균인가"를
// 말해 주지 않으면 CPU 두 대의 50%를 100%로 읽는 사고가 난다.
describe('CounterChart 합계 모드', () => {
  it('양을 세는 카운터는 합계라고 밝힌다', async () => {
    render(<CounterChart isStreaming counter="TPS" agentMap={AGENTS} total />);
    await emitCounter(update('TPS', [[1, 15.4], [2, 7.8]]));
    expect(screen.getByText(/합계/)).toBeDefined();
  });

  it('% 카운터는 평균이라고 밝힌다', async () => {
    // ErrorRate 는 counters.xml 이 합계를 허용하면서 단위가 % 다 —
    // getTotalMode 의 avg 갈래가 바로 이 경우를 위해 있다.
    render(<CounterChart isStreaming counter="ErrorRate" agentMap={AGENTS} total />);
    await emitCounter(update('ErrorRate', [[1, 4], [2, 6]]));
    expect(screen.getByText(/평균/)).toBeDefined();
  });

  it('counters.xml 이 막은 카운터는 합계를 요청받아도 개별로 그리고 그렇다고 말한다', async () => {
    // Cpu 는 total="false" 다. 조용히 개별로 그리면 옆 차트와 같은 자로 읽힌다.
    render(<CounterChart isStreaming counter="Cpu" agentMap={AGENTS} total />);
    await emitCounter(update('Cpu', [[1, 40], [2, 60]]));
    expect(screen.getByText(/합계 없음/)).toBeDefined();
    expect(screen.queryByText(/평균 ·/)).toBeNull();
  });

  it('접어도 몇 대를 접었는지는 남긴다', async () => {
    // "TPS 23" 만 있으면 한 대가 23인지 두 대가 각각 11.5인지 알 수 없다.
    render(<CounterChart isStreaming counter="TPS" agentMap={AGENTS} total />);
    await emitCounter(update('TPS', [[1, 15.4], [2, 7.8]]));
    expect(screen.getByText(/2개 에이전트/)).toBeDefined();
  });

  it('개별 모드에서는 합계/평균이라 하지 않는다', async () => {
    render(<CounterChart isStreaming counter="ErrorRate" agentMap={AGENTS} />);
    await emitCounter(update('ErrorRate', [[1, 4], [2, 6]]));
    expect(screen.queryByText(/평균/)).toBeNull();
    expect(screen.queryByText(/합계 없음/)).toBeNull();
  });
});
