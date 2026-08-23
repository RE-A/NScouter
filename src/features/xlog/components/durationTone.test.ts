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

  it('1000ms 이상은 위험색', () => {
    expect(durationTone(1000)).toBe('text-danger');
    expect(durationTone(30000)).toBe('text-danger');
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
    expect(durationBar(1000)).toBe('bg-danger');
  });
});
