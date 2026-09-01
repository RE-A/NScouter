// 담아 둔 조회 조건의 계약
//
// 여기서 지키려는 것:
//   · **조건만** 담는다 — 서버 해시는 콜렉터마다 달라 다른 서버에서 불러오면 0건이 된다
//   · 같은 이름은 덮어쓴다 (번호가 붙어 쌓이면 목록이 못 쓰게 된다)
//   · 설정 파일이 무엇을 담고 있어도 목록이 망가지지 않는다

import { describe, expect, it } from 'vitest';
import { fromFilter, isSame, normalize, remove, toPatch, upsert } from './savedFilters';
import { DEFAULT_FILTER, type XLogFilterState } from '../types/xlog';

const filter = (over: Partial<XLogFilterState> = {}): XLogFilterState => ({
  ...DEFAULT_FILTER,
  ...over,
});

const rule = (text: string, exclude = false) =>
  ({ field: 'service' as const, text, exclude });

describe('fromFilter', () => {
  it('조건만 담는다 — 서버와 모드는 담지 않는다', () => {
    const saved = fromFilter('결제만', filter({
      patterns: [rule('/pay')],
      errorOnly: true,
      elapsedMs: 3000,
      objHashSet: new Set([11, 22]),
    }));

    expect(saved).toEqual({
      name: '결제만',
      patterns: [rule('/pay')],
      errorOnly: true,
      elapsedMs: 3000,
      elapsedExclude: false,
    });
    expect('objHashSet' in saved).toBe(false);
  });

  it('빈 줄은 담지 않는다', () => {
    // 담을 때 털어 둬야 불러온 쪽에서 «왜 한 줄이 비어 있지» 가 없다.
    const saved = fromFilter('x', filter({ patterns: [rule('/pay'), rule('  ')] }));
    expect(saved.patterns).toEqual([rule('/pay')]);
  });
});

describe('toPatch', () => {
  it('대상 서버는 건드리지 않는다', () => {
    // 조건을 불러왔다고 보던 서버가 바뀌면 그게 더 놀랍다.
    const patch = toPatch(fromFilter('x', filter({ patterns: [rule('/pay')] })));
    expect('objHashSet' in patch).toBe(false);
    expect(patch.patterns).toEqual([rule('/pay')]);
  });
});

describe('normalize', () => {
  it('이름이 없거나 겹치면 버린다', () => {
    const out = normalize([
      { name: 'a', patterns: [] },
      { name: '  ', patterns: [] },
      { name: 'a', patterns: [] },
    ]);
    expect(out.map(f => f.name)).toEqual(['a']);
  });

  it('배열이 아니면 빈 목록이다', () => {
    expect(normalize(null)).toEqual([]);
    expect(normalize('nope')).toEqual([]);
  });

  it('모르는 자리와 빈 글자는 줄에서 뺀다', () => {
    const out = normalize([
      { name: 'a', patterns: [{ field: 'url', text: 'x' }, { field: 'ip', text: '' }, { field: 'ip', text: '10.' }] },
    ]);
    expect(out[0].patterns).toEqual([{ field: 'ip', text: '10.', exclude: false }]);
  });

  it('응답시간이 이상하면 조건 없음으로 둔다', () => {
    expect(normalize([{ name: 'a', elapsedMs: 'abc' }])[0].elapsedMs).toBe(0);
    expect(normalize([{ name: 'a', elapsedMs: -5 }])[0].elapsedMs).toBe(0);
    expect(normalize([{ name: 'a', elapsedMs: 1500 }])[0].elapsedMs).toBe(1500);
  });
});

describe('upsert · remove', () => {
  const a = fromFilter('a', filter({ patterns: [rule('/one')] }));

  it('같은 이름은 덮어쓴다', () => {
    const next = upsert([a], fromFilter('a', filter({ patterns: [rule('/two')] })));
    expect(next).toHaveLength(1);
    expect(next[0].patterns).toEqual([rule('/two')]);
  });

  it('다른 이름은 더한다', () => {
    expect(upsert([a], fromFilter('b', filter()))).toHaveLength(2);
  });

  it('이름이 비면 담지 않는다', () => {
    expect(upsert([a], fromFilter('   ', filter()))).toEqual([a]);
  });

  it('이름으로 지운다', () => {
    expect(remove([a], 'a')).toEqual([]);
  });
});

describe('isSame', () => {
  const saved = fromFilter('결제만', filter({ patterns: [rule('/pay')], errorOnly: true }));

  it('조건이 같으면 같다고 본다', () => {
    expect(isSame(saved, filter({ patterns: [rule('/pay')], errorOnly: true }))).toBe(true);
    // 서버를 다르게 골라도 «조건» 은 같다
    expect(
      isSame(saved, filter({ patterns: [rule('/pay')], errorOnly: true, objHashSet: new Set([9]) })),
    ).toBe(true);
  });

  it('한 줄이라도 다르면 다르다', () => {
    expect(isSame(saved, filter({ patterns: [rule('/pay', true)], errorOnly: true }))).toBe(false);
    expect(isSame(saved, filter({ patterns: [rule('/pay')], errorOnly: false }))).toBe(false);
  });
});
