// src/features/xlog/engine/CoordinateMapper.ts
// 데이터 좌표 ↔ 캔버스 픽셀 좌표 변환

import type { ChartLayout, XLogChartConfig } from '../types/xlog';
import { Y_AXIS_CONFIGS } from '../types/xlog';
import type { SXLog } from '../types/xlog';

/**
 * 화면에 그릴 시간 구간.
 *
 * 이전에는 `now` 하나만 받아 `now - timeRangeMs` 로 창을 만들었다.
 * 그래서 **"지금"밖에 그릴 수 없었다** — 과거 구간 조회(LoadTimeXLog / ZoomTime)의
 * 선행 조건이 이 구간을 밖에서 정하는 것이다.
 */
export interface TimeWindow {
  start: number;
  end: number;
}

/** 실시간 모드의 창 — 항상 "지금"에서 뒤로 rangeMs 만큼 */
export function rollingWindow(now: number, rangeMs: number): TimeWindow {
  return { start: now - rangeMs, end: now };
}

export class CoordinateMapper {
  private readonly layout: ChartLayout;
  private readonly config: XLogChartConfig;
  private readonly startTime: number;
  private readonly endTime: number;
  /**
   * 창의 길이. **`config.timeRangeMs` 를 쓰면 안 된다** —
   * 과거 구간은 그 값과 무관한 길이를 가진다.
   */
  private readonly spanMs: number;

  constructor(layout: ChartLayout, config: XLogChartConfig, window: TimeWindow) {
    this.layout = layout;
    this.config = config;
    this.startTime = window.start;
    this.endTime = window.end;
    // 0 이면 0으로 나눈다. 한 점짜리 구간도 그리기는 해야 한다.
    this.spanMs = Math.max(1, window.end - window.start);
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
    const time = this.startTime + ratio * this.spanMs;
    const yRatio = 1 - (py - plotAreaY) / plotAreaHeight;
    const value = yRatio * this.config.yMax;
    return { time, value };
  }

  timeToX(time: number): number {
    const { plotAreaX, plotAreaWidth } = this.layout;
    const ratio = (time - this.startTime) / this.spanMs;
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
