// src/features/xlog/types/alert.ts
// 알림 타입 정의 (Rust AlertPack 직렬화 구조)
// 참조: docs/asis/01-common-data-model.md AlertPack 섹션

/** Rust AlertPack 직렬화 구조 */
export interface AlertPack {
  time: number;      // epoch ms
  obj_type: string;  // 에이전트 타입 (예: java, host)
  obj_hash: number;  // 에이전트 hash
  level: number;     // 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR, 4=FATAL
  title: string;
  message: string;
}

/** 알림 레벨 문자열 */
export type AlertLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export function alertLevelLabel(level: number): AlertLevel {
  switch (level) {
    case 0: return 'DEBUG';
    case 1: return 'INFO';
    case 2: return 'WARN';
    case 3: return 'ERROR';
    case 4: return 'FATAL';
    default: return 'INFO';
  }
}

export function alertLevelColor(level: number): string {
  switch (level) {
    case 0: return '#888';     // DEBUG - 회색
    case 1: return '#4fc3f7';  // INFO - 파랑
    case 2: return '#ffb74d';  // WARN - 주황
    case 3: return '#ef5350';  // ERROR - 빨강
    case 4: return '#b71c1c';  // FATAL - 진빨강
    default: return '#888';
  }
}
