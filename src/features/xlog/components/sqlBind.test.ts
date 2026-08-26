import { describe, expect, it } from 'vitest';
import { bindSql, splitParams } from './sqlBind';

describe('splitParams', () => {
  it('쉼표로 자른다', () => {
    expect(splitParams("1,2,3")).toEqual(['1', '2', '3']);
  });

  it('값 하나면 그대로다', () => {
    // 실측에서 대부분이 이 모양이다 (param="549584").
    expect(splitParams('549584')).toEqual(['549584']);
  });

  it('빈 문자열은 값이 없다', () => {
    expect(splitParams('')).toEqual([]);
    expect(splitParams('   ')).toEqual([]);
  });

  it('따옴표 안의 쉼표는 구분자가 아니다', () => {
    // 여기서 잘못 자르면 그 뒤 값이 전부 한 칸씩 밀린다.
    expect(splitParams("'서울시, 강남구',42")).toEqual(["'서울시, 강남구'", '42']);
  });

  it('큰따옴표 안의 쉼표도 지킨다', () => {
    expect(splitParams('"a,b",c')).toEqual(['"a,b"', 'c']);
  });

  it('값 사이 공백은 떼어 낸다', () => {
    expect(splitParams("1, 'abc' , 3")).toEqual(['1', "'abc'", '3']);
  });
});

describe('bindSql', () => {
  it('자리표시자를 순서대로 채운다', () => {
    const r = bindSql('select * from t where a=? and b=?', "1,'x'");
    expect(r.text).toBe("select * from t where a=1 and b='x'");
    expect(r.bound).toBe(2);
    expect(r.placeholders).toBe(2);
  });

  it('실측 SQL 을 채운다', () => {
    const sql = 'select p1_0.id from product p1_0 where p1_0.id=?';
    expect(bindSql(sql, '126').text).toBe('select p1_0.id from product p1_0 where p1_0.id=126');
  });

  it('문자열 리터럴 안의 ? 는 자리표시자가 아니다', () => {
    // 이걸 세면 그 뒤가 전부 밀려 **말은 되지만 틀린 SQL** 이 나온다.
    const r = bindSql("select * from t where msg='what?' and id=?", '7');
    expect(r.text).toBe("select * from t where msg='what?' and id=7");
    expect(r.placeholders).toBe(1);
  });

  it("문자열 안의 '' 를 닫는 따옴표로 보지 않는다", () => {
    const r = bindSql("select * from t where s='it''s ok? yes' and id=?", '7');
    expect(r.text).toBe("select * from t where s='it''s ok? yes' and id=7");
    expect(r.placeholders).toBe(1);
  });

  it('큰따옴표 식별자 안의 ? 도 건드리지 않는다', () => {
    const r = bindSql('select "we?rd" from t where id=?', '7');
    expect(r.text).toBe('select "we?rd" from t where id=7');
    expect(r.placeholders).toBe(1);
  });

  it('줄 주석 안의 ? 는 자리표시자가 아니다', () => {
    const r = bindSql('select 1 -- why? \nwhere id=?', '7');
    expect(r.text).toBe('select 1 -- why? \nwhere id=7');
    expect(r.placeholders).toBe(1);
  });

  it('블록 주석 안의 ? 도 건드리지 않는다', () => {
    const r = bindSql('select /* huh? */ 1 where id=?', '7');
    expect(r.text).toBe('select /* huh? */ 1 where id=7');
    expect(r.placeholders).toBe(1);
  });

  it('값이 모자라면 남은 자리는 ? 그대로다', () => {
    // 빈칸으로 채우면 문법이 깨진 채 그럴듯해진다.
    const r = bindSql('select * from t where a=? and b=?', '1');
    expect(r.text).toBe('select * from t where a=1 and b=?');
    expect(r.bound).toBe(1);
    expect(r.placeholders).toBe(2);
  });

  it('값이 남으면 버리지 않고 알려준다', () => {
    const r = bindSql('select * from t where a=?', '1,2,3');
    expect(r.bound).toBe(1);
    expect(r.leftover).toEqual(['2', '3']);
  });

  it('파라미터가 없으면 원문 그대로다', () => {
    const r = bindSql('select * from t where a=?', '');
    expect(r.text).toBe('select * from t where a=?');
    expect(r.bound).toBe(0);
    expect(r.placeholders).toBe(1);
  });

  it('자리표시자가 없으면 아무것도 바꾸지 않는다', () => {
    const r = bindSql('select count(*) from product', '');
    expect(r.text).toBe('select count(*) from product');
    expect(r.placeholders).toBe(0);
  });

  it('빈 SQL 에도 죽지 않는다', () => {
    expect(bindSql('', '1').text).toBe('');
  });

  it('닫히지 않은 따옴표가 있어도 원문을 잃지 않는다', () => {
    // 사전이 SQL 을 잘라 보내는 경우가 있다. 채우지 못해도 보여는 줘야 한다.
    const sql = "select * from t where s='abc";
    expect(bindSql(sql, '1').text).toBe(sql);
  });
});

