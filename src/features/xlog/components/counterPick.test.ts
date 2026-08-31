// 서버 고르기 규칙
//
// 빈 집합이 곧 전부라, 체크 동작이 한 번 꼬이는 자리가 있다.

import { describe, expect, it } from 'vitest';
import { nextPicked, prunePicked } from './counterPick';

const HASHES = [11, 22, 33];

describe('nextPicked', () => {
  it('전체 상태에서 하나를 풀면 그것만 빼고 전부다', () => {
    // 그냥 add 하면 «푼 것 하나만» 남아 동작이 정반대가 된다.
    expect([...nextPicked(new Set(), HASHES, 22)]).toEqual([11, 33]);
  });

  it('고른 상태에서는 켜고 끈다', () => {
    expect([...nextPicked(new Set([11]), HASHES, 33)]).toEqual([11, 33]);
    expect([...nextPicked(new Set([11, 33]), HASHES, 11)]).toEqual([33]);
  });

  it('마지막 하나까지 풀면 전체로 돌아간다', () => {
    // 빈 집합 = 전부. 아무것도 안 그려진 화면은 고장으로 읽힌다.
    expect(nextPicked(new Set([11]), HASHES, 11).size).toBe(0);
  });
});

describe('prunePicked', () => {
  it('사라진 오브젝트는 선택에서 빠진다', () => {
    expect([...prunePicked(new Set([11, 99]), HASHES)]).toEqual([11]);
  });

  it('바뀐 게 없으면 같은 객체를 돌려준다', () => {
    // 새 Set 을 만들면 리렌더가 끝없이 돈다.
    const picked = new Set([11]);
    expect(prunePicked(picked, HASHES)).toBe(picked);
  });
});
