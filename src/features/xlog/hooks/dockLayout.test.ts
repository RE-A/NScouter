// 판 배치 저장·복원 — 탭 키는 켤 때마다 새로 붙으므로 순번으로 저장하고, 탭과 안 맞는 배치는 버린다

import { describe, expect, it } from 'vitest';
import type { SerializedDockview } from 'dockview-react';
import { decodeDock, encodeDock, opsFromSplit } from './dockLayout';

/** 판 둘을 좌우로, 오른쪽 묶음에 탭 둘 */
function layout(a: string, b: string, c: string): SerializedDockview {
  return {
    grid: {
      root: {
        type: 'branch',
        data: [
          { type: 'leaf', data: { views: [a], activeView: a, id: 'g1' }, size: 500 },
          { type: 'leaf', data: { views: [b, c], activeView: c, id: 'g2' }, size: 500 },
        ],
        size: 600,
      },
      width: 1000,
      height: 600,
      orientation: 'HORIZONTAL' as SerializedDockview['grid']['orientation'],
    },
    panels: {
      [a]: { id: a, contentComponent: 'xlog', title: 'A' },
      [b]: { id: b, contentComponent: 'xlog', title: 'B' },
      [c]: { id: c, contentComponent: 'xlog', title: 'C' },
    },
    activeGroup: 'g2',
  };
}

describe('encodeDock / decodeDock', () => {
  it('저장은 순번으로, 되살릴 때 그때의 키로 — 배치는 그대로', () => {
    const saved = encodeDock(layout('xlog-1', 'xlog-5', 'xlog-9'), ['xlog-1', 'xlog-5', 'xlog-9']);
    expect(saved).not.toBeNull();
    expect(Object.keys(saved!.panels)).toEqual(['t0', 't1', 't2']);
    expect(JSON.stringify(saved)).not.toContain('xlog-');

    const back = decodeDock(JSON.parse(JSON.stringify(saved)), ['k0', 'k1', 'k2']);
    expect(back).toEqual(layout('k0', 'k1', 'k2'));
  });

  it('탭에 없는 판이 있으면 저장하지 않는다', () => {
    expect(encodeDock(layout('a', 'b', 'x'), ['a', 'b', 'c'])).toBeNull();
  });

  it('탭과 안 맞는 배치는 버린다 — 탭 수가 다르거나 순번이 넘치거나 모양이 깨졌으면', () => {
    const saved = encodeDock(layout('a', 'b', 'c'), ['a', 'b', 'c'])!;
    expect(decodeDock(saved, ['k0', 'k1'])).toBeNull();
    expect(decodeDock(saved, ['k0', 'k1', 'k2', 'k3'])).toBeNull();
    expect(decodeDock({ grid: { root: { type: 'leaf', data: 'x' } }, panels: {} }, ['k0'])).toBeNull();
    expect(decodeDock(null, ['k0'])).toBeNull();
    expect(decodeDock('{}', ['k0'])).toBeNull();
  });

  it('떠 있는 판·팝아웃은 저장하지 않는다', () => {
    const json = { ...layout('a', 'b', 'c'), floatingGroups: [], popoutGroups: [] };
    const saved = encodeDock(json, ['a', 'b', 'c'])!;
    expect('floatingGroups' in saved).toBe(false);
    expect('popoutGroups' in saved).toBe(false);
  });
});

describe('opsFromSplit — 예전 분할을 판 배치로', () => {
  it('판 하나 — 나머지 탭은 그 판 묶음의 뒤쪽 탭', () => {
    expect(opsFromSplit(['a', 'b'], ['a'], 'row', 'a')).toEqual([
      { key: 'a' },
      { key: 'b', position: { referencePanel: 'a', direction: 'within' }, inactive: true },
    ]);
  });

  it('둘 — 방향을 따른다', () => {
    expect(opsFromSplit(['a', 'b'], ['a', 'b'], 'row', 'a')[1].position).toEqual({ referencePanel: 'a', direction: 'right' });
    expect(opsFromSplit(['a', 'b'], ['a', 'b'], 'column', 'a')[1].position).toEqual({ referencePanel: 'a', direction: 'below' });
  });

  it('셋 — 위에 둘, 아래에 하나를 가로로 길게', () => {
    const ops = opsFromSplit(['a', 'b', 'c'], ['a', 'b', 'c'], 'row', 'a');
    expect(ops.map(o => o.position)).toEqual([
      undefined,
      { referencePanel: 'a', direction: 'right' },
      { direction: 'below' },
    ]);
  });

  it('넷 — 2×2, 안 띄운 탭은 지금 판 묶음 뒤로', () => {
    const ops = opsFromSplit(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd'], 'row', 'c');
    expect(ops.slice(1, 4).map(o => o.position)).toEqual([
      { referencePanel: 'a', direction: 'right' },
      { referencePanel: 'a', direction: 'below' },
      { referencePanel: 'b', direction: 'below' },
    ]);
    expect(ops[4]).toEqual({ key: 'e', position: { referencePanel: 'c', direction: 'within' }, inactive: true });
  });

  it('없는 탭을 가리키는 판은 건너뛰고, 판이 없으면 첫 탭', () => {
    expect(opsFromSplit(['a', 'b'], ['zz'], 'row', 'zz')).toEqual([
      { key: 'a' },
      { key: 'b', position: { referencePanel: 'a', direction: 'within' }, inactive: true },
    ]);
    expect(opsFromSplit([], [], 'row', '')).toEqual([]);
  });
});
