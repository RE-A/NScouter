// XLog 탭 — **한 화면에 여러 조건을 동시에 띄운다.**
//
// 「어제 이 시간엔 어땠나」를 보려면 지금 조건을 지우고 날짜를 바꿔 조회한 뒤
// 다시 되돌려야 했다. 되돌리는 동안 비교 대상이 머릿속에만 남는다.
// 탭을 나누면 둘을 오가며 볼 수 있다.
//
// **서버 고르기도 탭마다다.** 실시간 탭 둘에 서버만 달리 고르는 것이 흔한 쓰임새라
// («결제» 탭과 «주문» 탭), 한 벌로 두면 한쪽을 고치는 순간 다른 쪽도 바뀐다.
// 왼쪽 목록은 **지금 탭의** 선택을 보여 주고 고친다. Active·Counter 는 지금 XLog 탭의
// 선택을 따른다. 고른 것은 이름으로 들고(`selection`), 조회할 해시(`filter.objHashSet`)는
// 명단이 갱신될 때마다 App 이 다시 푼다(`groupSelection.ts`).
//
// **여러 탭을 한 화면에 나란히 띄울 수 있다**(`panes`). 브라우저·편집기의 화면 분할처럼
// 탭을 차트 가장자리로 끌어 놓으면 그 옆에 선다. 툴바·왼쪽 목록·아래 표는 **지금 판**
// (`activeKey`) 의 것이다.
//
// **탭을 새 창으로 떼어 낼 수도 있다**(`detached/`). 뗀 탭은 이 목록에서 빠져 그 창의 것이 된다 —
// 창마다 이 상태를 한 벌씩 들고, 서버 고르기·목록·상세까지 저마다 한다.
//
// 이 파일은 **순수 함수다.** 탭을 더하고 닫고 옮기는 규칙은 화면 없이 확인한다.

import {
  DEFAULT_CHART_CONFIG,
  DEFAULT_FILTER,
  type XLogChartConfig,
  type XLogFilterState,
} from '../types/xlog';
import type { PastRange, XLogMode } from '../types/timeRange';
import { EMPTY_SELECTION, type GroupSelection } from './groupSelection';

/** 탭 하나가 쥐는 것 */
export interface XLogTab {
  /** 탭 식별자. 제목은 바뀌어도 이건 안 바뀐다 */
  key: string;
  /** 사람이 붙인 이름. 비어 있으면 조건에서 만든다(`tabTitle`) */
  title?: string;
  mode: XLogMode;
  pastRange: PastRange | null;
  config: XLogChartConfig;
  filter: XLogFilterState;
  /** 왼쪽 목록에서 고른 것 — 서비스 이름과 낱개 Task. 해시는 `filter.objHashSet` 에 풀려 있다 */
  selection: GroupSelection;
}

/** 두 판을 놓는 방향. `row` 는 좌우, `column` 은 위아래. 셋 이상은 2×2 격자다 */
export type SplitDir = 'row' | 'column';

export interface XLogTabsState {
  tabs: XLogTab[];
  /** 지금 판. 툴바·왼쪽 목록·아래 표가 이 탭의 것이다. 늘 `panes` 안에 있다 */
  activeKey: string;
  /** 화면에 띄운 탭들, 놓인 순서대로. 하나면 분할이 아니다 */
  panes: string[];
  dir: SplitDir;
  /** 두 판일 때 첫 판이 차지하는 몫 */
  ratio: number;
}

/** 한 화면에 나란히 둘 수 있는 판 수. 넷을 넘기면 판 하나가 엽서만 해져 점을 못 읽는다 */
export const MAX_PANES = 4;
export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;

/**
 * 한 번에 둘 수 있는 탭 수.
 *
 * **버퍼가 탭마다 따로다.** 과거 조회 한 탭이 수십만 건을 들 수 있으니
 * 무제한으로 두면 조용히 메모리를 먹는다. 비교는 둘셋을 견주는 일이지
 * 열몇 개를 늘어놓는 일이 아니다.
 */
export const MAX_XLOG_TABS = 6;

let seq = 0;
function nextKey(): string {
  seq += 1;
  return `xlog-${seq}`;
}

