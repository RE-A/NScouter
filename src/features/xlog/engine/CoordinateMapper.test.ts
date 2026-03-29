// src/features/xlog/engine/CoordinateMapper.test.ts

import { describe, it, expect } from 'vitest';
import { CoordinateMapper } from './CoordinateMapper';
import { buildLayout, DEFAULT_CHART_CONFIG } from '../types/xlog';

const layout = buildLayout(800, 600);
const config = { ...DEFAULT_CHART_CONFIG, timeRangeMs: 60_000, yMax: 9 };
const now = 1_000_000;

describe('CoordinateMapper', () => {
  it('timeToX: startTime → plotAreaX', () => {
    const mapper = new CoordinateMapper(layout, config, now);
    const x = mapper.timeToX(mapper.getStartTime());
    expect(x).toBeCloseTo(layout.plotAreaX, 1);
  });

  it('timeToX: endTime → plotAreaX + plotAreaWidth', () => {
    const mapper = new CoordinateMapper(layout, config, now);
    const x = mapper.timeToX(mapper.getEndTime());
    expect(x).toBeCloseTo(layout.plotAreaX + layout.plotAreaWidth, 1);
  });

  it('valueToY: yMax → plotAreaY (상단)', () => {
    const mapper = new CoordinateMapper(layout, config, now);
    const y = mapper.valueToY(config.yMax);
    expect(y).toBeCloseTo(layout.plotAreaY, 1);
  });

  it('valueToY: 0 → plotAreaY + plotAreaHeight (하단)', () => {
    const mapper = new CoordinateMapper(layout, config, now);
    const y = mapper.valueToY(0);
    expect(y).toBeCloseTo(layout.plotAreaY + layout.plotAreaHeight, 1);
  });

  it('dataToPixel → pixelToData 라운드트립', () => {
    const mapper = new CoordinateMapper(layout, config, now);
    const time = now - 30_000;
    const value = 4.5;
    const { x, y } = mapper.dataToPixel(time, value);
    const { time: t2, value: v2 } = mapper.pixelToData(x, y);
    expect(t2).toBeCloseTo(time, 0);
    expect(v2).toBeCloseTo(value, 1);
  });

  it('isInPlotArea: 플롯 영역 중앙 → true', () => {
    const mapper = new CoordinateMapper(layout, config, now);
    const cx = layout.plotAreaX + layout.plotAreaWidth / 2;
    const cy = layout.plotAreaY + layout.plotAreaHeight / 2;
    expect(mapper.isInPlotArea(cx, cy)).toBe(true);
  });

  it('isInPlotArea: 패딩 영역 (0,0) → false', () => {
    const mapper = new CoordinateMapper(layout, config, now);
    expect(mapper.isInPlotArea(0, 0)).toBe(false);
  });

  it('getStartTime: now - timeRangeMs', () => {
    const mapper = new CoordinateMapper(layout, config, now);
    expect(mapper.getStartTime()).toBe(now - config.timeRangeMs);
  });

  it('getEndTime: now', () => {
    const mapper = new CoordinateMapper(layout, config, now);
    expect(mapper.getEndTime()).toBe(now);
  });
});
