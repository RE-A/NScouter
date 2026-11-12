// 비교 표를 CSV 한 장으로 — 서비스 한 줄에 현재·기준·변화율을 나란히
//
// 엑셀에서 정렬·필터를 바로 걸 수 있게 머리글 한 줄 + 데이터만 둔다(설명 줄을 위에 붙이면 표 인식이 깨진다).
// 조건(대상·구간)은 파일 이름과 화면에 남는다.

import { csvCell } from '../xlog/components/summaryCsv';
import type { ServiceStats, StatsSummary } from './statsApi';
import { change, FLAG_LABEL, judge, type JudgeRules } from './statsJudge';

type Cell = string | number | null;

const SIDE_HEAD = ['건수', '에러', '에러율(%)', 'TPS', '평균(ms)', 'p50(ms)', 'p90(ms)', 'p95(ms)', 'p99(ms)', '최대(ms)', 'SQL 횟수', 'SQL(ms)', 'API 횟수', 'API(ms)', 'CPU(ms)'];

const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function side(s: StatsSummary | null): Cell[] {
  if (!s) return SIDE_HEAD.map(() => null);
  return [
    s.count, s.errors, r3(s.error_rate * 100), r3(s.tps), r1(s.avg_ms), s.p50_ms, s.p90_ms, s.p95_ms, s.p99_ms, s.max_ms,
    r1(s.sql_count_avg), r1(s.sql_ms_avg), r1(s.api_count_avg), r1(s.api_ms_avg), r1(s.cpu_ms_avg),
  ];
}

/** 변화율 % (소수 첫째 자리). 계산할 수 없으면 빈 칸 */
function pct(cur: number | undefined, base: number | undefined): Cell {
  const c = change(cur, base);
  return c === null ? null : r1(c * 100);
}

export function statsCsv(rows: readonly ServiceStats[], rules: JudgeRules): string {
  const head = [
    '서비스', '특이사항',
    ...SIDE_HEAD.map(h => `현재 ${h}`),
    ...SIDE_HEAD.map(h => `기준 ${h}`),
    '평균 변화(%)', 'p90 변화(%)', '에러율 차이(%p)', 'TPS 변화(%)',
  ];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) {
    const c = r.current ?? undefined;
    const b = r.baseline ?? undefined;
    const cells: Cell[] = [
      r.service,
      judge(r, rules).map(f => FLAG_LABEL[f]).join(' · '),
      ...side(r.current),
      ...side(r.baseline),
      pct(c?.avg_ms, b?.avg_ms),
      pct(c?.p90_ms, b?.p90_ms),
      c && b ? r3((c.error_rate - b.error_rate) * 100) : null,
      pct(c?.tps, b?.tps),
    ];
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\r\n');
}
