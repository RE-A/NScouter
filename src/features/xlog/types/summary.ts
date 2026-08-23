// 요약(Summary) 타입 — Rust `scouter::summary` 와 짝이다.

/** 요약 종류. Rust `SummaryKind` 와 문자열이 같아야 한다 */
export type SummaryKind = 'service' | 'sql' | 'apicall' | 'ip' | 'ua';

export interface SummaryRow {
  /** 해시. 종류에 따라 사전으로 풀거나(IP 는 그대로 디코드) 한다 */
  id: number;
  count: number;
  /** IP·UA 요약에는 없다. **0 이 아니라 null 이다** */
  error: number | null;
  /** 소요 시간 합(ms). 평균은 화면에서 나눈다 */
  elapsed: number | null;
  /** 서비스 요약에만 있다 */
  cpu: number | null;
  mem: number | null;
}

export interface ErrorSummaryRow {
  id: number;
  error: number;
  service: number;
  message: number;
  count: number;
  /** i64 라 문자열로 온다 */
  txid: string;
  sql: number;
  apicall: number;
}
