// 대시보드 목록 — 켤 때 만들기, 지금 것 적기, 더하기·지우기·되돌리기

import { describe, expect, it } from 'vitest';
import type { XLogTabPrefs } from '../api/scouterApi';
import {
  activeDashboard,
  addDashboard,
  loadDashboards,
  MAX_DASHBOARDS,
  presetDashboard,
  removeDashboard,
  renameDashboard,
  resetPreset,
  withCurrent,
} from './dashboards';
import { decodeDock } from './dockLayout';

const tab = (title: string): XLogTabPrefs => ({ title, sel_services: [], sel_hashes: [], stime: 0, etime: 0 });

describe('presetDashboard', () => {
  it('원본 기본 — XLog · Alert · EQ · 카운터 넷, 배치가 판과 딱 맞는다', () => {
    const d = presetDashboard('original');
    expect(d.tabs.map(t => t.kind ?? 'xlog')).toEqual(['xlog', 'alert', 'eq', 'counter', 'counter', 'counter', 'counter']);
    expect(d.tabs.filter(t => t.kind === 'counter').map(t => t.counter)).toEqual(['RecentUser', 'TPS', 'ElapsedTime', 'HeapUsed']);
    expect(d.tabs.every(t => t.pinned === false)).toBe(true);
    // 배치를 되살릴 수 있어야 한다 — 못 하면 예전 분할로 다시 짜 판이 한 묶음에 몰린다
    expect(decodeDock(d.split.dock, d.tabs.map((_, i) => `k${i}`))).not.toBeNull();
  });

  it('XLog 만 · 분석 · 카운터 위주 — 판 하나씩', () => {
    expect(presetDashboard('xlogOnly').tabs.map(t => t.kind ?? 'xlog')).toEqual(['xlog']);
    expect(presetDashboard('analysis').tabs.map(t => t.kind)).toEqual(['visualize']);
    expect(presetDashboard('counters').tabs.map(t => t.kind)).toEqual(['counterBoard']);
  });
});

describe('loadDashboards', () => {
  it('새로 설치 — 기본 제공 둘, 원본 기본부터', () => {
    const s = loadDashboards(undefined, undefined, [], undefined);
    expect(s.list.map(d => d.id)).toEqual(['original', 'xlogOnly', 'analysis', 'counters']);
    expect(s.activeId).toBe('original');
  });

  it('업데이트 — 예전 판을 «내 배치» 로, 화면은 그대로', () => {
    const s = loadDashboards([], '', [tab('a'), tab('b')], { panes: [0, 1] });
    expect(s.list.map(d => d.name)).toEqual(['내 배치', '원본 기본', 'XLog 만', '분석', '카운터 위주']);
    expect(s.activeId).toBe('mine');
    expect(activeDashboard(s).tabs.map(t => t.title)).toEqual(['a', 'b']);
  });

  it('목록이 있으면 지금 것의 판은 xlog_tabs 를 따른다 — 그쪽이 원본', () => {
    const saved = [
      { id: 'mine', name: '내 배치', tabs: [tab('old')], split: {} },
      { id: 'd1', name: '결제', tabs: [tab('p')], split: {} },
    ];
    const s = loadDashboards(saved, 'd1', [tab('new')], { panes: [0] });
    expect(s.activeId).toBe('d1');
    expect(s.list[1].tabs[0].title).toBe('new');
    expect(s.list[0].tabs[0].title).toBe('old');
  });

  it('깨진 항목·겹친 id 는 버리고, 없는 지금 id 는 첫 것으로', () => {
    const saved = [null, { id: '', name: 'x' }, { id: 'a', name: 'A' }, { id: 'a', name: 'A2' }, { id: 'b', name: ' ' }];
    const s = loadDashboards(saved, 'zz', [], undefined);
    expect(s.list.map(d => [d.id, d.name])).toEqual([['a', 'A'], ['b', 'b']]);
    expect(s.activeId).toBe('a');
  });
});

describe('바꾸기', () => {
  const base = loadDashboards(undefined, undefined, [], undefined);

  it('withCurrent — 지금 것만 갈아 적는다', () => {
    const s = withCurrent(base, [tab('z')], { panes: [0] });
    expect(activeDashboard(s).tabs[0].title).toBe('z');
    expect(s.list[1].tabs).toEqual(base.list[1].tabs);
  });

  it('addDashboard — 끝에, 겹치는 이름엔 순번, 꽉 차면 안 더한다', () => {
    const { state, id } = addDashboard(base, '원본 기본', [tab('c')], {});
    expect(id).toBe('d1');
    expect(state.list[state.list.length - 1].name).toBe('원본 기본 2');
    expect(state.list[state.list.length - 1].preset).toBeUndefined();
    let s = base;
    for (let i = 0; i < MAX_DASHBOARDS + 3; i++) s = addDashboard(s, 'x', [], {}).state;
    expect(s.list).toHaveLength(MAX_DASHBOARDS);
    expect(addDashboard(s, 'y', [], {}).id).toBeNull();
  });

  it('renameDashboard — 빈 이름은 무시', () => {
    expect(renameDashboard(base, 'original', ' 운영 ').list[0].name).toBe('운영');
    expect(renameDashboard(base, 'original', '  ')).toBe(base);
  });

  it('removeDashboard — 지금 것을 지우면 옆 것이 지금 것, 마지막 하나는 남긴다', () => {
    const s = removeDashboard(base, 'original');
    expect(s.list.map(d => d.id)).toEqual(['xlogOnly', 'analysis', 'counters']);
    expect(s.activeId).toBe('xlogOnly');
    let one = s;
    for (const id of ['analysis', 'counters']) one = removeDashboard(one, id);
    expect(removeDashboard(one, 'xlogOnly')).toBe(one);
  });

  it('resetPreset — 판만 처음 모양으로, 이름은 둔다', () => {
    const s = renameDashboard(withCurrent(base, [tab('z')], {}), 'original', '운영');
    const r = resetPreset(s, 'original');
    expect(r.list[0].name).toBe('운영');
    expect(r.list[0].tabs).toEqual(presetDashboard('original').tabs);
  });
});
