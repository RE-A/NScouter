// 저장해 둔 값을 읽어 올 때의 계약
//
// 여기서 지키려는 것은 하나다: **못 쓸 값이 화면을 망가뜨리지 않는다.**
// config.json 은 사람이 여는 파일이고, 항목이 늘어나는 중이라 예전 파일도 남아 있다.

import { describe, expect, it } from 'vitest';
import {
  toLayout,
  fromLayout,
  toChartConfig,
  fromChartConfig,
  toFilterState,
  fromFilterState,
  DEFAULT_LAYOUT,
  toTabs,
  fromTabs,
  fromSplit,
} from './uiState';
import { MAX_XLOG_TABS } from './xlogTabs';
import { DEFAULT_CHART_CONFIG, DEFAULT_FILTER } from '../types/xlog';
import type { XLogChartPrefs, XLogFilterPrefs } from '../api/scouterApi';

describe('toLayout', () => {
  it('저장해 둔 값을 그대로 쓴다', () => {
    const l = toLayout({ services_w: 260, detail_w: 640, table_h: 300, active_tab: 'counter', agent_group_by: 'type' });
    expect(l).toEqual({
      servicesW: 260,
      detailW: 640,
      tableH: 300,
      activeTab: 'counter',
      agentGroupBy: 'type',
    });
  });

  it('항목이 아예 없으면 기본값이다', () => {
    expect(toLayout(undefined)).toEqual(DEFAULT_LAYOUT);
  });

  it('**0 이나 음수는 기본값으로 돌린다**', () => {
    // 0 이 들어가면 패널이 사라진 채로 뜬다 — 화면만 봐서는 이유를 모른다
    const l = toLayout({ services_w: 0, detail_w: -10, table_h: 0, active_tab: 'xlog', agent_group_by: 'type' });
    expect(l.servicesW).toBe(DEFAULT_LAYOUT.servicesW);
    expect(l.detailW).toBe(DEFAULT_LAYOUT.detailW);
    expect(l.tableH).toBe(DEFAULT_LAYOUT.tableH);
  });

  it('숫자가 아니면 기본값이다', () => {
    const l = toLayout({
      services_w: NaN,
      detail_w: 'abc' as unknown as number,
      table_h: 240,
      active_tab: 'xlog',
      agent_group_by: 'type',
    });
    expect(l.servicesW).toBe(DEFAULT_LAYOUT.servicesW);
    expect(l.detailW).toBe(DEFAULT_LAYOUT.detailW);
    expect(l.tableH).toBe(240);
  });

  it('터무니없이 큰 값은 잘라 낸다', () => {
    // 모니터를 바꾸면 어제 맞던 값이 오늘 화면 밖이다
    const l = toLayout({ services_w: 99999, detail_w: 420, table_h: 240, active_tab: 'xlog', agent_group_by: 'type' });
    expect(l.servicesW).toBe(4000);
  });

  it('묶는 기준을 저장하고 되살린다', () => {
    const l = toLayout({
      services_w: 200,
      detail_w: 420,
      table_h: 240,
      active_tab: 'xlog',
      agent_group_by: 'group',
    });
    expect(l.agentGroupBy).toBe('group');
  });

  it('**모르는 기준이면 예전 동작(타입)이다**', () => {
    // 항목이 생기기 전 파일에는 이 값이 없다. 빈 값으로 두면 아무 묶음도 안 된다.
    const l = toLayout({
      services_w: 200,
      detail_w: 420,
      table_h: 240,
      active_tab: 'xlog',
      agent_group_by: 'nope',
    });
    expect(l.agentGroupBy).toBe('type');
    expect(toLayout({ services_w: 200, detail_w: 420, table_h: 240, active_tab: 'xlog' } as never)
      .agentGroupBy).toBe('type');
  });

  it('모르는 탭 이름이면 XLog 로 간다', () => {
    // 없는 탭으로 뜨면 빈 화면이 나온다
    const l = toLayout({ services_w: 200, detail_w: 420, table_h: 240, active_tab: 'nope', agent_group_by: 'type' });
    expect(l.activeTab).toBe('xlog');
  });

  it('넣었다 뺐을 때 값이 같다', () => {
    const l = {
      servicesW: 210,
      detailW: 500,
      tableH: 250,
      activeTab: 'alert' as const,
      agentGroupBy: 'group' as const,
    };
    expect(toLayout(fromLayout(l))).toEqual(l);
  });
});

