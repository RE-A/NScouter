import { describe, expect, it } from 'vitest';
import type { CounterSeries } from '../xlog/api/scouterApi';
import { NEAR_ENOUGH_MS, sameTimeYesterday, yesterdayValue } from './yesterday';

const at = (h: number, m: number, day = 6) => new Date(2026, 8, day, h, m).getTime();

const series = (obj_hash: number, points: [number, number][]): CounterSeries => ({
  obj_hash,
  times: points.map(p => p[0]),
  values: points.map(p => p[1]),
});

describe('sameTimeYesterday', () => {
  it('달력으로 하루를 물린다', () => {
    // 밀리초로 빼면 서머타임이 있는 곳에서 한 시간씩 어긋난다.
    const d = new Date(sameTimeYesterday(at(20, 5)));
    expect(d.getDate()).toBe(5);
    expect(d.getHours()).toBe(20);
    expect(d.getMinutes()).toBe(5);
  });

  it('월이 바뀌어도 맞는다', () => {
    const d = new Date(sameTimeYesterday(new Date(2026, 8, 1, 10, 0).getTime()));
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(31);
  });
});

describe('yesterdayValue', () => {
  const picked = new Set([11, 22]);
  const target = at(20, 5, 5);

  it('그 시각에 가장 가까운 버킷을 쓴다', () => {
    const s = [series(11, [[at(20, 0, 5), 10], [at(20, 5, 5), 20], [at(20, 10, 5), 30]])];
    expect(yesterdayValue(s, picked, 'TPS', target)).toBe(20);
  });

  it('지금과 같은 방식으로 접는다', () => {
    // 지금은 합계인데 어제는 평균이면 두 수를 견주는 것이 아무 뜻이 없다.
    const s = [
      series(11, [[at(20, 5, 5), 10]]),
      series(22, [[at(20, 5, 5), 20]]),
    ];
    expect(yesterdayValue(s, picked, 'TPS', target)).toBe(30);
    // 응답시간은 더하지 않는다.
    expect(yesterdayValue(s, picked, 'ElapsedTime', target)).toBe(15);
  });

  it('고른 서버만 센다', () => {
    const s = [
      series(11, [[at(20, 5, 5), 10]]),
      series(99, [[at(20, 5, 5), 999]]),
    ];
    expect(yesterdayValue(s, picked, 'TPS', target)).toBe(10);
  });

  it('너무 멀리 있는 버킷은 «같은 시각» 이 아니다', () => {
    // 트래픽이 없던 시간대의 엉뚱한 값을 «어제 이 시각» 이라고 적으면 안 된다.
    const far = target + NEAR_ENOUGH_MS + 1;
    expect(yesterdayValue([series(11, [[far, 10]])], picked, 'TPS', target)).toBeNull();
  });

  it('경계까지는 인정한다', () => {
    const edge = target + NEAR_ENOUGH_MS;
    expect(yesterdayValue([series(11, [[edge, 10]])], picked, 'TPS', target)).toBe(10);
  });

  it('어제 것이 없으면 0이 아니라 null 이다', () => {
    // 0을 적으면 «어제는 놀았다» 로 읽힌다.
    expect(yesterdayValue([], picked, 'TPS', target)).toBeNull();
    expect(yesterdayValue([series(11, [])], picked, 'TPS', target)).toBeNull();
  });

  it('못 쓸 수는 세지 않는다', () => {
    const s = [series(11, [[at(20, 5, 5), NaN]]), series(22, [[at(20, 5, 5), 20]])];
    expect(yesterdayValue(s, picked, 'TPS', target)).toBe(20);
  });
});
