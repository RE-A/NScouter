// 서버 색의 계약
//
//   · 기본은 objHash 로 정한다 — 목록 순서와 무관하다
//   · 무리 열쇠를 걸면 같은 열쇠의 오브젝트는 같은 색이다 (서비스로 묶어 볼 때)
//   · 열쇠를 바꾸면 옛 기준으로 정한 색이 남지 않는다
//   · 열쇠가 없는 오브젝트는 원래 색 그대로다

import { afterEach, describe, expect, it } from 'vitest';
import { getAgentColor, getDotColor, keyColor, setAgentColorKey } from './colorPalette';

afterEach(() => setAgentColorKey(null));

describe('getAgentColor', () => {
  it('열쇠가 없으면 objHash 로 정하고 매번 같다', () => {
    expect(getAgentColor(7)).toBe(getAgentColor(7));
  });

  it('같은 서비스의 Task 는 같은 색이다', () => {
    // 1·2 를 기본 색이 서로 다른 해시로 고른다 — 같으면 이 검사가 아무것도 못 가린다
    const [a, b] = findDistinctPair();
    setAgentColorKey(h => (h === a || h === b ? 'safs' : null));
    expect(getAgentColor(a)).toBe(keyColor('safs'));
    expect(getAgentColor(b)).toBe(keyColor('safs'));
  });

  it('열쇠가 없는 오브젝트는 원래 색이다', () => {
    const before = getAgentColor(42);
    setAgentColorKey(h => (h === 1 ? 'safs' : null));
    expect(getAgentColor(42)).toBe(before);
  });

  it('열쇠를 바꾸면 옛 기준의 색이 남지 않는다', () => {
    const [a] = findDistinctPair();
    const own = getAgentColor(a);
    const other = otherKeyThan(own);
    setAgentColorKey(() => other);
    expect(getAgentColor(a)).toBe(keyColor(other));
    setAgentColorKey(null);
    expect(getAgentColor(a)).toBe(own);
  });

  it('XLog 점도 같은 기준을 따른다', () => {
    setAgentColorKey(() => 'safs');
    expect(getDotColor(3, 1, false)).toBe(keyColor('safs'));
  });
});

describe('keyColor', () => {
  it('같은 이름은 재시작해도 같은 색이다 (String.hashCode 식)', () => {
    expect(keyColor('safs')).toBe(keyColor('safs'));
  });
});

/** 기본 색이 서로 다른 두 해시 */
function findDistinctPair(): [number, number] {
  for (let b = 2; b < 100; b++) if (getAgentColor(1) !== getAgentColor(b)) return [1, b];
  throw new Error('팔레트가 한 색뿐이다');
}

/** 이 색이 아닌 색을 내는 열쇠 */
function otherKeyThan(color: string): string {
  for (let i = 0; i < 100; i++) if (keyColor(`k${i}`) !== color) return `k${i}`;
  throw new Error('팔레트가 한 색뿐이다');
}