describe('toChartConfig', () => {
  it('저장해 둔 값을 그대로 쓴다', () => {
    const c = toChartConfig({
      y_axis_mode: 'sqlTime',
      time_range_ms: 600_000,
      y_max: 30,
      show_ignore_area: true,
      show_density: false,
      ignore_threshold_ms: 100,
    });
    expect(c.yAxisMode).toBe('sqlTime');
    expect(c.timeRangeMs).toBe(600_000);
    expect(c.yMax).toBe(30);
    expect(c.showIgnoreArea).toBe(true);
    expect(c.ignoreThresholdMs).toBe(100);
  });

  it('항목이 없으면 기본값이다', () => {
    expect(toChartConfig(undefined)).toEqual(DEFAULT_CHART_CONFIG);
  });

  it('모르는 Y축 종류면 기본값으로 돌린다', () => {
    const c = toChartConfig({
      y_axis_mode: 'memory',
      time_range_ms: 300_000,
      y_max: 9,
      show_ignore_area: false,
      show_density: false,
      ignore_threshold_ms: 0,
    });
    expect(c.yAxisMode).toBe(DEFAULT_CHART_CONFIG.yAxisMode);
  });

  it('**무시 임계값 0 은 정상값이다**', () => {
    // 0 = «무시 안 함». 크기 검사에 걸려 기본값으로 튀면 안 된다
    const c = toChartConfig({
      y_axis_mode: 'elapsed',
      time_range_ms: 300_000,
      y_max: 9,
      show_ignore_area: false,
      show_density: false,
      ignore_threshold_ms: 0,
    });
    expect(c.ignoreThresholdMs).toBe(0);
  });

  it('색은 설정에 들어 있지 않다 — 테마가 정한다', () => {
    // 설정에 색을 남기면 앱이 뜨는 순간의 값이 굳어져, 테마를 바꿔도
    // XLog 차트만 옆 테마 색으로 남는다. 그릴 때 `colorPalette` 에서 읽는다.
    const c = toChartConfig({
      y_axis_mode: 'elapsed',
      time_range_ms: 300_000,
      y_max: 9,
      show_ignore_area: false,
      show_density: false,
      ignore_threshold_ms: 0,
    });
    expect('backgroundColor' in c).toBe(false);
    expect('gridColor' in c).toBe(false);
  });

  it('넣었다 뺐을 때 값이 같다', () => {
    const c = { ...DEFAULT_CHART_CONFIG, yAxisMode: 'apiCallCount' as const, yMax: 50 };
    const back = toChartConfig(fromChartConfig(c));
    expect(back.yAxisMode).toBe('apiCallCount');
    expect(back.yMax).toBe(50);
  });
});

