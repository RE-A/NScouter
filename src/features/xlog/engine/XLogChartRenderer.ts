// src/features/xlog/engine/XLogChartRenderer.ts
// 7단계 Canvas 렌더링 오케스트레이터
// ASIS: XLogViewPainter.java draw() 메서드 포팅

import { CoordinateMapper } from './CoordinateMapper';
import type { TimeWindow } from './CoordinateMapper';
import { DotImageCache } from './DotImageCache';
import { GridCalculator } from './GridCalculator';
import { LAYER_ERROR, LAYER_NORMAL, PointMap } from './PointMap';
import { CELL_PX, cellIndex, densityAlpha, gridSize, peakOf } from './densityGrid';
import { findNearestPixel } from './pixelQuery';
import { passesFilter, selectInRect } from './rectSelect';
import { clampToCeiling } from './yScale';
import type { StreamStatus } from '../utils/streamStatus';
// Canvas 는 var() 를 못 읽으므로 실제 색 상수를 쓴다.
import { CANVAS } from '../../../styles/tokens';
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

/**
 * 천장에 붙은 점을 담는 띠의 두께(px).
 *
 * 점 크기(5px)보다 조금 두껍게 — 점이 띠 밖으로 삐져나오면 띠가 무슨 뜻인지 흐려진다.
 */
const CEILING_BAND_PX = 7;

export class XLogChartRenderer {
  private ctx: CanvasRenderingContext2D;
  private layout: ChartLayout;
  private config: XLogChartConfig;
  private pointMap: PointMap;
  private dotCache = new DotImageCache();
  // xlog 인덱스를 픽셀 위치에 저장 (hover 조회용)
  private pixelToXLogIndex = new Map<number, number>();
  // 드래그 선택은 그릴 때와 **같은** 좌표계·필터를 써야 눈에 보이는 사각형과 맞는다.
  private lastMapper: CoordinateMapper | null = null;
  private lastFilter: XLogFilterState | null = null;
  /**
   * 서비스 해시 → 이름. 서비스명 필터에만 쓴다.
   *
   * **렌더러가 직접 해석하지 않는다.** 텍스트 조회는 비동기인데 그리기는 프레임마다
   * 도는 동기 루프라 여기서 기다릴 수 없다. 이미 받아 둔 것을 읽기만 한다.
   */
  private serviceName: ((hash: number) => string | undefined) | undefined;

