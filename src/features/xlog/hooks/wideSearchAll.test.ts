// 넓은 구간 찾기가 서버 상한을 넘어서까지 찾는가
//
// 가짜 콜렉터: 구간 안의 것을 시간 순으로 상한만큼만 주고, 닿았으면 truncated.
// (실제 콜렉터는 «잘렸다» 를 안 알려 준다 — Rust 가 건수로 짐작해 붙인다, F-54)

import { describe, expect, it } from 'vitest';
import { clampWideMax, LIMIT_WIDE_MAX, MIN_PIECE_MS, searchAll, splitRange, WIDE_TOTAL_CAP, type SearchFn } from './wideSearchAll';
import type { SearchXLogFilter, SearchXLogResult } from '../api/scouterApi';
import type { XLogPack } from '../types/xlog';

const BASE: SearchXLogFilter = {
  stime: 0, etime: 0, objHash: 0, service: '', ip: '', login: '', desc: '',
  text1: '', text2: '', text3: '', text4: '', text5: '',
};

const pack = (t: number, id: string): XLogPack => ({ end_time: t, txid: id } as XLogPack);

/** 시각들로 가짜 콜렉터를 만든다. 부른 구간을 적어 둔다 */
function server(times: number[], max = 500, known = true) {
  const all = times.map((t, i) => pack(t, `tx${i}`)).sort((a, b) => a.end_time - b.end_time);
  const calls: { s: number; e: number; hinted: boolean }[] = [];
  const fn: SearchFn = async (f, hint) => {
    calls.push({ s: f.stime, e: f.etime, hinted: hint !== undefined });
    // 경계 시각은 양쪽에 다 걸린다 — 실제 서버처럼 끝을 포함한다
    const inRange = all.filter(x => x.end_time >= f.stime && x.end_time <= f.etime);
    const xlogs = inRange.slice(0, max);
    const res: SearchXLogResult = { xlogs, max, max_known: known, truncated: xlogs.length >= max };
    return res;
  };
  return { fn, calls };
}

const spread = (n: number, from: number, to: number) =>
  Array.from({ length: n }, (_, i) => from + Math.floor(((to - from) * i) / n));

describe('splitRange', () => {
  it('받은 것이 덮은 시간으로 조각 폭을 짐작한다', () => {
    // 앞 10초에 상한이 찼다 → 조각은 그 60%(6초) 이하 폭 → 60초 구간이면 10~11조각
    const page = spread(500, 0, 10_000).map((t, i) => pack(t, String(i)));
    const pieces = splitRange(0, 60_000, page);
    expect(pieces.length).toBeGreaterThanOrEqual(10);
    expect(pieces.length).toBeLessThanOrEqual(11);
    for (const [a, b] of pieces) expect(b - a).toBeLessThanOrEqual(6_000);
    expect(pieces[0][0]).toBe(0);
    expect(pieces[pieces.length - 1][1]).toBe(60_000);
  });

  it('조각은 빈틈 없이 이어진다', () => {
    const pieces = splitRange(1_000, 98_777, [pack(5_000, 'a')]);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i][0]).toBe(pieces[i - 1][1]);
  });

  it('짐작이 안 서면 반으로 자른다 — 받은 것이 전부 한 시각이면', () => {
    expect(splitRange(0, 10_000, [pack(0, 'a')])).toEqual([[0, 5_000], [5_000, 10_000]]);
  });

  it('1초 이하는 더 안 나눈다', () => {
    expect(splitRange(0, MIN_PIECE_MS, [])).toEqual([]);
  });

  it('짐작이 크게 빗나가도 한 번에 64조각까지만', () => {
    expect(splitRange(0, 10_000_000, [pack(1, 'a')]).length).toBeLessThanOrEqual(64);
  });
});

