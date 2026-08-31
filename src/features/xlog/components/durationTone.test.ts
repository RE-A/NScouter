// 소요 시간 → 색 등급
//
// 같은 규칙이 프로파일 스텝과 XLog 목록 두 곳에 따로 박혀 있었고
// **기준이 서로 달랐다** (목록은 빠른 것도 초록, 프로파일은 무채색).
// 목록에서 대부분의 행은 빠르므로 초록을 칠하면 초록 기둥이 하나 생길 뿐이다.
// 색은 "느린 것"에만 쓴다.

import { describe, it, expect } from 'vitest';
import { durationTone, durationBar } from './durationTone';

describe('durationTone', () => {
  it('300ms 미만은 색을 쓰지 않는다', () => {
    expect(durationTone(0)).toBe('text-fg-muted');
    expect(durationTone(299)).toBe('text-fg-muted');
  });

  it('300ms 이상은 경고색', () => {
    expect(durationTone(300)).toBe('text-warn');
    expect(durationTone(999)).toBe('text-warn');
  });

  // 현장 피드백: 소요 시간이 빨간색이라 에러로 읽혔다. 빨강은 에러 전용이다.
  it('가장 느린 구간도 빨강이 아니라 같은 주황에 굵기만 더한다', () => {
    expect(durationTone(1000)).toBe('text-warn font-medium');
    expect(durationTone(30000)).toBe('text-warn font-medium');
    expect(durationTone(30000)).not.toContain('danger');
  });

  // 음수는 오지 않아야 하지만, 와도 색이 튀면 안 된다.
  it('음수는 무채색으로 떨어진다', () => {
    expect(durationTone(-1)).toBe('text-fg-muted');
  });
});

describe('durationBar', () => {
  it('막대는 같은 경계를 쓰되 배경색을 낸다', () => {
    expect(durationBar(299)).toBe('bg-accent');
    expect(durationBar(300)).toBe('bg-warn');
    // 막대는 길이로도 길이를 말한다. 색을 하나 더 쓸 이유가 없다.
    expect(durationBar(1000)).toBe('bg-warn');
  });
});
