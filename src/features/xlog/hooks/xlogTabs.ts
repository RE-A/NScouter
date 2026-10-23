// XLog 탭 — **한 화면에 여러 조건을 동시에 띄운다.**
//
// 「어제 이 시간엔 어땠나」를 보려면 지금 조건을 지우고 날짜를 바꿔 조회한 뒤
// 다시 되돌려야 했다. 되돌리는 동안 비교 대상이 머릿속에만 남는다.
// 탭을 나누면 둘을 오가며 볼 수 있다.
//
// **서버 고르기는 여기 없다.** 그건 Active·Counter 와 같은 선택이라 탭 바깥에 있다
// (App.tsx «서버 고르기는 탭 바깥이다» 참고). 여기서 나뉘는 것은
// 모드·구간·차트 설정·거름 넷이다.
//
// 이 파일은 **순수 함수다.** 탭을 더하고 닫고 옮기는 규칙은 화면 없이 확인한다.

import {
  DEFAULT_CHART_CONFIG,
  DEFAULT_FILTER,
  type XLogChartConfig,
  type XLogFilterState,
} from '../types/xlog';
import type { PastRange, XLogMode } from '../types/timeRange';

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
}

export interface XLogTabsState {
  tabs: XLogTab[];
  activeKey: string;
}

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
  };
  return { tabs: [tab], activeKey: tab.key };
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
  };
  const at = s.tabs.findIndex(t => t.key === s.activeKey);
  const tabs = [...s.tabs];
  // 복제본은 **원본 바로 옆**에 둔다. 맨 뒤로 보내면 비교할 둘이 떨어진다.
  tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab);
  return { tabs, activeKey: tab.key };
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
  if (key !== s.activeKey) return { tabs, activeKey: s.activeKey };
  const neighbor = tabs[Math.min(at, tabs.length - 1)];
  return { tabs, activeKey: neighbor.key };
}

export function activate(s: XLogTabsState, key: string): XLogTabsState {
  return s.tabs.some(t => t.key === key) ? { ...s, activeKey: key } : s;
}

/** 지금 탭만 고친다. 나머지는 그대로 둔다 — 그게 탭을 나눈 이유다 */
export function patchActive(s: XLogTabsState, patch: Partial<Omit<XLogTab, 'key'>>): XLogTabsState {
  return {
    ...s,
    tabs: s.tabs.map(t => (t.key === s.activeKey ? { ...t, ...patch } : t)),
  };
}

/**
 * 고른 서버를 **모든 탭에** 적는다.
 *
 * 서버 고르기는 탭 바깥이라 한 벌뿐인데, 거름(`filter`)은 탭마다라서 그 안에 같이 산다.
 * 지금 탭에만 적으면 다른 탭으로 옮겼을 때 옛 선택이 되살아난다.
 */
export function setSelection(s: XLogTabsState, objHashSet: ReadonlySet<number>): XLogTabsState {
  return {
    ...s,
    tabs: s.tabs.map(t => ({
      ...t,
      filter: { ...t.filter, objHashSet: new Set(objHashSet) },
    })),
  };
}
