import { describe, expect, it } from 'vitest';
import type { StatsResult, StatsSummary } from './statsApi';
import { DEFAULT_RULES as D } from './statsJudge';

// 판정 논리 시험 — 고정한 규칙으로(기본값 1.3배·1000ms 와 상관없이)
const DEFAULT_RULES = { ...D, slowRatio: 1.5, slowMinMs: 100 };
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
    { service: '/x/cj.com.SlowService.get<x>', current: s({ avg_ms: 900 }), baseline: s() },
    { service: '/err', current: s({ error_rate: 0.19, avg_ms: 900 }), baseline: s({ error_rate: 0.05 }) },
    { service: '/gone', current: null, baseline: s() },
  ],
};

describe('statsReport', () => {
  const series = [{ t: 10 * H, count: 10, errors: 0, avg_ms: 900, max_ms: 1000 }, { t: 10 * H + 300_000, count: 10, errors: 0, avg_ms: 950, max_ms: 1000 }];
  const html = statsReport(r, DEFAULT_RULES, new Map([['/x/cj.com.SlowService.get<x>', { ...r.services[1], current: s({ avg_ms: 900, series }) }]]), x => x);

  it('바깥 자원 없이 한 장, 글자는 이스케이프', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<script|<link|src=|https?:/);
    expect(html).toContain('&lt;b&gt;보고서&lt;/b&gt;');
    expect(html).toContain('<svg');
  });

  it('용어는 기준·과거, 머리글 두 줄, 서비스 끝부분은 진하게', () => {
    expect(html).not.toMatch(/현재|평소/);
    expect(html).toContain('<span class="pill ref"');
    expect(html).toContain('<span class="pill past"');
    expect(html).toMatch(/<th class="g cur" title="[^"]+"><span class="pill ref">기준<\/span><\/th><th title="[^"]+"><span class="pill past">과거<\/span><\/th><th title="[^"]+">과거 대비<\/th>/);
    expect(html).toContain('<b>SlowService.get&lt;x&gt;</b>');
  });

  it('판정별로 묶고 더 나쁜 쪽에만 — 에러 증가가 먼저, 이유와 배수·%p', () => {
    const e = html.indexOf('<h2>에러 증가 <span class="count">1</span></h2>');
    expect(e).toBeGreaterThan(-1);
    expect(html.indexOf('<h2>느려짐 <span class="count">1</span></h2>')).toBeGreaterThan(e);
    expect(html).toContain('+14.0%p');
    expect(html).toContain('×4.5');
    expect(html).toContain('<span class="bad">×4.5</span>');
    expect(html).not.toContain('/gone');
  });

  it('용어 설명 — 머리글 툴팁과 끝의 용어 상자', () => {
    expect(html).toMatch(/<th colspan="3" class="g" title="p90 \(90번째 백분위\)/);
    expect(html).toContain('<div class="gloss">');
    expect(html).toContain('<dt>p99 (99번째 백분위)</dt>');
    expect(html).toContain('<dt>느려짐</dt>');
  });

  it('esc', () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
