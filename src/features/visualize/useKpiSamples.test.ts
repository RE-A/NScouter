// 스트림에서 지표를 모으는 부분.
//
// jsdom 에 캔버스는 없지만 이 훅은 캔버스를 안 쓴다 — 들어온 이벤트가
// 어떤 수로 남는지가 전부라 여기서 그대로 확인할 수 있다.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CounterUpdate } from '../xlog/types/counter';
import { MAX_COUNTER_SAMPLES } from '../xlog/types/counter';
import { useKpiSamples } from './useKpiSamples';

const bus = vi.hoisted(() => ({ send: null as null | ((u: CounterUpdate) => void) }));

vi.mock('../xlog/api/scouterApi', () => ({
  onCounterData: (cb: (u: CounterUpdate) => void) => {
    bus.send = cb;
    return Promise.resolve(() => {});
  },
}));
vi.mock('../xlog/api/subscribe', () => ({
  subscribe: (p: Promise<() => void>) => {
    void p;
    return () => {};
  },
}));

/** 이 테스트가 쓰는 오브젝트 전부. 고르기 자체는 아래 «고른 것만» 절에서 본다 */
const ALL: ReadonlySet<number> = new Set([1, 2, 11, 22, 33]);

type Row = { obj_hash: number; value: number; total?: number };

function push(counter: string, values: Row[]) {
  act(() => {
    bus.send?.({ counter, time: Date.now(), values } as unknown as CounterUpdate);
  });
}

beforeEach(() => { bus.send = null; });
afterEach(() => vi.clearAllMocks());

describe('useKpiSamples', () => {
  it('처음에는 아무 값도 없다', () => {
    const { result } = renderHook(() => useKpiSamples(true, ALL));
    expect(result.current.kpis.tps.value).toBeNull();
    expect(result.current.lastReceivedAt).toBeNull();
  });

  it('TPS 는 서버를 더해 담는다', () => {
    const { result } = renderHook(() => useKpiSamples(true, ALL));
    push('TPS', [{ obj_hash: 1, value: 40 }, { obj_hash: 2, value: 60 }]);
    expect(result.current.kpis.tps.value).toBe(100);
  });

  it('CPU 는 평균으로 담는다', () => {
    const { result } = renderHook(() => useKpiSamples(true, ALL));
    push('Cpu', [{ obj_hash: 1, value: 40 }, { obj_hash: 2, value: 60 }]);
    expect(result.current.kpis.cpu.value).toBe(50);
  });

  it('Heap 은 사용량/상한 % 로 담는다', () => {
    const { result } = renderHook(() => useKpiSamples(true, ALL));
    push('HeapTotUsage', [{ obj_hash: 1, value: 50, total: 200 }]);
    expect(result.current.kpis.heap.value).toBeCloseTo(25, 6);
  });

  it('지표에 없는 카운터는 무시한다', () => {
    // 스트림은 40개 카운터를 다 준다. 여섯 개만 골라 듣는다.
    const { result } = renderHook(() => useKpiSamples(true, ALL));
    push('GcCount', [{ obj_hash: 1, value: 7 }]);
    expect(result.current.lastReceivedAt).toBeNull();
  });

  it('표본이 시간순으로 쌓인다', () => {
    const { result } = renderHook(() => useKpiSamples(true, ALL));
    push('TPS', [{ obj_hash: 1, value: 10 }]);
    push('TPS', [{ obj_hash: 1, value: 20 }]);
    push('TPS', [{ obj_hash: 1, value: 30 }]);
    expect(result.current.kpis.tps.samples).toEqual([10, 20, 30]);
    expect(result.current.kpis.tps.value).toBe(30);
  });

  it('한 지표가 와도 다른 지표는 건드리지 않는다', () => {
    const { result } = renderHook(() => useKpiSamples(true, ALL));
    push('TPS', [{ obj_hash: 1, value: 10 }]);
    push('Cpu', [{ obj_hash: 1, value: 55 }]);
    expect(result.current.kpis.tps.value).toBe(10);
    expect(result.current.kpis.cpu.value).toBe(55);
  });

  it('접히지 않는 시점은 담지 않는다', () => {
    // 상한 없는 Heap 은 %를 만들 수 없다. 0으로 채우면 «여유가 넘친다» 로 읽힌다.
    const { result } = renderHook(() => useKpiSamples(true, ALL));
    push('HeapTotUsage', [{ obj_hash: 1, value: 74 }]);
    expect(result.current.kpis.heap.value).toBeNull();
    expect(result.current.kpis.heap.samples).toEqual([]);
    // 그래도 **받기는 받았다.** 여기서 시각을 안 남기면 «수신 없음» 이 뜬다.
    expect(result.current.lastReceivedAt).not.toBeNull();
  });

  it('표본은 상한을 넘지 않는다', () => {
    const { result } = renderHook(() => useKpiSamples(true, ALL));
    for (let i = 0; i < MAX_COUNTER_SAMPLES + 10; i++) {
      push('TPS', [{ obj_hash: 1, value: i }]);
    }
    const { samples } = result.current.kpis.tps;
    expect(samples.length).toBe(MAX_COUNTER_SAMPLES);
    // 버리는 쪽은 **오래된 것**이다. 최신을 버리면 지금 값이 과거로 굳는다.
    expect(samples[samples.length - 1]).toBe(MAX_COUNTER_SAMPLES + 9);
  });

  it('꺼져 있으면 듣지 않는다', () => {
    const { result } = renderHook(() => useKpiSamples(false, ALL));
    expect(bus.send).toBeNull();
    expect(result.current.kpis.tps.value).toBeNull();
  });

  it('껐다 켜면 쌓아 둔 것을 버린다', () => {
    // 끊긴 동안의 값을 이어 두면 다시 붙었을 때 없던 계단이 생긴다.
    const { result, rerender } = renderHook(({ on }: { on: boolean }) => useKpiSamples(on, ALL), {
      initialProps: { on: true },
    });
    push('TPS', [{ obj_hash: 1, value: 10 }]);
    expect(result.current.kpis.tps.value).toBe(10);

    rerender({ on: false });
    expect(result.current.kpis.tps.value).toBeNull();
    expect(result.current.kpis.tps.samples).toEqual([]);
    expect(result.current.lastReceivedAt).toBeNull();
  });
});

