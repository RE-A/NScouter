// 넓은 구간 찾기 — 조각으로 나눠 빠짐·겹침 없이 다 찾고, 멈추면 어디까지 찾았는지 말하는가
//
// 가짜 콜렉터: 조각 안의 것을 시간 순으로 페이지(`pageSize`)씩 주고, 조건은 Rust 가 이미 걸렀다고 본다.

import { describe, expect, it } from 'vitest';
import {
  clampWideMax,
  LIMIT_WIDE_MAX,
  planPieces,
  searchAll,
  WIDE_TOTAL_CAP,
  type PageFn,
} from './wideSearchAll';
import type { SearchXLogFilter, WidePage } from '../api/scouterApi';
import type { XLogPack } from '../types/xlog';

const BASE: SearchXLogFilter = {
  stime: 0, etime: 0, objHash: 0, service: '', ip: '', login: '', desc: '',
  text1: '', text2: '', text3: '', text4: '', text5: '',
};

const pack = (t: number, id: string): XLogPack => ({ end_time: t, txid: id } as XLogPack);
const spread = (n: number, from: number, to: number) =>
  Array.from({ length: n }, (_, i) => from + Math.floor(((to - from) * i) / n));

/** 시각들로 가짜 콜렉터를 만든다. 부른 것을 적어 둔다 */
function server(times: number[], pageSize = 100) {
  const all = times.map((t, i) => pack(t, `tx${i}`)).sort((a, b) => a.end_time - b.end_time);
  const calls: { s: number; e: number; date: string; hashes: number[] }[] = [];
  let inflight = 0;
  let maxInflight = 0;
  const fn: PageFn = async (f, date, hashes, cursor) => {
    calls.push({ s: f.stime, e: f.etime, date, hashes });
    inflight++;
    maxInflight = Math.max(maxInflight, inflight);
    await Promise.resolve();
    inflight--;
    // 경계 시각은 양쪽에 다 걸린다 — 실제 콜렉터처럼 끝을 포함한다
    const inRange = all.filter(x => x.end_time >= f.stime && x.end_time <= f.etime);
    const from = cursor ? cursor.last_txid : 0;
    const xlogs = inRange.slice(from, from + pageSize);
    const done = from + pageSize >= inRange.length;
    const res: WidePage = {
      xlogs,
      cursor: { has_more: !done, last_txid: from + pageSize, last_xlog_time: 0 },
      done,
      scanned: xlogs.length,
    };
    return res;
  };
  return { fn, calls, maxInflight: () => maxInflight };
}

const objectsOf = async () => [1, 2];
const MIN = 60_000;

describe('planPieces', () => {
  it('구간을 조각으로 나누고 빈틈·겹침 없이 잇는다', () => {
    const p = planPieces(0, 23 * MIN, 5 * MIN);
    expect(p.length).toBe(5);
    expect(p[0].s).toBe(0);
    expect(p[4].e).toBe(23 * MIN);
    for (let i = 1; i < p.length; i++) expect(p[i].s).toBe(p[i - 1].e);
  });

  it('자정에서 끊고 날짜를 바꾼다 — 날짜가 틀리면 0건이다', () => {
    const midnight = new Date(2026, 10, 2).getTime();
    const p = planPieces(midnight - 3 * MIN, midnight + 3 * MIN, 5 * MIN);
    expect(p.map(x => [x.date, x.e - x.s])).toEqual([
      ['20261101', 3 * MIN],
      ['20261102', 3 * MIN],
    ]);
  });
});

