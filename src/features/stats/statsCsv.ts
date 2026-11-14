// 비교 표를 CSV 한 장으로 — 서비스 한 줄에 기준·과거·과거 대비를 나란히
//
// 용어: **기준** = 살펴본 시점, **과거** = 견준 지난 시점. 과거가 여럿이면 과거 칸은 **일자별 평균**(`pastView`)이고, 건수 합계를 따로 둔다.
// (0.9.3 까지는 «현재 / 기준» 이라 적었다 — 그때의 «기준» 은 지금의 «과거» 다.)
// 엑셀에서 정렬·필터를 바로 걸 수 있게 머리글 한 줄 + 데이터만 둔다. 변화율은 계산하기 좋게 숫자(%)로 둔다.

import { csvCell } from '../xlog/components/summaryCsv';
import type { ServiceStats, StatsSummary } from './statsApi';
import { change, FLAG_LABEL, judge, type JudgeRules } from './statsJudge';
import { flagReason, fmtMetricVs, metricValue, METRICS, pastView, type MetricKey } from './statsFormat';

type Cell = string | number | null;

// 화면에서 쓰지 않는 p95·CPU·SQL/API 횟수는 뺐다(원본 CSV 에는 건마다 있다)
const SIDE_HEAD = ['건수', '에러', '에러율(%)', 'TPS', '평균(ms)', 'p50(ms)', 'p90(ms)', 'p99(ms)', '최대(ms)', 'SQL(ms)', 'API(ms)'];

const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** 한쪽 값들 */
function side(s: StatsSummary | null): Cell[] {
  if (!s) return SIDE_HEAD.map(() => null);
  return [
    r1(s.count), r1(s.errors), r3(s.error_rate * 100), r3(s.tps), r1(s.avg_ms), s.p50_ms, s.p90_ms, s.p99_ms, s.max_ms,
    r1(s.sql_ms_avg), r1(s.api_ms_avg),
  ];
}

/** 과거 대비 % (소수 첫째 자리). 계산할 수 없으면 빈 칸 */
function pct(cur: number | undefined, base: number | undefined): Cell {
  const c = change(cur, base);
  return c === null ? null : r1(c * 100);
}

export function statsCsv(rows: readonly ServiceStats[], rules: JudgeRules, pastRanges = 1, tr: (s: string) => string = x => x): string {
  const per = Math.max(1, pastRanges);
  const pastHead = SIDE_HEAD.map(h => (per > 1 ? `과거 일평균 ${h}` : `과거 ${h}`));
  const head = [
    '서비스', '판정',
    ...SIDE_HEAD.map(h => `기준 ${h}`),
    ...pastHead,
    '과거 건수(합계)',
    '평균 과거 대비(%)', 'p50 과거 대비(%)', 'p90 과거 대비(%)', 'p99 과거 대비(%)', '에러율 과거 대비(%p)', 'TPS 과거 대비(%)',
  ];
  const lines = [head.map(csvCell).join(',')];
  for (const orig of rows) {
    // 과거는 일자별 평균(앱 표와 같다) — 합계 칸만 합쳐 센 값에서
    const r = { ...orig, baseline: pastView(orig, per) };
    const c = r.current ?? undefined;
    const b = r.baseline ?? undefined;
    const cells: Cell[] = [
      r.service,
      judge(r, rules).map(f => tr(FLAG_LABEL[f])).join(' · '),
      ...side(r.current),
      ...side(r.baseline),
      orig.baseline ? orig.baseline.count : null,
      pct(c?.avg_ms, b?.avg_ms),
      pct(c?.p50_ms, b?.p50_ms),
      pct(c?.p90_ms, b?.p90_ms),
      pct(c?.p99_ms, b?.p99_ms),
      c && b ? r3((c.error_rate - b.error_rate) * 100) : null,
      pct(c?.tps, b?.tps),
    ];
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\r\n');
}

const VIEW_HEAD: Record<MetricKey, string> = { count: '건수', avg: '평균(ms)', p50: 'p50(ms)', p90: 'p90(ms)', p99: 'p99(ms)', err: '에러율(%)' };

/** 화면 칸의 값 — 표와 같은 반올림, 엑셀이 숫자로 읽게 천 단위 쉼표는 뺀다 */
function viewValue(k: MetricKey, v: number | undefined): Cell {
  if (v === undefined) return null;
  if (k === 'err') return Math.round(v * 10000) / 100;
  if (k === 'count') return r1(v);
  return Math.round(v);
}

/**
 * 화면 그대로 — 표에 보이는 줄(고른 칩·거르기·정렬 그대로)과 칸만.
 * 판정은 칩과 옆의 이유를 글로(`느려짐 평균 ×31`), 과거 대비는 화면 표기 그대로(`×31`, `+78%`, `+1.3%p`. 작은 변화는 빈 칸).
 * `rows` 는 이미 일자별 평균을 거친 줄(`withPastView`)
 */
export function statsViewCsv(rows: readonly ServiceStats[], rules: JudgeRules, pastRanges = 1, tr: (s: string) => string = x => x): string {
  const past = pastRanges > 1 ? '과거 일평균' : '과거';
  const head = ['서비스', '판정', ...METRICS.flatMap(k => [`${VIEW_HEAD[k]} 기준`, `${VIEW_HEAD[k]} ${past}`, `${VIEW_HEAD[k]} 과거 대비`])];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) {
    const verdict = judge(r, rules)
      .map(f => {
        const why = flagReason(f, r, rules, tr);
        return why ? `${tr(FLAG_LABEL[f])} ${why}` : tr(FLAG_LABEL[f]);
      })
      .join(' · ');
    const cells: Cell[] = [
      r.service,
      verdict,
      ...METRICS.flatMap(k => {
        const c = metricValue(r.current, k);
        const b = metricValue(r.baseline, k);
        return [viewValue(k, c), viewValue(k, b), fmtMetricVs(k, c, b) || null];
      }),
    ];
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\r\n');
}
