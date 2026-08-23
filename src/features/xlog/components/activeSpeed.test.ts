// 액티브 서비스 막대 / 오늘 누적 스파크라인 (순수 로직)

import { describe, it, expect } from 'vitest';
import { barFillPct, eqMaxValue, speedSegments, speedTotal, todayTotal, worstStep } from './activeSpeed';
import { sparklinePoints } from './sparkline';

const speed = (act1: number, act2: number, act3: number) => ({
  obj_hash: 1,
  act1,
  act2,
  act3,
  tps: 0,
});

describe('speedTotal', () => {
  it('세 단계를 더한다', () => {
    expect(speedTotal(speed(2, 3, 1))).toBe(6);
  });
});

describe('worstStep', () => {
  it('가장 느린 단계가 있으면 그것이다', () => {
    // 총 10건이어도 전부 3초 이상이면 장애다. 합계로는 안 보인다.
    expect(worstStep(speed(9, 0, 1))).toBe(3);
  });

  it('3초 이상이 없으면 1~3초다', () => {
    expect(worstStep(speed(9, 1, 0))).toBe(2);
  });

  it('빠른 것만 있으면 1이다', () => {
    expect(worstStep(speed(9, 0, 0))).toBe(1);
  });

  it('아무것도 없으면 0이다', () => {
    expect(worstStep(speed(0, 0, 0))).toBe(0);
  });
});

describe('speedSegments', () => {
  it('0인 단계는 막대에서 뺀다', () => {
    const segs = speedSegments(speed(3, 0, 1));
    expect(segs.map(s => s.step)).toEqual([1, 3]);
  });

  it('비율을 낸다', () => {
    const segs = speedSegments(speed(3, 1, 0));
    expect(segs[0].pct).toBeCloseTo(75);
    expect(segs[1].pct).toBeCloseTo(25);
  });

  it('1건뿐인 느린 단계도 보이게 남긴다', () => {
    // 99:1 이면 act3 이 1% 라 사실상 안 보인다. 그런데 그게 봐야 할 것이다.
    const segs = speedSegments(speed(99, 0, 1));
    const act3 = segs.find(s => s.step === 3)!;
    expect(act3.pct).toBeGreaterThanOrEqual(6);
  });

  it('비율의 합은 100이다', () => {
    // 최소 폭을 준 뒤에도 합이 넘치면 막대가 삐져나온다.
    const segs = speedSegments(speed(99, 1, 1));
    const sum = segs.reduce((a, s) => a + s.pct, 0);
    expect(sum).toBeCloseTo(100);
  });

  it('아무것도 없으면 빈 막대다', () => {
    expect(speedSegments(speed(0, 0, 0))).toEqual([]);
  });
});

describe('sparklinePoints', () => {
  it('첫 점은 왼쪽 끝, 마지막 점은 오른쪽 끝이다', () => {
    const pts = sparklinePoints([1, 2, 3], 100, 20);
    expect(pts[0].x).toBe(0);
    expect(pts[2].x).toBe(100);
  });

  it('최댓값이 위, 최솟값이 아래다', () => {
    // y 는 아래로 자라므로 최댓값이 0에 가까워야 한다.
    const pts = sparklinePoints([0, 10], 100, 20);
    expect(pts[1].y).toBe(0);
    expect(pts[0].y).toBe(20);
  });

  it('값이 모두 같으면 가운데 수평선이다', () => {
    // 0으로 나누면 NaN 이 되고 선이 통째로 사라진다.
    const pts = sparklinePoints([5, 5, 5], 100, 20);
    expect(pts.every(p => p.y === 10)).toBe(true);
  });

  it('점이 하나면 왼쪽 끝에 둔다', () => {
    const pts = sparklinePoints([7], 100, 20);
    expect(pts).toHaveLength(1);
    expect(pts[0].x).toBe(0);
  });

  it('빈 값은 빈 점이다', () => {
    expect(sparklinePoints([], 100, 20)).toEqual([]);
  });
});

describe('todayTotal', () => {
  const series = (values: number[]) => ({ obj_hash: 1, times: values.map((_, i) => i), values });

  it('모든 버킷을 더한다', () => {
    // ASIS 도 시간대별로 버킷을 더한다 (CounterTodayCountView).
    expect(todayTotal([series([10, 20, 30])])).toBe(60);
  });

  it('오브젝트가 여럿이면 전부 합친다', () => {
    expect(todayTotal([series([10, 20]), series([1, 2])])).toBe(33);
  });

  it('마지막 버킷이 비어도 총계가 0이 되지 않는다', () => {
    // 진행 중인 5분 버킷은 아직 안 채워져 0으로 온다.
    // 마지막 값을 총계로 쓰면 "오늘 0건" 이 되어 버린다 — 실제로 그랬다.
    expect(todayTotal([series([100, 200, 0])])).toBe(300);
  });

  it('빈 목록은 0이다', () => {
    expect(todayTotal([])).toBe(0);
  });
});

describe('eqMaxValue', () => {
  it('작은 값은 계단으로 올린다', () => {
    // 자가 매 폴링마다 바뀌면 모든 막대가 같이 출렁여 변화를 못 읽는다.
    expect(eqMaxValue(0)).toBe(10);
    expect(eqMaxValue(6)).toBe(10);
    expect(eqMaxValue(7)).toBe(30);
    expect(eqMaxValue(19)).toBe(30);
    expect(eqMaxValue(20)).toBe(60);
    expect(eqMaxValue(39)).toBe(60);
    expect(eqMaxValue(40)).toBe(100);
    expect(eqMaxValue(69)).toBe(100);
    expect(eqMaxValue(70)).toBe(500);
    expect(eqMaxValue(299)).toBe(500);
  });

  it('300 이상은 자릿수를 보고 2·5·10 배로 올린다 (ASIS rounding)', () => {
    expect(eqMaxValue(300)).toBe(500);
    expect(eqMaxValue(1200)).toBe(2000);
    expect(eqMaxValue(6000)).toBe(10000);
  });

  it('상한은 언제나 값보다 크거나 같다', () => {
    // 작으면 막대가 자를 넘어 삐져나온다.
    for (const v of [1, 7, 25, 55, 90, 250, 301, 999, 5000]) {
      expect(eqMaxValue(v)).toBeGreaterThanOrEqual(v);
    }
  });
});

describe('barFillPct', () => {
  it('같은 자로 재면 길이가 양을 뜻한다', () => {
    expect(barFillPct(5, 100)).toBeCloseTo(5, 5);
    expect(barFillPct(50, 100)).toBeCloseTo(50, 5);
  });

  it('0건은 아무것도 그리지 않는다', () => {
    expect(barFillPct(0, 100)).toBe(0);
  });

  it('1건은 사라지지 않는다', () => {
    // 상한 500 이면 0.2% 라 화면에서 없어진다. 없어진 막대는 0건과 구별되지 않는다.
    expect(barFillPct(1, 500)).toBeGreaterThanOrEqual(2);
  });

  it('상한을 넘겨도 삐져나오지 않는다', () => {
    expect(barFillPct(200, 100)).toBe(100);
  });
});
