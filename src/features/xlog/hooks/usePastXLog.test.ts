// 과거 구간 조회 훅의 계약
//
// `planFetch` 가 «무엇을 더 받을지» 를 정하는 순수 함수라면, 여기서 보는 것은
// **그 계획대로 실제로 던지는가** 다. 좌우로 옮길 때마다 창 전체를 다시 받으면
// 같은 것을 매번 수만 건씩 끌어온다 — 그것이 실제로 일어나지 않는지 확인한다.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePastXLog } from './usePastXLog';
import type { XLogPack } from '../types/xlog';

const calls = vi.hoisted(() => ({
  list: [] as { stime: number; etime: number; objHashes: number[]; date: string }[],
}));

vi.mock('../api/pastXLog', () => ({
  loadPastXLogs: async (
    q: { stime: number; etime: number; objHashes: number[]; date: string },
    onProgress: (rows: XLogPack[], p: unknown) => void,
  ) => {
    calls.list.push({ stime: q.stime, etime: q.etime, objHashes: q.objHashes, date: q.date });
    // 구간 안의 것 한 건. 어느 구간에서 온 것인지 txid 로 구분된다.
    onProgress([pack(q.stime + 1)], { pages: 1, loaded: 1, done: true, truncated: false });
  },
}));

// 설정 저장소는 config.json 을 읽는다. 여기서 보려는 것과 상관이 없다.
vi.mock('./useViewOptions', () => ({
  useViewOptions: () => ({ sqlBindInline: false, fontScale: 1, lang: 'ko', bufferMax: 100_000 }),
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

/** 2026-09-05 12:00:00 부터 재는 편이 날짜 경계에 안 걸린다 */
const NOON = new Date(2026, 8, 5, 12, 0, 0).getTime();
const MIN = 60_000;
const HASHES = [11, 22];

interface Props {
  /** null 이면 실시간 모드 */
  range: { stime: number; etime: number } | null;
  hashes: number[];
}

/** 훅을 띄우고 구간을 갈아 끼울 수 있게 돌려준다 */
function mount(stime: number, etime: number, objHashes: number[] = HASHES) {
  const initialProps: Props = { range: { stime, etime }, hashes: objHashes };
  return renderHook(({ range, hashes }: Props) => usePastXLog(range, hashes), { initialProps });
}

/** 이펙트가 던진 조회가 끝날 때까지 */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 요청한 구간들을 «분» 단위 상대값으로 — 읽기 쉬우라고 */
function asked(): [number, number][] {
  return calls.list.map(c => [(c.stime - NOON) / MIN, (c.etime - NOON) / MIN]);
}

describe('usePastXLog', () => {
  beforeEach(() => {
    calls.list = [];
  });

  it('처음에는 창 전체를 받는다', async () => {
    mount(NOON, NOON + 10 * MIN);
    await settle();

    expect(asked()).toEqual([[0, 10]]);
  });

  it('대상이 비면 아무것도 받지 않는다 — 전체 조회는 너무 무겁다', async () => {
    mount(NOON, NOON + 10 * MIN, []);
    await settle();

    expect(calls.list).toHaveLength(0);
  });

  it('오른쪽으로 밀면 **뒤쪽 모자란 만큼만** 받는다', async () => {
    const h = mount(NOON, NOON + 10 * MIN);
    await settle();
    calls.list = [];

    // 2분 오른쪽으로
    h.rerender({ range: { stime: NOON + 2 * MIN, etime: NOON + 12 * MIN }, hashes: HASHES });
    await settle();

    expect(asked()).toEqual([[10, 12]]);
  });

  it('왼쪽으로 밀면 **앞쪽 모자란 만큼만** 받는다', async () => {
    const h = mount(NOON + 10 * MIN, NOON + 20 * MIN);
    await settle();
    calls.list = [];

    h.rerender({ range: { stime: NOON + 7 * MIN, etime: NOON + 17 * MIN }, hashes: HASHES });
    await settle();

    expect(asked()).toEqual([[7, 10]]);
  });

  it('양쪽으로 넓히면 두 쪽을 나눠 받는다', async () => {
    const h = mount(NOON + 10 * MIN, NOON + 20 * MIN);
    await settle();
    calls.list = [];

    h.rerender({ range: { stime: NOON + 5 * MIN, etime: NOON + 25 * MIN }, hashes: HASHES });
    await settle();

    expect(asked()).toEqual([
      [5, 10],
      [20, 25],
    ]);
  });

  it('안쪽으로 확대하면 아무것도 받지 않는다 — 이미 갖고 있다', async () => {
    const h = mount(NOON, NOON + 20 * MIN);
    await settle();
    calls.list = [];

    h.rerender({ range: { stime: NOON + 5 * MIN, etime: NOON + 15 * MIN }, hashes: HASHES });
    await settle();

    expect(calls.list).toHaveLength(0);
  });

  it('이어 붙일 때는 갖고 있던 것을 버리지 않는다', async () => {
    const h = mount(NOON, NOON + 10 * MIN);
    await settle();
    expect(h.result.current.store.size).toBe(1);

    h.rerender({ range: { stime: NOON + 2 * MIN, etime: NOON + 12 * MIN }, hashes: HASHES });
    await settle();

    // 처음 것 + 이어 받은 것
    expect(h.result.current.store.size).toBe(2);
  });

  it('멀리 뛰면 이어 붙이지 않고 새로 받는다 — 사이가 비어 있다', async () => {
    const h = mount(NOON, NOON + 10 * MIN);
    await settle();
    calls.list = [];

    h.rerender({ range: { stime: NOON + 30 * MIN, etime: NOON + 40 * MIN }, hashes: HASHES });
    await settle();

    expect(asked()).toEqual([[30, 40]]);
    // 이전 구간의 것은 남아 있으면 안 된다 — 창 밖이다
    expect(h.result.current.store.size).toBe(1);
  });

  it('닿기만 해도 이어 붙인다 — 1ms 라도 떨어지면 그 사이를 영영 못 본다', async () => {
    const h = mount(NOON, NOON + 10 * MIN);
    await settle();
    calls.list = [];

    // 새 창의 왼쪽 끝이 받아 둔 것의 오른쪽 끝과 정확히 맞닿는다
    h.rerender({ range: { stime: NOON + 10 * MIN, etime: NOON + 20 * MIN }, hashes: HASHES });
    await settle();

    expect(asked()).toEqual([[10, 20]]);
    expect(h.result.current.store.size).toBe(2);
  });

  it('대상 서버가 바뀌면 이어 붙이지 않는다 — 갖고 있는 것은 다른 조건의 결과다', async () => {
    const h = mount(NOON, NOON + 10 * MIN);
    await settle();
    calls.list = [];

    h.rerender({ range: { stime: NOON + 2 * MIN, etime: NOON + 12 * MIN }, hashes: [11] });
    await settle();

    // 겹치는 구간까지 통째로 다시 받는다
    expect(asked()).toEqual([[2, 12]]);
    expect(calls.list[0].objHashes).toEqual([11]);
  });

  it('실시간으로 돌아가면(구간 null) 갖고 있던 것을 비운다', async () => {
    const h = mount(NOON, NOON + 10 * MIN);
    await settle();
    expect(h.result.current.store.size).toBe(1);

    h.rerender({ range: null, hashes: HASHES });
    await settle();

    expect(h.result.current.store.size).toBe(0);
  });

  it('다시 받기(reload)는 같은 구간을 통째로 다시 받는다', async () => {
    const h = mount(NOON, NOON + 10 * MIN);
    await settle();
    calls.list = [];

    await act(async () => {
      h.result.current.reload();
    });
    await settle();

    expect(asked()).toEqual([[0, 10]]);
  });

  it('콜렉터가 날짜 폴더로 나눠 두므로 구간의 날짜를 함께 보낸다', async () => {
    mount(NOON, NOON + 10 * MIN);
    await settle();

    expect(calls.list[0].date).toBe('20260905');
  });
});
