// 저장해 둔 배치·차트 설정과 화면 값 사이의 변환. **순수 함수다.**
//
// 설정 파일은 사람이 여는 곳이고, 어제 맞던 값이 오늘 안 맞는다(모니터를 바꾸면
// 그렇다). 그래서 **읽어 온 값을 그대로 믿지 않는다** — 못 쓸 값이면 기본값으로 돌린다.
// 배치가 0 이면 패널이 사라진 채로 뜨고, 그게 왜 그런지는 화면만 봐서는 모른다.

import type {
  CounterPickPrefs,
  PatternPrefs,
  UiLayout,
  XLogChartPrefs,
  XLogFilterPrefs,
} from '../api/scouterApi';
import { PANE } from '../../../components/paneSizing';
import type { GroupBy } from '../components/agentTree';
import type { PatternRule, XLogChartConfig, XLogFilterState, YAxisMode } from '../types/xlog';
import type { XLogMode } from '../types/timeRange';
import { DEFAULT_CHART_CONFIG, Y_AXIS_CONFIGS } from '../types/xlog';

export type TabId = 'xlog' | 'counter' | 'alert';

export interface StoredLayout {
  servicesW: number;
  detailW: number;
  tableH: number;
  activeTab: TabId;
  /** 서비스 목록을 무엇으로 묶는가 */
  agentGroupBy: GroupBy;
}

export const DEFAULT_LAYOUT: StoredLayout = {
  servicesW: PANE.servicesDefaultW,
  detailW: PANE.detailDefaultW,
  tableH: PANE.tableDefaultH,
  activeTab: 'xlog',
  agentGroupBy: 'type',
};

const TABS: readonly TabId[] = ['xlog', 'counter', 'alert'];
const GROUP_BYS: readonly GroupBy[] = ['type', 'group'];

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
    // 모르는 기준이 오면 예전 동작(타입)으로 둔다
    agentGroupBy: GROUP_BYS.includes(saved.agent_group_by as GroupBy)
      ? (saved.agent_group_by as GroupBy)
      : 'type',
  };
}

export function fromLayout(l: StoredLayout): UiLayout {
  return {
    services_w: l.servicesW,
    detail_w: l.detailW,
    table_h: l.tableH,
    active_tab: l.activeTab,
    agent_group_by: l.agentGroupBy,
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

// ─── 조회 조건 ────────────────────────────────────────────────

/**
 * 저장해 둔 조건 → 화면 값.
 *
 * **읽어 온 값을 그대로 믿지 않는다.** 파일은 사람이 여는 곳이고, 숫자 자리에
 * 글자가 들어와 있으면 필터가 통째로 이상해진다 — 배치와 같은 규칙이다.
 */
export function toFilterState(p: XLogFilterPrefs | undefined): {
  filter: XLogFilterState;
  mode: XLogMode;
} {
  const nonNegative = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };
  const flag = (v: unknown): boolean => v === true;

  return {
    filter: {
      elapsedMs: nonNegative(p?.elapsed_ms),
      elapsedExclude: flag(p?.elapsed_exclude),
      errorOnly: flag(p?.error_only),
      objHashSet: new Set(
        Array.isArray(p?.obj_hashes) ? p.obj_hashes.filter(h => Number.isInteger(h)) : [],
      ),
      patterns: toPatterns(p),
    },
    // 모드는 «어디를 보고 있었나» 라서 되살린다.
    // **구간(stime/etime)은 담지 않는다** — 어제 보던 «최근 1시간» 은 오늘 열면 남의
    // 시간이라, 과거 모드로 떠도 구간은 지금 기준으로 새로 잡힌다.
    mode: p?.mode === 'past' ? 'past' : 'live',
  };
}

/**
 * 저장해 둔 조건 줄들 → 화면 값.
 *
 * **예전 파일을 잃지 않는다.** 조건이 한 칸씩(`service_text`/`ip_text`)이던 판으로 저장된
 * 파일이 그대로 있다 — `patterns` 가 비어 있으면 그 한 칸을 한 줄로 옮긴다.
 */
function toPatterns(p: XLogFilterPrefs | undefined): PatternRule[] {
  const text = (v: unknown): string => (typeof v === 'string' ? v : '');
  const flag = (v: unknown): boolean => v === true;

  const rows = Array.isArray(p?.patterns) ? p.patterns : [];
  const parsed: PatternRule[] = [];
  for (const r of rows) {
    if (typeof r !== 'object' || r === null) continue;
    const field = text((r as PatternPrefs).field);
    if (field !== 'service' && field !== 'ip') continue;
    const body = text((r as PatternPrefs).text);
    if (body.trim() === '') continue;
    parsed.push({ field, text: body, exclude: flag((r as PatternPrefs).exclude) });
  }
  if (parsed.length > 0) return parsed;

  const legacy: PatternRule[] = [];
  if (text(p?.service_text).trim() !== '') {
    legacy.push({ field: 'service', text: text(p?.service_text), exclude: flag(p?.service_exclude) });
  }
  if (text(p?.ip_text).trim() !== '') {
    legacy.push({ field: 'ip', text: text(p?.ip_text), exclude: flag(p?.ip_exclude) });
  }
  return legacy;
}

/** 화면 값 → 저장할 조건 */
export function fromFilterState(filter: XLogFilterState, mode: XLogMode): XLogFilterPrefs {
  const first = (field: 'service' | 'ip') =>
    filter.patterns.find(r => r.field === field) ?? { text: '', exclude: false };

  return {
    elapsed_ms: filter.elapsedMs,
    elapsed_exclude: filter.elapsedExclude,
    error_only: filter.errorOnly,
    obj_hashes: [...filter.objHashSet],
    // 예전 판으로 되돌아가도 **첫 줄만은 살아 있게** 남겨 둔다.
    service_text: first('service').text,
    service_exclude: first('service').exclude,
    ip_text: first('ip').text,
    ip_exclude: first('ip').exclude,
    patterns: filter.patterns.map(r => ({ field: r.field, text: r.text, exclude: r.exclude })),
    mode,
  };
}

/** 저장해 둔 카운터 서버 고르기 → 화면 값 */
export function toCounterPicks(p: CounterPickPrefs | undefined): {
  javaee: Set<number>;
  host: Set<number>;
  datasource: Set<number>;
} {
  const set = (v: unknown): Set<number> =>
    new Set(Array.isArray(v) ? v.filter((h): h is number => Number.isInteger(h)) : []);
  return { javaee: set(p?.javaee), host: set(p?.host), datasource: set(p?.datasource) };
}
