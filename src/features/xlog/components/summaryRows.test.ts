import { describe, expect, it } from 'vitest';
import { ipFromInt, sortSummary, withAverage } from './summaryRows';
import type { SummaryRow } from '../types/summary';

const row = (over: Partial<SummaryRow>): SummaryRow => ({
  id: 1, count: 10, error: 0, elapsed: 1000, cpu: null, mem: null, ...over,
});

describe('withAverage', () => {
  it('합계를 횟수로 나눈다', () => {
    expect(withAverage([row({ count: 4, elapsed: 1000 })])[0].avg).toBe(250);
  });

  it('elapsed 가 없는 종류는 평균도 없다', () => {
    // IP·UA 요약. 0 으로 두면 "0ms 걸렸다" 가 된다.
    expect(withAverage([row({ elapsed: null })])[0].avg).toBeNull();
  });

  it('횟수가 0이면 나누지 않는다', () => {
    // Infinity 가 표에 들어가면 정렬이 망가지고 맨 위를 차지한다.
    expect(withAverage([row({ count: 0, elapsed: 500 })])[0].avg).toBeNull();
  });
});

describe('sortSummary', () => {
  const rows = withAverage([
    row({ id: 1, count: 100, elapsed: 1000 }),  // avg 10
    row({ id: 2, count: 2, elapsed: 4000 }),    // avg 2000
    row({ id: 3, count: 50, elapsed: 2000 }),   // avg 40
  ]);

  it('합계 기준은 시간을 어디서 썼는지 답한다', () => {
    expect(sortSummary(rows, 'sum').map(r => r.id)).toEqual([2, 3, 1]);
  });

  it('횟수 기준은 무엇이 많이 불렸는지 답한다', () => {
    expect(sortSummary(rows, 'count').map(r => r.id)).toEqual([1, 3, 2]);
  });

  it('평균 기준은 한 방이 비싼 것을 찾는다', () => {
    expect(sortSummary(rows, 'avg').map(r => r.id)).toEqual([2, 3, 1]);
  });

  it('값이 없는 행은 뒤로 보낸다', () => {
    const mixed = withAverage([row({ id: 1, elapsed: null }), row({ id: 2, elapsed: 5 })]);
    expect(sortSummary(mixed, 'sum').map(r => r.id)).toEqual([2, 1]);
  });

  it('원본을 건드리지 않는다', () => {
    const before = rows.map(r => r.id);
    sortSummary(rows, 'count');
    expect(rows.map(r => r.id)).toEqual(before);
  });
});

describe('ipFromInt', () => {
  it('실측값을 그대로 되돌린다', () => {
    // probe_summary_commands 에서 나온 값이다.
    expect(ipFromInt(173605394)).toBe('10.89.2.18');
    expect(ipFromInt(173605388)).toBe('10.89.2.12');
  });

  it('최상위 비트가 켜진 주소도 음수로 깨지지 않는다', () => {
    // -1062731519 을 부호 없이 읽으면 3232235777 = 192.168.1.1 이다.
    expect(ipFromInt(-1062731519)).toBe('192.168.1.1');
  });
});
