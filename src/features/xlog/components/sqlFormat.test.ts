// SQL 정렬
//
// **가장 중요한 성질: 글자를 하나도 잃지 않는다.** SQL 은 복사해서 DB 에 붙이는
// 물건이라, 예쁘게 만들려다 한 글자라도 바꾸면 사고다.

import { describe, expect, it } from 'vitest';
import { formatSql, collapseWhitespace } from './sqlFormat';

/** 정렬해도 «공백을 접으면 원문과 같다» — 이게 안 깨지는 게 전부다 */
function keepsEveryChar(sql: string): void {
  expect(collapseWhitespace(formatSql(sql))).toBe(collapseWhitespace(sql));
}

describe('formatSql — 글자를 잃지 않는다', () => {
  const samples = [
    'select a, b from t where x = 1 and y = 2 order by a desc',
    "select p.category, count(*) from product p group by p.category having count(*) > 0",
    'select o.id from orders o left join delivery d on d.order_id = o.id order by o.ordered_at desc limit 15',
    "update delivery set status = 'READY' where id = 29408",
    'insert into audit_log (kind, detail) values (?, ?)',
    "/*mixed-sql*/ select p.id from product p where p.category = 'book' and p.id > ?",
    'select * from t -- where 이건 주석이다\nwhere x = 1',
    "select 'group by' as g, \"order by\" as o from dual",
    '',
    '   ',
  ];
  for (const s of samples) {
    it(`그대로다: ${s.slice(0, 40) || '(빈 문장)'}`, () => keepsEveryChar(s));
  }
});

describe('formatSql — 절을 줄로 나눈다', () => {
  it('기본 절이 각자 줄을 갖는다', () => {
    expect(formatSql('select a from t where x = 1 order by a')).toBe(
      'select a\nfrom t\nwhere x = 1\norder by a',
    );
  });

  it('and · or · on 은 한 칸 들여쓴다', () => {
    // 조건이 여러 개일 때 어디까지가 where 인지 보이게
    expect(formatSql('select a from t where x = 1 and y = 2 or z = 3')).toBe(
      'select a\nfrom t\nwhere x = 1\n  and y = 2\n  or z = 3',
    );
  });

  it('join 과 on 이 짝으로 보인다', () => {
    expect(formatSql('select a from t join u on u.id = t.id')).toBe(
      'select a\nfrom t\njoin u\n  on u.id = t.id',
    );
  });

  it('두 낱말 절을 통째로 본다', () => {
    // `order` 만 보고 자르면 `by a` 가 떨어져 나간다
    expect(formatSql('select a from t group by a order by b')).toBe(
      'select a\nfrom t\ngroup by a\norder by b',
    );
    expect(formatSql('left outer join u on 1=1')).toContain('left outer join u');
  });
});

describe('formatSql — 건드리면 안 되는 곳', () => {
  it('**문자열 안의 낱말은 절이 아니다**', () => {
    // 여기서 자르면 문자열이 두 줄로 갈라져 실행할 수 없는 문장이 된다
    const out = formatSql("select 'group by' from dual");
    expect(out).toContain("'group by'");
    expect(out).toBe("select 'group by'\nfrom dual");
  });

  it("문자열 안의 '' 를 닫는 따옴표로 보지 않는다", () => {
    const sql = "select 'it''s from here' as x from t";
    expect(formatSql(sql)).toBe("select 'it''s from here' as x\nfrom t");
    keepsEveryChar(sql);
  });

  it('큰따옴표 식별자도 지킨다', () => {
    expect(formatSql('select "order by" from t')).toBe('select "order by"\nfrom t');
  });

  it('줄 주석 안은 안 자른다', () => {
    const out = formatSql('select a from t -- and 여기는 주석\n');
    expect(out).toContain('-- and 여기는 주석');
    expect(out).not.toContain('\n  and 여기는');
  });

  it('블록 주석 안도 안 자른다', () => {
    // 주석 **안**의 select/from/where 는 절이 아니다. 주석은 통째로 남는다.
    // (주석 뒤에서 줄이 나뉘는 건 맞는 동작이다 — 주석이 제 줄을 갖는다.)
    const out = formatSql('/* select from where */ select a from t');
    expect(out).toBe('/* select from where */\nselect a\nfrom t');
  });

  it('낱말 한가운데를 자르지 않는다', () => {
    // `fromage` 의 from, `selection` 의 select
    expect(formatSql('select fromage from t')).toBe('select fromage\nfrom t');
    expect(formatSql('select a from selection')).toBe('select a\nfrom selection');
  });

  it('대소문자를 바꾸지 않는다', () => {
    // 원문이 대문자면 그게 그 팀의 규칙이다
    expect(formatSql('SELECT A FROM T WHERE X = 1')).toBe('SELECT A\nFROM T\nWHERE X = 1');
  });
});

describe('formatSql — 실측 문장', () => {
  it('대시보드의 조인+서브쿼리', () => {
    const sql =
      'select p.id, p.name, s.warehouse, s.quantity from product p' +
      ' join stock s on s.product_id = p.id' +
      ' where s.quantity < (select avg(quantity) from stock) order by s.quantity asc limit ?';
    const out = formatSql(sql);
    keepsEveryChar(sql);
    // 눈으로 절이 보이는가
    expect(out.split('\n').length).toBeGreaterThanOrEqual(5);
    expect(out).toContain('\njoin stock s');
    expect(out).toContain('\n  on s.product_id = p.id');
    expect(out).toContain('\nwhere s.quantity');
  });
});
