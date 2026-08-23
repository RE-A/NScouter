// 인터랙션(토폴로지) 타입 — Rust `InteractionCounterPack` 과 짝이다.

export interface InteractionRow {
  time: number;
  obj_name: string;
  /** `INTR_API_OUTGOING` 등 10종 */
  interaction_type: string;
  from_hash: number;
  to_hash: number;
  /** 집계 구간(초) */
  period: number;
  count: number;
  error_count: number;
  total_elapsed: number;
}
