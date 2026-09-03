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

  /**
   * 눈금 값을 몇 자리까지 적을 것인가.
   *
   * **간격보다 굵게 반올림하면 같은 라벨이 두 번 나온다.** Y최대 1초에서 간격이
   * 0.05초인데 소수 한 자리로 적으면 `1.0 · 1.0 · 0.9 · 0.9 …` 가 되어
   * 어느 줄이 무슨 값인지 못 읽는다. 간격이 정하는 자리까지 적는다.
   */
  static decimalsFor(interval: number): number {
    if (!Number.isFinite(interval) || interval <= 0) return 0;
    return Math.max(0, Math.ceil(-Math.log10(interval)));
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
    const decimals = GridCalculator.decimalsFor(interval);

    for (let v = firstTick; v <= maxValue + interval * 0.01; v += interval) {
      const ratio = (v - minValue) / range;
      const position = plotHeight - ratio * plotHeight; // Y축 반전
      lines.push({
        value: v,
        position,
        // 더하기를 되풀이한 값이라 0.30000000000000004 같은 것이 온다 — toFixed 가 다듬는다.
        label: v.toFixed(decimals),
      });
    }

    return { interval, lines };
  }
}
