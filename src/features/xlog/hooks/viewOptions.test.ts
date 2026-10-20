// 글자 크기 배율 다듬기
//
// config.json 은 **사람이 여는 파일**이다. 0 이나 음수가 들어오면 글자가 사라지고,
// 그 상태로는 설정 창을 찾아 되돌리기도 어렵다. 읽는 쪽에서 막는다.

import { describe, it, expect } from 'vitest';
import { clampFontScale } from './useViewOptions';

describe('clampFontScale', () => {
  it('정상 값은 그대로 둔다', () => {
    expect(clampFontScale(1)).toBe(1);
    expect(clampFontScale(1.3)).toBe(1.3);
  });

  it('0 이하나 숫자가 아니면 1 로 되돌린다', () => {
    expect(clampFontScale(0)).toBe(1);
    expect(clampFontScale(-2)).toBe(1);
    expect(clampFontScale('큼')).toBe(1);
    expect(clampFontScale(undefined)).toBe(1);
    expect(clampFontScale(Number.NaN)).toBe(1);
  });

  it('너무 크거나 작으면 범위 안으로 당긴다', () => {
    // 화면이 통째로 깨지는 값까지 허용할 이유가 없다
    expect(clampFontScale(9)).toBe(1.6);
    expect(clampFontScale(0.1)).toBe(0.8);
  });
});

// ─── 테마가 설정에서 화면까지 닿는가 ──────────────────────────
//
// 「바꿔도 안 먹는다」가 나와서 끊어 본다. 설정 창은 저장할 때
// `applyConfigToViewOptions` 하나만 부른다 — 거기서 문서 뿌리까지 가야 한다.

describe('applyConfigToViewOptions 가 테마를 건다', () => {
  it('설정의 ui_theme 가 문서 뿌리에 걸린다', async () => {
    const { applyConfigToViewOptions } = await import('./useViewOptions');
    applyConfigToViewOptions({ ui_theme: 'light' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('모르는 값이면 기본 테마로 건다 — 비워 두지 않는다', async () => {
    const { applyConfigToViewOptions } = await import('./useViewOptions');
    const { DEFAULT_THEME } = await import('../../../styles/theme');
    applyConfigToViewOptions({ ui_theme: '없는테마' });
    expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_THEME);
  });
});
