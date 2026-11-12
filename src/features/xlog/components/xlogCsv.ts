// XLog 목록을 CSV 한 장으로 — 목록 위 오른쪽 클릭 «CSV 로 내보내기»
//
// 화면이 이미 가진 행을 그대로 쓴다(콜렉터에 다시 묻지 않는다). 이름은 화면과 **같은 함수**로 푼다 —
// 파일에 해시가 아니라 화면에서 읽은 이름이 들어가야 한다. 엑셀용 BOM 은 저장하는 쪽(Rust)이 붙인다.

import type { SXLog } from '../types/xlog';
import { csvCell } from './summaryCsv';

export interface XLogCsvNames {
  server: (objHash: number) => string;
  service: (hash: number) => string;
  /** 에러 문구. 없거나 못 풀었으면 빈 칸 */
  error: (hash: number) => string;
}

export const XLOG_CSV_HEAD = ['종료 시각', '서버', '서비스', 'IP', '응답(ms)', '에러', '에러 메시지', 'SQL 횟수', 'SQL(ms)', 'API 횟수', 'API(ms)', 'CPU(ms)', 'txid', 'gxid'];

/** 이 PC 시간대의 `yyyy-mm-dd HH:mm:ss.SSS` — 엑셀이 날짜·시각으로 알아본다 */
export function localStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function xlogCsv(rows: readonly SXLog[], names: XLogCsvNames): string {
  const lines = [XLOG_CSV_HEAD.map(csvCell).join(',')];
  for (const x of rows) {
    lines.push(
      [
        localStamp(x.endTime),
        names.server(x.objHash),
        names.service(x.service),
        x.ipAddr,
        x.elapsed,
        x.error !== 0 ? 1 : 0,
        x.error !== 0 ? names.error(x.error) : '',
        x.sqlCount,
        x.sqlTime,
        x.apiCallCount,
        x.apiCallTime,
        x.cpu,
        x.txid,
        x.gxid,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n');
}

/** 목록의 에러 한 줄 — 여러 줄 스택이면 첫 줄만 */
export function errorLine(text: string | undefined): string {
  if (!text) return '';
  return text.split(/\r?\n/).find(l => l.trim() !== '')?.trim() ?? '';
}
