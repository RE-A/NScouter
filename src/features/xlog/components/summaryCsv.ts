// 요약 표를 CSV 한 장으로
//
// 화면은 상위 50줄만 그린다. **받아 온 행은 그보다 훨씬 많다** — 남에게 넘기거나
// 엑셀에서 더 따져 보려면 전부가 필요하다. 서버에 다시 묻지 않는다(ASIS 는
// EXPORT_APP_SUMMARY 를 쓴다). 화면이 이미 그 행을 다 갖고 있다.

import type { SummaryRow, ErrorSummaryRow } from '../types/summary';

/**
 * CSV 한 칸.
 *
 * **쉼표·따옴표·줄바꿈이 든 값은 반드시 감싼다.** SQL 문장과 UA 문자열에 셋 다 나온다 —
 * 안 감싸면 한 줄이 여러 칸으로 쪼개져 표가 통째로 밀린다.
 * 따옴표는 두 번 적어 이스케이프한다(RFC 4180).
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.split('"').join('""')}"` : s;
}

function row(cells: (string | number | null)[]): string {
  return cells.map(csvCell).join(',');
}

/**
 * 요약 표(서비스/SQL/API/IP/UA) → CSV.
 *
 * `label` 은 화면이 쓰는 것과 **같은 함수**를 넘긴다 — 파일에는 해시가 아니라
 * 화면에서 읽은 그 이름이 들어가야 한다.
 */
export function summaryCsv(
  rows: readonly SummaryRow[],
  label: (id: number) => string,
): string {
  const head = row(['이름', '횟수', '합계(ms)', '평균(ms)', '에러']);
  const body = rows.map(r =>
    row([
      label(r.id),
      r.count,
      r.elapsed,
      // 평균은 화면과 같은 규칙으로 낸다 — 합계÷횟수. 콜렉터는 합계만 준다.
      r.elapsed === null || r.count === 0 ? null : Math.round(r.elapsed / r.count),
      r.error,
    ]),
  );
  return [head, ...body].join('\r\n') + '\r\n';
}

/** 에러 요약 → CSV. 열 구성이 달라 따로 만든다 */
export function errorSummaryCsv(
  rows: readonly ErrorSummaryRow[],
  label: (type: 'error' | 'service', id: number) => string,
): string {
  const head = row(['에러', '메시지', '서비스', '횟수', '대표 txid']);
  const body = rows.map(r =>
    row([
      label('error', r.error),
      label('error', r.message),
      label('service', r.service),
      r.count,
      r.txid,
    ]),
  );
  return [head, ...body].join('\r\n') + '\r\n';
}
