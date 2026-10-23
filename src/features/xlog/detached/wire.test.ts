// 메인 창 ↔ 뗀 창 주고받기의 계약
//
//   · Set 은 배열로 건너가고 되돌아오면 같은 내용이다
//   · 뗀 창이 보낸 patch 는 **서버 고르기를 못 바꾼다** — 고르기는 메인 창 왼쪽 목록에서만
//   · 창 이름은 탭 키에서 만들고, 주소의 질의로 탭 키를 되찾는다

import { describe, expect, it } from 'vitest';
import { applyPatch, detachedKeyFrom, filterFromWire, toWire, windowLabelOf, DETACHED_QUERY } from './wire';
import { activeTab, initialTabs, setResolved } from '../hooks/xlogTabs';
import type { XLogFilterState } from '../types/xlog';

describe('wire', () => {
  it('탭을 보내고 받으면 거름이 같다', () => {
    let s = initialTabs();
    s = setResolved(s, s.activeKey, new Set([3, 1]));
    const tab = activeTab(s);
    const w = JSON.parse(JSON.stringify(toWire(tab, '실시간')));
    const back = filterFromWire(w.filter);
    expect([...back.objHashSet].sort()).toEqual([1, 3]);
    expect(back.errorOnly).toBe(tab.filter.errorOnly);
    expect(w.label).toBe('실시간');
  });

  it('patch 로 서버 고르기는 못 바꾼다', () => {
    let s = initialTabs();
    s = setResolved(s, s.activeKey, new Set([7]));
    const tab = activeTab(s);
    const sneaky = { errorOnly: true, objHashSet: new Set([99]) } as Partial<XLogFilterState>;
    const out = applyPatch(tab, { filter: sneaky });
    expect(out.filter?.errorOnly).toBe(true);
    expect([...(out.filter?.objHashSet ?? [])]).toEqual([7]);
  });

  it('차트 설정은 덧씌운다', () => {
    const tab = activeTab(initialTabs());
    const out = applyPatch(tab, { config: { yMax: 30 } });
    expect(out.config).toEqual({ ...tab.config, yMax: 30 });
  });

  it('구간을 null 로 보내면 실시간으로 돌아간 것이다 — undefined 와 다르다', () => {
    const tab = activeTab(initialTabs());
    expect(applyPatch(tab, { pastRange: null })).toHaveProperty('pastRange', null);
    expect(applyPatch(tab, {})).not.toHaveProperty('pastRange');
  });

  it('창 이름과 주소', () => {
    expect(windowLabelOf('xlog-3')).toBe('detached-xlog-3');
    expect(detachedKeyFrom(`?${DETACHED_QUERY}=xlog-3`)).toBe('xlog-3');
    expect(detachedKeyFrom('')).toBeNull();
    expect(detachedKeyFrom(`?${DETACHED_QUERY}=`)).toBeNull();
  });
});
