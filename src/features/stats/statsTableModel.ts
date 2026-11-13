// 비교 표의 열 — 정렬과 너비
//
// 열 이름: `service` · `verdict` · `{지표}.cur|past|vs` (예: `p90.vs`). 너비는 이 이름으로 설정에 남는다.
// 정렬: 같은 머리를 다시 누르면 방향이 바뀐다. **값이 없는 줄(과거에 없음 등)은 방향과 상관없이 맨 아래** —
// 오름차순에서 빈 값이 위로 오면 정작 볼 줄이 밀린다.

import type { ServiceStats } from './statsApi';
import { change } from './statsJudge';
import { metricValue, METRICS, type MetricKey } from './statsFormat';

export type Side = 'cur' | 'past' | 'vs';
export type ColId = 'service' | 'verdict' | `${MetricKey}.${Side}`;

export const SIDES: Side[] = ['cur', 'past', 'vs'];

export const COLS: ColId[] = ['service', 'verdict', ...METRICS.flatMap(k => SIDES.map(s => `${k}.${s}` as ColId))];

export interface SortState {
  col: ColId;
  dir: 'asc' | 'desc';
}

/** 처음 정렬 — 나빠진 순 */
export const DEFAULT_SORT: SortState = { col: 'verdict', dir: 'desc' };

/** 머리를 눌렀다 — 같은 열이면 방향만 바꾸고, 다른 열이면 숫자는 큰 것부터·이름은 가나다순 */
export function nextSort(prev: SortState, col: ColId): SortState {
  if (prev.col === col) return { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
  return { col, dir: col === 'service' ? 'asc' : 'desc' };
}

/** 정렬에 쓸 값. 없으면 null */
export function sortValue(row: ServiceStats, col: ColId, score: number, pastRanges: number): number | string | null {
  if (col === 'service') return row.service;
  if (col === 'verdict') return score;
  const [k, side] = col.split('.') as [MetricKey, Side];
  const c = metricValue(row.current, k);
  const b = metricValue(row.baseline, k, pastRanges);
  if (side === 'cur') return c ?? null;
  if (side === 'past') return b ?? null;
  if (c === undefined || b === undefined) return null;
  // 과거 대비 — 에러율은 %p 차이, 나머지는 비율
  return k === 'err' ? c - b : change(c, b);
}

export function sortRows<T extends { row: ServiceStats; score: number }>(list: T[], s: SortState, pastRanges: number): T[] {
  const sign = s.dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const x = sortValue(a.row, s.col, a.score, pastRanges);
    const y = sortValue(b.row, s.col, b.score, pastRanges);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    if (typeof x === 'string' || typeof y === 'string') return sign * String(x).localeCompare(String(y));
    return sign * (x - y);
  });
}

/** 기본 너비(px) */
export function defaultWidth(col: ColId): number {
  if (col === 'service') return 340;
  if (col === 'verdict') return 230;
  return col.endsWith('.vs') ? 74 : col.startsWith('count.') ? 62 : 76;
}

export const MIN_WIDTH = 44;
const MIN_SERVICE = 120;
const MAX_WIDTH = 1200;

export function clampWidth(col: ColId, w: number): number {
  return Math.round(Math.min(MAX_WIDTH, Math.max(col === 'service' ? MIN_SERVICE : MIN_WIDTH, w)));
}

/** 설정에서 읽은 너비 — 모르는 열·못 쓸 값은 버린다 */
export function parseWidths(raw: unknown): Partial<Record<ColId, number>> {
  const out: Partial<Record<ColId, number>> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if ((COLS as string[]).includes(k) && typeof v === 'number' && Number.isFinite(v) && v > 0) out[k as ColId] = clampWidth(k as ColId, v);
  }
  return out;
}
