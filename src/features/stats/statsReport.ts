// HTML 보고서 — 결과 한 장을 남에게 넘길 수 있게 파일 하나로
//
// **바깥 것을 하나도 부르지 않는다**(글꼴·스크립트·이미지). 독립망에서 메일로 받아 열어도 그대로 보여야 한다.
// 용어는 앱 표와 같다: **기준** = 살펴본 시점, **과거** = 견준 지난 시점. 표는 지표마다 «기준 | 과거 | 과거 대비»
// 세 칸이고 머리글이 두 줄이다. 특이사항은 판정별로 묶고, 그 서비스들의 5분 추이(SVG)를 붙인다.

import type { ServiceStats, StatsResult } from './statsApi';
import { FLAG_LABEL, FLAG_ORDER, judge, severity, type Flag, type JudgeRules } from './statsJudge';
import { flagReason, fmtMetric, fmtMetricVs, metricBad, metricValue, METRICS, splitService, type MetricKey } from './statsFormat';
import { overlay } from './statsSeries';

type Tr = (s: string) => string;

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

const int = (v: number) => Math.round(v).toLocaleString();

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function when(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function span(s: number, e: number) {
  const a = when(s);
  const b = when(e);
  return a.slice(0, 10) === b.slice(0, 10) ? `${a} – ${b.slice(11)}` : `${a} – ${b}`;
}

function metricHead(k: MetricKey, tr: Tr, pastRanges: number): string {
  switch (k) {
    case 'count':
      return pastRanges > 1 ? tr('건수 (과거는 구간당 평균)') : tr('건수');
    case 'avg':
      return tr('평균(ms)');
    case 'p90':
      return 'p90(ms)';
    case 'p99':
      return 'p99(ms)';
    case 'err':
      return tr('에러율');
  }
}

/** 5분 평균 응답시간 — 기준(실선) vs 과거(점선) */
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
  const pastRanges = Math.max(1, r.request.baselines.length);
  const rows = r.services
    .filter(s => s.current !== null)
    .map(s => ({ s, flags: judge(s, rules), score: severity(s, rules) }))
    .sort((a, b) => b.score - a.score);
  const notable = (f: Flag) => f !== 'few' && f !== 'gone';
  const flagged = rows.filter(x => x.flags.some(notable));
  const pats = r.request.task_patterns ?? [];
  const target = r.request.groups[0] ?? (pats.length > 0 ? pats : r.request.servers).join(', ');

  const head = `<thead><tr><th rowspan="2" class="l">${esc(tr('서비스'))}</th><th rowspan="2" class="l">${esc(tr('판정'))}</th>${METRICS.map(
    k => `<th colspan="3" class="g">${esc(metricHead(k, tr, pastRanges))}</th>`,
  ).join('')}</tr><tr class="sub">${METRICS.map(
    () => `<th class="g cur">${esc(tr('기준'))}</th><th>${esc(tr('과거'))}</th><th>${esc(tr('과거 대비'))}</th>`,
  ).join('')}</tr></thead>`;

  const svc = (name: string) => {
    const { head: h, tail } = splitService(name);
    return `<span class="h">${esc(h)}</span><b>${esc(tail)}</b>`;
  };
  const tableRow = ({ s, flags }: (typeof rows)[number]) => {
    const cells = METRICS.map(k => {
      const c = metricValue(s.current, k);
      const b = metricValue(s.baseline, k, pastRanges);
      const bad = metricBad(k, s, rules);
      return `<td class="n g cur">${fmtMetric(k, c)}</td><td class="n past">${fmtMetric(k, b)}</td><td class="n vs${bad ? ' bad' : ''}">${esc(fmtMetricVs(k, c, b))}</td>`;
    }).join('');
    const verdict = flags
      .map(f => {
        const why = flagReason(f, s, rules, tr);
        return `<span class="flag ${f}">${esc(tr(FLAG_LABEL[f]))}</span>${why ? ` <span class="why">${esc(why)}</span>` : ''}`;
      })
      .join('<br>');
    return `<tr><td class="svc">${svc(s.service)}</td><td class="v">${verdict}</td>${cells}</tr>`;
  };

  // 판정별로 묶는다 — 한 서비스가 둘에 걸리면 더 나쁜 쪽(FLAG_ORDER 앞)에만
  const primary = (flags: Flag[]) => flags.filter(notable).sort((x, y) => FLAG_ORDER.indexOf(x) - FLAG_ORDER.indexOf(y))[0];
  const sections = FLAG_ORDER.filter(notable)
    .map(f => ({ f, list: flagged.filter(x => primary(x.flags) === f) }))
    .filter(x => x.list.length > 0);
  const summary = sections.map(x => `${esc(tr(FLAG_LABEL[x.f]))} ${x.list.length}`).join(' · ');

  const detail = flagged
    .map(({ s }) => {
      const full = details.get(s.service);
      const svg = full ? spark(full, r) : '';
      return svg ? `<h3>${svc(s.service)}</h3>${svg}` : '';
    })
    .filter(x => x !== '')
    .join('\n');

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${esc(r.request.title)}</title>
<style>
body{font-family:system-ui,"Malgun Gothic",sans-serif;margin:24px;color:#1d1d2b;background:#fff}
h1{font-size:20px;margin:0 0 8px}h2{font-size:16px;margin:28px 0 6px}h3{font-size:13px;font-family:monospace;font-weight:normal;margin:16px 0 4px}
.meta{font-size:13px;color:#555;border-collapse:collapse}.meta td{padding:1px 12px 1px 0;border:0}.meta .k{color:#888}
.tag{display:inline-block;border-radius:3px;padding:0 6px;font-size:12px;font-weight:600}.tag.cur{background:#e3e9ff;color:#2f4fd1}.tag.past{background:#eee;color:#555}
.legend{font-size:12px;color:#666;margin:6px 0 0}
table.t{border-collapse:collapse;font-size:13px;margin-top:8px}
.t th,.t td{border-bottom:1px solid #e3e3ea;padding:4px 8px;vertical-align:top;text-align:right;white-space:nowrap}
.t th{background:#f5f5f8;font-weight:600}.t tr:first-child th.g{text-align:center}.t tr.sub th{font-weight:normal;font-size:11px;color:#666}.t th.l{text-align:left;vertical-align:bottom}
.t .g{border-left:1px solid #d5d5de}.t th.cur,.t td.cur{color:#1d1d2b}.t td.past{color:#888}.t td.vs{color:#999;font-size:12px}.t td.vs.bad{color:#d4380d;font-weight:600}
td.svc{text-align:left;font-family:monospace;white-space:normal;max-width:520px;overflow-wrap:anywhere}td.svc .h{display:block;color:#999;font-size:11px}td.svc b{color:#111}
td.v{text-align:left}.why{font-size:11px;color:#666}
.flag{border-radius:3px;padding:1px 6px;font-size:11px;white-space:nowrap}.flag.errors{background:#ffe1e0;color:#b4231b}
.flag.slow{background:#fff1d6;color:#a35c00}.flag.volume,.flag.new{background:#e3e9ff;color:#2f4fd1}.flag.few{color:#999}
svg .ax{stroke:#e3e3ea}svg .lb{font-size:10px;fill:#888}svg .cur{fill:none;stroke:#3b5bdb;stroke-width:1.8}
svg .base{fill:none;stroke:#999;stroke-width:1.3;stroke-dasharray:4 3}
</style></head><body>
<h1>${esc(r.request.title)}</h1>
<table class="meta">
<tr><td class="k">${esc(tr('대상'))}</td><td>${esc(target)}</td></tr>
<tr><td><span class="tag cur">${esc(tr('기준'))}</span></td><td>${span(r.request.current.stime, r.request.current.etime)}</td></tr>
<tr><td><span class="tag past">${esc(tr('과거'))}</span></td><td>${r.request.baselines.map(b => span(b.stime, b.etime)).join('<br>')}${pastRanges > 1 ? ` <span class="k">(${pastRanges}${esc(tr('개 구간을 합침'))})</span>` : ''}</td></tr>
<tr><td class="k">${esc(tr('서비스'))}</td><td>${rows.length} · ${esc(tr('특이사항'))} ${flagged.length}${summary ? ` (${summary})` : ''}</td></tr>
<tr><td class="k">${esc(tr('수집'))}</td><td>${esc(r.collectors.join(' + '))} · ${esc(tr('만든 시각'))} ${when(Date.now())}</td></tr>
</table>
<p class="legend">${esc(tr('지표마다 세 칸: 기준 값 | 과거 값 | 과거 대비 (2배 이상은 ×배수, 에러율은 %p 차이). 빨간 칸은 판정에 걸린 것.'))}</p>
${sections
  .map(x => `<h2>${esc(tr(FLAG_LABEL[x.f]))} (${x.list.length})</h2><table class="t">${head}<tbody>${x.list.map(tableRow).join('\n')}</tbody></table>`)
  .join('\n')}
${flagged.length === 0 ? `<h2>${esc(tr('특이사항'))}</h2><p class="legend">${esc(tr('특이사항이 없습니다'))}</p>` : ''}
${detail ? `<h2>${esc(tr('5분 평균 응답시간 — 실선 기준, 점선 과거'))}</h2>${detail}` : ''}
<h2>${esc(tr('전체 서비스'))} (${rows.length})</h2>
<table class="t">${head}<tbody>${rows.map(tableRow).join('\n')}</tbody></table>
</body></html>`;
}
