// 구간 데이터를 **무엇으로 어떻게 묻는가.**
//
// 콜렉터가 objHash 목록을 안 받아 타입 전체가 온다. 고른 서버만 남기는 것이
// 이 훅의 몫이고, 그게 틀리면 «3대 골랐는데 차트에는 100줄» 이 된다.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePastCounters, type CounterQuery } from './usePastCounters';

interface Call { counter: string; objType: string; stime: number; etime: number }

const api = vi.hoisted(() => ({
  calls: [] as Call[],
  rows: [] as { obj_hash: number; times: number[]; values: number[] }[],
  fail: null as string | null,
}));

vi.mock('../xlog/api/scouterApi', () => ({
  getPastCounter: (counter: string, objType: string, stime: number, etime: number) => {
    api.calls.push({ counter, objType, stime, etime });
    return api.fail ? Promise.reject(new Error(api.fail)) : Promise.resolve(api.rows);
  },
}));

const RANGE = { stime: 1_000, etime: 2_000 };
const Q: CounterQuery[] = [
  { counter: 'TPS', objType: 'tomcat' },
  { counter: 'Cpu', objType: 'linux' },
];

beforeEach(() => {
  api.calls = [];
  api.fail = null;
  api.rows = [
    { obj_hash: 11, times: [1_100], values: [10] },
    { obj_hash: 22, times: [1_100], values: [20] },
    { obj_hash: 99, times: [1_100], values: [99] },
  ];
});
afterEach(() => vi.clearAllMocks());

const mount = (
  enabled: boolean,
  queries: CounterQuery[],
  range: typeof RANGE | null,
  picked: number[],
) => renderHook(() => usePastCounters(enabled, queries, range, new Set(picked)));

describe('usePastCounters', () => {
  it('줄마다 한 번씩 묻는다', async () => {
    const { result } = mount(true, Q, RANGE, [11]);
    await waitFor(() => expect(result.current.rows.length).toBe(2));
    expect(api.calls.map(c => `${c.counter}@${c.objType}`)).toEqual(['TPS@tomcat', 'Cpu@linux']);
  });

  it('구간을 그대로 넘긴다', async () => {
    const { result } = mount(true, Q, RANGE, [11]);
    await waitFor(() => expect(result.current.rows.length).toBe(2));
    expect(api.calls[0]).toMatchObject({ stime: 1_000, etime: 2_000 });
  });

  it('줄 순서는 물은 순서 그대로다', async () => {
    // 순서가 뒤바뀌면 화면의 줄과 이름이 어긋난다.
    const { result } = mount(true, Q, RANGE, [11]);
    await waitFor(() => expect(result.current.rows.length).toBe(2));
    expect(result.current.rows.map(r => r.counter)).toEqual(['TPS', 'Cpu']);
  });

  it('고른 서버만 남긴다', async () => {
    // 콜렉터는 타입 전체를 준다. 거르지 않으면 안 고른 서버가 차트에 나타난다.
    const { result } = mount(true, Q, RANGE, [11, 22]);
    await waitFor(() => expect(result.current.rows.length).toBe(2));
    expect(result.current.rows[0].series.map(s => s.obj_hash)).toEqual([11, 22]);
  });

  it('objType 을 모르는 줄은 묻지 않는다', async () => {
    // 호스트 에이전트가 없는 곳에서는 CPU 를 물을 데가 없다.
    const { result } = mount(true, [{ counter: 'Cpu', objType: '' }], RANGE, [11]);
    await waitFor(() => expect(result.current.rows.length).toBe(1));
    expect(api.calls).toEqual([]);
    expect(result.current.rows[0].series).toEqual([]);
  });

  it('꺼져 있으면 묻지 않는다', () => {
    mount(false, Q, RANGE, [11]);
    expect(api.calls).toEqual([]);
  });

  it('구간이 없으면 묻지 않는다', () => {
    mount(true, Q, null, [11]);
    expect(api.calls).toEqual([]);
  });

  it('고른 서버가 없으면 묻지 않는다', () => {
    // 받아 봐야 전부 걸러진다. 연결만 낭비한다.
    mount(true, Q, RANGE, []);
    expect(api.calls).toEqual([]);
  });

  it('실패하면 말하고, 화면을 비운다', async () => {
    api.fail = '연결되지 않음';
    const { result } = mount(true, Q, RANGE, [11]);
    await waitFor(() => expect(result.current.error).toContain('연결되지 않음'));
    expect(result.current.rows).toEqual([]);
  });

  it('구간이 그대로면 다시 묻지 않는다', async () => {
    // 배열·집합은 매 렌더 새로 만들어진다. 내용으로 견주지 않으면 조회가 끝없이 나간다.
    const { result, rerender } = renderHook(() =>
      usePastCounters(true, [...Q], { ...RANGE }, new Set([11])),
    );
    await waitFor(() => expect(result.current.rows.length).toBe(2));
    const before = api.calls.length;
    rerender();
    rerender();
    expect(api.calls.length).toBe(before);
  });

  it('reload 하면 다시 묻는다', async () => {
    const { result } = mount(true, Q, RANGE, [11]);
    await waitFor(() => expect(result.current.rows.length).toBe(2));
    const before = api.calls.length;
    act(() => result.current.reload());
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(before));
  });
});
