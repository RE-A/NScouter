// src/features/xlog/engine/PointMap.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { PointMap } from './PointMap';

describe('PointMap', () => {
  let map: PointMap;

  beforeEach(() => {
    map = new PointMap(100, 100);
  });

  it('초기 상태: has() → false', () => {
    expect(map.has(50, 50)).toBe(false);
  });

  it('set 후 has: 마킹된 좌표 → true', () => {
    map.set(50, 50, 1);
    expect(map.has(50, 50)).toBe(true);
  });

  it('set dotSize=3: 중심 ±1 픽셀 범위 마킹', () => {
    map.set(50, 50, 3);
    // half = floor(3/2) = 1
    // x0=49, y0=49 → 마킹: (49,49)~(51,51)
    expect(map.has(49, 49)).toBe(true);
    expect(map.has(50, 50)).toBe(true);
    expect(map.has(51, 51)).toBe(true);
    // 범위 밖
    expect(map.has(48, 50)).toBe(false);
    expect(map.has(52, 50)).toBe(false);
  });

  it('set dotSize=1: 정확히 1픽셀만 마킹', () => {
    map.set(30, 40, 1);
    expect(map.has(30, 40)).toBe(true);
    expect(map.has(31, 40)).toBe(false);
    expect(map.has(29, 40)).toBe(false);
  });

  it('clear 후 has: 모든 좌표 → false', () => {
    map.set(50, 50, 3);
    map.clear();
    expect(map.has(50, 50)).toBe(false);
    expect(map.has(49, 49)).toBe(false);
  });

  it('경계 밖 좌표: has() → false', () => {
    expect(map.has(-1, 50)).toBe(false);
    expect(map.has(100, 50)).toBe(false);
    expect(map.has(50, -1)).toBe(false);
    expect(map.has(50, 100)).toBe(false);
  });

  it('경계 안쪽 최대 좌표: has() 가능', () => {
    map.set(99, 99, 1);
    expect(map.has(99, 99)).toBe(true);
  });

  it('queryRect: 마킹된 픽셀 반환', () => {
    map.set(50, 50, 1);
    const result = map.queryRect(48, 48, 52, 52);
    expect(result.some(p => p.x === 50 && p.y === 50)).toBe(true);
  });

  it('queryRect: 마킹 없는 범위 → 빈 배열', () => {
    const result = map.queryRect(10, 10, 20, 20);
    expect(result).toHaveLength(0);
  });

  it('resize 후 기존 마킹 초기화됨', () => {
    map.set(50, 50, 3);
    map.resize(200, 200);
    expect(map.has(50, 50)).toBe(false);
  });

  it('resize 후 새 크기에서 set/has 가능', () => {
    map.resize(200, 200);
    map.set(150, 150, 1);
    expect(map.has(150, 150)).toBe(true);
  });
});
