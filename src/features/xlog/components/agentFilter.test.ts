// 에이전트 필터의 행 상태
//
// `objHashSet` 은 **화이트리스트**다 — 비어 있으면 필터가 없다는 뜻이고 전부 보인다
// (XLogChartRenderer.passesFilter: `size > 0 && !has(hash)` 일 때만 거른다).
//
// 이전 UI 는 "필터 없음"을 "전부 선택됨"으로 그렸다. 모든 행이 파랗게 칠해지는데,
// 전부를 강조하는 건 아무것도 강조하지 않는 것과 같다.

import { describe, it, expect } from 'vitest';
import { agentRowState } from './agentFilter';

describe('agentRowState', () => {
  it('빈 집합은 필터가 없다는 뜻이라 아무 행도 강조하지 않는다', () => {
    const none = new Set<number>();
    expect(agentRowState(none, 1)).toBe('plain');
    expect(agentRowState(none, 999)).toBe('plain');
  });

  it('필터 중이면 포함된 행만 강조한다', () => {
    const sel = new Set([1, 2]);
    expect(agentRowState(sel, 1)).toBe('picked');
    expect(agentRowState(sel, 2)).toBe('picked');
  });

  // 빠진 행을 그냥 두면 필터가 걸렸는지 알 수 없다. 제외됐다고 보여야 한다.
  it('필터 중에 빠진 행은 제외 상태다', () => {
    expect(agentRowState(new Set([1]), 2)).toBe('excluded');
  });

  // 모든 해시를 담는 것과 비우는 것은 결과가 같다(전부 표시).
  // 하지만 전자는 "필터가 걸려 있다"고 표시돼야 한다 — 사용자가 직접 고른 상태다.
  it('전부 담긴 집합은 필터 없음이 아니라 전부 선택이다', () => {
    const all = new Set([1, 2, 3]);
    expect(agentRowState(all, 1)).toBe('picked');
    expect(agentRowState(all, 3)).toBe('picked');
  });
});
