// 실시간 스트림 훅의 계약
//
// 여기서 지키려는 것:
//   · 받은 것을 저장소에 **한 번만** 넣는다 (StrictMode 가 effect 를 두 번 돌린다)
//   · 창 밖은 주기적으로 지운다 — 안 지우면 몇 시간 뒤 메모리로 갚는다
//   · 설정에서 바꾼 상한이 **살아 있는 저장소에** 물린다 (새로 만들면 화면이 빈다)
//   · 스트림 오류는 화면이 지울 수 있어야 한다

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useXLogStream } from './useXLogStream';
import { DEFAULT_CHART_CONFIG } from '../types/xlog';

const bus = vi.hoisted(() => ({
  data: null as null | ((cols: unknown) => void),
  error: null as null | ((msg: string) => void),
  bufferMax: 100_000,
}));

vi.mock('../api/scouterApi', () => ({
  onXLogData: (cb: (cols: unknown) => void) => { bus.data = cb; return Promise.resolve(() => {}); },
  onXLogError: (cb: (msg: string) => void) => { bus.error = cb; return Promise.resolve(() => {}); },
}));
vi.mock('../api/subscribe', () => ({
  subscribe: (...ps: Promise<() => void>[]) => { ps.forEach(p => void p); return () => {}; },
}));
vi.mock('./useViewOptions', () => ({
  useViewOptions: () => ({ bufferMax: bus.bufferMax, sqlBindInline: true, fontScale: 1, lang: 'ko' }),
}));

/** 열 묶음 한 개짜리 — xlogColumnsToSXLogs 가 읽는 모양 그대로 */
function columns(endTimes: number[]) {
  const n = endTimes.length;
  const zeros = () => new Array(n).fill(0);
  // 이름은 **Rust 가 보내는 스네이크 케이스 그대로**다 (F-56 의 열 묶음)
  return {
    txid: endTimes.map((_, i) => `z${i}`),
    gxid: endTimes.map(() => '0'),
    caller: endTimes.map(() => '0'),
    end_time: endTimes,
    elapsed: zeros(),
    obj_hash: zeros(),
    service: zeros(),
    error: zeros(),
    x_type: zeros(),
    cpu: zeros(),
    sql_count: zeros(),
    sql_time: zeros(),
    apicall_count: zeros(),
    apicall_time: zeros(),
    ipaddr: endTimes.map(() => '10.0.0.1'),
    kbytes: zeros(),
    thread_name_hash: zeros(),
  };
}

beforeEach(() => {
  bus.data = null;
  bus.error = null;
  bus.bufferMax = 100_000;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useXLogStream', () => {
  it('받은 묶음을 저장소에 넣는다', () => {
    const { result } = renderHook(() => useXLogStream(DEFAULT_CHART_CONFIG));
    act(() => bus.data?.(columns([Date.now(), Date.now()])));

    expect(result.current.store.size).toBe(2);
    expect(result.current.store.lastReceivedAt).not.toBeNull();
  });

  it('창 밖은 주기적으로 지운다', () => {
    // 안 지우면 몇 시간 뒤에 메모리로 갚는다.
    const { result } = renderHook(() => useXLogStream(DEFAULT_CHART_CONFIG));
    const old = Date.now() - DEFAULT_CHART_CONFIG.timeRangeMs - 60_000;
    act(() => bus.data?.(columns([old, Date.now()])));
    expect(result.current.store.size).toBe(2);

    act(() => { vi.advanceTimersByTime(5_000); });
    expect(result.current.store.size).toBe(1);
  });

  it('설정에서 바꾼 상한이 살아 있는 저장소에 물린다', () => {
    // 저장소를 새로 만들면 상한을 올리려다 화면을 비우는 꼴이 된다.
    const { result, rerender } = renderHook(() => useXLogStream(DEFAULT_CHART_CONFIG));
    act(() => bus.data?.(columns([Date.now()])));

    bus.bufferMax = 500_000;
    rerender();

    expect(result.current.store.maxItemCount).toBe(500_000);
    expect(result.current.store.size).toBe(1); // 받아 둔 것은 그대로다
  });

  it('스트림 오류를 올리고, 화면이 지울 수 있다', () => {
    const { result } = renderHook(() => useXLogStream(DEFAULT_CHART_CONFIG));
    act(() => bus.error?.('세션 만료'));
    expect(result.current.streamError).toBe('세션 만료');

    act(() => result.current.clearError());
    expect(result.current.streamError).toBeNull();
  });
});
