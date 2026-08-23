import { describe, expect, it } from 'vitest';
import { hasAnyValue, seriesMax, SLOT_MS, trimAll, trimFuture } from './fiveMinSeries';
import type { CounterSeries } from '../api/scouterApi';

/** 2026-08-22 00:00 KST */
const DAY0 = 1787324400000;

const day = (values: number[]): CounterSeries => ({
  obj_hash: 7,
  times: values.map((_, i) => DAY0 + i * SLOT_MS),
  values,
});

describe('trimFuture', () => {
  it('아직 오지 않은 슬롯을 버린다', () => {
    // 하루치가 통째로 오므로 안 자르면 지금 이후가 전부 0으로 그려진다.
    const s = day([1, 2, 3, 0, 0, 0]);
    const t = trimFuture(s, DAY0 + 2 * SLOT_MS);
    expect(t.values).toEqual([1, 2, 3]);
  });

  it('진행 중인 슬롯은 남긴다', () => {
    // 12:45 슬롯은 12:47 에 아직 집계 중이지만 미래가 아니다.
    // 자르면 최신 값이 5분 내내 안 보인다.
    const s = day([1, 2, 3]);
    const t = trimFuture(s, DAY0 + SLOT_MS + 1);
    expect(t.values).toEqual([1, 2]);
  });

  it('objHash 를 잃지 않는다', () => {
    expect(trimFuture(day([1]), DAY0).obj_hash).toBe(7);
  });

  it('값이 시각보다 짧으면 짧은 쪽에 맞춘다', () => {
    // 없는 값을 0으로 메우면 없던 골짜기가 생긴다.
    const s: CounterSeries = { obj_hash: 1, times: [DAY0, DAY0 + SLOT_MS], values: [5] };
    const t = trimFuture(s, DAY0 + 10 * SLOT_MS);
    expect(t.values).toEqual([5]);
    expect(t.times).toEqual([DAY0]);
  });

  it('빈 시리즈는 빈 채로 둔다', () => {
    const t = trimFuture({ obj_hash: 1, times: [], values: [] }, DAY0);
    expect(t.times).toEqual([]);
  });
});

describe('trimAll', () => {
  it('오브젝트마다 따로 자른다', () => {
    const out = trimAll([day([1, 2, 0]), day([3, 0, 0])], DAY0 + SLOT_MS);
    expect(out.map(s => s.values.length)).toEqual([2, 2]);
  });
});

describe('seriesMax', () => {
  it('오브젝트를 통틀어 가장 큰 값이다', () => {
    // 오브젝트마다 축이 다르면 선끼리 비교가 안 된다.
    expect(seriesMax([{ obj_hash: 1, times: [], values: [3] }, { obj_hash: 2, times: [], values: [9] }])).toBe(9);
  });

  it('전부 0이어도 1을 준다', () => {
    // 0으로 나누면 선이 NaN 이 되어 아무것도 안 그려진다.
    expect(seriesMax([{ obj_hash: 1, times: [], values: [0, 0] }])).toBe(1);
  });

  it('시리즈가 없어도 1이다', () => {
    expect(seriesMax([])).toBe(1);
  });
});

describe('hasAnyValue', () => {
  it('전부 0이면 false', () => {
    // SYN_SENT 는 순간 상태라 288슬롯이 전부 0으로 온다. 고장이 아니다.
    expect(hasAnyValue([{ obj_hash: 1, times: [], values: [0, 0, 0] }])).toBe(false);
  });

  it('하나라도 0이 아니면 true', () => {
    expect(hasAnyValue([{ obj_hash: 1, times: [], values: [0, 0.5] }])).toBe(true);
  });
});
