// 요약 → 목록 이동의 계약
//
// 요약은 «무엇이 몇 번» 이라 그 자체로는 갈 곳이 없다.
// 눌렀을 때 목록의 어디로 데려갈지가 이 함수다.

import { describe, expect, it } from 'vitest';
import { firstStepIndexOf, summarizeSteps } from './profileSummary';
import type { ProfileStep } from '../types/profile';

const base = { parent: -1, index: 0, start_time: 0, start_cpu: 0 };

const sql = (hash: number, elapsed: number): ProfileStep =>
  ({ kind: 'Sql', ...base, hash, param: '', elapsed, error: 0, updated: 0 }) as ProfileStep;
const method = (hash: number): ProfileStep =>
  ({ kind: 'Method', ...base, hash, elapsed: 1, cputime: 0 }) as ProfileStep;

const texts: Record<number, string> = { 7: 'select 1', 8: 'select 2', 9: 'doWork' };

describe('firstStepIndexOf', () => {
  it('같은 쿼리가 여럿이면 **처음 나온 것**으로 간다', () => {
    // 합계가 큰 순으로 데려가면 «맨 위가 왜 3번째 호출인가» 를 설명할 수 없다.
    const steps = [method(9), sql(7, 10), sql(8, 5), sql(7, 90)];
    const rows = summarizeSteps(steps, texts);
    const row = rows.find(r => r.name === 'select 1');

    expect(row?.count).toBe(2);
    expect(firstStepIndexOf(steps, texts, row!.key)).toBe(1);
  });

  it('요약이 만든 key 로 늘 찾아진다', () => {
    const steps = [method(9), sql(7, 10), sql(8, 5)];
    for (const row of summarizeSteps(steps, texts)) {
      expect(firstStepIndexOf(steps, texts, row.key)).toBeGreaterThanOrEqual(0);
    }
  });

  it('없는 key 는 -1 이다', () => {
    // 없는 곳으로 데려가지 않는다.
    expect(firstStepIndexOf([sql(7, 1)], texts, 'Sql 없는쿼리')).toBe(-1);
  });
});
