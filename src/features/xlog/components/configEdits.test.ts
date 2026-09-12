// 항목 단위 수정을 원문에 되돌려 넣기
//
// **저장은 파일을 통째로 덮는다** (F-40). 그래서 여기가 이 화면에서 가장 위험한 자리다 —
// 여기서 한 줄을 흘리면 그 설정이 조용히 기본값으로 돌아간다.
// 지키는 것:
//   · 고친 줄 말고는 한 글자도 안 건드린다 (주석·순서·빈 줄·줄바꿈 모양)
//   · 기본값으로 되돌리면 줄을 지운다 — 기본값을 박아 두면 판이 올라가도 옛 값에 묶인다
//   · 같은 키가 여럿이면 뒤의 것이 이긴다 — 앞의 줄을 고치면 저장해도 안 바뀐다
//   · 줄 이음(`\`)을 끊지 않는다 — 남은 줄이 다음 항목의 키로 읽힌다

import { describe, expect, it } from 'vitest';
import {
  ALL_DEFAULT_MARK,
  ensureNotEmpty,
  matchesQuery,
  planConfigEdits,
  validateValue,
} from './configEdits';
import type { ConfigEntry } from '../types/config';

function entry(key: string, value: string, dflt = ''): ConfigEntry {
  return { key, value, default: dflt, changed: value !== dflt, desc: '', value_type: 0 };
}

const edits = (o: Record<string, string>) => new Map(Object.entries(o));

describe('planConfigEdits — 고친 줄만', () => {
  const text = [
    '# 운영 설정',
    'net_collector_ip=10.0.0.5',
    '',
    'profile_sql_param_enabled=false',
    '# 끝',
  ].join('\n');
  const entries = [
    entry('net_collector_ip', '10.0.0.5', '127.0.0.1'),
    entry('profile_sql_param_enabled', 'false', 'true'),
    entry('xlog_lower_bound_time_ms', '0', '0'),
  ];

  it('원문에 있는 키는 그 줄의 값만 바꾼다', () => {
    const p = planConfigEdits(text, entries, edits({ net_collector_ip: '10.0.0.9' }));
    expect(p.text).toBe(text.replace('10.0.0.5', '10.0.0.9'));
    expect(p.changes).toEqual([
      { key: 'net_collector_ip', kind: 'set', before: '10.0.0.5', after: '10.0.0.9' },
    ]);
  });

  it('주석·빈 줄·순서는 한 글자도 안 건드린다', () => {
    const p = planConfigEdits(text, entries, edits({ net_collector_ip: '10.0.0.9' }));
    const lines = p.text.split('\n');
    expect(lines[0]).toBe('# 운영 설정');
    expect(lines[2]).toBe('');
    expect(lines[4]).toBe('# 끝');
  });

  it('원문에 없는 키는 끝에 덧붙인다', () => {
    const p = planConfigEdits(text, entries, edits({ xlog_lower_bound_time_ms: '100' }));
    expect(p.text.endsWith('xlog_lower_bound_time_ms=100')).toBe(true);
    expect(p.changes[0].kind).toBe('add');
  });

  it('기본값으로 되돌리면 그 줄을 지운다', () => {
    // 기본값을 박아 두면 에이전트 판이 올라가 기본값이 바뀌어도 옛 값에 묶인다.
    const p = planConfigEdits(text, entries, edits({ profile_sql_param_enabled: 'true' }));
    expect(p.text).not.toContain('profile_sql_param_enabled');
    expect(p.changes[0]).toEqual({
      key: 'profile_sql_param_enabled',
      kind: 'remove',
      before: 'false',
      after: 'true',
    });
  });

  it('지금 값과 같은 것은 바뀜이 아니다', () => {
    // 입력 칸을 눌렀다 놓기만 해도 «바뀜 1건» 이 뜨면 저장 확인이 무의미해진다.
    const p = planConfigEdits(text, entries, edits({ net_collector_ip: '10.0.0.5' }));
    expect(p.changes).toEqual([]);
    expect(p.text).toBe(text);
  });

  it('여러 건을 한 번에 넣는다', () => {
    const p = planConfigEdits(
      text,
      entries,
      edits({ net_collector_ip: '10.0.0.9', xlog_lower_bound_time_ms: '50' }),
    );
    expect(p.changes.map(c => c.kind).sort()).toEqual(['add', 'set']);
    expect(p.text).toContain('net_collector_ip=10.0.0.9');
    expect(p.text).toContain('xlog_lower_bound_time_ms=50');
  });
});

