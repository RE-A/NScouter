// 메인 창 ↔ 떼어 낸 XLog 창이 주고받는 것.
//
// **탭의 주인은 메인 창이다.** 뗀 창은 그 탭을 그려 보이고, 고친 것(툴바·휠)을 메인 창에 알린다.
// 메인 창이 고쳐서 다시 보내 준 것을 그린다 — 둘이 따로 들고 있으면 저장·서버 고르기·스트림이
// 어느 쪽을 따라야 할지 갈린다.
//
//   뗀 창 → 메인   hello  (떴다, 상태를 보내 달라)
//   메인  → 뗀 창 state  (탭 · 접속 상태)  — 탭이 바뀔 때마다
//   뗀 창 → 메인   patch  (툴바·휠로 고친 것)
//   뗀 창 → 메인   select (끌어서 고른 트랜잭션 — 메인 창 목록으로)
//   뗀 창 → 메인   bye    (창을 닫는다 — 탭을 도로 붙인다)
//
// Tauri 이벤트는 JSON 으로 건너간다. `Set` 은 배열로 바꿔 보낸다.

import type { PastRange, XLogMode } from '../types/timeRange';
import type { SXLog, XLogChartConfig, XLogFilterState } from '../types/xlog';
import type { XLogTab } from '../hooks/xlogTabs';

export const EV_HELLO = 'xlog-detached-hello';
export const EV_STATE = 'xlog-detached-state';
export const EV_PATCH = 'xlog-detached-patch';
export const EV_SELECT = 'xlog-detached-select';
export const EV_BYE = 'xlog-detached-bye';

/** 뗀 창을 여는 주소의 질의 이름. 값은 탭 키다 */
export const DETACHED_QUERY = 'detached';

/** 탭 키 → 창 이름. Tauri 창 이름은 영숫자와 `-/:_` 만 된다 — 탭 키가 그 안에 있다 */
export function windowLabelOf(key: string): string {
  return `detached-${key}`;
}

/** 이 창이 뗀 창이면 그 탭 키, 아니면 null */
export function detachedKeyFrom(search: string): string | null {
  const v = new URLSearchParams(search).get(DETACHED_QUERY);
  return v !== null && v !== '' ? v : null;
}

export interface WireFilter extends Omit<XLogFilterState, 'objHashSet'> {
  objHashes: number[];
}

export interface WireTab {
  key: string;
  /** 탭 줄과 같은 이름 (순번까지) */
  label: string;
  mode: XLogMode;
  pastRange: PastRange | null;
  config: XLogChartConfig;
  filter: WireFilter;
}

export interface DetachedState {
  tab: WireTab;
  connected: boolean;
  connectionEpoch: number;
}

/** 뗀 창에서 고칠 수 있는 것 — 서버 고르기는 메인 창 왼쪽 목록에서만 한다 */
export interface WirePatch {
  config?: Partial<XLogChartConfig>;
  filter?: Partial<Omit<XLogFilterState, 'objHashSet'>>;
  mode?: XLogMode;
  pastRange?: PastRange | null;
}

export function toWire(tab: XLogTab, label: string): WireTab {
  const { objHashSet, ...rest } = tab.filter;
  return {
    key: tab.key,
    label,
    mode: tab.mode,
    pastRange: tab.pastRange,
    config: tab.config,
    filter: { ...rest, objHashes: [...objHashSet] },
  };
}

export function filterFromWire(w: WireFilter): XLogFilterState {
  const { objHashes, ...rest } = w;
  return { ...rest, objHashSet: new Set(objHashes) };
}

/** 메인 창이 받은 patch 를 탭에 얹는다. **서버 고르기는 안 건드린다** */
export function applyPatch(tab: XLogTab, p: WirePatch): Partial<Omit<XLogTab, 'key'>> {
  const out: Partial<Omit<XLogTab, 'key'>> = {};
  if (p.config) out.config = { ...tab.config, ...p.config };
  if (p.filter) {
    // objHashSet 이 섞여 와도 무시한다 — 고르기는 메인 창이 푼다
    const { ...f } = p.filter as Partial<XLogFilterState>;
    delete f.objHashSet;
    out.filter = { ...tab.filter, ...f };
  }
  if (p.mode !== undefined) out.mode = p.mode;
  if (p.pastRange !== undefined) out.pastRange = p.pastRange;
  return out;
}

export interface SelectMessage {
  key: string;
  xlogs: SXLog[];
}
