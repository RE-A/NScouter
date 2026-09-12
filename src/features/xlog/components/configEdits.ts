// 설정을 항목 단위로 고치기 (순수 로직)
//
// **콜렉터에는 «한 항목만 바꿔라» 가 없다.** 저장은 `SET_CONFIGURE_WAS` 하나뿐이고 파일을
// 통째로 덮어쓴다(F-40) — 한 줄만 보내면 나머지 설정이 전부 사라진다. ASIS 가 원문 편집기만
// 준 것도 그래서다.
//
// 그래서 항목 화면에서 고친 것은 **원문에 되돌려 넣는다.**
//   · 그 키의 줄이 있으면 값만 갈아 끼운다 — 주석·순서·다른 줄은 한 글자도 안 건드린다
//   · 없으면 끝에 덧붙인다
//   · 기본값으로 되돌렸으면 **그 줄을 지운다** — 기본값을 적어 두면 에이전트 판이 올라가
//     기본값이 바뀌어도 옛 값에 묶인다. 지우면 기본값을 따라간다(원문 편집기 경고와 같은 뜻)
//
// 파일 문법은 자바 프로퍼티다. Scouter 설정은 거의 `key=value` 한 줄씩이지만,
// 사람이 손으로 여는 파일이라 `key: value` · `key value` · 줄 이음(`\`)도 받아 준다.
// 역슬래시 이스케이프는 여기서 하지 않는다 — 저장할 때 Rust 가 한다(`escape_config_text`).

import type { ConfigEntry } from '../types/config';

/** 원문의 논리 줄 하나. 줄 이음이 있으면 여러 물리 줄을 묶는다 */
interface LogicalLine {
  /** 물리 줄 범위 [start, end) */
  start: number;
  end: number;
  /** 주석·빈 줄이면 null */
  key: string | null;
}

/**
 * 원문을 논리 줄로 나눈다.
 *
 * **줄 이음을 따라간다.** `a=1,\` 다음 줄 `2` 는 한 항목이다. 첫 줄만 보고 값을 바꾸면
 * 둘째 줄이 남아 다음 항목의 키로 읽힌다 — 없는 설정이 하나 생긴다.
 */
function parseLines(lines: readonly string[]): LogicalLine[] {
  const out: LogicalLine[] = [];
  let i = 0;
  while (i < lines.length) {
    const start = i;
    const first = lines[i];
    // 줄 이음: 끝의 역슬래시가 홀수 개면 다음 줄로 이어진다
    while (i < lines.length && endsWithContinuation(lines[i])) i += 1;
    i += 1;
    const end = Math.min(i, lines.length);
    out.push({ start, end, key: keyOf(first) });
  }
  return out;
}

/** 끝의 역슬래시가 홀수 개인가 — 짝수면 «역슬래시 한 글자» 가 적힌 것이다 */
function endsWithContinuation(line: string): boolean {
  let n = 0;
  for (let i = line.length - 1; i >= 0 && line[i] === '\\'; i--) n += 1;
  return n % 2 === 1;
}

/**
 * 한 줄에서 키를 꺼낸다. 주석·빈 줄이면 null.
 *
 * 자바 프로퍼티는 키가 `=` · `:` · 공백 중 먼저 오는 것에서 끝난다.
 */
function keyOf(line: string): string | null {
  const s = line.replace(/^[ \t\f]+/, '');
  if (s === '' || s.startsWith('#') || s.startsWith('!')) return null;
  const m = /^((?:\\.|[^=:\s\\])+)/.exec(s);
  return m ? m[1] : null;
}

/** 값에 줄바꿈이 들어오면 한 항목이 여러 줄로 쪼개진다. 한 줄로 누른다 */
function oneLine(value: string): string {
  return value.replace(/\r?\n/g, ' ');
}

/** 저장 전에 보여줄 바뀜 한 건 */
export interface ConfigChange {
  key: string;
  /** set: 원문의 값을 바꾼다 · add: 원문에 없어 덧붙인다 · remove: 기본값으로 — 줄을 지운다 */
  kind: 'set' | 'add' | 'remove';
  /** 지금 에이전트가 쓰고 있는 값 */
  before: string;
  /** 저장 뒤에 쓰게 될 값 (지우면 기본값) */
  after: string;
}

export interface ConfigPlan {
  /** 저장할 원문 전체 */
  text: string;
  changes: ConfigChange[];
}

/**
 * 고친 항목들을 원문에 되돌려 넣는다.
 *
 * @param text    지금의 원문 (`GET_CONFIGURE_WAS`)
 * @param entries 지금의 항목 표 — 현재 값과 기본값을 여기서 본다
 * @param edits   키 → 새 값. **지금 값과 같은 것은 바뀜이 아니다** — 넘겨도 무시한다
 */
