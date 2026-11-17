// 대시보드 — 이름 붙은 판 배치(원본 스카우터의 퍼스펙티브). **순수 함수다.**
//
// 대시보드 하나 = 판들의 조건(`XLogTabPrefs[]`) + 배치(`XLogSplitPrefs`, dock JSON 포함) + 이름.
// 화면에 떠 있는 것은 **지금 대시보드 하나**다(App 의 `xlogTabs`). 바꿀 때 지금 것을 목록에 적어 두고
// 고른 것을 꺼내 판을 다시 세운다 — 받아 둔 점은 다시 받는다(실시간 판은 서면서 지난 몇 분을 채운다).
//
// 저장: `config.dashboards` (목록) · `active_dashboard` (id). **지금 대시보드의 원본은 `xlog_tabs`·`xlog_split`** 다 —
// 뗀 창·예전 판이 그 칸을 쓴다. 목록의 같은 항목은 저장할 때 함께 맞춘다(`withCurrent`).
//
// 기본 제공(`preset`) 은 고쳐 쓸 수 있고, `기본으로 되돌리기` 로 처음 모양으로 돌아간다.

import type { DashboardPrefs, XLogSplitPrefs, XLogTabPrefs } from '../api/scouterApi';

export type PresetId = 'original' | 'xlogOnly';

export const PRESET_IDS: readonly PresetId[] = ['original', 'xlogOnly'];

/** 기본 제공 이름 — 저장도 이 글자로 한다(화면은 `t()` 로 옮긴다) */
export const PRESET_NAME: Record<PresetId, string> = {
  original: '원본 기본',
  xlogOnly: 'XLog 만',
};

/** 예전 판을 옮겨 담은 대시보드의 이름 */
export const MIGRATED_NAME = '내 배치';

/** 대시보드는 이만큼까지 — `Ctrl+1~9` 로 닿는 것은 앞의 아홉 */
export const MAX_DASHBOARDS = 20;

export interface DashboardsState {
  list: DashboardPrefs[];
  activeId: string;
}

const isPreset = (v: unknown): v is PresetId => typeof v === 'string' && (PRESET_IDS as readonly string[]).includes(v);

/** 판 하나의 조건 — 따라감(🔗), 실시간, 고른 것 없음 */
function panel(kind: string, counter?: string): XLogTabPrefs {
  return {
    title: '',
    sel_services: [],
    sel_hashes: [],
    stime: 0,
    etime: 0,
    pinned: false,
    ...(kind !== 'xlog' ? { kind } : {}),
    ...(counter ? { counter } : {}),
  };
}

type Leaf = { type: 'leaf'; data: { views: string[]; activeView: string; id: string }; size: number };
type Branch = { type: 'branch'; data: (Leaf | Branch)[]; size: number };

const leaf = (i: number, size: number): Leaf => ({
  type: 'leaf',
  data: { views: [`t${i}`], activeView: `t${i}`, id: `g${i}` },
  size,
});

/**
 * 기본 제공 대시보드의 판과 배치. 배치는 저장 꼴(판 이름 = 순번 `t0`…, `dockLayout.ts`) 그대로다.
 *
 * `original` — 원본 `PerspectiveService` 의 첫 화면:
 * ```
 * ┌ Alert ─┬ Recent User ┬──────────────┐
 * │        ├ TPS         │              │
 * ├ EQ ────┼ Elapsed     │  XLog        │
 * │        ├ Heap Used   │              │
 * └────────┴─────────────┴──────────────┘
 * ```
 * 서버 목록(Objects)은 왼쪽 트리가 맡는다. 원본의 CPU 판은 호스트 카운터라 트리 따라감(자바 서버)으로는 비어서 뺐다.
 */
export function presetDashboard(id: PresetId): DashboardPrefs {
  if (id === 'xlogOnly') {
    return { id, name: PRESET_NAME[id], preset: id, tabs: [panel('xlog')], split: { panes: [0], active: 0, dir: 'row', ratio: 0.5 } };
  }
  const tabs = [
    panel('xlog'),
    panel('alert'),
    panel('eq'),
    panel('counter', 'RecentUser'),
    panel('counter', 'TPS'),
    panel('counter', 'ElapsedTime'),
    panel('counter', 'HeapUsed'),
  ];
  const W = 1200;
  const H = 800;
  const root: Branch = {
    type: 'branch',
    size: H,
    data: [
      { type: 'branch', size: W * 0.22, data: [leaf(1, H / 2), leaf(2, H / 2)] },
      { type: 'branch', size: W * 0.28, data: [leaf(3, H / 4), leaf(4, H / 4), leaf(5, H / 4), leaf(6, H / 4)] },
      leaf(0, W * 0.5),
    ],
  };
  const panels = Object.fromEntries(tabs.map((_, i) => [`t${i}`, { id: `t${i}`, contentComponent: 'xlog', title: '' }]));
  return {
    id,
    name: PRESET_NAME[id],
    preset: id,
    tabs,
    split: {
      panes: [0],
      active: 0,
      dir: 'row',
      ratio: 0.5,
      dock: { grid: { root, width: W, height: H, orientation: 'HORIZONTAL' }, panels, activeGroup: 'g0' },
    },
  };
}