describe('searchAll', () => {
  it('조각과 페이지를 넘겨 전부 찾는다 — 빠짐도 겹침도 없이', async () => {
    const times = spread(3_000, 0, 30 * MIN);
    const srv = server(times);
    const res = await searchAll({ ...BASE, stime: 0, etime: 30 * MIN }, srv.fn, objectsOf);
    expect(res.cut).toBe('none');
    expect(res.xlogs.length).toBe(3_000);
    expect(new Set(res.xlogs.map(x => x.txid)).size).toBe(3_000);
  });

  it('결과는 시간 순이다', async () => {
    const srv = server(spread(500, 0, 20 * MIN).reverse());
    const res = await searchAll({ ...BASE, stime: 0, etime: 20 * MIN }, srv.fn, objectsOf);
    const ts = res.xlogs.map(x => x.end_time);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it('전체면 그날 붙었던 오브젝트를, 하나를 골랐으면 그것만 묻는다', async () => {
    const all = server([1]);
    await searchAll({ ...BASE, stime: 0, etime: MIN }, all.fn, objectsOf);
    expect(all.calls[0].hashes).toEqual([1, 2]);
    const one = server([1]);
    await searchAll({ ...BASE, stime: 0, etime: MIN, objHash: 7 }, one.fn, objectsOf);
    expect(one.calls[0].hashes).toEqual([7]);
  });

  it('정한 수까지만 한꺼번에 묻는다 — 그보다 많이 열면 콜렉터가 버겁다', async () => {
    const srv = server(spread(2_000, 0, 60 * MIN), 50);
    await searchAll({ ...BASE, stime: 0, etime: 60 * MIN }, srv.fn, objectsOf, { parallel: 3 });
    expect(srv.maxInflight()).toBeLessThanOrEqual(3);
    expect(srv.maxInflight()).toBeGreaterThan(1);
  });

  it('모은 것이 상한에 닿으면 멈추고 빈틈없이 훑은 데까지만 담는다', async () => {
    const srv = server(spread(6_000, 0, 60 * MIN), 100);
    const res = await searchAll({ ...BASE, stime: 0, etime: 60 * MIN }, srv.fn, objectsOf, { cap: 1_000, parallel: 2 });
    expect(res.cut).toBe('cap');
    expect(res.stoppedAt).not.toBeNull();
    // 멈춘 자리 뒤의 것은 담지 않는다 — «어디까지 찾았나» 가 거짓이 되면 안 된다
    for (const x of res.xlogs) expect(x.end_time).toBeLessThanOrEqual(res.stoppedAt!);
    // 멈춘 자리 앞은 빠짐없이
    const expected = spread(6_000, 0, 60 * MIN).filter(t => t <= res.stoppedAt!).length;
    expect(res.xlogs.length).toBe(expected);
  });

  it('트래픽이 많아 조각 넷이 다 덜 끝난 채 상한에 닿아도 — 가장 이른 조각은 끝까지 받아 결과가 비지 않는다', async () => {
    // 5분 조각 하나에 3,000건 남짓 — 상한 1,000 은 조각 넷을 같이 받는 동안 어느 하나도 끝나기 전에 닿는다
    const times = spread(40_000, 0, 60 * MIN);
    const srv = server(times, 100);
    const res = await searchAll({ ...BASE, stime: 0, etime: 60 * MIN }, srv.fn, objectsOf, { cap: 1_000, parallel: 4 });
    expect(res.cut).toBe('cap');
    expect(res.stoppedAt).toBeGreaterThanOrEqual(5 * MIN);
    const expected = times.filter(t => t <= res.stoppedAt!).length;
    expect(res.xlogs.length).toBe(expected);
    expect(res.xlogs.length).toBeGreaterThan(1_000);
  });

  it('멈추면 다음 페이지를 부르지 않는다', async () => {
    const srv = server(spread(5_000, 0, 60 * MIN), 100);
    let cancel = false;
    const res = await searchAll({ ...BASE, stime: 0, etime: 60 * MIN }, srv.fn, objectsOf, {
      parallel: 1,
      onProgress: () => { cancel = true; },
      isCancelled: () => cancel,
    });
    expect(res.cut).toBe('cancelled');
    const before = srv.calls.length;
    expect(before).toBeLessThan(50);
    expect(res.stoppedAt).toBe(5 * MIN);
  });

  it('진행은 0 에서 1 로 가고, 받은 것은 페이지마다 바로 화면 모양으로 바꾼다', async () => {
    const srv = server(spread(300, 0, 15 * MIN));
    const done: number[] = [];
    let mapped = 0;
    const res = await searchAll({ ...BASE, stime: 0, etime: 15 * MIN }, srv.fn, objectsOf, {
      onProgress: p => done.push(p.done),
      map: x => { mapped++; return x.txid; },
    });
    expect(done[done.length - 1]).toBe(1);
    expect(done).toEqual([...done].sort((a, b) => a - b));
    expect(mapped).toBe(300);
    expect(typeof res.xlogs[0]).toBe('string');
  });
});

describe('clampWideMax', () => {
  it('설정 값을 범위 안으로 자른다', () => {
    expect(clampWideMax(undefined)).toBe(WIDE_TOTAL_CAP);
    expect(clampWideMax(5)).toBe(10_000);
    expect(clampWideMax(9_999_999)).toBe(LIMIT_WIDE_MAX);
    expect(clampWideMax(500_000)).toBe(500_000);
  });
});
