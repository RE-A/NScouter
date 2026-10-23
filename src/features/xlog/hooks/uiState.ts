// 저장해 둔 배치·차트 설정과 화면 값 사이의 변환. **순수 함수다.**
//
// 설정 파일은 사람이 여는 곳이고, 어제 맞던 값이 오늘 안 맞는다(모니터를 바꾸면
// 그렇다). 그래서 **읽어 온 값을 그대로 믿지 않는다** — 못 쓸 값이면 기본값으로 돌린다.
// 배치가 0 이면 패널이 사라진 채로 뜨고, 그게 왜 그런지는 화면만 봐서는 모른다.

import type {
  PatternPrefs,
  UiLayout,
  XLogChartPrefs,
  XLogFilterPrefs,
  XLogSplitPrefs,
  XLogTabPrefs,
} from '../api/scouterApi';
import { PANE } from '../../../components/paneSizing';
import type { GroupBy } from '../components/agentTree';
import type { PatternRule, XLogChartConfig, XLogFilterState, YAxisMode } from '../types/xlog';
import { initialTabs, MAX_PANES, MAX_XLOG_TABS, setRatio, type XLogTabsState } from './xlogTabs';
import type { XLogMode } from '../types/timeRange';
import { DEFAULT_CHART_CONFIG, Y_AXIS_CONFIGS } from '../types/xlog';

export type TabId = 'xlog' | 'active' | 'visualize' | 'counter' | 'alert';

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

const TABS: readonly TabId[] = ['xlog', 'active', 'visualize', 'counter', 'alert'];
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
    showDensity: saved.show_density === true,
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
    show_density: c.showDensity,
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

// ─── XLog 탭 ───────────────────────────────────────────────────
//
// **조건만 담는다.** 받아 둔 데이터는 안 담는다 — 수십만 건을 파일에 넣을 수도 없고,
// 열어 보면 이미 지나간 것이다. 열면 그 조건으로 다시 조회한다.

export function fromTabs(s: XLogTabsState): XLogTabPrefs[] {
  return s.tabs.map(t => ({
    // 붙인 이름이 없으면 빈 글자 — 읽는 쪽이 «자동 이름» 으로 되돌린다
    title: t.title ?? '',
    sel_services: [...t.selection.services],
    sel_hashes: [...t.selection.hashes],
    chart: fromChartConfig(t.config),
    filter: fromFilterState(t.filter, t.mode),
    // 구간이 없으면 0 으로 적는다. 읽는 쪽이 «안 정했다» 로 되돌린다.
    stime: t.pastRange?.stime ?? 0,
    etime: t.pastRange?.etime ?? 0,
  }));
}

/**
 * 파일에서 탭들을 되살린다.
 *
 * **빈 목록이면 옛 한 벌로 탭 하나를 만든다.** 판이 올라가기 전 파일에는 `xlog_tabs`
 * 가 없는데, 그때 빈 화면으로 시작하면 «설정이 날아갔다» 로 읽힌다.
 */
/** 분할 → 저장할 값. 탭은 순번으로 적는다 — 키는 켤 때마다 새로 만든다 */
export function fromSplit(s: XLogTabsState): XLogSplitPrefs {
  const index = (key: string) => s.tabs.findIndex(t => t.key === key);
  return {
    panes: s.panes.map(index).filter(i => i >= 0),
    active: Math.max(0, index(s.activeKey)),
    dir: s.dir,
    ratio: s.ratio,
  };
}

export function toTabs(
  saved: XLogTabPrefs[] | undefined,
  legacyChart: XLogChartPrefs | undefined,
  legacyFilter: XLogFilterPrefs | undefined,
  split?: XLogSplitPrefs,
): XLogTabsState {
  const rows = saved && saved.length > 0
    ? saved
    : [{ chart: legacyChart, filter: legacyFilter, stime: 0, etime: 0 }];

  const base = initialTabs();
  const tabs = rows.slice(0, MAX_XLOG_TABS).map((row, i) => {
    const f = toFilterState(row.filter);
    const hasRange = (row.stime ?? 0) > 0 && (row.etime ?? 0) > 0;
    const tab = row as XLogTabPrefs;
    const services = Array.isArray(tab.sel_services) ? tab.sel_services.filter(v => typeof v === 'string') : [];
    const picked = Array.isArray(tab.sel_hashes) ? tab.sel_hashes.filter(h => Number.isInteger(h)) : [];
    // 고르기를 담기 전 파일에는 풀린 해시(obj_hashes)만 있다 — 그걸 낱개로 고른 것으로 되살린다
    const legacy = services.length === 0 && picked.length === 0 ? [...f.filter.objHashSet] : picked;
    return {
      // 첫 탭은 처음 만든 키를 그대로 쓴다 — 키가 흔들리면 차트가 통째로 다시 선다
      key: i === 0 ? base.tabs[0].key : `${base.tabs[0].key}-r${i}`,
      ...(typeof row.title === 'string' && row.title.trim() !== '' ? { title: row.title.trim() } : {}),
      mode: f.mode,
      pastRange: hasRange ? { stime: row.stime as number, etime: row.etime as number } : null,
      config: toChartConfig(row.chart),
      filter: f.filter,
      selection: { services: new Set(services), hashes: new Set(legacy) },
    };
  });
  // 뗀 창은 되살리지 않는다 — 켤 때는 모든 탭이 메인 창에 붙어 있다
  return withSplit({ ...base, tabs, activeKey: tabs[0].key, panes: [tabs[0].key], detached: [] }, split);
}

/**
 * 저장한 분할을 되살린다. **못 쓸 값은 버린다** — 없는 순번, 같은 탭 두 번, 상한 넘는 판 수.
 * 남는 판이 없으면 첫 탭 하나다.
 */
function withSplit(s: XLogTabsState, split: XLogSplitPrefs | undefined): XLogTabsState {
  if (!split) return s;
  const keyAt = (i: unknown) =>
    typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < s.tabs.length ? s.tabs[i].key : null;
  const panes: string[] = [];
  for (const i of Array.isArray(split.panes) ? split.panes : []) {
    const k = keyAt(i);
    if (k !== null && !panes.includes(k) && panes.length < MAX_PANES) panes.push(k);
  }
  if (panes.length === 0) panes.push(s.tabs[0].key);
  const active = keyAt(split.active);
  const out: XLogTabsState = {
    ...s,
    panes,
    activeKey: active !== null && panes.includes(active) ? active : panes[0],
    dir: split.dir === 'column' ? 'column' : 'row',
  };
  return typeof split.ratio === 'number' ? setRatio(out, split.ratio) : out;
}