/** 파일에서 읽은 한 항목이 쓸 만한가 — 모양이 깨졌으면 버린다 */
function clean(raw: unknown): DashboardPrefs | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<DashboardPrefs>;
  if (typeof r.id !== 'string' || r.id === '' || typeof r.name !== 'string') return null;
  return {
    id: r.id,
    name: r.name.trim() || r.id,
    ...(isPreset(r.preset) ? { preset: r.preset } : {}),
    tabs: Array.isArray(r.tabs) ? r.tabs : [],
    split: typeof r.split === 'object' && r.split !== null ? r.split : {},
  };
}

/**
 * 켤 때 대시보드 목록을 만든다.
 *
 * - 목록이 있으면: 그대로, **지금 것의 판은 `xlog_tabs`·`xlog_split` 로** 맞춘다(그쪽이 원본이다)
 * - 없고 예전 판이 있으면(업데이트한 사람): 그 판을 `내 배치` 로 옮기고 그것을 지금 대시보드로 — 화면이 바뀌지 않는다.
 *   기본 제공 둘을 뒤에 붙인다
 * - 아무것도 없으면(새로 설치): 기본 제공 둘, 지금은 `원본 기본`
 */
export function loadDashboards(
  saved: unknown,
  activeId: unknown,
  curTabs: XLogTabPrefs[] | undefined,
  curSplit: XLogSplitPrefs | undefined,
): DashboardsState {
  const list = (Array.isArray(saved) ? saved : []).map(clean).filter((d): d is DashboardPrefs => d !== null);
  // id 가 겹치면 뒤의 것을 버린다 — 손으로 고친 파일
  const seen = new Set<string>();
  const uniq = list.filter(d => !seen.has(d.id) && seen.add(d.id)).slice(0, MAX_DASHBOARDS);
  const hasCur = (curTabs?.length ?? 0) > 0;
  if (uniq.length > 0) {
    const active = uniq.some(d => d.id === activeId) ? (activeId as string) : uniq[0].id;
    const out = hasCur
      ? uniq.map(d => (d.id === active ? { ...d, tabs: curTabs ?? [], split: curSplit ?? {} } : d))
      : uniq;
    return { list: out, activeId: active };
  }
  const presets = PRESET_IDS.map(presetDashboard);
  if (!hasCur) return { list: presets, activeId: 'original' };
  return {
    list: [{ id: 'mine', name: MIGRATED_NAME, tabs: curTabs ?? [], split: curSplit ?? {} }, ...presets],
    activeId: 'mine',
  };
}

export function activeDashboard(s: DashboardsState): DashboardPrefs {
  return s.list.find(d => d.id === s.activeId) ?? s.list[0];
}

/** 지금 대시보드의 판을 목록에 적는다 — 저장할 때, 바꾸기 직전에 */
export function withCurrent(s: DashboardsState, tabs: XLogTabPrefs[], split: XLogSplitPrefs): DashboardsState {
  return { ...s, list: s.list.map(d => (d.id === s.activeId ? { ...d, tabs, split } : d)) };
}

/** 새 id — `d1`, `d2` … 비어 있는 가장 작은 수 */
function newId(list: readonly DashboardPrefs[]): string {
  const ids = new Set(list.map(d => d.id));
  let n = 1;
  while (ids.has(`d${n}`)) n++;
  return `d${n}`;
}

/** 이름이 겹치면 뒤에 순번 — `원본 기본 2` */
export function uniqueName(list: readonly DashboardPrefs[], name: string): string {
  const names = new Set(list.map(d => d.name));
  if (!names.has(name)) return name;
  let n = 2;
  while (names.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}

/**
 * 대시보드를 하나 더한다(목록 끝). 더한 것의 id 를 함께 준다 — 꽉 찼으면 id 가 null 이고 목록은 그대로.
 * 기본 제공을 하나 더 열 때도 이것으로 — 복사본이라 `preset` 을 떼고 이름에 순번을 붙인다.
 */
export function addDashboard(
  s: DashboardsState,
  name: string,
  tabs: XLogTabPrefs[],
  split: XLogSplitPrefs,
): { state: DashboardsState; id: string | null } {
  if (s.list.length >= MAX_DASHBOARDS) return { state: s, id: null };
  const id = newId(s.list);
  return { state: { ...s, list: [...s.list, { id, name: uniqueName(s.list, name.trim() || id), tabs, split }] }, id };
}

export function renameDashboard(s: DashboardsState, id: string, name: string): DashboardsState {
  const v = name.trim();
  if (v === '') return s;
  return { ...s, list: s.list.map(d => (d.id === id ? { ...d, name: v } : d)) };
}

/** 지운다. 마지막 하나는 안 지운다. 지금 것을 지우면 옆의 것이 지금 것 — 바뀌었는지는 `activeId` 로 안다 */
export function removeDashboard(s: DashboardsState, id: string): DashboardsState {
  if (s.list.length <= 1) return s;
  const i = s.list.findIndex(d => d.id === id);
  if (i < 0) return s;
  const list = s.list.filter(d => d.id !== id);
  const activeId = s.activeId === id ? list[Math.min(i, list.length - 1)].id : s.activeId;
  return { list, activeId };
}

/** 기본 제공을 처음 모양으로 — 이름은 사람이 바꾼 것을 둔다 */
export function resetPreset(s: DashboardsState, id: string): DashboardsState {
  return {
    ...s,
    list: s.list.map(d => {
      if (d.id !== id || !isPreset(d.preset)) return d;
      const p = presetDashboard(d.preset);
      return { ...d, tabs: p.tabs, split: p.split };
    }),
  };
}
