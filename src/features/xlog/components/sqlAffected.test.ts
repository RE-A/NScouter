import { describe, expect, it } from 'vitest';
import { affectedRows } from './sqlAffected';

describe('affectedRows', () => {
  it('바꾼 행 수를 그대로 준다', () => {
    expect(affectedRows(1)).toEqual({ kind: 'rows', count: 1 });
    expect(affectedRows(120)).toEqual({ kind: 'rows', count: 120 });
  });

  it('**0 도 적는다** — 한 행도 안 바뀐 UPDATE 는 그 자체가 단서다', () => {
    expect(affectedRows(0)).toEqual({ kind: 'rows', count: 0 });
  });

  it('결과 집합(-1)은 적을 것이 없다', () => {
    // 읽기였다는 뜻이라 «영향받은 행» 이 의미가 없다
    expect(affectedRows(-1)).toBeNull();
  });

  it('갱신인데 건수를 모르면(-2) 그렇다고 말한다', () => {
    expect(affectedRows(-2)).toEqual({ kind: 'unknown' });
  });

  it('SQL 예외(-3)는 적지 않는다 — 에러가 따로 보인다', () => {
    expect(affectedRows(-3)).toBeNull();
  });
});
