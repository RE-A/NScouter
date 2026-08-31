// 요약 CSV 의 계약
//
// 여기서 지키려는 것:
//   · 쉼표·따옴표·줄바꿈이 든 값이 칸을 밀지 않는다 (SQL·UA 에 셋 다 나온다)
//   · 없는 값은 0 이 아니라 빈 칸이다 (F-38 — 0 으로 쓰면 «0ms 걸렸다» 가 된다)
//   · 화면에 그린 상위 50줄이 아니라 **받아 온 전부**가 들어간다

import { describe, expect, it } from 'vitest';
import { csvCell, summaryCsv } from './summaryCsv';
import type { SummaryRow } from '../types/summary';

const label = (id: number) => `svc-${id}`;

function r(over: Partial<SummaryRow> = {}): SummaryRow {
  return { id: 1, count: 2, error: 0, elapsed: 100, cpu: null, mem: null, ...over };
}

describe('csvCell', () => {
  it('쉼표가 들어가면 감싼다', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
  });

  it('따옴표는 두 번 적어 이스케이프한다', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('줄바꿈이 들어가면 감싼다', () => {
    // 안 감싸면 SQL 한 문장이 여러 줄로 쪼개져 표가 통째로 밀린다.
    expect(csvCell('select 1\nfrom dual')).toBe('"select 1\nfrom dual"');
  });

  it('없는 값은 빈 칸이다', () => {
    expect(csvCell(null)).toBe('');
  });
});

describe('summaryCsv', () => {
  it('머리글 + 행 전부를 낸다', () => {
    const rows = Array.from({ length: 120 }, (_, i) => r({ id: i }));
    const lines = summaryCsv(rows, label).trimEnd().split('\r\n');

    expect(lines[0]).toBe('이름,횟수,합계(ms),평균(ms),에러');
    expect(lines).toHaveLength(121); // 화면은 50줄만 그린다
  });

  it('평균은 합계÷횟수다', () => {
    const line = summaryCsv([r({ count: 4, elapsed: 100 })], label).split('\r\n')[1];
    expect(line).toBe('svc-1,4,100,25,0');
  });

  it('합계가 없으면 평균도 비운다', () => {
    // IP·UA 요약에는 소요 시간이 없다. 0 으로 쓰면 «0ms 걸렸다» 가 된다.
    const line = summaryCsv([r({ elapsed: null, error: null })], label).split('\r\n')[1];
    expect(line).toBe('svc-1,2,,,');
  });
});
