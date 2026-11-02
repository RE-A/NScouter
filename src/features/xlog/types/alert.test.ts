// 알림 레벨 번호의 계약 — scouter.lang.AlertLevel(F-65)
import { describe, expect, it } from 'vitest';
import { alertLevelLabel } from './alert';

describe('alertLevelLabel', () => {
  it('0 부터 INFO 다 — 경고가 INFO 로, FATAL 이 ERROR 로 보이면 안 된다', () => {
    expect([0, 1, 2, 3].map(alertLevelLabel)).toEqual(['INFO', 'WARN', 'ERROR', 'FATAL']);
  });
});
