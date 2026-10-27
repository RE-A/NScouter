import { T, CAT } from '../../../styles/tokens';
// src/features/xlog/types/alert.ts
// 알림 타입 정의 (Rust AlertPack 직렬화 구조)
// 참조: docs/asis/01-common-data-model.md AlertPack 섹션

/** Rust AlertPack 직렬화 구조 */
export interface AlertPack {
  time: number;      // epoch ms
  obj_type: string;  // 에이전트 타입 (예: java, host)
  obj_hash: number;  // 에이전트 hash
  level: number;     // 0=INFO, 1=WARN, 2=ERROR, 3=FATAL (F-65)
  title: string;
  message: string;
}

/** 알림 레벨 문자열 */
export type AlertLevel = 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

/**
 * 레벨 번호 → 이름.
 *
 * **0 부터 INFO 다** (`scouter.lang.AlertLevel` 2.21.3 실측 — F-65). 예전에는 0=DEBUG 로 한 칸씩
 * 밀려 읽어서 `WARNING_CPU_HIGH`(1) 가 INFO, `FATAL_CPU_HIGH`(3) 가 ERROR 로 보였다.
 */
export function alertLevelLabel(level: number): AlertLevel {
  switch (level) {
    case 0: return 'INFO';
    case 1: return 'WARN';
    case 2: return 'ERROR';
    case 3: return 'FATAL';
    default: return 'INFO';
  }
}

export function alertLevelColor(level: number): string {
  switch (level) {
    case 0: return CAT.api;      // INFO
    case 1: return T.warn;       // WARN
    case 2: return T.error;      // ERROR
    case 3: return '#b71c1c';    // FATAL — 유일하게 더 진한 빨강이 필요해 예외
    default: return T.textMuted;
  }
}
