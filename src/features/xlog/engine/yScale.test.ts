// Y축 눈금의 계약
//
// 이 화면에서 찾는 것은 대개 «튀는 것 하나»(타임아웃·행)다.
// 축이 그것보다 낮으면 **한 점도 안 보인다** — 현장에서 30초짜리가 그랬다.

import { describe, expect, it } from 'vitest';
import { clampToCeiling, niceCeil, stepYMax } from './yScale';

describe('niceCeil', () => {
  it('보기 좋은 수로 올린다', () => {
    expect(niceCeil(0.7)).toBe(1);
    expect(niceCeil(4)).toBe(5);
    expect(niceCeil(9)).toBe(9);
    expect(niceCeil(9.1)).toBe(10);
    expect(niceCeil(31)).toBe(45);
  });

  it('목록 밖은 자릿수에서 올린다', () => {
    // 축 라벨이 7.3·14.6 처럼 나오면 읽는 데 품이 든다.
    expect(niceCeil(1_700)).toBe(2_000);
    expect(niceCeil(12_345)).toBe(20_000);
  });

  it('0 이나 음수는 가장 작은 눈금으로', () => {
    expect(niceCeil(0)).toBe(0.1);
    expect(niceCeil(-5)).toBe(0.1);
  });
});

describe('clampToCeiling', () => {
  it('축보다 큰 값은 천장에 붙는다', () => {
    // 예전에는 그림 밖이라 렌더러가 건너뛰었고, 30초짜리가 한 점도 안 보였다.
    expect(clampToCeiling(30, 9)).toEqual({ value: 9, over: true });
  });

  it('축 안이면 그대로 둔다', () => {
    expect(clampToCeiling(3, 9)).toEqual({ value: 3, over: false });
    // 딱 맞는 값은 넘친 것이 아니다 — 축선 위에 정확히 앉는다
    expect(clampToCeiling(9, 9)).toEqual({ value: 9, over: false });
  });

  it('0 과 음수도 그대로 — 축을 건드리지 않는다', () => {
    expect(clampToCeiling(0, 9)).toEqual({ value: 0, over: false });
  });
});

describe('stepYMax', () => {
  it('눈금 목록을 따라 한 칸씩 움직인다', () => {
    // 곱셈으로 늘리면 9 → 11.7 → 15.2 같은 축이 나온다.
    expect(stepYMax(9, 1)).toBe(10);
    expect(stepYMax(9, -1)).toBe(5);
    expect(stepYMax(30, 1)).toBe(45);
  });

  it('양 끝에서는 더 안 간다', () => {
    expect(stepYMax(0.1, -1)).toBe(0.1);
    expect(stepYMax(600, 1)).toBe(600);
  });

  it('목록 밖 값은 배로 움직인다', () => {
    expect(stepYMax(5000, 1)).toBe(10000);
    expect(stepYMax(5000, -1)).toBe(2500);
  });
});
