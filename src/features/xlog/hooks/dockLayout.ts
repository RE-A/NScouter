// XLog 판 배치(dockview) 저장·복원 — **순수 함수다.**
//
// 판 하나 = XLog 탭 하나다(`xlogTabs.ts`). 탭의 조건은 탭 상태가 들고, **어느 판이 어디에 어떤 묶음으로
// 있나**만 dockview 의 배치 JSON(`SerializedDockview`) 이 든다.
//
// **판 이름은 저장할 때 순번으로 바꾼다.** 탭 키(`xlog-3`)는 켤 때마다 새로 붙으므로 그대로 적으면
// 다음 실행에 아무 탭과도 맞지 않는다. 저장은 `t0, t1 …`(`xlog_tabs` 의 순번)으로, 되살릴 때 그 순번의
// 지금 키로 되돌린다. 배치가 탭과 맞지 않으면(손으로 고쳤거나 탭 수가 달라졌거나) **버리고** 예전 분할
// 설정에서 다시 짠다(`opsFromSplit`) — 깨진 배치로 띄우면 판이 사라진 채로 뜬다.
//
// 떠 있는 판·팝아웃은 쓰지 않는다 — 새 창은 Tauri 창으로 뗀다(`detached/`). 저장할 때 뺀다.

import type { SerializedDockview } from 'dockview-react';
import type { SplitDir } from './xlogTabs';

type Leaf = { type: 'leaf'; data: { views: string[]; activeView?: string; id: string }; size?: number; visible?: boolean };
type Branch = { type: 'branch'; data: Node[]; size?: number; visible?: boolean };
type Node = Leaf | Branch;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function isNode(v: unknown): v is Node {
  if (!isRecord(v)) return false;
  if (v.type === 'leaf') {
    const d = v.data;
    return isRecord(d) && Array.isArray(d.views) && d.views.every(x => typeof x === 'string') && typeof d.id === 'string';
  }
  return v.type === 'branch' && Array.isArray(v.data) && v.data.every(isNode);
}

/** 나무의 판 이름을 갈아 끼운다. 모르는 이름이 하나라도 있으면 null */
function mapNode(n: Node, f: (id: string) => string | null): Node | null {
  if (n.type === 'leaf') {
    const views: string[] = [];
    for (const v of n.data.views) {
      const m = f(v);
      if (m === null) return null;
      views.push(m);
    }
    const active = n.data.activeView === undefined ? undefined : f(n.data.activeView);
    if (active === null) return null;
    return { ...n, data: { ...n.data, views, ...(active === undefined ? {} : { activeView: active }) } };
  }
  const kids: Node[] = [];
  for (const k of n.data) {
    const m = mapNode(k, f);
    if (m === null) return null;
    kids.push(m);
  }
  return { ...n, data: kids };
}

/** 나무에 놓인 판 이름들 (나온 순서) */
function viewsOf(n: Node, out: string[] = []): string[] {
  if (n.type === 'leaf') out.push(...n.data.views);
  else for (const k of n.data) viewsOf(k, out);
  return out;
}

/** 판 이름을 바꾼 배치. 이름 하나라도 못 바꾸면 null. 떠 있는 판·팝아웃은 뺀다 */
function remap(json: SerializedDockview, f: (id: string) => string | null): SerializedDockview | null {
  const root = json.grid?.root as unknown;
  if (!isNode(root) || !isRecord(json.panels)) return null;
  const mapped = mapNode(root, f);
  if (mapped === null) return null;
  const panels: SerializedDockview['panels'] = {};
  for (const [id, p] of Object.entries(json.panels)) {
    const m = f(id);
    if (m === null || !isRecord(p)) return null;
    panels[m] = { ...p, id: m };
  }
  const out: SerializedDockview = {
    grid: { ...json.grid, root: mapped as SerializedDockview['grid']['root'] },
    panels,
  };
  if (typeof json.activeGroup === 'string') out.activeGroup = json.activeGroup;
  return out;
}

/**
 * 저장할 배치 — 판 이름(탭 키)을 `keys` 안의 순번(`t0`…)으로.
 * 배치에 `keys` 에 없는 판이 있으면 null(저장하지 않는다).
 */
export function encodeDock(json: SerializedDockview, keys: readonly string[]): SerializedDockview | null {
  return remap(json, id => {
    const i = keys.indexOf(id);
    return i < 0 ? null : `t${i}`;
  });
}

/**
 * 되살릴 배치 — 순번을 지금 탭 키로. **탭과 딱 맞을 때만** 준다: 모든 판이 탭 하나씩이고,
 * 모든 탭이 판으로 한 번씩 나와야 한다. 아니면 null(예전 분할에서 다시 짠다).
 */
