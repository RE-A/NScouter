// HTML 보고서 — 결과 한 장을 남에게 넘길 수 있게 파일 하나로
//
// **바깥 것을 하나도 부르지 않는다**(글꼴·스크립트·이미지). 독립망에서 메일로 받아 열어도 그대로 보여야 한다.
// 용어는 앱 표와 같다: **기준** = 살펴본 시점, **과거** = 견준 지난 시점. 표는 지표마다 «기준 | 과거 | 과거 대비»
// 세 칸이고 머리글이 두 줄이다. 특이사항은 판정별로 묶고, 그 서비스들의 5분 추이(SVG)를 붙인다.

import type { ServiceStats, StatsResult } from './statsApi';
import { FLAG_LABEL, FLAG_ORDER, judge, severity, type Flag, type JudgeRules } from './statsJudge';
import { flagReason, fmtMetric, fmtMetricVs, metricBad, metricValue, METRICS, splitService, withPastView, type MetricKey } from './statsFormat';
import { overlay } from './statsSeries';
import { flagHelp, termHelp, type Term } from './statsGlossary';

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

function metricHead(k: MetricKey, tr: Tr): string {
  switch (k) {
    case 'count':
      return tr('건수');
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
  // 과거는 일자별 평균으로 (앱 표와 같다)
  const rows = withPastView(r.services, pastRanges)
    .filter(s => s.current !== null)
    .map(s => ({ s, flags: judge(s, rules), score: severity(s, rules) }))
    .sort((a, b) => b.score - a.score);
  const notable = (f: Flag) => f !== 'few' && f !== 'gone';
  const flagged = rows.filter(x => x.flags.some(notable));
  const pats = r.request.task_patterns ?? [];
  const target = r.request.groups[0] ?? (pats.length > 0 ? pats : r.request.servers).join(', ');

  const tip = (k: Term) => ` title="${esc(termHelp(k))}"`;
  const head = `<thead><tr><th rowspan="2" class="l">${esc(tr('서비스'))}</th><th rowspan="2" class="l"${tip('verdict')}><span class="help">${esc(tr('판정'))}</span></th>${METRICS.map(
    k => `<th colspan="3" class="g"${tip(k)}><span class="help">${esc(metricHead(k, tr))}</span></th>`,
  ).join('')}</tr><tr class="sub">${METRICS.map(
    () => `<th class="g cur"${tip('ref')}><span class="pill ref">${esc(tr('기준'))}</span></th><th${tip('past')}><span class="pill past">${esc(tr('과거'))}</span></th><th${tip('vs')}>${esc(tr('과거 대비'))}</th>`,
  ).join('')}</tr></thead>`;

  const svc = (name: string) => {
    const { head: h, tail } = splitService(name);
    return `<span class="h">${esc(h)}</span><b>${esc(tail)}</b>`;
  };
  const tableRow = ({ s, flags }: (typeof rows)[number]) => {
    const cells = METRICS.map(k => {
      const c = metricValue(s.current, k);
      const b = metricValue(s.baseline, k);
      const bad = metricBad(k, s, rules);
      const vs = fmtMetricVs(k, c, b);
      return `<td class="n g cur">${fmtMetric(k, c)}</td><td class="n past">${fmtMetric(k, b)}</td><td class="n vs">${vs ? (bad ? `<span class="bad">${esc(vs)}</span>` : esc(vs)) : ''}</td>`;
    }).join('');
    const verdict = flags
      .map(f => {
        const why = flagReason(f, s, rules, tr);
        return `<span class="flag ${f}" title="${esc(flagHelp(f, rules))}">${esc(tr(FLAG_LABEL[f]))}</span>${why ? ` <span class="why">${esc(why)}</span>` : ''}`;
      })
      .join('<br>');
    return `<tr><td class="svc">${svc(s.service)}</td><td class="v">${verdict}</td>${cells}</tr>`;
  };

  // 판정별로 묶는다 — 한 서비스가 둘에 걸리면 더 나쁜 쪽(FLAG_ORDER 앞)에만
  const primary = (flags: Flag[]) => flags.filter(notable).sort((x, y) => FLAG_ORDER.indexOf(x) - FLAG_ORDER.indexOf(y))[0];
  const sections = FLAG_ORDER.filter(notable)
    .map(f => ({ f, list: flagged.filter(x => primary(x.flags) === f) }))
    .filter(x => x.list.length > 0);
  

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
:root{--ink:#1d1d2b;--muted:#5d6472;--faint:#8a90a0;--line:#e4e6ee;--soft:#f6f7fb;--accent:#3b5bdb;--accent-soft:#e7ecff;--bad:#c92a2a;--bad-soft:#ffe3e3;--warn:#a35c00;--warn-soft:#fff1d6}
*{box-sizing:border-box}
body{font-family:system-ui,"Malgun Gothic","Apple SD Gothic Neo",sans-serif;margin:0;padding:32px 40px;color:var(--ink);background:#fff;line-height:1.45}
h1{font-size:22px;margin:0 0 14px;letter-spacing:-0.01em}h2{font-size:16px;margin:32px 0 8px;display:flex;align-items:center;gap:8px}
h2 .count{font-size:12px;font-weight:600;color:var(--muted);background:var(--soft);border-radius:999px;padding:1px 9px}
h3{font-size:13px;font-family:ui-monospace,Consolas,monospace;font-weight:normal;margin:18px 0 4px}
.head{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;border:1px solid var(--line);border-radius:10px;padding:16px 20px;background:var(--soft)}
.meta{font-size:13px;color:var(--muted);border-collapse:collapse}.meta td{padding:2px 14px 2px 0;border:0;vertical-align:top}.meta .k{color:var(--faint)}
.kpis{display:flex;gap:10px;flex-wrap:wrap;margin-left:auto}
.kpi{border:1px solid var(--line);background:#fff;border-radius:8px;padding:8px 14px;min-width:96px}.kpi .l{font-size:11px;color:var(--muted)}.kpi .v{font-size:20px;font-weight:700}
.kpi.errors .v{color:var(--bad)}.kpi.slow .v{color:var(--warn)}.kpi.volume .v,.kpi.new .v{color:var(--accent)}
.pill{display:inline-block;border-radius:999px;padding:0 8px;font-size:11px;font-weight:600}.pill.ref{background:var(--accent-soft);color:var(--accent)}.pill.past{background:#eceef3;color:var(--muted)}
.legend{font-size:12px;color:var(--muted);margin:10px 2px 0}
.help{text-decoration:underline dotted var(--faint);text-underline-offset:3px;cursor:help}
.wrap{border:1px solid var(--line);border-radius:10px;overflow:hidden;display:inline-block;max-width:100%}
table.t{border-collapse:collapse;font-size:13px}
.t th,.t td{border-bottom:1px solid var(--line);padding:6px 9px;vertical-align:top;text-align:right;white-space:nowrap}
.t thead th{background:var(--soft);font-weight:600;color:var(--muted)}.t tr.sub th{font-weight:normal;font-size:11px}.t th.l{text-align:left;vertical-align:bottom}
.t tr:first-child th.g{text-align:center;color:var(--ink)}
.t tbody tr:nth-child(even){background:#fbfbfd}.t tbody tr:last-child td{border-bottom:0}
.t .g{border-left:1px solid var(--line)}.t td.cur{background:rgba(59,91,219,.05);font-weight:600}.t td.past{color:var(--faint)}.t td.vs{color:var(--faint);font-size:12px}
.t .bad{display:inline-block;border-radius:999px;padding:0 7px;background:var(--bad-soft);color:var(--bad);font-weight:700}
td.svc{text-align:left;font-family:ui-monospace,Consolas,monospace;white-space:normal;max-width:520px;overflow-wrap:anywhere}td.svc .h{display:block;color:var(--faint);font-size:11px}td.svc b{color:#111}
td.v{text-align:left}.why{font-size:11px;color:var(--muted)}
.flag{border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;white-space:nowrap;cursor:help}.flag.errors{background:var(--bad-soft);color:var(--bad)}
.flag.slow{background:var(--warn-soft);color:var(--warn)}.flag.volume,.flag.new{background:var(--accent-soft);color:var(--accent)}.flag.few{color:var(--faint)}
.gloss{margin-top:36px;border:1px solid var(--line);border-radius:10px;padding:14px 20px;background:var(--soft);font-size:12px;color:var(--muted)}
.gloss dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px;margin:8px 0 0}.gloss dt{font-weight:700;color:var(--ink)}.gloss dd{margin:0;white-space:pre-line}
svg .ax{stroke:var(--line)}svg .lb{font-size:10px;fill:var(--faint)}svg .cur{fill:none;stroke:var(--accent);stroke-width:1.8}
svg .base{fill:none;stroke:#999;stroke-width:1.3;stroke-dasharray:4 3}
@media print{body{padding:12px}.wrap{overflow:visible}}
</style></head><body>
<h1>${esc(r.request.title)}</h1>
<div class="head">
<table class="meta">
<tr><td class="k">${esc(tr('대상'))}</td><td>${esc(target)}</td></tr>
<tr><td><span class="pill ref" title="${esc(termHelp('ref'))}">${esc(tr('기준'))}</span></td><td>${span(r.request.current.stime, r.request.current.etime)}</td></tr>
<tr><td><span class="pill past" title="${esc(termHelp('past'))}">${esc(tr('과거'))}</span></td><td>${r.request.baselines.map(b => span(b.stime, b.etime)).join('<br>')}${pastRanges > 1 ? ` <span class="k">(${pastRanges}${esc(tr('개 구간'))} · ${esc(tr('과거 값은 일평균'))})</span>` : ''}</td></tr>
<tr><td class="k">${esc(tr('수집'))}</td><td>${esc(r.collectors.join(' + '))} · ${esc(tr('만든 시각'))} ${when(Date.now())}</td></tr>
</table>
<div class="kpis">
<div class="kpi"><div class="l">${esc(tr('서비스'))}</div><div class="v">${rows.length}</div></div>
<div class="kpi"><div class="l">${esc(tr('특이사항'))}</div><div class="v">${flagged.length}</div></div>
${sections.map(x => `<div class="kpi ${x.f}" title="${esc(flagHelp(x.f, rules))}"><div class="l">${esc(tr(FLAG_LABEL[x.f]))}</div><div class="v">${x.list.length}</div></div>`).join('')}
</div>
</div>
<p class="legend">${esc(tr('지표마다 세 칸: 기준 값 | 과거 값 | 과거 대비 (2배 이상은 ×배수, 에러율은 %p 차이). 빨간 칸은 판정에 걸린 것.'))}</p>
${sections
  .map(x => `<h2>${esc(tr(FLAG_LABEL[x.f]))} <span class="count">${x.list.length}</span></h2><div class="wrap"><table class="t">${head}<tbody>${x.list.map(tableRow).join('\n')}</tbody></table></div>`)
  .join('\n')}
${flagged.length === 0 ? `<h2>${esc(tr('특이사항'))}</h2><p class="legend">${esc(tr('특이사항이 없습니다'))}</p>` : ''}
${detail ? `<h2>${esc(tr('5분 평균 응답시간 — 실선 기준, 점선 과거'))}</h2>${detail}` : ''}
<h2>${esc(tr('전체 서비스'))} <span class="count">${rows.length}</span></h2>
<div class="wrap"><table class="t">${head}<tbody>${rows.map(tableRow).join('\n')}</tbody></table></div>
<div class="gloss"><b>${esc(tr('용어 설명'))}</b><dl>
${(['ref', 'past', 'vs', 'count', 'avg', 'p90', 'p99', 'err'] as Term[])
  .map(k => {
    const [name, ...rest] = termHelp(k).split(' — ');
    return `<dt>${esc(name)}</dt><dd>${esc(rest.join(' — '))}</dd>`;
  })
  .join('\n')}
${FLAG_ORDER.filter(notable).map(f => `<dt>${esc(tr(FLAG_LABEL[f]))}</dt><dd>${esc(flagHelp(f, rules).split(' — ').slice(1).join(' — '))}</dd>`).join('\n')}
</dl></div>
</body></html>`;
}
