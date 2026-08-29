// 저장해 둔 값을 읽어 올 때의 계약
//
// 여기서 지키려는 것은 하나다: **못 쓸 값이 화면을 망가뜨리지 않는다.**
// config.json 은 사람이 여는 파일이고, 항목이 늘어나는 중이라 예전 파일도 남아 있다.

import { describe, expect, it } from 'vitest';
import { toLayout, fromLayout, toChartConfig, fromChartConfig, DEFAULT_LAYOUT } from './uiState';
import { DEFAULT_CHART_CONFIG } from '../types/xlog';

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
      ignore_threshold_ms: 0,
    });
    expect(c.ignoreThresholdMs).toBe(0);
  });

  it('색은 저장해 둔 것을 쓰지 않는다', () => {
    // 팔레트는 colorPalette.ts 한 곳에만 있어야 한다
    const c = toChartConfig({
      y_axis_mode: 'elapsed',
      time_range_ms: 300_000,
      y_max: 9,
      show_ignore_area: false,
      ignore_threshold_ms: 0,
    });
    expect(c.backgroundColor).toBe(DEFAULT_CHART_CONFIG.backgroundColor);
    expect(c.gridColor).toBe(DEFAULT_CHART_CONFIG.gridColor);
  });

  it('넣었다 뺐을 때 값이 같다', () => {
    const c = { ...DEFAULT_CHART_CONFIG, yAxisMode: 'apiCallCount' as const, yMax: 50 };
    const back = toChartConfig(fromChartConfig(c));
    expect(back.yAxisMode).toBe('apiCallCount');
    expect(back.yMax).toBe(50);
  });
});
