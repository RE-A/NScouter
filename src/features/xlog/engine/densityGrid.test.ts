// 밀집 구간의 자
//
// 여기서 지키려는 것:
//   · 격자 밖을 칠하지 않는다 — 축 라벨 위에 열이 번지면 그림이 아니라 얼룩이다
//   · 로그로 누른다 — 선형이면 몰린 칸 하나만 하얗고 나머지는 안 보인다
//   · 한가한 시간대에도 말을 한다 — 절대 기준을 쓰면 그때는 통째로 침묵한다

import { describe, expect, it } from 'vitest';
import { CELL_PX, MIN_COUNT, cellIndex, densityAlpha, gridSize, peakOf } from './densityGrid';

describe('gridSize', () => {
  it('남는 픽셀도 한 칸을 갖는다', () => {
    // 버리면 오른쪽·아래 끝이 영영 안 칠해진다.
    expect(gridSize(CELL_PX * 10, CELL_PX * 5)).toEqual({ cols: 10, rows: 5 });
    expect(gridSize(CELL_PX * 10 + 1, CELL_PX * 5 + 1)).toEqual({ cols: 11, rows: 6 });
  });

  it('접힌 패널에서도 터지지 않는다', () => {
    expect(gridSize(0, 0)).toEqual({ cols: 0, rows: 0 });
    expect(gridSize(-5, -5)).toEqual({ cols: 0, rows: 0 });
  });
});

describe('cellIndex', () => {
  it('플롯 원점을 빼고 센다', () => {
    // 캔버스 좌표를 그대로 나누면 칸이 축 라벨 쪽으로 밀린다.
    expect(cellIndex(60, 20, 60, 20, 10, 10)).toBe(0);
    expect(cellIndex(60 + CELL_PX, 20, 60, 20, 10, 10)).toBe(1);
    expect(cellIndex(60, 20 + CELL_PX, 60, 20, 10, 10)).toBe(10);
  });

  it('격자 밖은 -1 이다', () => {
    // 축 라벨 위에 열이 번지면 그림이 아니라 얼룩이다.
    expect(cellIndex(59, 20, 60, 20, 10, 10)).toBe(-1);
    expect(cellIndex(60, 19, 60, 20, 10, 10)).toBe(-1);
    expect(cellIndex(60 + CELL_PX * 10, 20, 60, 20, 10, 10)).toBe(-1);
    expect(cellIndex(60, 20 + CELL_PX * 10, 60, 20, 10, 10)).toBe(-1);
  });
});

describe('densityAlpha', () => {
  it('둘까지는 칠하지 않는다', () => {
    // 둘이 겹친 것은 어디에나 있다. 그것까지 칠하면 화면 전체가 옅게 밝아진다.
    expect(densityAlpha(1, 100)).toBe(0);
    expect(densityAlpha(MIN_COUNT - 1, 100)).toBe(0);
    expect(densityAlpha(MIN_COUNT, 100)).toBeGreaterThanOrEqual(0);
  });

  it('가장 붐빈 칸이 가장 진하다', () => {
    expect(densityAlpha(1_000, 1_000)).toBeGreaterThan(densityAlpha(10, 1_000));
  });

  it('로그로 누른다 — 적은 칸도 보인다', () => {
    // 선형이면 3,000건짜리 옆에서 10건짜리는 알파가 0.003 이라 안 보인다.
    const small = densityAlpha(10, 3_000);
    expect(small).toBeGreaterThan(0.05);
  });

  it('점을 덮을 만큼 진해지지 않는다', () => {
    // 이 보기의 목적은 «어디에 몰렸나» 지 점을 지우는 것이 아니다.
    expect(densityAlpha(1_000_000, 1_000_000)).toBeLessThanOrEqual(0.45);
  });

  it('한가한 시간대에도 말을 한다', () => {
    // 절대 기준을 쓰면 최대가 5건인 화면에서는 아무 칸도 안 밝아진다.
    expect(densityAlpha(5, 5)).toBeGreaterThan(0);
  });

  it('셀 것이 없으면 0 이다', () => {
    expect(densityAlpha(0, 0)).toBe(0);
    expect(densityAlpha(2, 2)).toBe(0);
  });
});

describe('peakOf', () => {
  it('가장 붐빈 칸을 찾는다', () => {
    expect(peakOf(Int32Array.from([0, 3, 91, 7]))).toBe(91);
  });

  it('빈 격자는 0 이다', () => {
    expect(peakOf(new Int32Array(0))).toBe(0);
  });
});
