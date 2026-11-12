import { describe, expect, it } from 'vitest';
import type { StatsResult, StatsSummary } from './statsApi';
import { DEFAULT_RULES } from './statsJudge';
import { esc, statsReport } from './statsReport';

const s = (over: Partial<StatsSummary> = {}): StatsSummary => ({
  count: 1000, errors: 0, error_rate: 0, tps: 1, avg_ms: 200, p50_ms: 150, p90_ms: 400, p95_ms: 500, p99_ms: 900,
  max_ms: 2000, sql_count_avg: 3, sql_ms_avg: 50, api_count_avg: 1, api_ms_avg: 20, cpu_ms_avg: 5,
  series: [], dist: [], slowest: [], errored: [], ...over,
});
const H = 3600_000;
const r: StatsResult = {
  id: '1', started_at: 0, finished_at: 0, status: 'done', message: null, collectors: ['A'], ranges: [],
  raw_path: null, raw_rows: 0, raw_error: null, raw_files: 0, folded: 0,
  request: {
    title: '<b>보고서</b>', groups: ['shop'], servers: [], task_patterns: [], current: { stime: 10 * H, etime: 11 * H },
    baselines: [{ stime: 9 * H, etime: 10 * H }], services: [], service_include: [], service_exclude: [], ip_include: [], ip_exclude: [],
    tz_offset_ms: 0, raw: false,
  },
  services: [
    { service: '/ok', current: s(), baseline: s() },
    { service: '/slow<x>', current: s({ avg_ms: 900 }), baseline: s() },
    { service: '/gone', current: null, baseline: s() },
  ],
};

describe('statsReport', () => {
  it('바깥 자원 없이 한 장 — 특이사항이 위에, 글자는 이스케이프', () => {
    const series = [{ t: 10 * H, count: 10, errors: 0, avg_ms: 900, max_ms: 1000 }, { t: 10 * H + 300_000, count: 10, errors: 0, avg_ms: 950, max_ms: 1000 }];
    const html = statsReport(r, DEFAULT_RULES, new Map([['/slow<x>', { ...r.services[1], current: s({ avg_ms: 900, series }) }]]), x => x);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<script|<link|src=|https?:/);
    expect(html).toContain('&lt;b&gt;보고서&lt;/b&gt;');
    expect(html).toContain('/slow&lt;x&gt;');
    expect(html).toContain('<svg');
    expect(html).toContain('특이사항 (1)');
    expect(html).not.toContain('/gone');
  });

  it('esc', () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
