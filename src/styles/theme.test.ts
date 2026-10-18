// 테마가 **실제로 걸리는가.**
//
// 색을 아무리 잘 골라 놔도 문서 뿌리에 안 걸리면 아무 일도 안 일어난다.
// 「바꿔도 안 먹는다」가 나와서, 고르는 자리부터 문서에 걸릴 때까지를 끊어서 확인한다.

import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, toTheme, subscribeTheme, themeEpoch, THEMES, DEFAULT_THEME } from './theme';

beforeEach(() => {
  delete document.documentElement.dataset.theme;
});

describe('테마를 건다', () => {
  it('문서 뿌리에 data-theme 를 남긴다 — CSS 가 이걸 본다', () => {
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('기본 테마도 속성을 적어 둔다 — 비워 두면 그 테마만 규칙에서 빠진다', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('바꾸면 앞 테마가 남지 않는다', () => {
    applyTheme('warm');
    applyTheme('contrast');
    expect(document.documentElement.getAttribute('data-theme')).toBe('contrast');
  });

  it('바뀔 때마다 번호가 오른다 — 캔버스가 이걸 보고 다시 그린다', () => {
    const before = themeEpoch();
    applyTheme('slate');
    expect(themeEpoch()).toBeGreaterThan(before);
  });

  it('구독자에게 알린다', () => {
    let got = 0;
    const off = subscribeTheme(n => { got = n; });
    applyTheme('light');
    off();
    expect(got).toBe(themeEpoch());
  });
});

describe('모르는 값', () => {
  it('설정 파일에 이상한 값이 있어도 기본으로 돌린다', () => {
    expect(toTheme('없는테마')).toBe(DEFAULT_THEME);
    expect(toTheme(undefined)).toBe(DEFAULT_THEME);
    expect(toTheme(42)).toBe(DEFAULT_THEME);
  });

  it('목록에 있는 것은 그대로 받는다', () => {
    for (const t of THEMES) expect(toTheme(t.id)).toBe(t.id);
  });
});
