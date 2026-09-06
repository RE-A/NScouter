import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CounterUpdate } from '../xlog/types/counter';
import { useInstanceKpis } from './useInstanceKpis';

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

describe('useInstanceKpis', () => {
  it('처음에는 비어 있다', () => {
    const { result } = renderHook(() => useInstanceKpis(true, ALL));
    expect(result.current.samples.size).toBe(0);
    expect(result.current.lastReceivedAt).toBeNull();
  });

  it('오브젝트마다 따로 담는다', () => {
    // 접은 값 하나로는 «어느 서버가» 에 답할 수 없다.
    const { result } = renderHook(() => useInstanceKpis(true, ALL));
    push('TPS', [{ obj_hash: 11, value: 40 }, { obj_hash: 22, value: 60 }]);
    expect(result.current.samples.get(11)).toEqual({ tps: 40 });
    expect(result.current.samples.get(22)).toEqual({ tps: 60 });
  });

  it('지표가 여럿 오면 한 오브젝트에 모인다', () => {
    const { result } = renderHook(() => useInstanceKpis(true, ALL));
    push('TPS', [{ obj_hash: 11, value: 40 }]);
    push('Cpu', [{ obj_hash: 11, value: 55 }]);
    expect(result.current.samples.get(11)).toEqual({ tps: 40, cpu: 55 });
  });

  it('새 값이 앞 값을 덮는다', () => {
    const { result } = renderHook(() => useInstanceKpis(true, ALL));
    push('TPS', [{ obj_hash: 11, value: 40 }]);
    push('TPS', [{ obj_hash: 11, value: 41 }]);
    expect(result.current.samples.get(11)).toEqual({ tps: 41 });
  });

  it('Heap 은 그 오브젝트의 사용량/상한 % 다', () => {
    // 스트립과 같은 규칙을 쓴다(foldKpi). 여기 한 번 더 적으면 두 화면이 갈린다.
    const { result } = renderHook(() => useInstanceKpis(true, ALL));
    push('HeapTotUsage', [{ obj_hash: 11, value: 50, total: 200 }]);
    expect(result.current.samples.get(11)?.heap).toBeCloseTo(25, 6);
  });

  it('상한 없는 Heap 행은 담지 않는다', () => {
    // % 자리에 MB 를 적으면 74MB 가 «74%» 로 읽힌다.
    const { result } = renderHook(() => useInstanceKpis(true, ALL));
    push('HeapTotUsage', [{ obj_hash: 11, value: 74 }]);
    expect(result.current.samples.has(11)).toBe(false);
    // 그래도 받기는 받았다.
    expect(result.current.lastReceivedAt).not.toBeNull();
  });

  it('지표에 없는 카운터는 무시한다', () => {
    const { result } = renderHook(() => useInstanceKpis(true, ALL));
    push('GcCount', [{ obj_hash: 11, value: 7 }]);
    expect(result.current.samples.size).toBe(0);
    expect(result.current.lastReceivedAt).toBeNull();
  });

  it('꺼져 있으면 듣지 않는다', () => {
    renderHook(() => useInstanceKpis(false, ALL));
    expect(bus.send).toBeNull();
  });

  it('껐다 켜면 들고 있던 것을 버린다', () => {
    // 내려간 서버의 마지막 값이 남아 있으면 «아직 살아 있다» 로 읽힌다.
    const { result, rerender } = renderHook(({ on }: { on: boolean }) => useInstanceKpis(on, ALL), {
      initialProps: { on: true },
    });
    push('TPS', [{ obj_hash: 11, value: 40 }]);
    expect(result.current.samples.size).toBe(1);

    rerender({ on: false });
    expect(result.current.samples.size).toBe(0);
    expect(result.current.lastReceivedAt).toBeNull();
  });
});

describe('useInstanceKpis — 고른 것만', () => {
  it('고르기에서 빠진 서버는 칸을 만들지 않는다', () => {
    // 뺀 서버의 칸이 다음 폴링까지 남아 있으면 뺀 것이 안 빠진 것처럼 보인다.
    const { result } = renderHook(() => useInstanceKpis(true, new Set([11])));
    push('TPS', [{ obj_hash: 11, value: 40 }, { obj_hash: 22, value: 60 }]);
    expect(result.current.samples.has(11)).toBe(true);
    expect(result.current.samples.has(22)).toBe(false);
  });

  it('고르기를 바꾸면 들고 있던 것을 버리고 새로 담는다', () => {
    const { result, rerender } = renderHook(
      ({ v }: { v: ReadonlySet<number> }) => useInstanceKpis(true, v),
      { initialProps: { v: new Set([11, 22]) as ReadonlySet<number> } },
    );
    push('TPS', [{ obj_hash: 11, value: 40 }, { obj_hash: 22, value: 60 }]);
    expect(result.current.samples.size).toBe(2);

    rerender({ v: new Set([11]) });
    // 뺀 칸은 **그 자리에서** 사라지고, 남은 칸은 그대로 있어야 한다 —
    // 통째로 비우면 남은 칸이 2초 동안 깜빡인다.
    expect([...result.current.samples.keys()]).toEqual([11]);
    push('TPS', [{ obj_hash: 11, value: 41 }, { obj_hash: 22, value: 60 }]);
    expect([...result.current.samples.keys()]).toEqual([11]);
    expect(result.current.samples.get(11)?.tps).toBe(41);
  });
});
