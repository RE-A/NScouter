// src/features/xlog/engine/CoordinateMapper.test.ts

import { describe, it, expect } from 'vitest';
import { CoordinateMapper, rollingWindow } from './CoordinateMapper';
import { buildLayout, DEFAULT_CHART_CONFIG } from '../types/xlog';

const layout = buildLayout(800, 600);
const config = { ...DEFAULT_CHART_CONFIG, timeRangeMs: 60_000, yMax: 9 };
const now = 1_000_000;

describe('CoordinateMapper', () => {
  it('timeToX: startTime → plotAreaX', () => {
    const mapper = new CoordinateMapper(layout, config, rollingWindow(now, config.timeRangeMs));
    const x = mapper.timeToX(mapper.getStartTime());
    expect(x).toBeCloseTo(layout.plotAreaX, 1);
  });

  it('timeToX: endTime → plotAreaX + plotAreaWidth', () => {
    const mapper = new CoordinateMapper(layout, config, rollingWindow(now, config.timeRangeMs));
    const x = mapper.timeToX(mapper.getEndTime());
    expect(x).toBeCloseTo(layout.plotAreaX + layout.plotAreaWidth, 1);
  });

  it('valueToY: yMax → plotAreaY (상단)', () => {
    const mapper = new CoordinateMapper(layout, config, rollingWindow(now, config.timeRangeMs));
    const y = mapper.valueToY(config.yMax);
    expect(y).toBeCloseTo(layout.plotAreaY, 1);
  });

  it('valueToY: 0 → plotAreaY + plotAreaHeight (하단)', () => {
    const mapper = new CoordinateMapper(layout, config, rollingWindow(now, config.timeRangeMs));
    const y = mapper.valueToY(0);
    expect(y).toBeCloseTo(layout.plotAreaY + layout.plotAreaHeight, 1);
  });

  it('dataToPixel → pixelToData 라운드트립', () => {
    const mapper = new CoordinateMapper(layout, config, rollingWindow(now, config.timeRangeMs));
    const time = now - 30_000;
    const value = 4.5;
    const { x, y } = mapper.dataToPixel(time, value);
    const { time: t2, value: v2 } = mapper.pixelToData(x, y);
    expect(t2).toBeCloseTo(time, 0);
    expect(v2).toBeCloseTo(value, 1);
  });

  it('isInPlotArea: 플롯 영역 중앙 → true', () => {
    const mapper = new CoordinateMapper(layout, config, rollingWindow(now, config.timeRangeMs));
    const cx = layout.plotAreaX + layout.plotAreaWidth / 2;
    const cy = layout.plotAreaY + layout.plotAreaHeight / 2;
    expect(mapper.isInPlotArea(cx, cy)).toBe(true);
  });

  it('isInPlotArea: 패딩 영역 (0,0) → false', () => {
    const mapper = new CoordinateMapper(layout, config, rollingWindow(now, config.timeRangeMs));
    expect(mapper.isInPlotArea(0, 0)).toBe(false);
  });

  it('getStartTime: now - timeRangeMs', () => {
    const mapper = new CoordinateMapper(layout, config, rollingWindow(now, config.timeRangeMs));
    expect(mapper.getStartTime()).toBe(now - config.timeRangeMs);
  });

  it('getEndTime: now', () => {
    const mapper = new CoordinateMapper(layout, config, rollingWindow(now, config.timeRangeMs));
    expect(mapper.getEndTime()).toBe(now);
  });
});

// 과거 구간 조회(LoadTimeXLog / ZoomTime)의 선행 조건.
// 이전에는 `now` 하나만 받아 `now - timeRangeMs` 로 창을 만들었기 때문에
// **"지금"밖에 그릴 수 없었다.**
describe('CoordinateMapper — 절대 시간 창', () => {
  // 창 길이가 config.timeRangeMs 와 다른 경우다. 이게 이 변경의 핵심이다.
  const past = { start: 5_000_000, end: 5_600_000 }; // 10분, config 는 1분

  it('창의 시작이 왼쪽 끝이다', () => {
    const m = new CoordinateMapper(layout, config, past);
    expect(m.timeToX(past.start)).toBeCloseTo(layout.plotAreaX, 1);
  });

  it('창의 끝이 오른쪽 끝이다', () => {
    const m = new CoordinateMapper(layout, config, past);
    expect(m.timeToX(past.end)).toBeCloseTo(layout.plotAreaX + layout.plotAreaWidth, 1);
  });

  // config.timeRangeMs(1분)로 나누면 중앙이 한참 오른쪽으로 밀린다.
  it('가운데 시각이 가운데 픽셀이다 — timeRangeMs 와 무관하게', () => {
    const m = new CoordinateMapper(layout, config, past);
    const mid = (past.start + past.end) / 2;
    expect(m.timeToX(mid)).toBeCloseTo(layout.plotAreaX + layout.plotAreaWidth / 2, 1);
  });

  it('픽셀→시간이 시간→픽셀의 역이다', () => {
    const m = new CoordinateMapper(layout, config, past);
    const t = past.start + 123_456;
    expect(m.pixelToData(m.timeToX(t), 0).time).toBeCloseTo(t, 0);
  });

  it('길이가 0인 창에서도 0으로 나누지 않는다', () => {
    const m = new CoordinateMapper(layout, config, { start: 100, end: 100 });
    expect(Number.isFinite(m.timeToX(100))).toBe(true);
  });

  it('rollingWindow 는 지금에서 뒤로 rangeMs 만큼이다', () => {
    expect(rollingWindow(1000, 300)).toEqual({ start: 700, end: 1000 });
  });
});
