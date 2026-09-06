import { describe, expect, it } from 'vitest';
import {
  hhmm,
  maxOf,
  nearestIndex,
  niceMax,
  rowLayout,
  timeTicks,
  timeToX,
  valueToY,
  xToTime,
  type Range,
} from './timelineScale';

const R: Range = { stime: 1_000, etime: 2_000 };

describe('rowLayout', () => {
  it('세로를 고르게 나눈다', () => {
    expect(rowLayout(2, 10, 100)).toEqual([
      { y: 10, height: 50 },
      { y: 60, height: 50 },
    ]);
  });

  it('줄 사이를 띄우지 않는다', () => {
    // 붙여 놓아야 같은 x 를 눈으로 따라 내려갈 수 있다.
    const rows = rowLayout(3, 0, 90);
    expect(rows[0].y + rows[0].height).toBe(rows[1].y);
    expect(rows[1].y + rows[1].height).toBe(rows[2].y);
  });

  it('줄이 없거나 자리가 없으면 빈 배열', () => {
    expect(rowLayout(0, 0, 100)).toEqual([]);
    expect(rowLayout(3, 0, 0)).toEqual([]);
  });
});

describe('timeToX · xToTime', () => {
  it('구간 시작이 왼쪽 끝이다', () => {
    expect(timeToX(1_000, R, 50, 200)).toBe(50);
  });

  it('구간 끝이 오른쪽 끝이다', () => {
    expect(timeToX(2_000, R, 50, 200)).toBe(250);
  });

  it('가운데는 가운데다', () => {
    expect(timeToX(1_500, R, 50, 200)).toBe(150);
  });

  it('되돌리면 같은 시각이다', () => {
    expect(xToTime(timeToX(1_250, R, 50, 200), R, 50, 200)).toBeCloseTo(1_250, 6);
  });

  it('구간이 0이면 왼쪽 끝으로 둔다', () => {
    // 나누면 무한대가 나와 캔버스가 통째로 안 그려진다.
    expect(timeToX(999, { stime: 5, etime: 5 }, 7, 100)).toBe(7);
  });
});

describe('valueToY', () => {
  const row = { y: 0, height: 100 };

  it('0 은 바닥이다', () => {
    // 최솟값을 바닥으로 잡으면 40~42 를 오가는 CPU 가 화면 가득 출렁인다.
    expect(valueToY(0, 50, row, 5)).toBe(95);
  });

  it('최댓값은 꼭대기다', () => {
    expect(valueToY(50, 50, row, 5)).toBe(5);
  });

  it('축 위로 넘는 값은 꼭대기에 붙인다', () => {
    // 캔버스 밖으로 나가면 옆 줄 위에 선이 그려진다.
    expect(valueToY(999, 50, row, 5)).toBe(5);
  });

  it('음수는 바닥에 붙인다', () => {
    expect(valueToY(-3, 50, row, 5)).toBe(95);
  });

  it('자리가 없으면 바닥이다', () => {
    expect(valueToY(10, 50, { y: 0, height: 4 }, 5)).toBe(-1);
  });
});

describe('niceMax', () => {
  it('1·2·5 계단으로 올린다', () => {
    expect(niceMax(23)).toBe(50);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(1.4)).toBe(2);
    expect(niceMax(120)).toBe(200);
    expect(niceMax(0.03)).toBe(0.05);
  });

  it('값이 계단에 딱 맞으면 그대로다', () => {
    // 20 을 50 으로 올리면 선이 화면 아래쪽 절반에만 남는다.
    expect(niceMax(20)).toBe(20);
    expect(niceMax(100)).toBe(100);
  });

  it('0 이하나 못 쓸 수는 1 로 둔다', () => {
    // 0 으로 나누면 선이 통째로 사라진다.
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
    expect(niceMax(NaN)).toBe(1);
  });
});

