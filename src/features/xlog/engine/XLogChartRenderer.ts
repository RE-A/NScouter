// src/features/xlog/engine/XLogChartRenderer.ts
// 7단계 Canvas 렌더링 오케스트레이터
// ASIS: XLogViewPainter.java draw() 메서드 포팅

import { CoordinateMapper } from './CoordinateMapper';
import { DotImageCache } from './DotImageCache';
import { GridCalculator } from './GridCalculator';
import { PointMap } from './PointMap';
import type { ChartLayout, SXLog, XLogChartConfig, XLogFilterState } from '../types/xlog';
import { buildLayout, Y_AXIS_CONFIGS } from '../types/xlog';
import { getDotColor, XLOG_COLORS } from '../utils/colorPalette';

const DOT_SIZE = 5;

export interface SelectionRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export class XLogChartRenderer {
  private ctx: CanvasRenderingContext2D;
  private layout: ChartLayout;
  private config: XLogChartConfig;
  private pointMap: PointMap;
  private dotCache = new DotImageCache();
  // xlog 인덱스를 픽셀 위치에 저장 (hover 조회용)
  private pixelToXLogIndex = new Map<number, number>();

  constructor(canvas: HTMLCanvasElement, config: XLogChartConfig) {
    this.ctx = canvas.getContext('2d')!;
    this.config = config;
    this.layout = buildLayout(canvas.width, canvas.height);
    this.pointMap = new PointMap(canvas.width, canvas.height);
  }

  updateConfig(config: XLogChartConfig): void {
    this.config = config;
  }

  resize(width: number, height: number): void {
    this.layout = buildLayout(width, height);
    this.pointMap = new PointMap(width, height);
  }

  /** 전체 프레임 렌더링 (rAF에서 호출) */
  render(
    data: SXLog[],
    filter: XLogFilterState,
    now: number,
    selection: SelectionRect | null,
  ): void {
    const mapper = new CoordinateMapper(this.layout, this.config, now);

    this.drawBackground();
    this.drawIgnoreArea(mapper);
    this.drawYGrid();
    this.drawXGrid(mapper);
    this.drawDataPoints(data, filter, mapper);
    this.drawBorder();
    this.drawMetadata(data, selection);

    if (selection) {
      this.drawSelectionRect(selection);
    }
  }

  /** 1단계: 배경 */
  private drawBackground(): void {
    const { canvasWidth, canvasHeight } = this.layout;
    this.ctx.fillStyle = this.config.backgroundColor;
    this.ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }

  /** 2단계: 무시 영역 */
  private drawIgnoreArea(mapper: CoordinateMapper): void {
    if (!this.config.showIgnoreArea || this.config.ignoreThresholdMs <= 0) return;
    const { plotAreaX, plotAreaWidth } = this.layout;
    const thresholdSec = this.config.ignoreThresholdMs / 1000;
    const yThreshold = mapper.valueToY(thresholdSec);
    const yBottom = mapper.valueToY(0);
    const height = yBottom - yThreshold;
    this.ctx.fillStyle = XLOG_COLORS.IGNORE_AREA;
    this.ctx.fillRect(plotAreaX, yThreshold, plotAreaWidth, height);
  }

  /** 3단계: Y축 그리드 */
  private drawYGrid(): void {
    const { plotAreaX, plotAreaY, plotAreaWidth, plotAreaHeight } = this.layout;
    const grid = GridCalculator.calcValueGrid(0, this.config.yMax, plotAreaHeight);

    this.ctx.save();
    this.ctx.strokeStyle = this.config.gridColor;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([2, 3]);
    this.ctx.fillStyle = XLOG_COLORS.META_TEXT;
    this.ctx.font = '11px monospace';
    this.ctx.textAlign = 'right';
    this.ctx.textBaseline = 'middle';

    for (const line of grid.lines) {
      const py = plotAreaY + line.position;
      this.ctx.beginPath();
      this.ctx.moveTo(plotAreaX, py);
      this.ctx.lineTo(plotAreaX + plotAreaWidth, py);
      this.ctx.stroke();
      this.ctx.fillText(line.label, plotAreaX - 5, py);
    }

    this.ctx.restore();
  }

  /** 4단계: X축 그리드 */
  private drawXGrid(mapper: CoordinateMapper): void {
    const { plotAreaX, plotAreaY, plotAreaWidth, plotAreaHeight } = this.layout;
    const grid = GridCalculator.calcTimeGrid(
      mapper.getStartTime(),
      mapper.getEndTime(),
      plotAreaWidth,
    );

    this.ctx.save();
    this.ctx.strokeStyle = this.config.gridColor;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([2, 3]);
    this.ctx.fillStyle = XLOG_COLORS.META_TEXT;
    this.ctx.font = '10px monospace';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';

    for (const line of grid.lines) {
      const px = plotAreaX + line.position;
      this.ctx.beginPath();
      this.ctx.moveTo(px, plotAreaY);
      this.ctx.lineTo(px, plotAreaY + plotAreaHeight);
      this.ctx.stroke();
      this.ctx.fillText(line.label, px, plotAreaY + plotAreaHeight + 4);
    }

    this.ctx.restore();
  }