  /**
   * 이번 프레임에 실제로 쓴 축 최대.
   *
   * 자동이면 데이터에서 정하므로 `config.yMax` 와 다르다 — 눈금·좌표·«넘침» 판정이
   * **모두 같은 수를 봐야 한다.** 하나라도 config 를 보면 축과 점이 어긋난다.
   */
  private effectiveYMax = 0;
  /** 축 위로 나가 못 그린 건수. 조용히 빠지면 «없는 것» 으로 읽힌다 */
  private overflowCount = 0;
  /**
   * 같은 자리에 겹쳐 **못 그린** 건수.
   *
   * 점 하나가 5x5 를 막으므로 촘촘한 구간에서는 대부분이 안 그려진다 —
   * 실측에서 5,000건 남짓한 구간의 점이 339개였다. 그 차이를 말하지 않으면
   * 화면에 보이는 점 수를 건수로 읽게 된다.
   */
  private hiddenCount = 0;
  /**
   * 칸마다 몇 건이 들어왔나 (`densityGrid`).
   *
   * **점을 다 그리는 것으로는 안 된다.** 십만 개를 그리면 프레임이 무너지고, 다 그려도
   * 같은 자리에 겹쳐 색만 진해질 뿐 «몇 배인지» 는 여전히 안 보인다. 그래서 센다.
   * 프레임마다 새로 만들지 않고 크기가 바뀔 때만 다시 잡는다.
   */
  private density = new Int32Array(0);
  private densityCols = 0;
  private densityRows = 0;

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
    this.allocDensity();
  }

  /** 플롯 영역 크기에 맞춰 밀도 격자를 잡는다. 크기가 그대로면 비우기만 한다 */
  private allocDensity(): void {
    const { cols, rows } = gridSize(this.layout.plotAreaWidth, this.layout.plotAreaHeight);
    if (cols !== this.densityCols || rows !== this.densityRows) {
      this.densityCols = cols;
      this.densityRows = rows;
      this.density = new Int32Array(cols * rows);
    } else {
      this.density.fill(0);
    }
  }

  /** 전체 프레임 렌더링 (rAF에서 호출) */
  /**
   * @param window 그릴 시간 구간. 실시간이면 `rollingWindow(now, timeRangeMs)`,
   *               과거 조회면 사용자가 고른 절대 구간이다.
   */
  render(
    data: SXLog[],
    filter: XLogFilterState,
    window: TimeWindow,
    selection: SelectionRect | null,
    status?: StreamStatus,
  ): void {
    this.effectiveYMax = this.config.yMax;
    const mapper = new CoordinateMapper(this.layout, this.config, window);
    this.lastMapper = mapper;
    this.lastFilter = filter;

    this.drawBackground();
    this.drawIgnoreArea(mapper);
    this.drawYGrid();
    this.drawXGrid(mapper);
    // **버퍼 크기를 세면 안 된다.** 에러만 켜면 60개가 보이는데 7,503 이라고 적힌다.
    // 화면의 숫자는 화면에 있는 것을 말해야 한다.
    const visible = this.drawDataPoints(data, filter, mapper);
    // **점 위에 얹는다.** 밑에 깔면 점이 열을 가려 정작 몰린 자리가 안 보이고,
    // 그렇다고 덮으면 «어느 서버인가»(점 색)를 잃는다 — 가산 합성으로 밝기만 더한다.
    if (this.config.showDensity) this.drawDensity();
    this.drawBorder();
    this.drawMetadata(visible, selection, status);

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
    const grid = GridCalculator.calcValueGrid(0, this.effectiveYMax, plotAreaHeight);

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
  /** @returns 이 창에 실제로 들어온 트랜잭션 수 (겹쳐서 못 그린 것도 포함) */
  private drawDataPoints(
    data: SXLog[],
    filter: XLogFilterState,
    mapper: CoordinateMapper,
  ): number {
    this.pointMap.clear();
    this.pixelToXLogIndex.clear();
    this.overflowCount = 0;
    this.allocDensity();

    const half = Math.floor(DOT_SIZE / 2);
    let visible = 0;
    let drawn = 0;

    /**
     * 에러 점은 **나중에 그린다.**
     *
     * 한 칸에 점을 하나만 그리는 것은 촘촘한 구간에서 그리기가 폭발하지 않게 하려는
     * 것인데, 순서대로 그리면 **먼저 온 정상 점이 에러 점을 지운다** — 에러 하나를
     * 찾으려고 보는 화면에서 그 에러가 사라진다. 실제로 바쁜 구간일수록 잘 사라졌다.
     *
     * 좌표를 여기서 담아 두고 두 번째 바퀴에서 그린다. 데이터를 두 번 훑지 않으려는
     * 것이다 — 버퍼는 십만 건 단위지만 에러는 그중 일부다.
     */
    const errors: { i: number; x: number; y: number; color: string }[] = [];

    for (let i = 0; i < data.length; i++) {
      const xlog = data[i];

      // 필터링
      if (!this.passesFilter(xlog, filter)) continue;

      const raw = mapper.extractValue(xlog);
      // **축보다 큰 값은 버리지 않고 천장에 붙인다.** 예전에는 그림 밖이라 건너뛰었고,
      // 30초짜리 타임아웃이 9초 축에서 한 점도 안 보였다.
      const { value, over } = clampToCeiling(raw, this.config.yMax);
      const { x, y } = mapper.dataToPixel(xlog.endTime, value);

      if (!mapper.isInPlotArea(x, y)) continue;
      if (over) this.overflowCount += 1;

      // 겹쳐서 안 그려지는 것도 **이 구간에 있는 트랜잭션**이다. 세기는 여기서 한다.
      visible += 1;
      this.countDensity(x, y);

      const color = getDotColor(xlog.objHash, xlog.xType, xlog.error !== 0);
      if (xlog.error !== 0) {
        errors.push({ i, x, y, color });
        continue;
      }

      // 충돌 체크 (이미 그려진 위치 스킵)
      if (this.pointMap.has(x, y)) continue;

      const dot = this.dotCache.getDot(color, DOT_SIZE);

      // ASIS: drawImage 좌표는 좌상단 기준 (중심 아님)
      this.ctx.drawImage(dot, x - half, y - half);
      this.pointMap.set(x, y, DOT_SIZE, LAYER_NORMAL);
      drawn += 1;

      // hover 조회용 인덱스 저장
      const key = Math.round(y) * this.layout.canvasWidth + Math.round(x);
      this.pixelToXLogIndex.set(key, i);
    }

    // 두 번째 바퀴 — 에러. **정상 점의 자리를 무시한다.** 저희끼리는 여전히
    // 한 칸에 하나라, 에러가 쏟아지는 구간에서도 그리기가 폭발하지 않는다.
    for (const e of errors) {
      if (this.pointMap.has(e.x, e.y, LAYER_ERROR)) continue;

      const dot = this.dotCache.getDot(e.color, DOT_SIZE);
      this.ctx.drawImage(dot, e.x - half, e.y - half);
      this.pointMap.set(e.x, e.y, DOT_SIZE, LAYER_ERROR);
      drawn += 1;

      // **덮어쓴다.** 그 자리에 지금 보이는 것이 에러이므로, 짚었을 때도 에러가 나와야 한다.
      const key = Math.round(e.y) * this.layout.canvasWidth + Math.round(e.x);
      this.pixelToXLogIndex.set(key, e.i);
    }

    this.hiddenCount = visible - drawn;
    return visible;
  }

  /** 이 자리를 격자에 한 건 더한다. 격자 밖이면 아무 일도 안 한다 */
  private countDensity(x: number, y: number): void {
    const idx = cellIndex(
      x,
      y,
      this.layout.plotAreaX,
      this.layout.plotAreaY,
      this.densityCols,
      this.densityRows,
    );
    if (idx >= 0) this.density[idx] += 1;
  }

  /**
   * 밀집 구간을 밝기로 얹는다.
   *
   * **가산 합성(`lighter`)을 쓴다.** 보통 합성으로 칠하면 그 위의 점이 열에 묻혀
   * 어느 서버인지 못 읽는다 — 밝기만 더하면 점은 그대로 있고 «여기가 붐빈다» 만 얹힌다.
   */
  private drawDensity(): void {
    const peak = peakOf(this.density);
    if (peak < 1) return;

    const { plotAreaX, plotAreaY } = this.layout;
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'lighter';

    for (let cy = 0; cy < this.densityRows; cy++) {
      for (let cx = 0; cx < this.densityCols; cx++) {
        const alpha = densityAlpha(this.density[cy * this.densityCols + cx], peak);
        if (alpha <= 0) continue;
        this.ctx.fillStyle = `rgba(245, 166, 35, ${alpha.toFixed(3)})`;
        this.ctx.fillRect(plotAreaX + cx * CELL_PX, plotAreaY + cy * CELL_PX, CELL_PX, CELL_PX);
      }
    }

    this.ctx.restore();
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
  private drawMetadata(
    /** 이 창에 실제로 들어온 건수. 버퍼 전체가 아니다 */
    visible: number,
    _selection: SelectionRect | null,
    status?: StreamStatus,
  ): void {
    const { plotAreaX, plotAreaY } = this.layout;
    const modeLabel = Y_AXIS_CONFIGS[this.config.yAxisMode].label;

    this.ctx.save();
    this.ctx.fillStyle = XLOG_COLORS.META_TEXT;
    this.ctx.font = '11px monospace';
    this.ctx.textBaseline = 'top';

    this.ctx.textAlign = 'left';
    // **«점 몇 개» 가 아니라 «건수» 다.** 점 하나가 5x5 를 막아 촘촘한 구간에서는
    // 대부분이 안 그려진다 — 실측에서 5,000건 남짓한 구간의 점이 339개였다.
    // 그 차이를 적지 않으면 화면에 보이는 점 수를 건수로 읽는다.
    let head = `${visible.toLocaleString()} dots`;
    if (this.hiddenCount > 0) {
      head += `  (${this.hiddenCount.toLocaleString()} 겹침)`;
    }
    this.ctx.fillText(head, plotAreaX + 4, plotAreaY + 4);

    // 천장에 붙은 점이 있으면 **그 줄이 축 밖이라는 것**을 보여 준다.
    //
    // 점만 맨 위에 찍으면 «9초짜리» 와 «30초짜리» 가 같은 줄에 섞여, 그 줄의 높이를
    // 값으로 읽게 된다. 옅은 띠를 깔아 «여기는 눈금이 아니다» 를 표시하고
    // 몇 개인지 적는다 — 축을 올리면 제 높이로 흩어진다는 뜻이다.
    if (this.overflowCount > 0) {
      const { plotAreaWidth } = this.layout;
      this.ctx.fillStyle = CANVAS.overflowBand;
      this.ctx.fillRect(plotAreaX, plotAreaY, plotAreaWidth, CEILING_BAND_PX);

      this.ctx.fillStyle = CANVAS.warn;
      this.ctx.fillText(
        `▲ ${this.overflowCount.toLocaleString()} (축 위)`,
        plotAreaX + 4 + this.ctx.measureText(`${head}  `).width,
        plotAreaY + 4,
      );
      this.ctx.fillStyle = XLOG_COLORS.META_TEXT;
    }

    this.ctx.textAlign = 'right';
    const { plotAreaWidth } = this.layout;
    this.ctx.fillText(modeLabel, plotAreaX + plotAreaWidth - 4, plotAreaY + 4);

    // 비어 있을 때 **왜** 비었는지 알려준다.
    // "0 dots" 만 보면 고장인지 데이터가 없는 건지 알 수 없다.
    if (status && status.kind !== 'live' && visible === 0) {
      const { plotAreaHeight } = this.layout;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.font = '13px sans-serif';
      this.ctx.fillStyle = status.kind === 'stale' ? CANVAS.error : CANVAS.textDim;
      this.ctx.fillText(
        status.message,
        plotAreaX + plotAreaWidth / 2,
        plotAreaY + plotAreaHeight / 2,
      );
    }

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

  /** 서비스명 필터가 읽을 사전을 꽂는다 */
  setServiceNameResolver(fn: (hash: number) => string | undefined): void {
    this.serviceName = fn;
  }

  private passesFilter(xlog: SXLog, filter: XLogFilterState): boolean {
    return passesFilter(xlog, filter, this.serviceName);
  }

  /** 픽셀 위치에 해당하는 SXLog 인덱스 반환 (hover용) */
  getXLogIndexAt(px: number, py: number): number | undefined {
    const key = Math.round(py) * this.layout.canvasWidth + Math.round(px);
    return this.pixelToXLogIndex.get(key);
  }

  /**
   * 클릭 지점 근처의 XLog 1건 반환.
   *
   * 점이 2~4px 이라 클릭이 정확히 같은 픽셀에 떨어지지 않는다.
   * `radius` 안에서 가장 가까운 점을 고른다.
   */
  queryPoint(px: number, py: number, data: SXLog[], radius = 5): SXLog | undefined {
    const idx = findNearestPixel(this.pixelToXLogIndex, this.layout.canvasWidth, px, py, radius);
    return idx === undefined ? undefined : data[idx];
  }

  /**
   * 사각형 영역 내 XLog 목록 반환 (선택용).
   *
   * **픽셀 지도를 쓰지 않는다.** 그리기는 겹친 점을 건너뛰므로(충돌 회피)
   * 화면에 찍힌 점을 세면 촘촘한 구간에서 실제의 10분의 1도 안 나온다.
   * 데이터를 직접 훑어 전부 담는다 — 자세한 이유는 `rectSelect.ts`.
   */
  querySelection(sel: SelectionRect, data: SXLog[]): SXLog[] {
    // 아직 한 번도 그리지 않았으면 좌표를 알 수 없다.
    if (!this.lastMapper || !this.lastFilter) return [];
    return selectInRect(data, sel, this.lastMapper, this.lastFilter, this.serviceName);
  }

  dispose(): void {
    this.dotCache.clear();
  }
}
