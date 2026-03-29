// src/features/xlog/engine/GridCalculator.ts
// ChartUtil.java 포팅 — "nice number" 그리드 간격 알고리즘

import { formatTime } from '../utils/colorPalette';

export interface GridLine {
  value: number;
  position: number;
  label: string;
}

export interface GridInfo {
  interval: number;
  lines: GridLine[];
}

export class GridCalculator {
  /**
   * "nice number" 알고리즘으로 사람이 읽기 쉬운 간격 계산
   * ASIS: ChartUtil.java calcInterval()
   */
  static calcNiceInterval(range: number, desiredTicks: number): number {
    if (range <= 0 || desiredTicks <= 0) return 1;
    const rawInterval = range / desiredTicks;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
    const normalized = rawInterval / magnitude;

    let nice: number;
    if (normalized <= 1.5) nice = 1;
    else if (normalized <= 3) nice = 2;
    else if (normalized <= 7) nice = 5;
    else nice = 10;

    return nice * magnitude;
  }

  /** X축(시간) 그리드 */
  static calcTimeGrid(
    startTime: number,
    endTime: number,
    plotWidth: number,
  ): GridInfo {
    const rangeMs = endTime - startTime;
    const desiredTicks = Math.max(3, Math.floor(plotWidth / 100));
    const interval = GridCalculator.calcNiceInterval(rangeMs, desiredTicks);

    const lines: GridLine[] = [];
    const firstTick = Math.ceil(startTime / interval) * interval;

    for (let t = firstTick; t <= endTime; t += interval) {
      const ratio = (t - startTime) / rangeMs;
      const position = ratio * plotWidth;
      lines.push({
        value: t,
        position,
        label: formatTime(t),
      });
    }

    return { interval, lines };
  }

  /** Y축(값) 그리드 */
  static calcValueGrid(
    minValue: number,
    maxValue: number,
    plotHeight: number,
  ): GridInfo {
    const range = maxValue - minValue;
    const desiredTicks = Math.max(3, Math.floor(plotHeight / 60));
    const interval = GridCalculator.calcNiceInterval(range, desiredTicks);

    const lines: GridLine[] = [];
    const firstTick = Math.ceil(minValue / interval) * interval;

    for (let v = firstTick; v <= maxValue + interval * 0.01; v += interval) {
      const ratio = (v - minValue) / range;
      const position = plotHeight - ratio * plotHeight; // Y축 반전
      lines.push({
        value: v,
        position,
        label: Number.isInteger(v) ? String(v) : v.toFixed(1),
      });
    }

    return { interval, lines };
  }
}
