// src/features/xlog/engine/GridCalculator.test.ts

import { describe, it, expect } from 'vitest';
import { GridCalculator } from './GridCalculator';

describe('GridCalculator.calcNiceInterval', () => {
  it('range=0 → 1 반환 (방어 코드)', () => {
    expect(GridCalculator.calcNiceInterval(0, 5)).toBe(1);
  });

  it('desiredTicks=0 → 1 반환 (방어 코드)', () => {
    expect(GridCalculator.calcNiceInterval(10_000, 0)).toBe(1);
  });

  it('range=10000, ticks=5 → 2000', () => {
    // rawInterval=2000, magnitude=1000, normalized=2 → nice=2 → 2000
    expect(GridCalculator.calcNiceInterval(10_000, 5)).toBe(2000);
  });

  it('range=300000, ticks=6 → 50000', () => {
    // rawInterval=50000, magnitude=10000, normalized=5 → nice=5 → 50000
    expect(GridCalculator.calcNiceInterval(300_000, 6)).toBe(50_000);
  });

  it('range=9, ticks=5 → 2', () => {
    // rawInterval=1.8, magnitude=1, normalized=1.8 → nice=2 → 2
    expect(GridCalculator.calcNiceInterval(9, 5)).toBe(2);
  });
});

describe('GridCalculator.calcTimeGrid', () => {
  it('그리드 라인 1개 이상 생성됨', () => {
    const { lines } = GridCalculator.calcTimeGrid(0, 300_000, 700);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('그리드 라인이 startTime~endTime 범위 내에만 존재', () => {
    const start = 1_000_000;
    const end = 1_300_000;
    const { lines } = GridCalculator.calcTimeGrid(start, end, 700);
    for (const line of lines) {
      expect(line.value).toBeGreaterThanOrEqual(start);
      expect(line.value).toBeLessThanOrEqual(end);
    }
  });

  it('interval > 0', () => {
    const { interval } = GridCalculator.calcTimeGrid(0, 300_000, 700);
    expect(interval).toBeGreaterThan(0);
  });

  it('각 라인에 label이 존재', () => {
    const { lines } = GridCalculator.calcTimeGrid(0, 300_000, 700);
    for (const line of lines) {
      expect(typeof line.label).toBe('string');
      expect(line.label.length).toBeGreaterThan(0);
    }
  });
});

describe('GridCalculator.calcValueGrid', () => {
  it('그리드 라인 1개 이상 생성됨', () => {
    const { lines } = GridCalculator.calcValueGrid(0, 9, 500);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('Y축 라인 position은 0~plotHeight 범위', () => {
    const plotHeight = 500;
    const { lines } = GridCalculator.calcValueGrid(0, 9, plotHeight);
    for (const line of lines) {
      expect(line.position).toBeGreaterThanOrEqual(0);
      expect(line.position).toBeLessThanOrEqual(plotHeight);
    }
  });

  it('라벨이 겹치지 않는다 — 간격이 정하는 자리까지 적는다', () => {
    // Y최대 1초일 때 간격이 0.05초다. 소수 한 자리로 적으면 «1.0 · 1.0 · 0.9 · 0.9» 가 되어
    // 어느 줄이 무슨 값인지 못 읽는다 (화면에서 실제로 그랬다).
    const { lines } = GridCalculator.calcValueGrid(0, 1, 1000);
    const labels = lines.map(l => l.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('간격이 1 이상이면 소수점을 붙이지 않는다', () => {
    const { lines } = GridCalculator.calcValueGrid(0, 9, 500);
    expect(lines.every(l => !l.label.includes('.'))).toBe(true);
  });

  it('value=0이면 position이 plotHeight에 가까움 (Y반전)', () => {
    const { lines } = GridCalculator.calcValueGrid(0, 9, 500);
    const zeroLine = lines.find(l => l.value === 0);
    if (zeroLine) {
      expect(zeroLine.position).toBeCloseTo(500, 0);
    }
  });
});
