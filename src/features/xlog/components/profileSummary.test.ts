// 프로파일 요약
//
// 스텝 200개를 순서대로 훑는 것으로는 "같은 SQL 이 50번 돌았다"를 볼 수 없다.
// 이름으로 묶어 횟수·합계·평균을 낸다 (ASIS XLogFullProfileView 의 Summary).

import { describe, it, expect } from 'vitest';
import { summarizeSteps, sortSummary } from './profileSummary';
import type { ProfileStep } from '../types/profile';

const base = { parent: -1, index: 0, start_time: 0, start_cpu: 0 };

function sql(hash: number, elapsed: number): ProfileStep {
  return { kind: 'Sql', ...base, hash, elapsed, error: 0, param: '', updated: 0 };
}
function method(hash: number, elapsed: number): ProfileStep {
  return { kind: 'Method', ...base, hash, elapsed, cputime: 0 };
}

const TEXTS: Record<number, string> = { 1: 'select * from product', 2: 'save()', 3: 'GET /shop/api' };

describe('summarizeSteps', () => {
  it('같은 이름을 묶어 횟수와 합계를 낸다', () => {
    const rows = summarizeSteps([sql(1, 10), sql(1, 30), sql(1, 20)], TEXTS);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'select * from product', count: 3, sum: 60, avg: 20 });
  });

  it('평균은 반올림한다', () => {
    // 소수점이 붙으면 자릿수가 들쭉날쭉해 표가 안 읽힌다.
    const rows = summarizeSteps([sql(1, 10), sql(1, 11)], TEXTS);
    expect(rows[0].avg).toBe(11);
  });

  it('종류가 다르면 이름이 같아도 따로 센다', () => {
    // SQL 과 메서드가 우연히 같은 텍스트를 가질 수 있다. 섞이면 합계가 거짓이 된다.
    const rows = summarizeSteps([sql(1, 10), method(1, 10)], TEXTS);
    expect(rows).toHaveLength(2);
  });

  it('이름을 못 찾으면 해시를 그대로 쓴다', () => {
    // 사전 조회가 실패해도 행이 사라지면 안 된다 — 합계가 조용히 틀려진다.
    const rows = summarizeSteps([sql(99, 10)], TEXTS);
    expect(rows).toHaveLength(1);
    // 표기는 앱의 다른 곳과 같은 16진수다 (99 → 0x63).
    expect(rows[0].name).toBe('0x63');
  });

  it('시간이 없는 종류는 세기만 한다', () => {
    const rows = summarizeSteps(
      [{ kind: 'Message', ...base, message: '캐시 미스', hash: 0 }],
      TEXTS,
    );
    expect(rows[0]).toMatchObject({ count: 1, sum: 0, avg: 0 });
  });

  it('Unknown 은 빼고 센다', () => {
    // 화면에 안 보이는 스텝이 요약에만 나오면 둘이 어긋난다.
    const rows = summarizeSteps([{ kind: 'Unknown', step_type: 14 }, sql(1, 10)], TEXTS);
    expect(rows).toHaveLength(1);
  });

  it('빈 프로파일은 빈 요약이다', () => {
    expect(summarizeSteps([], TEXTS)).toEqual([]);
  });
});

describe('sortSummary', () => {
  const rows = [
    { key: 'a', kind: 'Sql' as const, name: 'a', count: 1, sum: 300, avg: 300 },
    { key: 'b', kind: 'Sql' as const, name: 'b', count: 50, sum: 100, avg: 2 },
    { key: 'c', kind: 'Sql' as const, name: 'c', count: 5, sum: 200, avg: 40 },
  ];

  it('합계 기준이 기본이다', () => {
    // 제일 먼저 알고 싶은 건 "시간을 어디서 썼나"다.
    expect(sortSummary(rows, 'sum').map(r => r.key)).toEqual(['a', 'c', 'b']);
  });

  it('횟수 기준은 반복을 드러낸다', () => {
    // 2ms 짜리가 50번이면 N+1 이다. 합계로만 보면 안 보인다.
    expect(sortSummary(rows, 'count').map(r => r.key)).toEqual(['b', 'c', 'a']);
  });

  it('평균 기준은 한 방이 큰 것을 드러낸다', () => {
    expect(sortSummary(rows, 'avg').map(r => r.key)).toEqual(['a', 'c', 'b']);
  });

  it('원본을 건드리지 않는다', () => {
    sortSummary(rows, 'count');
    expect(rows.map(r => r.key)).toEqual(['a', 'b', 'c']);
  });
});
