// 실시간 왼쪽 채우기 훅의 계약
//
// 여기서 지키려는 것:
//   · 붙자마자 던지지 않는다 — 스트림의 첫 묶음을 기다렸다가 그 왼쪽만 받는다
//   · 받은 것은 **실시간 저장소**에 들어간다 (창이 흐르면 같이 지워져야 한다)
//   · 받을 것이 없으면 조회를 던지지 않는다
//   · 대상이 바뀌면 이전 조회는 버린다

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveBackfill, BACKFILL_DELAY_MS } from './useLiveBackfill';
import { XLogDataStore } from '../store/XLogDataStore';
import type { XLogPack } from '../types/xlog';

const calls = vi.hoisted(() => ({ list: [] as { stime: number; etime: number; objHashes: number[] }[] }));

vi.mock('../api/pastXLog', () => ({
  loadPastXLogs: async (
    q: { stime: number; etime: number; objHashes: number[] },
    onProgress: (rows: XLogPack[], p: unknown) => void,
  ) => {
    calls.list.push({ stime: q.stime, etime: q.etime, objHashes: q.objHashes });
    onProgress([pack(q.stime + 1)], { pages: 1, loaded: 1, done: true, truncated: false });
  },
}));

function pack(endTime: number): XLogPack {
  return {
    txid: `t${endTime}`,
    gxid: '0',
    caller: '0',
    end_time: endTime,
    elapsed: 10,
    obj_hash: 1,
    service: 0,
    error: 0,
    x_type: 0,
    cpu: 0,
    sql_count: 0,
    sql_time: 0,
    api_call_count: 0,
    api_call_time: 0,
    ipaddr: [127, 0, 0, 1],
    alloc_kbytes: 0,
    thread_name_hash: 0,
  } as unknown as XLogPack;
}

const MIN = 60_000;

describe('useLiveBackfill', () => {
  beforeEach(() => {
    calls.list = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('대기 시간 전에는 아무것도 던지지 않는다', () => {
    const store = new XLogDataStore();
    renderHook(() => useLiveBackfill(store, 30 * MIN, [1], true));
    act(() => { vi.advanceTimersByTime(BACKFILL_DELAY_MS - 1); });
    expect(calls.list).toHaveLength(0);
  });

  it('스트림이 받아 둔 것 왼쪽만 받아 같은 저장소에 담는다', async () => {
    const store = new XLogDataStore();
    const now = Date.now();
    store.addBatch([{ ...packToS(now - 5 * MIN) }]);

    renderHook(() => useLiveBackfill(store, 30 * MIN, [1], true));
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKFILL_DELAY_MS); });

    expect(calls.list).toHaveLength(1);
    expect(calls.list[0].etime).toBe(now - 5 * MIN);
    expect(store.size).toBe(2);
  });

  it('끊겨 있으면 받지 않는다', async () => {
    const store = new XLogDataStore();
    renderHook(() => useLiveBackfill(store, 30 * MIN, [1], false));
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKFILL_DELAY_MS); });
    expect(calls.list).toHaveLength(0);
  });

  it('대상이 없으면 받지 않는다', async () => {
    const store = new XLogDataStore();
    renderHook(() => useLiveBackfill(store, 30 * MIN, [], true));
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKFILL_DELAY_MS); });
    expect(calls.list).toHaveLength(0);
  });

  it('새로 고른 서버만 창 전체를 받는다 — 보던 서버는 다시 받지 않는다', async () => {
    const store = new XLogDataStore();
    const now = Date.now();
    store.addBatch([packToS(now - 30 * MIN)]);

    const { rerender } = renderHook(
      ({ hs }: { hs: number[] }) => useLiveBackfill(store, 30 * MIN, hs, true),
      { initialProps: { hs: [1] } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKFILL_DELAY_MS); });
    calls.list = [];

    rerender({ hs: [1, 2] });
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKFILL_DELAY_MS); });
    expect(calls.list).toHaveLength(1);
    expect(calls.list[0].objHashes).toEqual([2]);
  });

  it('과거 모드를 다녀와도 갖고 있는 구간은 다시 받지 않는다', async () => {
    const store = new XLogDataStore();
    const now = Date.now();
    store.addBatch([packToS(now - 30 * MIN)]);

    const { rerender } = renderHook(
      ({ on }: { on: boolean }) => useLiveBackfill(store, 30 * MIN, [1], on),
      { initialProps: { on: true } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKFILL_DELAY_MS); });
    calls.list = [];

    rerender({ on: false });
    rerender({ on: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKFILL_DELAY_MS); });
    expect(calls.list).toHaveLength(0);
  });

  it('한 번 채운 뒤에는 같은 구간을 다시 받지 않는다', async () => {
    const store = new XLogDataStore();
    const { rerender } = renderHook(
      ({ ms }: { ms: number }) => useLiveBackfill(store, ms, [1], true),
      { initialProps: { ms: 30 * MIN } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKFILL_DELAY_MS); });
    expect(calls.list).toHaveLength(1);

    // 창을 **좁히면** 받을 것이 없다
    rerender({ ms: 5 * MIN });
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKFILL_DELAY_MS); });
    expect(calls.list).toHaveLength(1);
  });
});

function packToS(endTime: number) {
  return {
    txid: `s${endTime}`,
    gxid: '0',
    caller: '0',
    endTime,
    elapsed: 10,
    objHash: 1,
    service: 0,
    error: 0,
    xType: 0,
    cpu: 0,
    sqlCount: 0,
    sqlTime: 0,
    apiCallCount: 0,
    apiCallTime: 0,
    ipAddr: '127.0.0.1',
    allocKBytes: 0,
    threadNameHash: 0,
  };
}
