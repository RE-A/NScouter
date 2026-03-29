// src/features/xlog/types/counter.ts
// 성능 카운터 타입 정의 (Rust PerfCounterPack 직렬화 구조)
// 참조: docs/asis/01-common-data-model.md PerfCounterPack 섹션

/** Rust PerfCounterPack 직렬화 구조 */
export interface PerfCounterPack {
  time: number;      // epoch ms
  obj_name: string;  // 에이전트 이름 (예: /myhost/tomcat1)
  timetype: number;  // 집계 주기 타입
  data: Record<string, number>;  // 카운터명 → 값
}

/** 모니터링할 카운터 키 */
export type CounterKey =
  | 'activespeed'     // 활성 트랜잭션 수
  | 'tps'             // TPS
  | 'elapsed_avg'     // 평균 응답시간 (ms)
  | 'elapsed_max'     // 최대 응답시간 (ms)
  | 'error_rate'      // 에러율 (%)
  | 'cpu'             // CPU 사용률 (%)
  | 'heap_used'       // 힙 사용량 (KB)
  | 'gc_count'        // GC 횟수
  | string;           // 기타

/** 에이전트별 카운터 시계열 데이터 */
export interface CounterSeries {
  objName: string;
  samples: Array<{ time: number; value: number }>;  // 최대 155개 (5.2분)
}

/** 카운터 스트림 상태 */
export interface CounterState {
  /** key: objName, value: 카운터별 시계열 */
  series: Map<string, Map<CounterKey, CounterSeries>>;
  lastUpdated: number;
}

export const MAX_COUNTER_SAMPLES = 155; // 5분 / 2초 ≈ 150 + 여유