  /** 5단계: 데이터 점 ★ 핵심 */
  private drawDataPoints(
    data: SXLog[],
    filter: XLogFilterState,
    mapper: CoordinateMapper,
  ): void {
    this.pointMap.clear();
    this.pixelToXLogIndex.clear();

    const half = Math.floor(DOT_SIZE / 2);

    for (let i = 0; i < data.length; i++) {
      const xlog = data[i];

      // 필터링
      if (!this.passesFilter(xlog, filter)) continue;

      const value = mapper.extractValue(xlog);
      const { x, y } = mapper.dataToPixel(xlog.endTime, value);

      // 플롯 영역 밖이면 스킵
      if (!mapper.isInPlotArea(x, y)) continue;

      // 충돌 체크 (이미 그려진 위치 스킵)
      if (this.pointMap.has(x, y)) continue;

      const color = getDotColor(xlog.objHash, xlog.xType, xlog.error !== 0);
      const dot = this.dotCache.getDot(color, DOT_SIZE);

      // ASIS: drawImage 좌표는 좌상단 기준 (중심 아님)
      this.ctx.drawImage(dot, x - half, y - half);
      this.pointMap.set(x, y, DOT_SIZE);

      // hover 조회용 인덱스 저장
      const key = Math.round(y) * this.layout.canvasWidth + Math.round(x);
      this.pixelToXLogIndex.set(key, i);
    }
  }

  /** 6단계: 테두리 */
  private drawBorder(): void {
    const { plotAreaX, plotAreaY, plotAreaWidth, plotAreaHeight } = this.layout;
    this.ctx.save();
    this.ctx.strokeStyle = XLOG_COLORS.BORDER;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([]);
    this.ctx.strokeRect(plotAreaX, plotAreaY, plotAreaWidth, plotAreaHeight);
    this.ctx.restore();
  }

  /** 7단계: 메타데이터 오버레이 */
  private drawMetadata(data: SXLog[], _selection: SelectionRect | null): void {
    const { plotAreaX, plotAreaY } = this.layout;
    const modeLabel = Y_AXIS_CONFIGS[this.config.yAxisMode].label;

    this.ctx.save();
    this.ctx.fillStyle = 'rgba(0,0,0,0.5)';
    this.ctx.font = '11px monospace';
    this.ctx.textBaseline = 'top';

    this.ctx.textAlign = 'left';
    this.ctx.fillText(`${data.length.toLocaleString()} dots`, plotAreaX + 4, plotAreaY + 4);

    this.ctx.textAlign = 'right';
    const { plotAreaWidth } = this.layout;
    this.ctx.fillText(modeLabel, plotAreaX + plotAreaWidth - 4, plotAreaY + 4);

    this.ctx.restore();
  }

  private drawSelectionRect(sel: SelectionRect): void {
    const x = Math.min(sel.x1, sel.x2);
    const y = Math.min(sel.y1, sel.y2);
    const w = Math.abs(sel.x2 - sel.x1);
    const h = Math.abs(sel.y2 - sel.y1);

    this.ctx.save();
    this.ctx.fillStyle = XLOG_COLORS.SELECT_FILL;
    this.ctx.fillRect(x, y, w, h);
    this.ctx.strokeStyle = XLOG_COLORS.SELECT_STROKE;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([4, 2]);
    this.ctx.strokeRect(x, y, w, h);
    this.ctx.restore();
  }

  private passesFilter(xlog: SXLog, filter: XLogFilterState): boolean {
    if (filter.errorOnly && xlog.error === 0) return false;
    if (xlog.elapsed < filter.minElapsed) return false;
    if (filter.objHashSet.size > 0 && !filter.objHashSet.has(xlog.objHash)) return false;
    return true;
  }

  /** 픽셀 위치에 해당하는 SXLog 인덱스 반환 (hover용) */
  getXLogIndexAt(px: number, py: number): number | undefined {
    const key = Math.round(py) * this.layout.canvasWidth + Math.round(px);
    return this.pixelToXLogIndex.get(key);
  }

  /** 사각형 영역 내 XLog 목록 반환 (선택용) */
  querySelection(sel: SelectionRect, data: SXLog[]): SXLog[] {
    const hits = this.pointMap.queryRect(sel.x1, sel.y1, sel.x2, sel.y2);
    const result: SXLog[] = [];
    for (const { x, y } of hits) {
      const key = y * this.layout.canvasWidth + x;
      const idx = this.pixelToXLogIndex.get(key);
      if (idx !== undefined) result.push(data[idx]);
    }
    return result;
  }

  dispose(): void {
    this.dotCache.clear();
  }
}
