// 프로파일 스텝 본문 — 종류를 알아보고 읽기 좋게 나눈다 (순수 로직)
//
// **왜 필요한가.** SAP PO 어댑터처럼 XML 한 통을 통째로 메시지 스텝에 남기는
// 환경이 있다. 지금까지 그런 스텝은 한 줄로 잘려 나오고 전문은 hover 툴팁으로만
// 볼 수 있었다 — 수천 자짜리 XML 이 화면을 덮는다.
//
// **원문을 고치지 않는다.** 나누기에 실패하면 원문을 그대로 돌려준다. 보기 좋게
// 만들려다 내용이 바뀌면, 화면에서 본 것과 실제로 오간 것이 달라진다 — 그 순간
// 이 화면은 근거로 쓸 수 없게 된다. 그래서 나눈 뒤 **공백을 뺀 내용이 같은지**
// 스스로 견주고, 다르면 원문을 돌려준다 (`lossless`).

/** 본문의 종류. 모르면 `text` 로 두고 손대지 않는다 */
export type BodyFormat = 'xml' | 'json' | 'sql' | 'text';

const SQL_HEAD = /^(select|insert|update|delete|merge|with|create|alter|drop|truncate|call|exec)\b/i;

/**
 * 무엇으로 보이는가.
 *
 * **확실한 것만 이름 붙인다.** 애매하면 `text` 다 — 잘못 붙이면 XML 이 아닌 것을
 * XML 로 나누려다 엉뚱한 모양이 된다. 판정은 글자로만 한다(파서를 들이지 않는다).
 */
export function detectFormat(body: string): BodyFormat {
  const s = body.trim();
  if (s === '') return 'text';
  if (s.startsWith('<') && s.endsWith('>')) return 'xml';
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try {
      JSON.parse(s);
      return 'json';
    } catch {
      return 'text';
    }
  }
  if (SQL_HEAD.test(s)) return 'sql';
  return 'text';
}

/** 나눈 뒤에도 내용이 그대로인가 — 공백만 견준다 */
function lossless(src: string, out: string): boolean {
  const bare = (s: string) => s.replace(/\s+/g, '');
  return bare(src) === bare(out);
}

const INDENT = '  ';

/**
 * 태그 한 조각. **주석과 CDATA 를 통째로 집는다** — 그 안에는 `>` 가 들어 있어서
 * `<[^>]*>` 로만 가르면 중간에서 잘린다. 잘린 채 줄을 나누면 내용이 바뀐다.
 */
const TOKEN = /(<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>)/;

/**
 * XML 을 태그마다 줄로 나눈다.
 *
 * XML 파서를 들이지 않는다 — 여기서 하려는 것은 해석이 아니라 **줄 나누기**다.
 * 값이 든 잎(`<a>1</a>`)은 한 줄로 둔다. 셋으로 나누면 payload 하나가 수천 줄이
 * 되어 오히려 못 읽는다.
 *
 * 나눈 뒤 **공백을 뺀 내용이 원문과 같은지 스스로 견주고**, 다르면 원문을 돌려준다.
 */
export function formatXml(xml: string): string {
  const src = xml.trim();
  const tokens = src.split(TOKEN).filter(t => t !== '');

  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];

    if (!tk.startsWith('<')) {
      // 태그 사이의 들여쓰기는 버리고, 내용이 있는 텍스트는 제 줄에 둔다.
      const text = tk.trim();
      if (text !== '') out.push(INDENT.repeat(depth) + text);
      continue;
    }
    if (tk.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      out.push(INDENT.repeat(depth) + tk);
      continue;
    }
    // 선언(`<?xml?>`)·DOCTYPE·주석·CDATA·빈 요소는 깊이를 바꾸지 않는다.
    if (tk.startsWith('<?') || tk.startsWith('<!') || tk.endsWith('/>')) {
      out.push(INDENT.repeat(depth) + tk);
      continue;
    }

    // `<a>값</a>` 은 한 줄로. 값의 앞뒤 공백은 지우지 않는다 — 값의 일부일 수 있다.
    const next = tokens[i + 1];
    const after = tokens[i + 2];
    if (next !== undefined && !next.startsWith('<') && after?.startsWith('</')) {
      out.push(INDENT.repeat(depth) + tk + next + after);
      i += 2;
      continue;
    }

    out.push(INDENT.repeat(depth) + tk);
    depth++;
  }

  const text = out.join('\n');
  return lossless(src, text) ? text : src;
}

/** JSON 을 두 칸 들여쓰기로. 파싱에 실패하면 원문 그대로 */
export function formatJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

/**
 * 종류에 맞게 나눈다. SQL 은 기존 정렬기(`sqlFormat`)가 맡으므로 여기서 손대지 않는다 —
 * 부르는 쪽이 종류를 보고 고른다.
 */
export function formatBody(body: string, format: BodyFormat): string {
  if (format === 'xml') return formatXml(body);
  if (format === 'json') return formatJson(body);
  return body;
}

/**
 * 목록에 놓을 한 줄 미리보기.
 *
 * 줄바꿈을 빈칸으로 바꾸고 길면 자른다. **자른 것을 자르지 않은 척하지 않는다** —
 * 끝에 `…` 를 붙여 «뒤가 더 있다» 를 표시한다.
 */
export function previewLine(body: string, max = 200): string {
  const one = body.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max)}…`;
}