describe('toFilterState — 껐다 켜도 조건이 남는다', () => {
  it('저장해 둔 조건을 그대로 되살린다', () => {
    const { filter, mode } = toFilterState({
      elapsed_ms: 1500,
      elapsed_exclude: true,
      error_only: true,
      obj_hashes: [11, 22],
      service_text: '/shop',
      service_exclude: false,
      ip_text: '10.0.',
      ip_exclude: true,
      patterns: [],
      mode: 'live',
    });

    expect(filter.elapsedMs).toBe(1500);
    expect(filter.elapsedExclude).toBe(true);
    expect(filter.errorOnly).toBe(true);
    expect([...filter.objHashSet]).toEqual([11, 22]);
    // 예전 판(한 칸짜리)으로 저장된 파일도 잃지 않는다 — 줄로 옮겨 온다
    expect(filter.patterns).toEqual([
      { field: 'service', text: '/shop', exclude: false },
      { field: 'ip', text: '10.0.', exclude: true },
    ]);
    expect(mode).toBe('live');
  });

  it('항목이 없으면(예전 파일) 조건 없음으로 뜬다', () => {
    const { filter, mode } = toFilterState(undefined);
    expect(filter.elapsedMs).toBe(0);
    expect(filter.errorOnly).toBe(false);
    expect(filter.objHashSet.size).toBe(0);
    expect(mode).toBe('live');
  });

  it('과거 모드는 되살리되 구간은 새로 잡는다', () => {
    // 모드는 «어디를 보고 있었나» 라서 되살린다. 다만 **구간은 담지 않는다** —
    // 어제 보던 «최근 1시간» 은 오늘 열면 남의 시간이라, 열 때 지금 기준으로 다시 잡힌다.
    const { mode } = toFilterState({
      elapsed_ms: 0, elapsed_exclude: false, error_only: false, obj_hashes: [],
      service_text: '', service_exclude: false, ip_text: '', ip_exclude: false,
      patterns: [], mode: 'past',
    });
    expect(mode).toBe('past');
  });

  it('숫자 자리에 글자가 들어와도 화면이 멀쩡하다', () => {
    // config.json 은 사람이 여는 파일이다.
    const { filter } = toFilterState({
      elapsed_ms: 'abc', elapsed_exclude: 'yes', error_only: 1, obj_hashes: 'nope',
      service_text: 42, service_exclude: null, ip_text: undefined, ip_exclude: 0,
      patterns: 'nope', mode: 7,
    } as never);

    expect(filter.elapsedMs).toBe(0);
    expect(filter.elapsedExclude).toBe(false);
    expect(filter.errorOnly).toBe(false);
    expect(filter.objHashSet.size).toBe(0);
    expect(filter.patterns).toEqual([]);
  });

  it('넣었다 뺐을 때 값이 같다', () => {
    const filter = {
      elapsedMs: 300,
      elapsedExclude: false,
      errorOnly: true,
      objHashSet: new Set([7]),
      patterns: [
        { field: 'service' as const, text: 'a', exclude: true },
        { field: 'ip' as const, text: 'b', exclude: false },
      ],
    };
    const back = toFilterState(fromFilterState(filter, 'past'));
    expect(back.filter).toEqual(filter);
    expect(back.mode).toBe('past');
  });
});

// ─── XLog 탭 저장·복원 ─────────────────────────────────────────