/** 첫 탭 하나로 시작한다 */
export function initialTabs(): XLogTabsState {
  const tab: XLogTab = {
    key: nextKey(),
    mode: 'live',
    pastRange: null,
    config: DEFAULT_CHART_CONFIG,
    filter: DEFAULT_FILTER,
    selection: EMPTY_SELECTION,
  };
  return { tabs: [tab], activeKey: tab.key, panes: [tab.key], dir: 'row', ratio: 0.5 };
}

/** 지금 보고 있는 탭. 목록이 비는 일은 없다(마지막 하나는 안 닫힌다) */
export function activeTab(s: XLogTabsState): XLogTab {
  return s.tabs.find(t => t.key === s.activeKey) ?? s.tabs[0];
}

/**
 * 탭 이름.
 *
 * **붙인 이름이 있으면 그것, 없으면 조건에서 만든다.** 열 때마다 이름을 묻지는 않는다 —
 * 날짜만 바꿔 견줄 때는 구간이 곧 이름이라 따라 바뀌는 편이 맞다. 다만 실시간 탭 둘에
 * 서버만 달리 고르면 둘 다 «실시간» 이라 가를 수 없어, 사람이 붙일 수 있게 둔다.
 */
export function tabTitle(tab: XLogTab): string {
  const named = tab.title?.trim() ?? '';
  if (named !== '') return named;
  return autoTitle(tab);
}

function autoTitle(tab: XLogTab): string {
  if (tab.mode === 'live') return '실시간';
  if (!tab.pastRange) return '과거';

  const s = new Date(tab.pastRange.stime);
  const e = new Date(tab.pastRange.etime);
  const p = (n: number): string => String(n).padStart(2, '0');
  const day = `${p(s.getMonth() + 1)}/${p(s.getDate())}`;
  const from = `${p(s.getHours())}:${p(s.getMinutes())}`;
  const to = `${p(e.getHours())}:${p(e.getMinutes())}`;
  // 날짜를 넘긴 구간은 끝 날짜도 적는다 — 안 적으면 23:00~01:00 이 거꾸로 읽힌다
  const crossesDay = s.getDate() !== e.getDate() || s.getMonth() !== e.getMonth();
  const tail = crossesDay ? `${p(e.getMonth() + 1)}/${p(e.getDate())} ${to}` : to;
  return `${day} ${from}~${tail}`;
}

/**
 * 탭 줄에 적을 이름들 — `tabs` 와 같은 순서.
 *
 * **이름이 겹치면 순번을 붙인다.** 붙인 이름이 없는 실시간 탭 둘이 둘 다 «실시간» 이면
 * 어느 쪽이 어느 쪽인지 눌러 보기 전에는 모른다. 첫 것은 그대로, 다음부터 «실시간 2» 다.
 */