describe('maxOf', () => {
  it('여러 줄에 걸친 최댓값이다', () => {
    expect(maxOf([{ values: [1, 9] }, { values: [4, 7] }])).toBe(9);
  });

  it('값이 없으면 0', () => {
    expect(maxOf([])).toBe(0);
    expect(maxOf([{ values: [] }])).toBe(0);
  });

  it('못 쓸 수는 세지 않는다', () => {
    expect(maxOf([{ values: [1, NaN, Infinity, 3] }])).toBe(3);
  });
});

describe('timeTicks', () => {
  const t = (h: number, m: number) => new Date(2026, 8, 6, h, m, 0, 0).getTime();

  it('시계에서 읽는 간격에 선다', () => {
    // 개수를 맞추면 10:03·10:18 처럼 어중간한 시각에 서서 읽는 데 계산이 필요하다.
    const ticks = timeTicks({ stime: t(10, 3), etime: t(11, 3) }, 600);
    expect(ticks.length).toBeGreaterThan(1);

    const step = ticks[1] - ticks[0];
    // 사람이 시계에서 읽는 간격만 쓴다.
    expect([1, 2, 5, 10, 15, 30, 60].map(m => m * 60_000)).toContain(step);
    for (const x of ticks) {
      expect(new Date(x).getSeconds()).toBe(0);
      // 그 간격의 **배수 자리**에 선다 — 구간 시작에서 세면 10:03 부터 시작한다.
      expect(x % step).toBe(0);
    }
  });

  it('구간 안에만 선다', () => {
    const range = { stime: t(10, 3), etime: t(11, 3) };
    for (const x of timeTicks(range, 600)) {
      expect(x).toBeGreaterThanOrEqual(range.stime);
      expect(x).toBeLessThanOrEqual(range.etime);
    }
  });

  it('폭이 좁으면 눈금을 덜 놓는다', () => {
    // 글자가 겹치면 아무것도 못 읽는다.
    const range = { stime: t(10, 0), etime: t(11, 0) };
    expect(timeTicks(range, 200).length).toBeLessThan(timeTicks(range, 900).length);
  });

  it('구간이 길면 시간 단위로 넘어간다', () => {
    const range = { stime: t(0, 0), etime: t(12, 0) };
    const ticks = timeTicks(range, 600);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks[1] - ticks[0]).toBeGreaterThanOrEqual(3_600_000);
  });

  it('구간이나 폭이 없으면 빈 배열', () => {
    expect(timeTicks({ stime: 5, etime: 5 }, 600)).toEqual([]);
    expect(timeTicks({ stime: 0, etime: 1000 }, 0)).toEqual([]);
  });
});

describe('nearestIndex', () => {
  const times = [100, 200, 300, 400];

  it('딱 맞는 자리를 찾는다', () => {
    expect(nearestIndex(times, 300)).toBe(2);
  });

  it('사이에서는 가까운 쪽이다', () => {
    // 이전 것만 고르면 표본 사이에서 크로스헤어가 늘 왼쪽으로 끌린다.
    expect(nearestIndex(times, 260)).toBe(2);
    expect(nearestIndex(times, 240)).toBe(1);
  });

  it('한가운데면 앞쪽이다', () => {
    expect(nearestIndex(times, 250)).toBe(1);
  });

  it('구간 밖은 끝에 붙인다', () => {
    expect(nearestIndex(times, 0)).toBe(0);
    expect(nearestIndex(times, 9999)).toBe(3);
  });

  it('표본이 없으면 -1', () => {
    expect(nearestIndex([], 100)).toBe(-1);
  });

  it('표본이 하나면 그것이다', () => {
    expect(nearestIndex([500], 100)).toBe(0);
  });
});

describe('hhmm', () => {
  it('두 자리로 적는다', () => {
    expect(hhmm(new Date(2026, 8, 6, 9, 5).getTime())).toBe('09:05');
    expect(hhmm(new Date(2026, 8, 6, 23, 59).getTime())).toBe('23:59');
  });
});
