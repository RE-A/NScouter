// 떼어 낸 창 목록 — 메인 창이 적어 두고 설정에 남긴다
//
//   · 창 이름은 번호를 늘려 가며, 닫힌 창의 번호를 다시 안 쓴다
//   · 설정에서 못 쓸 것(이름이 틀림 · 탭 없음 · 같은 이름 두 번)은 버린다
//   · 자리를 안 알려 온 snapshot 은 적어 둔 자리를 지킨다
//   · 주소에서 창 이름을 되찾는다 — 메인 창이면 null

import { describe, expect, it } from 'vitest';
import { boundsOf, EMPTY_REGISTRY, fromConfig, nextLabel, remove, toConfig, upsert } from './registry';
import { windowLabelFrom, WINDOW_QUERY } from './protocol';
import type { XLogTabPrefs, XLogWindowPrefs } from '../api/scouterApi';

const TAB: XLogTabPrefs = { title: 'a', stime: 0, etime: 0 };
const SPLIT = { panes: [0], active: 0, dir: 'row', ratio: 0.5 };
const win = (label: string, tabs: XLogTabPrefs[] = [TAB]): XLogWindowPrefs =>
  ({ label, tabs, split: SPLIT, x: 0, y: 0, width: 0, height: 0 });

describe('registry', () => {
  it('창 이름은 번호를 늘려 간다', () => {
    expect(nextLabel(EMPTY_REGISTRY)).toBe('xlogwin-1');
    const r = upsert(EMPTY_REGISTRY, 'xlogwin-1', { tabs: [TAB], split: SPLIT });
    expect(nextLabel(r)).toBe('xlogwin-2');
  });

  it('닫힌 창의 번호를 다시 안 쓴다 — 늦게 온 알림이 새 창에 붙지 않게', () => {
    const r = remove(upsert(EMPTY_REGISTRY, 'xlogwin-3', { tabs: [TAB], split: SPLIT }), 'xlogwin-3');
    expect(nextLabel(r, new Set(['xlogwin-3']))).toBe('xlogwin-4');
  });

  it('설정에서 못 쓸 것은 버린다', () => {
    const r = fromConfig([win('xlogwin-1'), win('evil'), win('xlogwin-2', []), win('xlogwin-1')]);
    expect([...r.keys()]).toEqual(['xlogwin-1']);
  });

  it('자리를 안 알려 오면 적어 둔 자리를 지킨다', () => {
    let r = upsert(EMPTY_REGISTRY, 'xlogwin-1', { tabs: [TAB], split: SPLIT }, { x: 10, y: 20, width: 800, height: 500 });
    r = upsert(r, 'xlogwin-1', { tabs: [TAB, TAB], split: SPLIT }, null);
    const w = r.get('xlogwin-1')!;
    expect(w.tabs).toHaveLength(2);
    expect(boundsOf(w)).toEqual({ x: 10, y: 20, width: 800, height: 500 });
  });

  it('크기가 0 이면 자리를 모르는 것이다', () => {
    expect(boundsOf(win('xlogwin-1'))).toBeNull();
  });

  it('설정으로 넣었다 빼면 같다', () => {
    const list = [win('xlogwin-1'), win('xlogwin-5')];
    expect(toConfig(fromConfig(list))).toEqual(list);
  });

  it('없는 창을 지우면 그대로', () => {
    expect(remove(EMPTY_REGISTRY, 'xlogwin-1')).toBe(EMPTY_REGISTRY);
  });
});

describe('windowLabelFrom', () => {
  it('뗀 창 주소에서 창 이름을 되찾는다', () => {
    expect(windowLabelFrom(`?${WINDOW_QUERY}=xlogwin-2`)).toBe('xlogwin-2');
  });
  it('메인 창이거나 이름 꼴이 틀리면 null', () => {
    expect(windowLabelFrom('')).toBeNull();
    expect(windowLabelFrom(`?${WINDOW_QUERY}=../../etc`)).toBeNull();
  });
});