describe('useKpiSamples — 고른 것만', () => {
  it('고르기에서 빠진 서버는 접은 값에 안 들어간다', () => {
    // 스트림은 고른 것만 주지만, 고르기를 바꾼 직후 한 폴링은 이전 서버 값이 딸려 온다.
    const { result } = renderHook(() => useKpiSamples(true, new Set([1])));
    push('TPS', [{ obj_hash: 1, value: 40 }, { obj_hash: 2, value: 60 }]);
    expect(result.current.kpis.tps.value).toBe(40);
  });

  it('고른 서버의 값이 하나도 없으면 담지 않는다', () => {
    const { result } = renderHook(() => useKpiSamples(true, new Set([99])));
    push('TPS', [{ obj_hash: 1, value: 40 }]);
    expect(result.current.kpis.tps.value).toBeNull();
  });

  it('고르기를 바꾸면 그 뒤 값부터 새 기준으로 접는다', () => {
    const { result, rerender } = renderHook(
      ({ v }: { v: ReadonlySet<number> }) => useKpiSamples(true, v),
      { initialProps: { v: new Set([1, 2]) as ReadonlySet<number> } },
    );
    push('TPS', [{ obj_hash: 1, value: 40 }, { obj_hash: 2, value: 60 }]);
    expect(result.current.kpis.tps.value).toBe(100);

    rerender({ v: new Set([1]) });
    push('TPS', [{ obj_hash: 1, value: 40 }, { obj_hash: 2, value: 60 }]);
    expect(result.current.kpis.tps.value).toBe(40);
  });
});
