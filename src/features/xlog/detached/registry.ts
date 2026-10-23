// 메인 창이 적어 두는 «떼어 낸 창 목록» (순수 함수).
//
// 창마다 띄운 탭·분할과 자리를 들고 있다가 설정 파일(`xlog_windows`)에 남긴다 — 켜면 같은 자리에
// 같은 창들을 다시 연다. 창이 바뀐 것을 알려 올 때(snapshot)마다 고친다.

import type { XLogWindowPrefs } from '../api/scouterApi';
import { isWindowLabel, type WindowBounds, type WindowContent } from './protocol';

export type Registry = ReadonlyMap<string, XLogWindowPrefs>;

export const EMPTY_REGISTRY: Registry = new Map();

/** 다음 창 이름. 닫힌 창의 번호는 다시 안 쓴다 — 늦게 온 알림이 새 창에 붙지 않게 */
export function nextLabel(reg: Registry, used: ReadonlySet<string> = new Set()): string {
  let max = 0;
  for (const l of [...reg.keys(), ...used]) {
    const n = Number(l.slice('xlogwin-'.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `xlogwin-${max + 1}`;
}

/** 설정 파일 → 목록. **못 쓸 것은 버린다** — 이름이 틀렸거나 탭이 없는 창 */
export function fromConfig(list: readonly XLogWindowPrefs[] | undefined): Registry {
  const out = new Map<string, XLogWindowPrefs>();
  for (const w of Array.isArray(list) ? list : []) {
    if (!w || !isWindowLabel(w.label) || out.has(w.label)) continue;
    if (!Array.isArray(w.tabs) || w.tabs.length === 0) continue;
    out.set(w.label, w);
  }
  return out;
}

export function toConfig(reg: Registry): XLogWindowPrefs[] {
  return [...reg.values()];
}

/** 창의 탭·분할(·자리)을 적는다. 자리를 안 주면 적어 둔 자리를 둔다 */
export function upsert(reg: Registry, label: string, content: WindowContent, bounds?: WindowBounds | null): Registry {
  const prev = reg.get(label);
  const b = bounds ?? (prev ? { x: prev.x, y: prev.y, width: prev.width, height: prev.height } : null);
  const next = new Map(reg);
  next.set(label, {
    label,
    tabs: content.tabs,
    split: content.split,
    x: b?.x ?? 0,
    y: b?.y ?? 0,
    width: b?.width ?? 0,
    height: b?.height ?? 0,
  });
  return next;
}

export function remove(reg: Registry, label: string): Registry {
  if (!reg.has(label)) return reg;
  const next = new Map(reg);
  next.delete(label);
  return next;
}

/** 적어 둔 자리 — 크기가 0 이면 모르는 것이다 */
export function boundsOf(w: XLogWindowPrefs): WindowBounds | null {
  return w.width > 0 && w.height > 0 ? { x: w.x, y: w.y, width: w.width, height: w.height } : null;
}
