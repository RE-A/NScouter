// SQL 바인딩 파라미터 채우기
//
// 프로파일의 SQL 은 `select ... where id=?` 처럼 자리표시자만 온다.
// 값은 별도 필드(`param`)에 **쉼표로 이어 붙은 한 줄**로 온다 (실측 확인).
//
// 자리표시자는 두 가지다.
//
//   ?       PreparedStatement 의 바인딩. 값은 **나온 순서대로** 대응한다.
//   @{n}    에이전트가 리터럴을 빼낸 자리(profile_sql_escape_enabled).
//           n 은 1부터의 번호이고 값 목록의 **n 번째**다 — 순서가 아니라 번호다.
//
// `@{n}` 은 문자열이면 문장 쪽에 따옴표가 남는다: `where c = '@{1}'` · 값 `'fruit'`.
// 값이 따옴표를 들고 오므로 **따옴표째** 갈아끼워야 한다. 안쪽만 바꾸면 `''fruit''` 다.
// 숫자는 맨몸이다: `where id > @{2}` · 값 `100`.
// 실측: `probe_literal_sql_escape` (F-49)
//
// **둘은 한 문장에 같이 나온다.** 손으로 쓴 SQL 은 리터럴과 바인딩을 섞는다
// (`where status = 'PENDING' and id = ?`). 이때 값 한 줄은 **리터럴이 앞, 바인딩이 뒤**다:
//
//   TraceSQL.start(Object):
//     escapeLiteral(sql, step)                   → step.param = 리터럴 CSV
//     step.param = ctx.sql.toString(step.param)  → 리터럴 CSV + "," + 바인딩 값들
//
// 그래서 `?` 는 0번이 아니라 **리터럴 개수 다음**부터 가져와야 한다 (F-51).
// 0번부터 세면 `?` 자리에 리터럴 값이 다시 들어가고, 진짜 바인딩 값은 «쓰이지 않은 값»
// 으로 밀려난다 — 실환경에서 «파라미터가 안 나온다»로 보이던 것이 이것이다.
//
// **따옴표·주석 안의 `?` 를 건드리면 안 된다.** 하나를 잘못 세면 그 뒤가 전부 한 칸씩
// 밀려 **말은 되지만 틀린 SQL** 이 만들어진다. 그걸 복사해 DB 에 붙이면 사고다.
//
// ASIS(`SqlMakerUtil.bindSQL`)는 `?` 를 `:1` 로 바꾸고 값은 아래에 목록으로만 붙인다 —
// 채워 넣지는 않는다. 여기서는 **채운 문장을 만든다**: 그대로 복사해 실행할 수 있어야 쓸모가 있다.

export interface BoundSql {
  /** 채운 SQL. 값이 모자라면 남은 자리는 `?` 그대로다 */
  text: string;
  /** 실제로 채운 개수 */
  bound: number;
  /** SQL 안의 자리표시자 개수 */
  placeholders: number;
  /** 자리표시자보다 값이 많을 때 남은 것들. **버리지 않는다** */
  leftover: string[];
}

/**
 * 파라미터 한 줄을 값 목록으로 자른다.
 *
 * **따옴표 안의 쉼표는 구분자가 아니다** — `'서울시, 강남구'` 가 두 값이 되면
 * 그 뒤가 전부 밀린다. ASIS `divideParams` 와 같은 규칙이다.
 */
export function splitParams(params: string): string[] {
  if (params.trim() === '') return [];

  const out: string[] = [];
  let start = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < params.length; i++) {
    const ch = params[i];
    if (ch === ',' && !inSingle && !inDouble) {
      out.push(params.slice(start, i).trim());
      start = i + 1;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
  }
  out.push(params.slice(start).trim());
  return out;
}

/** `@{12}` 를 만나면 12 를, 아니면 null 을 준다. `at` 은 `@` 의 위치다 */
function readIndexed(sql: string, at: number): { index: number; end: number } | null {
  if (sql[at] !== '@' || sql[at + 1] !== '{') return null;
  let i = at + 2;
  let digits = '';
  while (i < sql.length && sql[i] >= '0' && sql[i] <= '9') {
    digits += sql[i];
    i++;
  }
  if (digits === '' || sql[i] !== '}') return null;
  return { index: Number(digits), end: i };
}

