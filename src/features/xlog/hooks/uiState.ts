// 저장해 둔 배치·차트 설정과 화면 값 사이의 변환. **순수 함수다.**
//
// 설정 파일은 사람이 여는 곳이고, 어제 맞던 값이 오늘 안 맞는다(모니터를 바꾸면
// 그렇다). 그래서 **읽어 온 값을 그대로 믿지 않는다** — 못 쓸 값이면 기본값으로 돌린다.
// 배치가 0 이면 패널이 사라진 채로 뜨고, 그게 왜 그런지는 화면만 봐서는 모른다.

import type { UiLayout, XLogChartPrefs } from '../api/scouterApi';
import { PANE } from '../../../components/paneSizing';
import type { XLogChartConfig, YAxisMode } from '../types/xlog';
import { DEFAULT_CHART_CONFIG, Y_AXIS_CONFIGS } from '../types/xlog';

export type TabId = 'xlog' | 'counter' | 'alert';

export interface StoredLayout {
  servicesW: number;
  detailW: number;
  tableH: number;
  activeTab: TabId;
}

export const DEFAULT_LAYOUT: StoredLayout = {
  servicesW: PANE.servicesDefaultW,
  detailW: PANE.detailDefaultW,
  tableH: PANE.tableDefaultH,
  activeTab: 'xlog',
};

const TABS: readonly TabId[] = ['xlog', 'counter', 'alert'];

/** 0·음수·NaN 이면 기본값으로 돌린다 */
function positive(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * 패널 크기(픽셀)를 다듬는다.
 *
 * **밀리초에 이걸 쓰면 안 된다.** 픽셀 상한을 시간에 씌우면 10분 범위가 4초가 된다
 * (테스트가 잡아 줬다). 단위가 다른 값은 다른 함수로 다듬는다.
 */
function px(v: unknown, fallback: number): number {
  // 4K 를 가로로 다 써도 이 아래다. 이보다 크면 남의 값이거나 손으로 잘못 적은 것이다.
  return Math.min(positive(v, fallback), 4000);
}

export function toLayout(saved: UiLayout | undefined): StoredLayout {
  if (!saved) return DEFAULT_LAYOUT;
  const tab = saved.active_tab as TabId;
  return {
    servicesW: px(saved.services_w, DEFAULT_LAYOUT.servicesW),
    detailW: px(saved.detail_w, DEFAULT_LAYOUT.detailW),
    tableH: px(saved.table_h, DEFAULT_LAYOUT.tableH),
    // 없는 탭 이름이 들어오면 빈 화면이 뜬다 — 아는 것만 받는다.
    activeTab: TABS.includes(tab) ? tab : 'xlog',
  };
}

export function fromLayout(l: StoredLayout): UiLayout {
  return {
    services_w: l.servicesW,
    detail_w: l.detailW,
    table_h: l.tableH,
    active_tab: l.activeTab,
  };
}

// **목록을 손으로 적지 않는다.** Y축 종류가 늘 때 여기를 같이 못 고치면
// 새 종류를 골라 두고 껐다 켰을 때 조용히 elapsed 로 돌아간다.
const Y_MODES = Object.keys(Y_AXIS_CONFIGS) as YAxisMode[];

/**
 * 저장해 둔 차트 설정을 화면 설정에 얹는다.
 *
 * **색은 저장해 둔 것을 쓰지 않는다.** 팔레트는 `colorPalette.ts` 한 곳에만 있어야 하고,
 * 설정 파일에 두 벌이 되면 테마를 바꿔도 예전 색이 이긴다.
 */
export function toChartConfig(saved: XLogChartPrefs | undefined): XLogChartConfig {
  if (!saved) return DEFAULT_CHART_CONFIG;
  const mode = saved.y_axis_mode as YAxisMode;
  return {
    ...DEFAULT_CHART_CONFIG,
    yAxisMode: Y_MODES.includes(mode) ? mode : DEFAULT_CHART_CONFIG.yAxisMode,
    timeRangeMs: positive(saved.time_range_ms, DEFAULT_CHART_CONFIG.timeRangeMs),
    yMax: positive(saved.y_max, DEFAULT_CHART_CONFIG.yMax),
    showIgnoreArea: saved.show_ignore_area === true,
    // 0 은 «무시 안 함» 이라 정상값이다. positive() 를 쓰면 0 이 기본값으로 튄다.
    ignoreThresholdMs:
      Number.isFinite(saved.ignore_threshold_ms) && saved.ignore_threshold_ms >= 0
        ? saved.ignore_threshold_ms
        : DEFAULT_CHART_CONFIG.ignoreThresholdMs,
  };
}

export function fromChartConfig(c: XLogChartConfig): XLogChartPrefs {
  return {
    y_axis_mode: c.yAxisMode,
    time_range_ms: c.timeRangeMs,
    y_max: c.yMax,
    show_ignore_area: c.showIgnoreArea,
    ignore_threshold_ms: c.ignoreThresholdMs,
  };
}