describe('planConfigEdits — 사람이 손으로 쓴 파일', () => {
  it('같은 키가 둘이면 뒤의 줄을 고친다', () => {
    // 자바 프로퍼티는 뒤의 것을 쓴다. 앞의 줄을 고치면 저장해도 안 바뀐다.
    const text = 'a=1\nb=2\na=3';
    const p = planConfigEdits(text, [entry('a', '3')], edits({ a: '9' }));
    expect(p.text).toBe('a=1\nb=2\na=9');
  });

  it('같은 키가 둘인데 기본값으로 되돌리면 둘 다 지운다', () => {
    // 하나만 지우면 남은 줄이 되살아나 이긴다.
    const text = 'a=1\nb=2\na=3';
    const p = planConfigEdits(text, [entry('a', '3', '0')], edits({ a: '0' }));
    expect(p.text).toBe('b=2');
  });

  it('`:` 와 공백으로 적은 키도 알아본다', () => {
    const text = 'a: 1\nb 2\n  c=3';
    const es = [entry('a', '1'), entry('b', '2'), entry('c', '3')];
    const p = planConfigEdits(text, es, edits({ a: '10', b: '20', c: '30' }));
    expect(p.text).toBe('a=10\nb=20\nc=30');
  });

  it('줄 이음을 끊지 않는다', () => {
    // 첫 줄만 고치면 둘째 줄 `2,3` 이 남아 없는 설정의 키로 읽힌다.
    const text = 'list=1,\\\n  2,3\nnext=x';
    const p = planConfigEdits(text, [entry('list', '1,2,3')], edits({ list: '9' }));
    expect(p.text).toBe('list=9\nnext=x');
  });

  it('역슬래시가 짝수로 끝나면 이음이 아니다', () => {
    // `\\` 는 역슬래시 한 글자다. 이음으로 보면 다음 항목을 삼킨다.
    const text = 'dir=c:\\\\\nnext=x';
    const p = planConfigEdits(text, [entry('dir', 'c:\\'), entry('next', 'x')], edits({ next: 'y' }));
    expect(p.text).toBe('dir=c:\\\\\nnext=y');
  });

  it('주석 안의 키는 고치지 않는다', () => {
    const text = '#a=1\na=2';
    const p = planConfigEdits(text, [entry('a', '2')], edits({ a: '5' }));
    expect(p.text).toBe('#a=1\na=5');
  });

  it('윈도우 줄바꿈을 지킨다', () => {
    // \n 만 섞으면 diff 가 통째로 바뀐다.
    const text = 'a=1\r\nb=2\r\n';
    const p = planConfigEdits(text, [entry('a', '1'), entry('b', '2')], edits({ a: '9' }));
    expect(p.text).toBe('a=9\r\nb=2\r\n');
  });

  it('파일 끝 줄바꿈 모양을 지키며 덧붙인다', () => {
    const p = planConfigEdits('a=1\n', [entry('a', '1'), entry('z', '0', '0')], edits({ z: '7' }));
    expect(p.text).toBe('a=1\nz=7\n');
  });

  it('설정 파일이 없어도 덧붙일 수 있다', () => {
    // 에이전트가 파일 없이 기본값으로 도는 경우. 첫 설정을 여기서 만든다.
    const p = planConfigEdits('', [entry('a', '0', '0')], edits({ a: '1' }));
    expect(p.text).toBe('a=1');
  });

  it('값에 줄바꿈이 섞이면 한 줄로 누른다', () => {
    // 쪼개지면 뒷부분이 새 키로 읽힌다.
    const p = planConfigEdits('a=1', [entry('a', '1')], edits({ a: 'x\ny=2' }));
    expect(p.text).toBe('a=x y=2');
  });
});