export function tabLabels(tabs: readonly XLogTab[]): string[] {
  const total = new Map<string, number>();
  for (const tab of tabs) total.set(tabTitle(tab), (total.get(tabTitle(tab)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return tabs.map(tab => {
    const name = tabTitle(tab);
    if ((total.get(name) ?? 0) <= 1) return name;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name} ${n}`;
  });
}

/**
 * 탭 이름을 바꾼다. **빈 이름이면 붙인 이름을 지운다** — 조건에서 만든 이름으로 돌아간다.
 */
export function renameTab(s: XLogTabsState, key: string, title: string): XLogTabsState {
  const name = title.trim();
  return {
    ...s,
    tabs: s.tabs.map(t => (t.key === key ? { ...t, title: name === '' ? undefined : name } : t)),
  };
}

/**
 * 탭을 하나 더 연다 — **지금 탭을 복제한다.**
 *
 * 빈 판으로 열면 서버와 조건을 처음부터 다시 골라야 한다. 비교하려고 여는 것이니
 * 바꾸고 싶은 것(대개 날짜) 하나만 고치게 두는 쪽이 맞다.
 */
export function addTab(s: XLogTabsState): XLogTabsState {
  if (s.tabs.length >= MAX_XLOG_TABS) return s;
  const src = activeTab(s);
  // 붙인 이름은 **안 옮긴다** — 복제본까지 «결제» 면 둘을 못 가른다. 순번 붙은 자동 이름으로 연다
  const tab: XLogTab = {
    key: nextKey(),
    mode: src.mode,
    pastRange: src.pastRange,
    config: { ...src.config },
    // Set 은 얕게 복사하면 두 탭이 같은 것을 공유한다 — 한쪽을 고치면 다른 쪽도 바뀐다
    filter: { ...src.filter, objHashSet: new Set(src.filter.objHashSet) },
    // 고른 서버도 복제한다 — 비교하려고 여는 것이니 서버를 처음부터 다시 고르게 하지 않는다
    selection: src.selection,
  };
  const at = s.tabs.findIndex(t => t.key === s.activeKey);
  const tabs = [...s.tabs];
  // 복제본은 **원본 바로 옆**에 둔다. 맨 뒤로 보내면 비교할 둘이 떨어진다.
  tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab);
  // 새 탭은 **지금 판 자리에** 연다 — 브라우저에서 분할된 쪽에 새 탭을 열면 그 쪽이 바뀌듯
  const panes = s.panes.map(k => (k === s.activeKey ? tab.key : k));
  return { ...s, tabs, activeKey: tab.key, panes };
}

/**
 * 탭을 닫는다.
 *
 * **마지막 하나는 안 닫는다.** 다 닫으면 빈 화면이 되는데, 그 상태에서 돌아올
 * 방법이 «새 탭» 버튼뿐이라 실수로 닫은 사람이 화면을 잃는다.
 * 닫은 뒤에는 **이웃으로 옮긴다** — 매번 첫 탭으로 튀면 보던 자리를 잃는다.
 */
export function closeTab(s: XLogTabsState, key: string): XLogTabsState {
  if (s.tabs.length <= 1) return s;
  const at = s.tabs.findIndex(t => t.key === key);
  if (at < 0) return s;

  const tabs = s.tabs.filter(t => t.key !== key);
  const panes = s.panes.filter(k => k !== key);
  if (key !== s.activeKey) {
    return { ...s, tabs, panes: panes.length > 0 ? panes : [s.activeKey] };
  }
  // 띄워 둔 다른 판이 있으면 그쪽으로, 없으면 탭 줄의 이웃을 그 자리에 띄운다
  if (panes.length > 0) {
    const i = Math.min(s.panes.indexOf(key), panes.length - 1);
    return { ...s, tabs, panes, activeKey: panes[Math.max(0, i)] };
  }
  const neighbor = tabs[Math.min(at, tabs.length - 1)];
  return { ...s, tabs, activeKey: neighbor.key, panes: [neighbor.key] };
}

/**
 * 탭을 누른다.
 *
 * 띄워 둔 판이면 **그 판으로 옮긴다.** 안 띄운 탭이면 **지금 판 자리에** 띄운다 —
 * 분할해 둔 다른 판은 그대로 둔다(브라우저 분할 보기와 같다).
 */
export function activate(s: XLogTabsState, key: string): XLogTabsState {
  if (!s.tabs.some(t => t.key === key)) return s;
  if (s.panes.includes(key)) return { ...s, activeKey: key };
  return { ...s, activeKey: key, panes: s.panes.map(k => (k === s.activeKey ? key : k)) };
}

export type DropSide = 'left' | 'right' | 'top' | 'bottom' | 'center';

/**
 * 탭을 판 위에 끌어 놓는다.
 *
 *   · 가장자리(left/right/top/bottom) — 그 판 옆에 새 판으로 세운다
 *   · 가운데 — 그 판을 이 탭으로 바꾼다
 *
 * 판이 이미 `MAX_PANES` 면 가장자리에 놓아도 **그 판을 바꾼다** — 더 쪼개지 않는다.
 * 이미 떠 있는 탭을 끌면 자리만 옮긴다(둘로 보이지 않는다).
 */
export function dropTab(s: XLogTabsState, key: string, target: string, side: DropSide): XLogTabsState {
  if (!s.tabs.some(t => t.key === key) || !s.panes.includes(target)) return s;
  if (key === target) return { ...s, activeKey: key };

  if (side === 'center' || (s.panes.length >= MAX_PANES && !s.panes.includes(key))) {
    // 떠 있던 탭을 다른 판에 놓으면 두 판이 자리를 바꾼다
    const from = s.panes.indexOf(key);
    const panes = s.panes.map((k, i) => (k === target ? key : i === from ? target : k));
    return { ...s, panes, activeKey: key };
  }

  const rest = s.panes.filter(k => k !== key);
  const at = rest.indexOf(target);
  const before = side === 'left' || side === 'top';
  rest.splice(before ? at : at + 1, 0, key);
  return {
    ...s,
    panes: rest,
    activeKey: key,
    // 두 판의 방향은 놓은 쪽이 정한다. 셋 이상은 격자라 방향이 없다
    dir: side === 'left' || side === 'right' ? 'row' : 'column',
  };
}

/**
 * 다른 창에서 온 탭들을 들인다 (뗀 창을 합치거나 탭 하나를 보내 왔을 때).
 *
 * **키는 여기서 새로 붙인다** — 창마다 키를 따로 세므로 그대로 쓰면 겹칠 수 있다.
 * 상한(`MAX_XLOG_TABS`)은 안 따진다 — 합치다가 탭을 버리면 그 조건을 잃는다.
 * 들인 첫 탭을 지금 판 자리에 띄운다.
 */
export function importTabs(s: XLogTabsState, incoming: readonly XLogTab[]): XLogTabsState {
  if (incoming.length === 0) return s;
  const added = incoming.map(t => ({ ...t, key: nextKey() }));
  return activate({ ...s, tabs: [...s.tabs, ...added] }, added[0].key);
}

/** 판 하나를 내린다 — **탭은 남는다.** 마지막 판은 못 내린다 */
export function closePane(s: XLogTabsState, key: string): XLogTabsState {
  if (s.panes.length <= 1 || !s.panes.includes(key)) return s;
  const panes = s.panes.filter(k => k !== key);
  if (key !== s.activeKey) return { ...s, panes };
  const i = Math.min(s.panes.indexOf(key), panes.length - 1);
  return { ...s, panes, activeKey: panes[i] };
}

export function setRatio(s: XLogTabsState, ratio: number): XLogTabsState {
  if (!Number.isFinite(ratio)) return s;
  return { ...s, ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)) };
}

/**
 * 그 탭만 고친다. 판을 나눠 띄우면 **지금 판이 아닌 판도** 휠로 확대·축소된다 —
 * 지금 판을 고치면 엉뚱한 판이 바뀐다.
 */
export function patchTab(
  s: XLogTabsState,
  key: string,
  patch: (tab: XLogTab) => Partial<Omit<XLogTab, 'key'>>,
): XLogTabsState {
  return { ...s, tabs: s.tabs.map(t => (t.key === key ? { ...t, ...patch(t) } : t)) };
}

/** 지금 탭만 고친다. 나머지는 그대로 둔다 — 그게 탭을 나눈 이유다 */
export function patchActive(s: XLogTabsState, patch: Partial<Omit<XLogTab, 'key'>>): XLogTabsState {
  return {
    ...s,
    tabs: s.tabs.map(t => (t.key === s.activeKey ? { ...t, ...patch } : t)),
  };
}

/**
 * 한 탭의 조회할 해시를 적는다 (App 이 그 탭의 `selection` 을 풀어 넘긴다).
 *
 * **내용이 같으면 그대로 돌려준다.** 명단은 10초마다 갱신되는데 그때마다 새 Set 을 넣으면
 * 그걸 의존성으로 쓰는 차트·목록이 Task 가 하나도 안 바뀌었는데도 다시 선다.
 */
export function setResolved(s: XLogTabsState, key: string, hashes: ReadonlySet<number>): XLogTabsState {
  const tab = s.tabs.find(t => t.key === key);
  if (!tab || sameSet(tab.filter.objHashSet, hashes)) return s;
  return {
    ...s,
    tabs: s.tabs.map(t => (t.key === key ? { ...t, filter: { ...t.filter, objHashSet: new Set(hashes) } } : t)),
  };
}

/** 모든 탭의 고르기를 비운다 — 콜렉터를 갈아탈 때. 해시는 이름의 해시라 서버가 달라도 겹친다(F-35) */
export function clearSelections(s: XLogTabsState): XLogTabsState {
  return {
    ...s,
    tabs: s.tabs.map(t => ({
      ...t,
      selection: EMPTY_SELECTION,
      filter: { ...t.filter, objHashSet: new Set<number>() },
    })),
  };
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
