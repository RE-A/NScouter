import { describe, expect, it } from 'vitest';
import { sortGroups, toStats } from './serviceGroup';
import type { ServiceGroupRow } from '../api/scouterApi';

const row = (over: Partial<ServiceGroupRow>): ServiceGroupRow => ({
  name: '/shop', count: 450, elapsed: 12, error: 0, ...over,
});

describe('toStats', () => {
  it('소수점 응답시간을 잃지 않는다', () => {
    // 콜렉터가 elapsed 를 Float 으로 준다 (F-44). 0.57ms 를 0으로 뭉개면
    // "응답 0ms" 라는 있을 수 없는 값이 표에 찍힌다.
    expect(toStats([row({ elapsed: 0.5652174 })])[0].elapsed).toBeCloseTo(0.5652174, 6);
  });

  it('30초 누적을 TPS 로 바꾼다', () => {
    // 그대로 TPS 라고 그리면 30배 부풀려진다.
    expect(toStats([row({ count: 450 })])[0].tps).toBeCloseTo(15, 5);
  });

  it('에러율은 그 그룹 안에서 센다', () => {
    expect(toStats([row({ count: 200, error: 4 })])[0].errorRate).toBeCloseTo(2, 5);
  });

  it('호출이 0이면 에러율은 0이다', () => {
    // 0으로 나눠 NaN 이 되면 표에 NaN% 가 그대로 찍힌다.
    expect(toStats([row({ count: 0, error: 0 })])[0].errorRate).toBe(0);
  });

  it('비중은 전체 호출 대비다', () => {
    const s = toStats([row({ name: '/shop', count: 75 }), row({ name: '/order', count: 25 })]);
    expect(s[0].share).toBeCloseTo(75, 5);
    expect(s[1].share).toBeCloseTo(25, 5);
  });

  it('빈 응답은 빈 표다', () => {
    expect(toStats([])).toEqual([]);
  });
});

describe('sortGroups', () => {
  it('호출이 많은 순이다', () => {
    const s = sortGroups(toStats([row({ name: '/a', count: 10 }), row({ name: '/b', count: 90 })]));
    expect(s.map(g => g.name)).toEqual(['/b', '/a']);
  });

  it('에러가 있는 그룹은 건수가 적어도 앞으로 온다', () => {
    // 목록이 길어지면 정작 봐야 할 그룹이 스크롤 밖으로 나간다.
    const s = sortGroups(toStats([
      row({ name: '/big', count: 900, error: 0 }),
      row({ name: '/broken', count: 3, error: 3 }),
    ]));
    expect(s[0].name).toBe('/broken');
  });

  it('원본을 건드리지 않는다', () => {
    const stats = toStats([row({ name: '/a', count: 1 }), row({ name: '/b', count: 2 })]);
    const before = stats.map(g => g.name);
    sortGroups(stats);
    expect(stats.map(g => g.name)).toEqual(before);
  });
});
