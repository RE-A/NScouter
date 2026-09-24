// 본문 나누기 — **보기 좋게 만들려다 내용을 바꾸지 않는가.**
//
// 이 화면은 «실제로 무엇이 오갔나» 의 근거로 쓰인다. 나눈 결과가 원문과 다르면
// 그 자리에서 근거가 아니게 된다. 그래서 여기 테스트의 절반은 «안 바뀌는가» 다.

import { describe, expect, it } from 'vitest';
import { detectFormat, formatBody, formatJson, formatXml, previewLine } from './textFormat';

/** 공백을 뺀 내용 */
const bare = (s: string) => s.replace(/\s+/g, '');

describe('종류 알아보기', () => {
  it('XML·JSON·SQL 을 가른다', () => {
    expect(detectFormat('<a><b>1</b></a>')).toBe('xml');
    expect(detectFormat(' {"a":1} ')).toBe('json');
    expect(detectFormat('select * from t')).toBe('sql');
    expect(detectFormat('SELECT 1')).toBe('sql');
  });

  it('JSON 처럼 생겼지만 아닌 것은 손대지 않는다', () => {
    // 괄호로만 가르면 로그 한 줄(`{...}` 모양)을 JSON 으로 잘못 보고 깨뜨린다.
    expect(detectFormat('{this is not json}')).toBe('text');
  });

  it('모르면 text 다', () => {
    expect(detectFormat('')).toBe('text');
    expect(detectFormat('[driving thread] MS Queue Worker')).toBe('text');
  });
});

describe('XML 나누기', () => {
  it('태그마다 줄을 나누고 값은 한 줄에 둔다', () => {
    const src = '<r><a>1</a><b><c>2</c></b></r>';
    expect(formatXml(src)).toBe(['<r>', '  <a>1</a>', '  <b>', '    <c>2</c>', '  </b>', '</r>'].join('\n'));
  });

  it('선언과 빈 요소는 깊이를 건드리지 않는다', () => {
    const src = '<?xml version="1.0"?><r><a/><b/></r>';
    expect(formatXml(src)).toBe(['<?xml version="1.0"?>', '<r>', '  <a/>', '  <b/>', '</r>'].join('\n'));
  });

  it('이미 들여 쓴 XML 을 다시 나눠도 내용이 그대로다', () => {
    const src = '<r>\n  <a>1</a>\n</r>';
    expect(bare(formatXml(src))).toBe(bare(src));
  });

  it('SAP PO 처럼 이름공간이 붙은 것도 내용이 그대로다', () => {
    const src =
      "<ns1:MT_COM0280_FS xmlns:ns1='urn:/com.fs.cjfreshway.co.kr/FI'><XROWS>21</XROWS><XSYS>FS</XSYS></ns1:MT_COM0280_FS>";
    expect(bare(formatXml(src))).toBe(bare(src));
  });

  it('CDATA 와 주석은 통째로 한 조각이다', () => {
    // 안에 `>` 가 들어 있어 태그 단위로만 가르면 중간에서 잘린다.
    // 잘린 채 줄을 나누면 **내용이 바뀐다** — 실제로 `a > b` 가 두 줄로 쪼개졌다.
    expect(formatXml('<r><![CDATA[a > b]]></r>')).toBe(['<r>', '  <![CDATA[a > b]]>', '</r>'].join('\n'));
    expect(formatXml('<r><!-- a > b --></r>')).toBe(['<r>', '  <!-- a > b -->', '</r>'].join('\n'));
  });

  it('값 안의 공백은 지우지 않는다', () => {
    const src = '<a>hello  world</a>';
    expect(formatXml(src)).toBe('<a>hello  world</a>');
  });
});

describe('JSON 나누기', () => {
  it('두 칸 들여쓰기로 편다', () => {
    expect(formatJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('깨진 JSON 은 원문 그대로다 — 지어내지 않는다', () => {
    expect(formatJson('{"a":')).toBe('{"a":');
  });
});

describe('formatBody', () => {
  it('종류에 맞게 고르고 text 는 손대지 않는다', () => {
    expect(formatBody('<a>1</a>', 'xml')).toBe('<a>1</a>');
    expect(formatBody('{"a":1}', 'json')).toBe('{\n  "a": 1\n}');
    const plain = '그냥  글자';
    expect(formatBody(plain, 'text')).toBe(plain);
    // SQL 은 기존 정렬기가 맡는다 — 여기서 두 번 손대지 않는다.
    expect(formatBody('select 1', 'sql')).toBe('select 1');
  });
});

describe('미리보기 한 줄', () => {
  it('줄바꿈을 빈칸으로 바꾼다', () => {
    expect(previewLine('a\n  b')).toBe('a b');
  });

  it('자른 것은 자른 티를 낸다', () => {
    const long = 'x'.repeat(300);
    const p = previewLine(long, 10);
    expect(p).toBe(`${'x'.repeat(10)}…`);
  });
});
