// SQL 을 읽을 수 있게 줄로 나눈다.
//
// 프로파일의 SQL 은 **한 줄로 온다.** 대시보드 한 판이 129건이고 그중 하나가
// 150~400자짜리 join·서브쿼리다. 접힌 상태로는 세 줄이 잘려 보이고, 펼쳐도
// 벽 같은 한 덩어리라 어디가 `where` 인지 눈으로 못 찾는다.
//
// **여는 것은 «어디가 느렸나» 를 보려는 것이다.** 문장을 읽을 수 없으면 그 자리에서 멈춘다.
//
// ── 지키는 것 두 가지 ────────────────────────────────────────
//
// 1. **글자를 하나도 잃지 않는다.** 지운 것 없이 줄바꿈과 들여쓰기만 넣는다.
//    `format(s)` 결과에서 공백을 접어 비교하면 원문과 같아야 한다(테스트가 본다).
//    SQL 은 복사해서 DB 에 붙이는 물건이라, 예쁘게 만들려다 한 글자라도 바꾸면 사고다.
//
// 2. **따옴표·주석 안은 건드리지 않는다.** `'order by'` 같은 값이나 주석 안의 낱말을
//    키워드로 보면 문자열이 두 줄로 갈라진다 — `sqlBind` 와 같은 규칙이다.
//
// 완전한 SQL 파서가 아니다. 서브쿼리 안까지 들여쓰기를 맞추지는 않는다 —
// 그건 방언마다 달라서 틀리기 시작하면 원문보다 못해진다. 줄만 나눈다.

/** 새 줄에서 시작하는 절. 긴 것부터 봐야 `order` 가 `order by` 를 가로채지 않는다 */
const BREAK_BEFORE = [
  'insert into',
  'delete from',
  'group by',
  'order by',
  'left outer join',
  'right outer join',
  'full outer join',
  'cross join',
  'inner join',
  'left join',
  'right join',
  'outer join',
  'union all',
  'select',
  'from',
  'where',
  'having',
  'union',
  'values',
  'update',
  'set',
  'join',
  'limit',
  'offset',
  'fetch',
  'returning',
] as const;

/** 한 칸 들여쓰는 절. 앞 절에 딸린 것들이다 */
const INDENTED = new Set(['and', 'or', 'on']);

/** 토큰 하나 */
interface Tok {
  text: string;
  /** 따옴표·주석 안이라 손대면 안 되는 덩어리인가 */
  literal: boolean;
}

/**
 * 문자열·주석을 통째로 한 토큰으로 떼어 낸다.
 *
 * 이걸 먼저 하지 않으면 `'group by'` 같은 값이 절로 잘린다.
 */
function lex(sql: string): Tok[] {
  const out: Tok[] = [];
  let buf = '';
  const flush = () => {
    if (buf !== '') {
      out.push({ text: buf, literal: false });
      buf = '';
    }
  };

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === "'" || ch === '"') {
      flush();
      const quote = ch;
      let lit = ch;
      i++;
      while (i < sql.length) {
        lit += sql[i];
        // '' 는 문자열 안의 따옴표 한 개다 — 닫는 것으로 보면 그 뒤가 전부 어긋난다
        if (sql[i] === quote && sql[i + 1] === quote) {
          lit += sql[i + 1];
          i += 2;
          continue;
        }
        if (sql[i] === quote) break;
        i++;
      }
      out.push({ text: lit, literal: true });
      continue;
    }
    if (ch === '-' && next === '-') {
      flush();
      let lit = '';
      while (i < sql.length && sql[i] !== '\n') lit += sql[i++];
      out.push({ text: lit, literal: true });
      i--;
      continue;
    }
    if (ch === '/' && next === '*') {
      flush();
      let lit = '';
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) lit += sql[i++];
      lit += '*/';
      i++;
      out.push({ text: lit, literal: true });
      continue;
    }
    buf += ch;
  }
  flush();
  return out;
}

/**
 * 이 자리에서 절이 시작하는가. 시작하면 그 절의 글자 수를 준다.
 *
 * **이미 공백이 있는 자리에서만 자른다.** `(select …)` 처럼 붙어 있는 데를 자르면
 * 줄바꿈이 곧 **없던 공백**이 되어 원문이 바뀐다 — 테스트가 그걸 잡아 줬다.
 * 서브쿼리를 한 줄에 두는 편이 읽기에도 낫다.
 */
function clauseAt(lower: string, at: number): number {
  // 낱말 경계에서만 본다 — `fromage` 의 `from` 을 절로 보면 안 된다.
  // **맨 앞은 알아보되 줄은 안 나눈다** (부르는 쪽이 정한다). 여기서 0 을 돌려주면
  // `left outer join` 의 `left` 를 지나쳐 `outer join` 에서 잘려 «left / outer join» 이 된다.
  if (at > 0 && !/\s/.test(lower[at - 1])) return 0;
  for (const kw of BREAK_BEFORE) {
    if (!lower.startsWith(kw, at)) continue;
    const after = lower[at + kw.length];
    if (after === undefined || !/[\w$]/.test(after)) return kw.length;
  }
  return 0;
}

/** `and` · `or` · `on` 처럼 한 칸 들여쓸 낱말인가. 자르는 자리 규칙은 `clauseAt` 과 같다 */
function indentedAt(lower: string, at: number): number {
  if (at > 0 && !/\s/.test(lower[at - 1])) return 0;
  for (const kw of INDENTED) {
    if (!lower.startsWith(kw, at)) continue;
    const after = lower[at + kw.length];
    if (after === undefined || !/[\w$]/.test(after)) return kw.length;
  }
  return 0;
}

/**
 * 줄로 나눈다.
 *
 * **글자는 그대로 두고 줄바꿈만 넣는다.** 대소문자도 안 바꾼다 —
 * 원문이 대문자로 쓰였으면 그게 그 팀의 규칙이다.
 */
export function formatSql(sql: string): string {
  if (sql.trim() === '') return sql;

  const parts: string[] = [];
  for (const tok of lex(sql)) {
    if (tok.literal) {
      parts.push(tok.text);
      continue;
    }
    const lower = tok.text.toLowerCase();
    let i = 0;
    let plain = '';
    while (i < tok.text.length) {
      const cl = clauseAt(lower, i);
      if (cl > 0) {
        if (plain !== '') {
          parts.push(plain);
          plain = '';
        }
        parts.push('\n' + tok.text.slice(i, i + cl));
        i += cl;
        continue;
      }
      const ind = indentedAt(lower, i);
      if (ind > 0) {
        if (plain !== '') {
          parts.push(plain);
          plain = '';
        }
        parts.push('\n  ' + tok.text.slice(i, i + ind));
        i += ind;
        continue;
      }
      plain += tok.text[i];
      i++;
    }
    if (plain !== '') parts.push(plain);
  }

  // 줄 끝 공백을 털고, 맨 앞의 빈 줄을 없앤다
  return parts
    .join('')
    .split('\n')
    .map(l => l.replace(/\s+$/, ''))
    .filter((l, idx) => !(idx === 0 && l.trim() === ''))
    .join('\n')
    .trim();
}

/**
 * 공백을 하나로 접는다. **글자를 잃지 않았는지 보는 데 쓴다.**
 *
 * 정렬은 줄바꿈과 들여쓰기만 넣어야 한다 — 이 함수로 접었을 때 원문과 같아야 한다.
 */
export function collapseWhitespace(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}