describe('searchAll', () => {
  it('상한 안이면 한 번에 끝난다', async () => {
    const { fn, calls } = server(spread(120, 0, 60_000));
    const r = await searchAll({ ...BASE, stime: 0, etime: 60_000 }, fn);
    expect(r.xlogs).toHaveLength(120);
    expect(r.cut).toBe('none');
    expect(calls).toHaveLength(1);
  });

  it('상한을 넘어도 전부 찾는다 — 빠짐도 겹침도 없이', async () => {
    const times = spread(4_321, 0, 3_600_000);
    const { fn } = server(times);
    const r = await searchAll({ ...BASE, stime: 0, etime: 3_600_000 }, fn);
    expect(r.cut).toBe('none');
    expect(r.xlogs).toHaveLength(4_321);
    expect(new Set(r.xlogs.map(x => x.txid)).size).toBe(4_321);
  });

  it('한쪽에 몰려 있어도 전부 찾는다', async () => {
    // 1시간 중 마지막 1분에 3천 건이 몰렸다
    const times = [...spread(300, 0, 3_540_000), ...spread(3_000, 3_540_000, 3_600_000)];
    const { fn } = server(times);
    const r = await searchAll({ ...BASE, stime: 0, etime: 3_600_000 }, fn);
    expect(r.xlogs).toHaveLength(3_300);
    expect(r.cut).toBe('none');
  });

  it('결과는 시간 순이다', async () => {
    const { fn } = server(spread(2_000, 0, 600_000).reverse());
    const r = await searchAll({ ...BASE, stime: 0, etime: 600_000 }, fn);
    for (let i = 1; i < r.xlogs.length; i++) expect(r.xlogs[i].end_time).toBeGreaterThanOrEqual(r.xlogs[i - 1].end_time);
  });

  it('첫 조각 뒤로는 상한을 넘겨 준다 — 조각마다 서버 설정을 다시 읽지 않게', async () => {
    const { fn, calls } = server(spread(2_000, 0, 600_000));
    await searchAll({ ...BASE, stime: 0, etime: 600_000 }, fn);
    expect(calls[0].hinted).toBe(false);
    expect(calls.slice(1).every(c => c.hinted)).toBe(true);
  });

  it('1초에 상한을 넘기면 받은 만큼 담고 «빽빽함» 이라고 말한다', async () => {
    // 0.5초 안에 900건 — 1초 조각도 상한(500)을 넘는다
    const times = spread(900, 10_000, 10_500);
    const { fn } = server(times);
    const r = await searchAll({ ...BASE, stime: 0, etime: 20_000 }, fn);
    expect(r.cut).toBe('dense');
    expect(r.xlogs.length).toBeGreaterThanOrEqual(500);
  });

  it('모은 것이 상한에 닿으면 멈추고 어디까지 훑었는지 말한다', async () => {
    const { fn } = server(spread(5_000, 0, 600_000));
    const r = await searchAll({ ...BASE, stime: 0, etime: 600_000 }, fn, { cap: 1_000 });
    expect(r.cut).toBe('cap');
    expect(r.stoppedAt).not.toBeNull();
    expect(r.stoppedAt!).toBeLessThan(600_000);
    // 멈춘 데까지는 빠짐이 없다
    const expected = spread(5_000, 0, 600_000).filter(t => t <= r.stoppedAt!).length;
    expect(r.xlogs.length).toBe(expected);
  });

  it('멈추면 다음 조각을 부르지 않는다', async () => {
    const { fn, calls } = server(spread(5_000, 0, 600_000));
    let stop = false;
    const r = await searchAll({ ...BASE, stime: 0, etime: 600_000 }, fn, {
      onProgress: p => { if (p.found > 0) stop = true; },
      isCancelled: () => stop,
    });
    expect(r.cut).toBe('cancelled');
    const before = calls.length;
    expect(before).toBeLessThan(20);
  });

  it('진행은 0 에서 1 로 간다', async () => {
    const { fn } = server(spread(3_000, 0, 600_000));
    const done: number[] = [];
    await searchAll({ ...BASE, stime: 0, etime: 600_000 }, fn, { onProgress: p => done.push(p.done) });
    expect(done[done.length - 1]).toBeCloseTo(1);
    for (let i = 1; i < done.length; i++) expect(done[i]).toBeGreaterThanOrEqual(done[i - 1]);
  });
});

describe('searchAll — 한꺼번에 묻기', () => {
  it('정한 수까지만 한꺼번에 묻는다 — 그보다 많이 열면 콜렉터가 버겁다', async () => {
    const { fn: inner } = server(spread(20_000, 0, 3_600_000));
    let inflight = 0;
    let peak = 0;
    const fn: SearchFn = async (f, h) => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise(r => setTimeout(r, 1));
      try { return await inner(f, h); } finally { inflight -= 1; }
    };
    const r = await searchAll({ ...BASE, stime: 0, etime: 3_600_000 }, fn, { parallel: 3 });
    expect(r.xlogs).toHaveLength(20_000);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('받은 것은 조각마다 바로 화면 모양으로 바꾼다', async () => {
    const { fn } = server(spread(1_200, 0, 600_000));
    const r = await searchAll({ ...BASE, stime: 0, etime: 600_000 }, fn, { map: x => ({ id: x.txid, at: x.end_time }) });
    expect(r.xlogs).toHaveLength(1_200);
    expect(r.xlogs[0]).toHaveProperty('id');
    for (let i = 1; i < r.xlogs.length; i++) expect(r.xlogs[i].at).toBeGreaterThanOrEqual(r.xlogs[i - 1].at);
  });

  it('멈추면 빈틈없이 훑은 데까지만 담는다', async () => {
    const times = spread(5_000, 0, 600_000);
    const { fn } = server(times);
    let stop = false;
    const r = await searchAll({ ...BASE, stime: 0, etime: 600_000 }, fn, {
      onProgress: p => { if (p.found > 1_000) stop = true; },
      isCancelled: () => stop,
    });
    expect(r.cut).toBe('cancelled');
    expect(r.xlogs.length).toBe(times.filter(t => t <= r.stoppedAt!).length);
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