// ── @{n} 형태 (에이전트의 리터럴 치환) ─────────────────────────
//
// profile_sql_escape_enabled 를 켠 에이전트는 리터럴을 빼내고 자리에 번호를 남긴다.
// 실측(probe_literal_sql_escape):
//   sql   = … where p.category = '@{1}' and p.id > @{2} and @{3} = @{4}
//   param = "'fruit',100,1,1"
// **문자열은 따옴표가 문장 쪽에 남고 값이 따옴표를 들고 온다.** 그래서 '@{1}' 은
// 따옴표째 갈아끼워야 하고, 안쪽만 바꾸면 ''fruit'' 가 된다.

describe('bindSql — @{n}', () => {
  it("문자열 자리는 따옴표째 값으로 바뀐다", () => {
    const r = bindSql("select * from p where c = '@{1}'", "'fruit'");
    expect(r.text).toBe("select * from p where c = 'fruit'");
    expect(r.bound).toBe(1);
    expect(r.leftover).toEqual([]);
  });

  it('숫자 자리는 맨몸으로 바뀐다', () => {
    const r = bindSql('select * from p where id > @{2}', "'fruit',100");
    expect(r.text).toBe('select * from p where id > 100');
    expect(r.bound).toBe(1);
    // 1번 값은 쓰이지 않았다 — 버리지 않는다
    expect(r.leftover).toEqual(["'fruit'"]);
  });

  it('실측 문장을 그대로 채운다', () => {
    const sql =
      "/*literal-sql*/ select count(*) from product p where p.category = '@{1}' and p.id > @{2} and @{3} = @{4}";
    const r = bindSql(sql, "'fruit',100,1,1");
    expect(r.text).toBe(
      "/*literal-sql*/ select count(*) from product p where p.category = 'fruit' and p.id > 100 and 1 = 1",
    );
    expect(r.placeholders).toBe(4);
    expect(r.bound).toBe(4);
    expect(r.leftover).toEqual([]);
  });

  it('같은 번호가 여러 번 나오면 같은 값을 쓴다', () => {
    const r = bindSql('select @{1}, @{1} from dual', '7');
    expect(r.text).toBe('select 7, 7 from dual');
    expect(r.bound).toBe(2);
  });

  it('값이 없는 번호는 그대로 둔다', () => {
    // 빈칸으로 채우면 문법이 깨진 채 그럴듯해진다
    const r = bindSql('select * from p where id = @{5}', "'fruit',100");
    expect(r.text).toBe('select * from p where id = @{5}');
    expect(r.bound).toBe(0);
    expect(r.leftover).toEqual(["'fruit'", '100']);
  });

  it('주석과 문자열 안의 @{n} 은 건드리지 않는다', () => {
    const r = bindSql("select /* @{1} */ 'a@{1}b' from dual", "'x'");
    expect(r.text).toBe("select /* @{1} */ 'a@{1}b' from dual");
    expect(r.bound).toBe(0);
    expect(r.leftover).toEqual(["'x'"]);
  });
});