describe('XLog 탭', () => {
  // 파일은 사람이 여는 곳이라 항목이 빠질 수 있지만, 타입은 한 벌을 다 요구한다.
  // 시험에서는 기본값 위에 바꿀 것만 얹는다.
  const chart = (p: Partial<XLogChartPrefs>): XLogChartPrefs =>
    ({ ...fromChartConfig(DEFAULT_CHART_CONFIG), ...p });
  const filt = (p: Partial<XLogFilterPrefs>): XLogFilterPrefs =>
    ({ ...fromFilterState(DEFAULT_FILTER, 'live'), ...p });

  it('넣었다 뺐을 때 조건이 같다', () => {
    const s = toTabs(
      [
        { chart: chart({ y_axis_mode: 'cpu' }), filter: filt({ mode: 'past' }), stime: 100, etime: 200 },
        { chart: chart({ y_axis_mode: 'elapsed' }), filter: filt({ mode: 'live' }), stime: 0, etime: 0 },
      ],
      undefined,
      undefined,
    );
    expect(s.tabs).toHaveLength(2);
    expect(s.tabs[0].mode).toBe('past');
    expect(s.tabs[0].pastRange).toEqual({ stime: 100, etime: 200 });
    expect(s.tabs[1].pastRange).toBeNull();

    const back = fromTabs(s);
    expect(back[0].stime).toBe(100);
    expect(back[1].stime).toBe(0);
  });

  it('탭 목록이 없으면 옛 한 벌로 탭 하나를 만든다 — 빈 화면으로 시작하면 «설정이 날아갔다» 다', () => {
    const s = toTabs(undefined, chart({ y_axis_mode: 'sqlTime' }), filt({ mode: 'past' }));
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].config.yAxisMode).toBe('sqlTime');
    expect(s.tabs[0].mode).toBe('past');
  });

  it('붙인 이름이 남는다 — 비어 있으면 자동 이름이다', () => {
    const s = toTabs([{ title: '결제', stime: 0, etime: 0 }, { title: '  ', stime: 0, etime: 0 }], undefined, undefined);
    expect(s.tabs[0].title).toBe('결제');
    expect(s.tabs[1].title).toBeUndefined();
    const back = fromTabs(s);
    expect(back.map(t => t.title)).toEqual(['결제', '']);
  });

  it('탭마다 고른 서버가 남는다', () => {
    const s = toTabs([{ sel_services: ['pay'], sel_hashes: [5], stime: 0, etime: 0 }], undefined, undefined);
    expect([...s.tabs[0].selection.services]).toEqual(['pay']);
    expect([...s.tabs[0].selection.hashes]).toEqual([5]);
    const back = fromTabs(s);
    expect(back[0].sel_services).toEqual(['pay']);
    expect(back[0].sel_hashes).toEqual([5]);
  });

  it('고르기를 담기 전 파일은 풀린 해시를 낱개로 고른 것으로 되살린다', () => {
    const s = toTabs([{ filter: filt({ obj_hashes: [9, 8] }), stime: 0, etime: 0 }], undefined, undefined);
    expect([...s.tabs[0].selection.hashes].sort()).toEqual([8, 9]);
  });

  it('분할을 넣었다 빼면 같다', () => {
    const rows = [{ stime: 0, etime: 0 }, { stime: 0, etime: 0 }, { stime: 0, etime: 0 }];
    const s = toTabs(rows, undefined, undefined, { panes: [2, 0], active: 0, dir: 'column', ratio: 0.3 });
    expect(s.panes).toEqual([s.tabs[2].key, s.tabs[0].key]);
    expect(s.activeKey).toBe(s.tabs[0].key);
    expect(s.dir).toBe('column');
    expect(s.ratio).toBeCloseTo(0.3);
    expect(fromSplit(s)).toEqual({ panes: [2, 0], active: 0, dir: 'column', ratio: 0.3 });
  });

  it('못 쓸 분할은 버린다 — 없는 순번 · 같은 탭 두 번 · 안 띄운 지금 판', () => {
    const rows = [{ stime: 0, etime: 0 }, { stime: 0, etime: 0 }];
    const s = toTabs(rows, undefined, undefined, { panes: [1, 1, 7, -1], active: 0, dir: 'diag', ratio: 5 });
    expect(s.panes).toEqual([s.tabs[1].key]);
    expect(s.activeKey).toBe(s.tabs[1].key);
    expect(s.dir).toBe('row');
    expect(s.ratio).toBe(0.8);
  });

  it('구간이 0 이면 «안 정했다» 로 되돌린다', () => {
    const s = toTabs([{ stime: 0, etime: 0 }], undefined, undefined);
    expect(s.tabs[0].pastRange).toBeNull();
  });

  it('파일에 탭이 너무 많아도 상한까지만 연다', () => {
    const many = Array.from({ length: 20 }, () => ({ stime: 0, etime: 0 }));
    expect(toTabs(many, undefined, undefined).tabs.length).toBeLessThanOrEqual(MAX_XLOG_TABS);
  });

  it('처음 탭이 활성이다', () => {
    const s = toTabs([{ stime: 0, etime: 0 }, { stime: 1, etime: 2 }], undefined, undefined);
    expect(s.activeKey).toBe(s.tabs[0].key);
  });
});
