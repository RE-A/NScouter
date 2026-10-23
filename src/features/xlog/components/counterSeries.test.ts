// 카운터 선 접기의 계약
//
//   · each    — 오브젝트마다 한 선, 고른 것만
//   · total   — 고른 것 전부를 한 선 (합 또는 평균)
//   · service — 서비스마다 한 선, 서비스에 안 속한 것은 따로 한 선
//   · 원본을 들고 있으므로 접는 방식을 바꿔도 이력이 그대로다

import { describe, expect, it } from 'vitest';
import { foldSeries, shownObjectCount } from './counterSeries';
import type { CounterUpdate } from '../types/counter';
import { getAgentColor, keyColor } from '../utils/colorPalette';

const up = (time: number, vals: [number, number, number?][]): CounterUpdate => ({
  time,
  counter: 'TPS',
  values: vals.map(([obj_hash, value, total]) => ({ obj_hash, value, ...(total === undefined ? {} : { total }) })),
});

// 1·2 는 safs Task, 3 은 서비스에 안 속한 shop-app
const svc = (h: number) => (h === 1 || h === 2 ? 'safs' : null);
const name = (h: number) => `obj${h}`;
const ups = [up(1000, [[1, 10], [2, 20], [3, 5]]), up(3000, [[1, 12], [2, 18], [3, 7]])];

describe('foldSeries', () => {
  it('each — 오브젝트마다 한 선이고 색은 오브젝트 색이다', () => {
    const s = foldSeries(ups, { fold: 'each', agg: 'sum', visible: null, nameOf: name });
    expect(s.map(x => x.key)).toEqual(['h:1', 'h:2', 'h:3']);
    expect(s[0]).toMatchObject({ values: [10, 12], times: [1000, 3000], color: getAgentColor(1), label: 'obj1' });
  });

  it('each — 고른 것만 그린다', () => {
    const s = foldSeries(ups, { fold: 'each', agg: 'sum', visible: new Set([3]), nameOf: name });
    expect(s.map(x => x.key)).toEqual(['h:3']);
  });

  it('total — 고른 것 전부를 한 선으로 더한다', () => {
    const s = foldSeries(ups, { fold: 'total', agg: 'sum', visible: null, nameOf: name });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ key: 'total', values: [35, 37], color: null });
  });

  it('total — 평균 카운터는 평균을 낸다', () => {
    const s = foldSeries(ups, { fold: 'total', agg: 'avg', visible: new Set([1, 2]), nameOf: name });
    expect(s[0].values).toEqual([15, 15]);
  });

  it('total — 안 고른 오브젝트는 접는 데 안 넣는다', () => {
    const s = foldSeries(ups, { fold: 'total', agg: 'sum', visible: new Set([1]), nameOf: name });
    expect(s[0].values).toEqual([10, 12]);
  });

  it('service — 서비스마다 한 선, 안 속한 것은 따로 한 선', () => {
    const s = foldSeries(ups, { fold: 'service', agg: 'sum', visible: null, serviceOf: svc, nameOf: name });
    expect(s.map(x => x.key)).toEqual(['s:safs', 'h:3']);
    expect(s[0]).toMatchObject({ label: 'safs', values: [30, 30], color: keyColor('safs') });
    expect(s[1]).toMatchObject({ label: 'obj3', values: [5, 7], color: getAgentColor(3) });
  });

  it('service — Task 가 갈려도 서비스 선은 끊기지 않는다', () => {
    // 1 이 내려가고 4 가 새로 떴다 — 개별이면 선이 끊기고 새 선이 생기지만 서비스 선은 이어진다
    const svc4 = (h: number) => (h === 1 || h === 2 || h === 4 ? 'safs' : null);
    const rolled = [up(1000, [[1, 10], [2, 20]]), up(3000, [[2, 20], [4, 9]])];
    const s = foldSeries(rolled, { fold: 'service', agg: 'sum', visible: null, serviceOf: svc4, nameOf: name });
    expect(s).toHaveLength(1);
    expect(s[0].values).toEqual([30, 29]);
  });

  it('service — 서비스를 모르면(serviceOf 없음) 오브젝트마다 그린다', () => {
    const s = foldSeries(ups, { fold: 'service', agg: 'sum', visible: null, nameOf: name });
    expect(s.map(x => x.key)).toEqual(['h:1', 'h:2', 'h:3']);
  });

  it('쌍 카운터의 상한도 같은 방식으로 접는다', () => {
    const heap = [up(1000, [[1, 40, 100], [2, 60, 100]])];
    expect(foldSeries(heap, { fold: 'total', agg: 'sum', visible: null, nameOf: name })[0].total).toBe(200);
    expect(foldSeries(heap, { fold: 'each', agg: 'sum', visible: null, nameOf: name })[0].total).toBe(100);
  });

  it('고른 것이 하나도 안 온 폴링은 건너뛴다 — 0 을 지어내지 않는다', () => {
    const s = foldSeries([up(1000, [[9, 1]]), ...ups], { fold: 'total', agg: 'sum', visible: new Set([1]), nameOf: name });
    expect(s[0].times).toEqual([1000 + 0, 3000].slice(0, 0).concat([1000, 3000]));
    expect(s[0].values).toEqual([10, 12]);
  });

  it('원본은 그대로라 접는 방식을 바꿔도 이력이 남는다', () => {
    const each = foldSeries(ups, { fold: 'each', agg: 'sum', visible: null, nameOf: name });
    const total = foldSeries(ups, { fold: 'total', agg: 'sum', visible: null, nameOf: name });
    expect(each[0].values).toHaveLength(2);
    expect(total[0].values).toHaveLength(2);
  });
});

describe('shownObjectCount', () => {
  it('고른 것 중 받은 오브젝트 수를 센다 — 같은 오브젝트는 한 번만', () => {
    expect(shownObjectCount(ups, null)).toBe(3);
    expect(shownObjectCount(ups, new Set([1, 99]))).toBe(1);
  });
});
