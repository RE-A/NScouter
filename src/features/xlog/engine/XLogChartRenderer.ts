// src/features/xlog/engine/XLogChartRenderer.ts
// 7단계 Canvas 렌더링 오케스트레이터
// ASIS: XLogViewPainter.java draw() 메서드 포팅

import { CoordinateMapper } from './CoordinateMapper';
import type { TimeWindow } from './CoordinateMapper';
import { DotImageCache } from './DotImageCache';
import { GridCalculator } from './GridCalculator';
import { PointMap } from './PointMap';
import { findNearestPixel } from './pixelQuery';
import { passesFilter, selectInRect } from './rectSelect';
import { autoYMax } from './yScale';
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
    // **축보다 큰 점은 그려지지 않는다.** 30초짜리 타임아웃이 9초 축에서 한 점도
    // 안 보였다 — 자동이면 창 안 최댓값에 맞춰 늘린다.
    const effective = this.config.yAutoScale
      ? autoYMax(this.windowValues(data, filter, window), this.config.yMax)
      : this.config.yMax;
    this.effectiveYMax = effective;
    const scaled = effective === this.config.yMax ? this.config : { ...this.config, yMax: effective };
    const mapper = new CoordinateMapper(this.layout, scaled, window);
    this.lastMapper = mapper;
    this.lastFilter = filter;

    this.drawBackground();
    this.drawIgnoreArea(mapper);
    this.drawYGrid();
    this.drawXGrid(mapper);
    // **버퍼 크기를 세면 안 된다.** 에러만 켜면 60개가 보이는데 7,503 이라고 적힌다.
    // 화면의 숫자는 화면에 있는 것을 말해야 한다.
    const visible = this.drawDataPoints(data, filter, mapper);
    this.drawBorder();
    this.drawMetadata(visible, selection, status);

    if (selection) {
      this.drawSelectionRect(selection);
    }
  }

  /**
   * 창 안에서 필터를 통과한 값들.
   *
   * 자동 축은 **보이는 것** 기준이어야 한다 — 버퍼 전체로 잡으면 창 밖의 옛 타임아웃
   * 하나 때문에 축이 늘어난 채로 굳는다.
   */
  private windowValues(data: SXLog[], filter: XLogFilterState, window: TimeWindow): number[] {
    const extract = Y_AXIS_CONFIGS[this.config.yAxisMode].valueExtractor;
    const out: number[] = [];
    for (const x of data) {
      if (x.endTime < window.start || x.endTime > window.end) continue;
      if (!this.passesFilter(x, filter)) continue;
      out.push(extract(x));
    }
    return out;
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

    const half = Math.floor(DOT_SIZE / 2);
    let visible = 0;

    for (let i = 0; i < data.length; i++) {
      const xlog = data[i];

      // 필터링
      if (!this.passesFilter(xlog, filter)) continue;

      const value = mapper.extractValue(xlog);
      const { x, y } = mapper.dataToPixel(xlog.endTime, value);

      // 플롯 영역 밖이면 스킵.
      // **축 위로 나간 것은 따로 센다** — 창 안에 있는데 축이 낮아서 못 그린 것이고,
      // 조용히 빠지면 «없는 것» 으로 읽힌다(30초짜리 타임아웃이 그랬다).
      if (!mapper.isInPlotArea(x, y)) {
        if (
          y < this.layout.plotAreaY &&
          x >= this.layout.plotAreaX &&
          x <= this.layout.plotAreaX + this.layout.plotAreaWidth
        ) {
          this.overflowCount += 1;
        }
        continue;
      }

      // 겹쳐서 안 그려지는 것도 **이 구간에 있는 트랜잭션**이다. 세기는 여기서 한다.
      visible += 1;

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

    return visible;
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
    this.ctx.fillText(`${visible.toLocaleString()} dots`, plotAreaX + 4, plotAreaY + 4);

    // 축 위로 나간 것이 있으면 **몇 개인지** 말한다. 축을 올리면 보인다는 뜻이다.
    if (this.overflowCount > 0) {
      this.ctx.fillStyle = CANVAS.warn;
      this.ctx.fillText(
        `▲ ${this.overflowCount.toLocaleString()} (축 위)`,
        plotAreaX + 4 + this.ctx.measureText(`${visible.toLocaleString()} dots  `).width,
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
