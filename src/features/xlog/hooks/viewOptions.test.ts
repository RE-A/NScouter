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