describe('validateValue', () => {
  it('숫자 칸에 글자가 들어가면 막는다', () => {
    // 에이전트는 파싱에 실패하면 **조용히** 기본값을 쓴다.
    expect(validateValue('abc', 2)).not.toBeNull();
    expect(validateValue('1.5', 2)).not.toBeNull();
    expect(validateValue('300', 2)).toBeNull();
    expect(validateValue('-1', 2)).toBeNull();
    expect(validateValue('', 2)).toBeNull();
  });

  it('참거짓 칸은 true / false 만 받는다', () => {
    expect(validateValue('true', 3)).toBeNull();
    expect(validateValue('yes', 3)).not.toBeNull();
  });

  it('이름:값 목록은 모양을 본다', () => {
    expect(validateValue('a:1,b:2', 5)).toBeNull();
    expect(validateValue('a:1,b', 5)).not.toBeNull();
  });

  it('글자 칸과 모르는 종류는 막지 않는다', () => {
    expect(validateValue('anything', 1)).toBeNull();
    expect(validateValue('anything', 0)).toBeNull();
  });
});

describe('matchesQuery', () => {
  it('설명으로도 찾는다', () => {
    // 키 이름을 아는 사람보다 «SQL 파라미터» 를 찾는 사람이 훨씬 많다.
    const e = { ...entry('profile_sql_param_enabled', 'true'), desc: 'Collect SQL bind parameters' };
    expect(matchesQuery(e, 'collect')).toBe(true);
  });

  it('낱말마다 따로 본다 — 순서도 자리도 따지지 않는다', () => {
    // 붙은 글자로만 찾으면 «sql parameters» 는 사이에 bind 가 있어 못 찾는다.
    const e = { ...entry('profile_sql_param_enabled', 'true'), desc: 'Collect SQL bind parameters' };
    expect(matchesQuery(e, 'sql parameters')).toBe(true);
    expect(matchesQuery(e, 'parameters sql')).toBe(true);
    // 키의 낱말과 설명의 낱말을 섞어도 된다
    expect(matchesQuery(e, 'profile bind')).toBe(true);
  });

  it('낱말 하나라도 없으면 안 걸린다', () => {
    const e = { ...entry('profile_sql_param_enabled', 'true'), desc: 'Collect SQL bind parameters' };
    expect(matchesQuery(e, 'sql socket')).toBe(false);
  });

  it('값으로도 찾는다', () => {
    // 포트 번호만 아는 사람은 6100 으로 찾는다.
    expect(matchesQuery(entry('net_collector_tcp_port', '6100'), '6100')).toBe(true);
  });
});

describe('ensureNotEmpty', () => {
  it('마지막 항목까지 기본값으로 돌리면 주석 한 줄을 남긴다', () => {
    // 저장은 빈 텍스트를 거절한다 — 빈 편집기를 실수로 저장하는 것을 막는 빗장이다.
    // 여기서는 정당하게 빈 것이라 주석으로 채운다. 에이전트는 주석을 무시한다.
    const p = planConfigEdits('a=1', [entry('a', '1', '0')], edits({ a: '0' }));
    expect(p.text).toBe('');
    expect(ensureNotEmpty(p.text)).toBe(ALL_DEFAULT_MARK);
    expect(ALL_DEFAULT_MARK.startsWith('#')).toBe(true);
  });

  it('내용이 있으면 그대로다', () => {
    expect(ensureNotEmpty('a=1')).toBe('a=1');
  });
});
