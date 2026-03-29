// src/features/xlog/engine/CoordinateMapper.ts
// 데이터 좌표 ↔ 캔버스 픽셀 좌표 변환

import type { ChartLayout, XLogChartConfig } from '../types/xlog';
import { Y_AXIS_CONFIGS } from '../types/xlog';
import type { SXLog } from '../types/xlog';

export class CoordinateMapper {
  private readonly layout: ChartLayout;
  private readonly config: XLogChartConfig;
  private readonly startTime: number;
  private readonly endTime: number;

  constructor(layout: ChartLayout, config: XLogChartConfig, now: number) {
    this.layout = layout;
    this.config = config;
    this.endTime = now;
    this.startTime = now - config.timeRangeMs;
  }

  getStartTime(): number {
    return this.startTime;
  }

  getEndTime(): number {
    return this.endTime;
  }

  /** 데이터 좌표 → 캔버스 픽셀 좌표 */
  dataToPixel(time: number, value: number): { x: number; y: number } {
    return {
      x: this.timeToX(time),
      y: this.valueToY(value),
    };
  }

  /** 캔버스 픽셀 좌표 → 데이터 좌표 */
  pixelToData(px: number, py: number): { time: number; value: number } {
    const { plotAreaX, plotAreaY, plotAreaWidth, plotAreaHeight } = this.layout;
    const ratio = (px - plotAreaX) / plotAreaWidth;
    const time = this.startTime + ratio * this.config.timeRangeMs;
    const yRatio = 1 - (py - plotAreaY) / plotAreaHeight;
    const value = yRatio * this.config.yMax;
    return { time, value };
  }

  timeToX(time: number): number {
    const { plotAreaX, plotAreaWidth } = this.layout;
    const ratio = (time - this.startTime) / this.config.timeRangeMs;
    return plotAreaX + ratio * plotAreaWidth;
  }

  valueToY(value: number): number {
    const { plotAreaY, plotAreaHeight } = this.layout;
    const ratio = value / this.config.yMax;
    // Y축 반전: 값이 클수록 위 (작은 px)
    return plotAreaY + plotAreaHeight - ratio * plotAreaHeight;
  }

  extractValue(xlog: SXLog): number {
    return Y_AXIS_CONFIGS[this.config.yAxisMode].valueExtractor(xlog);
  }

  isInPlotArea(px: number, py: number): boolean {
    const { plotAreaX, plotAreaY, plotAreaWidth, plotAreaHeight } = this.layout;
    return (
      px >= plotAreaX &&
      px <= plotAreaX + plotAreaWidth &&
      py >= plotAreaY &&
      py <= plotAreaY + plotAreaHeight
    );
  }
}
