import { describe, expect, it } from 'vitest';
import { findStepHits } from './stepSearch';
import type { ProfileStep } from '../types/profile';

// Rust profile_search 의 테스트와 **같은 사례**를 쓴다.
// 규칙이 갈리면 목록은 "sql 에서 걸림"이라는데 상세에는 강조가 없는 일이 생긴다.

const base = { parent: -1, index: 0, start_time: 0, start_cpu: 0 };

const sql = (hash: number, param = '', error = 0): ProfileStep => ({
  ...base, kind: 'Sql', hash, param, elapsed: 1, error, updated: 0,
});

describe('findStepHits', () => {
  it('SQL 문에서 찾는다', () => {
    const hits = findStepHits([sql(1)], { 1: 'SELECT * FROM ORDERS WHERE ID=?' }, 'orders');
    expect(hits).toEqual([{ index: 0, kind: 'sql' }]);
  });

  it('바인딩 값으로도 찾는다', () => {
    const hits = findStepHits([sql(1, '[A-99213]')], { 1: 'SELECT * FROM ORDERS' }, 'a-99213');
    expect(hits).toEqual([{ index: 0, kind: 'sql-param' }]);
  });

  it('대소문자를 가리지 않는다', () => {
    expect(findStepHits([sql(1)], { 1: 'select * from Orders' }, 'ORDERS')).toHaveLength(1);
  });

  it('에러 텍스트에서도 찾는다', () => {
    const hits = findStepHits(
      [sql(1, '', 9)],
      { 1: 'SELECT 1', 9: 'java.sql.SQLTimeoutException: timeout' },
      'timeoutexception',
    );
    expect(hits).toEqual([{ index: 0, kind: 'error' }]);
  });

  it('한 스텝은 한 번만 센다', () => {
    // 두 번 세면 "3곳 중 2번째" 같은 안내가 실제와 어긋난다.
    const hits = findStepHits([sql(1, 'ORDERS')], { 1: 'SELECT * FROM ORDERS' }, 'orders');
    expect(hits).toHaveLength(1);
  });

  it('해시가 0인 메시지는 본문을 쓴다', () => {
    const step: ProfileStep = {
      ...base, kind: 'Message', message: 'cache miss for key=user:42', hash: 0,
    };
    expect(findStepHits([step], {}, 'user:42')).toEqual([{ index: 0, kind: 'message' }]);
  });

  it('소켓은 주소와 포트를 합쳐 본다', () => {
    const step: ProfileStep = {
      ...base, kind: 'Socket', ipaddr: '10.89.2.13', port: 5432, elapsed: 1, error: 0,
    };
    expect(findStepHits([step], {}, '10.89.2.13:5432')).toHaveLength(1);
  });

  it('빈 검색어는 아무것도 걸리지 않는다', () => {
    // 빈 문자열은 어디에나 있다. 전부 걸리면 검색이 아니다.
    expect(findStepHits([sql(1)], { 1: 'SELECT 1' }, '')).toEqual([]);
    expect(findStepHits([sql(1)], { 1: 'SELECT 1' }, '   ')).toEqual([]);
  });

  it('못 푼 해시는 건너뛴다', () => {
    expect(findStepHits([sql(1)], {}, 'select')).toEqual([]);
  });

  it('여러 군데 걸리면 순번 순으로 모은다', () => {
    // 이걸로 «이전/다음» 을 만든다. 순서가 뒤섞이면 넘길 때마다 튄다.
    const steps = [sql(1), sql(2), sql(3)];
    const texts = { 1: 'select a from orders', 2: 'select b from users', 3: 'delete from orders' };
    expect(findStepHits(steps, texts, 'orders').map(h => h.index)).toEqual([0, 2]);
  });

  it('Unknown 스텝은 순번만 차지하고 걸리지 않는다', () => {
    // 순번은 프로파일 배열 기준이라 Unknown 도 자리를 센다 — 안 그러면 강조가 밀린다.
    const steps: ProfileStep[] = [{ kind: 'Unknown', step_type: 99 }, sql(1)];
    expect(findStepHits(steps, { 1: 'select from orders' }, 'orders')).toEqual([
      { index: 1, kind: 'sql' },
    ]);
  });
});