export function planConfigEdits(
  text: string,
  entries: readonly ConfigEntry[],
  edits: ReadonlyMap<string, string>,
): ConfigPlan {
  const byKey = new Map(entries.map(e => [e.key, e]));
  // 원문의 줄바꿈을 지킨다 — 윈도우 줄바꿈 파일에 \n 만 섞으면 diff 가 통째로 바뀐다
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text === '' ? [] : text.split(/\r?\n/);
  const logical = parseLines(lines);

  const changes: ConfigChange[] = [];
  /** 물리 줄 번호 → 갈아 끼울 내용. null 이면 지운다 */
  const replace = new Map<number, string | null>();
  const appended: string[] = [];

  for (const [key, raw] of edits) {
    const entry = byKey.get(key);
    const value = oneLine(raw);
    const before = entry?.value ?? '';
    if (value === before) continue;

    const dflt = entry?.default;
    const toDefault = dflt !== undefined && value === dflt;
    // **마지막 것이 이긴다.** 같은 키를 두 번 적은 파일이 실제로 있다 — 자바 프로퍼티는
    // 뒤의 것을 쓰므로, 앞의 줄을 고치면 저장해도 안 바뀐다.
    const hits = logical.filter(l => l.key === key);
    const last = hits[hits.length - 1];

    if (toDefault) {
      // 원문에 없는데 기본값과 다르게 돌고 있을 수는 없다 — 있으면 지운다, 없으면 할 일이 없다.
      // 같은 키가 여럿이면 **전부** 지운다 — 하나만 지우면 앞의 줄이 되살아나 이긴다.
      for (const h of hits) {
        for (let i = h.start; i < h.end; i++) replace.set(i, null);
      }
      changes.push({ key, kind: 'remove', before, after: dflt });
      continue;
    }

    if (last) {
      replace.set(last.start, `${key}=${value}`);
      // 이어진 줄은 지운다 — 남으면 다음 항목의 키로 읽힌다
      for (let i = last.start + 1; i < last.end; i++) replace.set(i, null);
      changes.push({ key, kind: 'set', before, after: value });
    } else {
      appended.push(`${key}=${value}`);
      changes.push({ key, kind: 'add', before, after: value });
    }
  }

  const out: string[] = [];
  lines.forEach((line, i) => {
    if (!replace.has(i)) {
      out.push(line);
      return;
    }
    const next = replace.get(i);
    if (next !== null && next !== undefined) out.push(next);
  });

  if (appended.length > 0) {
    // 파일 끝의 빈 줄 뒤에 붙이면 사이에 빈 줄이 하나 끼어 원문 모양이 흐트러진다
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    out.push(...appended);
    // 원래 파일이 줄바꿈으로 끝났으면 그 모양을 지킨다
    if (text.endsWith('\n')) out.push('');
  }

  return { text: out.join(eol), changes };
}

/**
 * 값이 이 종류로 쓸 만한가. 안 되면 까닭을, 되면 null.
 *
 * **저장 전에 걸러야 한다.** 숫자 자리에 글자가 들어가면 에이전트가 파싱에 실패해
 * 그 항목을 기본값으로 쓰는데, 그게 오류가 아니라 **조용히** 일어난다.
 */
export function validateValue(value: string, valueType: number): string | null {
  const v = value.trim();
  switch (valueType) {
    case 2: // NUM
      if (v === '') return null; // 빈 값은 «기본값을 써라» 로 읽힌다
      return /^-?\d+$/.test(v) ? null : '정수만 넣을 수 있습니다';
    case 3: // BOOL
      return v === 'true' || v === 'false' ? null : 'true 또는 false 여야 합니다';
    case 5: { // COMMA_COLON_SEPARATED
      if (v === '') return null;
      // 문구에 값을 끼워 넣지 않는다 — 그러면 번역 사전의 키가 될 수 없다.
      // 무엇이 틀렸는지는 바로 위 입력 칸에 그대로 보인다.
      const bad = v.split(',').map(s => s.trim()).some(s => s !== '' && !s.includes(':'));
      return bad ? '«이름:값» 모양이 아닌 것이 있습니다' : null;
    }
    default:
      return null;
  }
}

/**
 * 검색 — 키·값·기본값 **그리고 설명**.
 *
 * 설명으로 찾게 해야 이 화면이 쓸모 있다. `profile_sql_param_enabled` 라는 이름을 아는
 * 사람보다 «SQL 파라미터» 를 찾는 사람이 훨씬 많다.
 */
export function matchesQuery(e: ConfigEntry, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  // **낱말마다 따로 본다.** «sql param» 을 붙은 글자로만 찾으면 키 `profile_sql_param`
  // (밑줄) 도 설명 «SQL bind parameters» (사이에 bind) 도 못 찾는다.
  // 낱말이 전부 어딘가에 있으면 걸린다 — 순서도 자리도 따지지 않는다.
  const hay = [e.key, e.value, e.default, e.desc].join('\n').toLowerCase();
  return words.every(w => hay.includes(w));
}

/** 모든 항목이 기본값일 때 파일에 남기는 한 줄 */
export const ALL_DEFAULT_MARK = '# 모든 항목이 기본값입니다';

/**
 * 저장할 원문이 비지 않게 한다.
 *
 * **저장은 빈 텍스트를 거절한다** (`save_agent_config`) — 빈 편집기를 실수로 저장해
 * 설정이 통째로 날아가는 것을 막으려는 빗장이다. 그런데 항목 화면에서 마지막 하나까지
 * 기본값으로 되돌리면 원문이 **정당하게** 빈다. 그때는 주석 한 줄을 남긴다 —
 * 에이전트는 주석을 무시하므로 뜻은 «전부 기본값» 그대로다.
 */
export function ensureNotEmpty(text: string): string {
  return text.trim() === '' ? ALL_DEFAULT_MARK : text;
}
