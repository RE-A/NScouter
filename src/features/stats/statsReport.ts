// HTML 보고서 — 결과 한 장을 남에게 넘길 수 있게 파일 하나로
//
// **바깥 것을 하나도 부르지 않는다**(글꼴·스크립트·이미지). 독립망에서 메일로 받아 열어도 그대로 보여야 한다.
// 차트는 SVG 를 글자로 박는다. 특이사항이 있는 서비스는 5분 추이(현재 vs 평소)를 붙인다.

import type { ServiceStats, StatsResult, StatsSummary } from './statsApi';
import { change, FLAG_LABEL, judge, severity, type JudgeRules } from './statsJudge';
import { overlay } from './statsSeries';

type Tr = (s: string) => string;

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

const int = (v: number) => Math.round(v).toLocaleString();
const rate = (v: number) => `${(v * 100).toFixed(2)}%`;

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function when(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function cell(cur: number | undefined, base: number | undefined, fmt: (v: number) => string): string {
  const c = change(cur, base);
  const p = c === null ? 0 : Math.round(c * 100);
  const d = Math.abs(p) < 10 ? '' : `<span class="${p >= 50 ? 'bad' : 'dim'}">${p > 0 ? '▲' : '▼'}${Math.abs(p)}%</span>`;
  return `<td class="n">${cur === undefined ? '–' : fmt(cur)} ${d}<br><span class="dim">${base === undefined ? '–' : fmt(base)}</span></td>`;
}

/** 5분 평균 응답시간 — 현재(실선) vs 평소(점선) */
function spark(full: ServiceStats, r: StatsResult): string {
  const slots = overlay(full.current?.series ?? [], full.baseline?.series ?? [], r.request.current, r.request.baselines);
  if (slots.length < 2) return '';
  const W = 520;
  const H = 90;
  const max = Math.max(1, ...slots.flatMap(s => [s.cur.avg ?? 0, s.base.avg ?? 0])) * 1.1;
  const X = (i: number) => ((i / (slots.length - 1)) * (W - 50) + 45).toFixed(1);
  const Y = (v: number) => (H - 14 - (v / max) * (H - 22)).toFixed(1);
  const path = (get: (i: number) => number | null) => {
    let d = '';
    let pen = false;
    slots.forEach((_, i) => {
      const v = get(i);
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${X(i)},${Y(v)} `;
      pen = true;
    });
    return d.trim();
  };
  const hm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">
<line x1="45" y1="${Y(0)}" x2="${W - 5}" y2="${Y(0)}" class="ax"/><line x1="45" y1="${Y(max / 1.1)}" x2="${W - 5}" y2="${Y(max / 1.1)}" class="ax"/>
<text x="40" y="${Y(max / 1.1)}" class="lb" text-anchor="end">${int(max / 1.1)}</text><text x="40" y="${Y(0)}" class="lb" text-anchor="end">0</text>
<text x="45" y="${H - 2}" class="lb">${hm(r.request.current.stime)}</text><text x="${W - 5}" y="${H - 2}" class="lb" text-anchor="end">${hm(r.request.current.etime)}</text>
<path d="${path(i => slots[i].base.avg)}" class="base"/><path d="${path(i => slots[i].cur.avg)}" class="cur"/></svg>`;
}

export function statsReport(
  r: StatsResult,
  rules: JudgeRules,
  /** 특이사항 서비스의 전부(추이 포함) — 이름으로 찾는다 */
  details: ReadonlyMap<string, ServiceStats>,
  tr: Tr,
): string {
  const rows = r.services
    .filter(s => s.current !== null)
    .map(s => ({ s, flags: judge(s, rules), score: severity(s, rules) }))
    .sort((a, b) => b.score - a.score);
  const flagged = rows.filter(x => x.flags.some(f => f !== 'few' && f !== 'gone'));
  const pats = r.request.task_patterns ?? [];
  const target = r.request.groups[0] ?? (pats.length > 0 ? pats : r.request.servers).join(', ');
  const m = (s: StatsSummary | null) => s ?? undefined;
  const tableRow = ({ s, flags }: (typeof rows)[number]) => {
    const c = m(s.current);
    const b = m(s.baseline);
    return `<tr><td class="svc">${esc(s.service)}</td><td>${flags.map(f => `<span class="flag ${f}">${esc(tr(FLAG_LABEL[f]))}</span>`).join(' ')}</td>
${cell(c?.count, b?.count, int)}${cell(c?.avg_ms, b?.avg_ms, int)}${cell(c?.p90_ms, b?.p90_ms, int)}${cell(c?.p99_ms, b?.p99_ms, int)}${cell(c?.error_rate, b?.error_rate, rate)}</tr>`;
  };
  const head = `<tr><th>${esc(tr('서비스'))}</th><th>${esc(tr('판정'))}</th><th>${esc(tr('건수'))}</th><th>${esc(tr('평균(ms)'))}</th><th>p90(ms)</th><th>p99(ms)</th><th>${esc(tr('에러율'))}</th></tr>`;
  const detail = flagged
    .map(({ s }) => {
      const full = details.get(s.service);
      const svg = full ? spark(full, r) : '';
      return svg ? `<h3>${esc(s.service)}</h3>${svg}` : '';
    })
    .join('\n');

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${esc(r.request.title)}</title>
<style>
body{font-family:system-ui,"Malgun Gothic",sans-serif;margin:24px;color:#1d1d2b;background:#fff}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}h3{font-size:13px;font-family:monospace;margin:16px 0 4px}
.meta{color:#666;font-size:13px}table{border-collapse:collapse;font-size:13px;margin-top:8px}
th,td{border-bottom:1px solid #e3e3ea;padding:4px 10px;vertical-align:top;text-align:left}th{background:#f5f5f8;font-weight:600}
td.n{text-align:right;white-space:nowrap}td.svc{font-family:monospace}.dim{color:#888;font-size:11px}.bad{color:#d4380d;font-size:11px}
.flag{border-radius:3px;padding:1px 6px;font-size:11px;white-space:nowrap}.flag.errors{background:#ffe1e0;color:#b4231b}
.flag.slow{background:#fff1d6;color:#a35c00}.flag.volume,.flag.new{background:#e3e9ff;color:#2f4fd1}.flag.few{color:#999}
svg .ax{stroke:#e3e3ea}svg .lb{font-size:10px;fill:#888}svg .cur{fill:none;stroke:#3b5bdb;stroke-width:1.8}
svg .base{fill:none;stroke:#999;stroke-width:1.3;stroke-dasharray:4 3}
</style></head><body>
<h1>${esc(r.request.title)}</h1>
<div class="meta">${esc(tr('대상'))}: ${esc(target)} · ${esc(tr('현재'))} ${when(r.request.current.stime)} – ${when(r.request.current.etime)} · ${esc(tr('평소'))} ${r.request.baselines.map(b => `${when(b.stime)} – ${when(b.etime)}`).join(', ')}</div>
<div class="meta">${esc(tr('서비스'))} ${rows.length} · ${esc(tr('특이사항'))} ${flagged.length} · ${esc(tr('수집'))} ${esc(r.collectors.join(' + '))} · ${esc(tr('만든 시각'))} ${when(Date.now())}</div>
<h2>${esc(tr('특이사항'))} (${flagged.length})</h2>
${flagged.length > 0 ? `<table>${head}${flagged.map(tableRow).join('\n')}</table>` : `<p class="meta">${esc(tr('특이사항이 없습니다'))}</p>`}
${detail ? `<h2>${esc(tr('5분 평균 응답시간 — 실선 현재, 점선 평소'))}</h2>${detail}` : ''}
<h2>${esc(tr('전체 서비스'))} (${rows.length})</h2>
<table>${head}${rows.map(tableRow).join('\n')}</table>
</body></html>`;
}
