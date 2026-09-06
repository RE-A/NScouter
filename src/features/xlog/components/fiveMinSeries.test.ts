import { describe, expect, it } from 'vitest';
import { hasAnyValue, seriesMax, SLOT_MS, trimAll, trimFuture, type TrimmedSeries } from './fiveMinSeries';
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

describe('값이 없는 슬롯 (null)', () => {
  // 콜렉터는 하루 288칸을 늘 채워 보내고 **수집이 없던 시각은 null 로** 준다
  // (실측: 288칸 중 값 있는 것 17칸). 0 으로 읽으면 «그때 0 이었다» 가 되는데,
  // 그건 에이전트가 안 붙어 있던 것과 전혀 다른 말이다.
  const s = (values: (number | null)[]): TrimmedSeries => ({
    obj_hash: 11,
    times: values.map((_, i) => i * SLOT_MS),
    values,
  });

  it('축 상한을 셀 때 null 은 빼놓는다', () => {
    expect(seriesMax([s([null, 7, null])])).toBe(7);
  });

  it('전부 null 이면 상한은 1 이다', () => {
    // 0 으로 나누면 선이 NaN 이 되어 아무것도 안 그려진다.
    expect(seriesMax([s([null, null])])).toBe(1);
  });

  it('null 뿐이면 «그릴 값이 있다» 가 아니다', () => {
    expect(hasAnyValue([s([null, null])])).toBe(false);
  });

  it('null 사이에 값이 하나라도 있으면 그릴 값이 있다', () => {
    expect(hasAnyValue([s([null, 3, null])])).toBe(true);
  });

  it('0 만 있는 것과 null 만 있는 것을 똑같이 «없음» 으로 본다', () => {
    // 둘 다 그릴 것이 없다 — 다만 뜻이 다르므로 값 자체는 섞지 않는다.
    expect(hasAnyValue([s([0, 0])])).toBe(false);
  });

  it('미래 슬롯을 자를 때 null 자리도 그대로 옮긴다', () => {
    // 여기서 0 으로 메우면 없던 골짜기가 생긴다.
    const trimmed = trimFuture(
      { obj_hash: 11, times: [0, SLOT_MS, 2 * SLOT_MS], values: [1, null, 3] },
      2 * SLOT_MS,
    );
    expect(trimmed.values).toEqual([1, null, 3]);
  });
});