export function decodeDock(saved: unknown, keys: readonly string[]): SerializedDockview | null {
  if (!isRecord(saved) || !isRecord(saved.grid) || !isRecord(saved.panels)) return null;
  const json = saved as unknown as SerializedDockview;
  const out = remap(json, id => {
    const m = /^t(\d+)$/.exec(id);
    const i = m ? Number(m[1]) : -1;
    return i >= 0 && i < keys.length ? keys[i] : null;
  });
  if (out === null) return null;
  const placed = viewsOf(out.grid.root as unknown as Node);
  if (placed.length !== keys.length || new Set(placed).size !== keys.length) return null;
  if (Object.keys(out.panels).length !== keys.length) return null;
  return out;
}

/** 판 하나를 놓는 법 — dockview `addPanel` 의 자리 옵션과 짝이다 */
export interface AddOp {
  key: string;
  /** 없으면 첫 판(빈 배치에 놓는다) */
  position?:
    | { referencePanel: string; direction: 'right' | 'below' | 'within' }
    | { direction: 'below' };
  /** 지금 판이 되지 않게 놓는다 — 판 묶음 뒤쪽 탭 */
  inactive?: boolean;
}

/**
 * 예전 분할 설정(`panes` · `dir`) → 판을 놓는 차례.
 *
 *   · 판 하나: 그대로
 *   · 둘: 좌우(`row`) 또는 위아래(`column`)
 *   · 셋: 위에 둘, 아래에 셋째가 가로로 길게 (예전 격자와 같다)
 *   · 넷: 2×2
 *
 * 띄우지 않았던 탭은 **지금 판의 묶음 뒤쪽 탭**으로 넣는다 — 예전에도 탭 줄에만 있고 판에는 없었다.
 * 두 판의 몫(`ratio`)은 옮기지 않는다 — 처음 한 번만 고르게 나뉜다.
 */
export function opsFromSplit(
  keys: readonly string[],
  panes: readonly string[],
  dir: SplitDir,
  activeKey: string,
): AddOp[] {
  const shown = panes.filter(k => keys.includes(k));
  const p = shown.length > 0 ? shown : keys.length > 0 ? [keys[0]] : [];
  const ops: AddOp[] = [];
  if (p.length === 0) return ops;
  ops.push({ key: p[0] });
  if (p.length === 2) {
    ops.push({ key: p[1], position: { referencePanel: p[0], direction: dir === 'column' ? 'below' : 'right' } });
  } else if (p.length === 3) {
    ops.push({ key: p[1], position: { referencePanel: p[0], direction: 'right' } });
    ops.push({ key: p[2], position: { direction: 'below' } });
  } else if (p.length >= 4) {
    ops.push({ key: p[1], position: { referencePanel: p[0], direction: 'right' } });
    ops.push({ key: p[2], position: { referencePanel: p[0], direction: 'below' } });
    ops.push({ key: p[3], position: { referencePanel: p[1], direction: 'below' } });
  }
  const home = p.includes(activeKey) ? activeKey : p[0];
  for (const k of keys) {
    if (!p.slice(0, 4).includes(k)) ops.push({ key: k, position: { referencePanel: home, direction: 'within' }, inactive: true });
  }
  return ops;
}

/** `격자로 정렬` 의 한 걸음 — 판(`key`)을 `ref` 판의 묶음 옆(`position`)으로 옮긴다 */
export interface GridMove {
  key: string;
  ref: string;
  position: 'center' | 'bottom' | 'right';
}

/**
 * `격자로 정렬` — 판을 판 수에 맞게 고르게 나눈다(3개 3열, 4개 2×2, 6개 3×2, 9개 3×3 …).
 *
 * **판을 지우고 다시 넣지 않고 옮기기만 한다** — 다시 넣으면 차트가 다시 서서 받아 둔 점을 잃는다.
 *   1. 모두 첫 판의 묶음으로 모은다
 *   2. 줄마다 첫 판을 앞 줄 첫 판 **아래**로 — 줄이 선다
 *   3. 줄 안의 나머지를 바로 앞 판 **오른쪽**으로
 * 크기는 쪼갤 때마다 반씩이라 고르지 않다 — 옮긴 뒤 크기를 맞춘다(`cols`·`rows`).
 */
export function gridMoves(keys: readonly string[]): { moves: GridMove[]; cols: number; rows: number } {
  const n = keys.length;
  if (n <= 1) return { moves: [], cols: 1, rows: 1 };
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const moves: GridMove[] = keys.slice(1).map(key => ({ key, ref: keys[0], position: 'center' as const }));
  for (let r = 1; r < rows; r++) moves.push({ key: keys[r * cols], ref: keys[(r - 1) * cols], position: 'bottom' });
  for (let r = 0; r < rows; r++) {
    for (let c = 1; c < cols; c++) {
      const i = r * cols + c;
      if (i < n) moves.push({ key: keys[i], ref: keys[i - 1], position: 'right' });
    }
  }
  return { moves, cols, rows };
}