/** 문장 안에서 찾아낸 자리 하나 */
interface Slot {
  /** 갈아끼울 구간 [start, end) — `'@{n}'` 은 따옴표까지 포함한다 */
  start: number;
  end: number;
  /** `@{n}` 이면 그 번호, `?` 면 null */
  index: number | null;
}

/**
 * 자리표시자의 **위치만** 훑는다. 값은 아직 넣지 않는다.
 *
 * 두 번 훑는 이유: `?` 가 값 목록의 몇 번부터 시작하는지는 문장을 끝까지 봐야 안다.
 * 리터럴(`@{n}`)이 몇 개인지 모른 채로는 `?` 의 시작점을 정할 수 없다.
 *
 * 문자열 리터럴(`'...'`, `''` 이스케이프), 따옴표 식별자(`"..."`),
 * 줄 주석(`--`), 블록 주석(`/* *\/`) 안은 자리로 세지 않는다.
 * 단 `'@{n}'` 은 통째로 자리다 — 문자열처럼 생겼지만 값이 들어갈 자리다.
 */
function scanSlots(sql: string): Slot[] {
  const slots: Slot[] = [];

  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (inSingle) {
      // '' 는 문자열 안의 따옴표 한 개다 — 닫는 것으로 보면 그 뒤가 전부 어긋난다.
      if (ch === "'" && next === "'") i++;
      else if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }

    if (ch === "'") {
      const found = readIndexed(sql, i + 1);
      if (found && sql[found.end + 1] === "'") {
        slots.push({ start: i, end: found.end + 2, index: found.index });
        i = found.end + 1;
        continue;
      }
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '-' && next === '-') {
      inLineComment = true;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '@') {
      const found = readIndexed(sql, i);
      if (found) {
        slots.push({ start: i, end: found.end + 1, index: found.index });
        i = found.end;
        continue;
      }
    }
    if (ch === '?') {
      slots.push({ start: i, end: i + 1, index: null });
    }
  }

  return slots;
}

/**
 * 자리표시자를 값으로 채운다.
 *
 * 값은 **온 그대로** 넣는다. 문자열 값은 따옴표가 붙어 오므로(ASIS 도 그렇게 다룬다)
 * 벗겨 내면 실행할 수 없는 문장이 된다.
 */
export function bindSql(sql: string, params: string): BoundSql {
  const values = splitParams(params);
  const slots = scanSlots(sql);

  // **`?` 는 값 목록의 0번부터가 아니다.** 에이전트는 리터럴 값을 앞에, 바인딩 값을
  // 뒤에 이어 붙인다 (F-51). 리터럴이 몇 개인지 세고 그다음부터 `?` 를 채운다.
  // 0번부터 세면 `?` 자리에 리터럴 값이 다시 들어가 **말은 되지만 틀린 SQL** 이 된다.
  let seq = 0;
  for (const s of slots) {
    if (s.index !== null && s.index > seq) seq = s.index;
  }

  // 번호로 집는 자리표시자가 있어 **쓴 값을 따로 표시해야 한다.**
  // 남은 값을 '뒤에서부터' 자르는 식으로는 @{2} 만 쓰인 경우를 못 맞춘다.
  const used = new Array<boolean>(values.length).fill(false);
  let out = '';
  let bound = 0;
  let cursor = 0;

  for (const s of slots) {
    out += sql.slice(cursor, s.start);
    cursor = s.end;

    const at = s.index !== null ? s.index - 1 : seq;
    const v = values[at];
    if (v !== undefined) {
      out += v;
      used[at] = true;
      bound++;
    } else {
      // 값이 없으면 **원문 그대로** 둔다. 빈칸으로 채우면 조용히 틀린 문장이 된다.
      out += sql.slice(s.start, s.end);
    }
    if (s.index === null) seq++;
  }
  out += sql.slice(cursor);

  return {
    text: out,
    bound,
    placeholders: slots.length,
    leftover: values.filter((_, i) => !used[i]),
  };
}
