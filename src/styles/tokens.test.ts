// 토큰 무결성
//
// Canvas 는 `var(--x)` 를 못 읽어서 실제 색 문자열이 필요하다.
// 그래서 tokens.ts 의 CANVAS 가 tokens.css 값을 복제한다.
// **복제는 언젠가 어긋난다.** 어긋나면 차트와 UI 색이 갈라지는데,
// 눈으로는 잘 안 보이고 스크린샷을 나란히 놓아야 알 수 있다. 그래서 테스트로 막는다.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { CANVAS, T, F } from './tokens';

const css = readFileSync('src/styles/tokens.css', 'utf8');

/** tokens.css 에서 `--name: value;` 를 읽는다 */
function cssVar(name: string): string | undefined {
  const m = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return m?.[1].trim();
}

describe('tokens.css ↔ tokens.ts', () => {
  it.each([
    ['bgSurface', 'bg-surface'],
    ['border', 'border'],
    ['textMuted', 'text-muted'],
    ['textDim', 'text-dim'],
    ['accent', 'accent'],
    ['success', 'success'],
    ['warn', 'warn'],
    ['error', 'error'],
  ])('CANVAS.%s 가 --%s 와 같다', (tsKey, cssName) => {
    expect(CANVAS[tsKey as keyof typeof CANVAS]).toBe(cssVar(cssName));
  });

  // `var(--없는변수)` 는 조용히 무시돼 색이 안 먹는다. 오타를 여기서 잡는다.
  it('T 의 모든 var() 가 tokens.css 에 실재한다', () => {
    const missing: string[] = [];
    for (const [key, val] of Object.entries(T)) {
      const name = val.match(/var\(--([\w-]+)\)/)?.[1];
      if (!name || cssVar(name) === undefined) missing.push(`${key} -> ${val}`);
    }
    expect(missing).toEqual([]);
  });

  it('F 의 모든 var() 가 tokens.css 에 실재한다', () => {
    const missing: string[] = [];
    for (const [key, val] of Object.entries(F)) {
      const name = val.match(/var\(--([\w-]+)\)/)?.[1];
      if (!name || cssVar(name) === undefined) missing.push(`${key} -> ${val}`);
    }
    expect(missing).toEqual([]);
  });
});

describe('토큰 사용 규칙', () => {
  it('tokens.css 는 CSS 변수만 정의한다 (선택자 규칙 없음)', () => {
    // 여기에 컴포넌트 스타일이 섞이면 토큰 파일이 아니게 된다.
    const selectors = css.match(/^\s*[.#a-zA-Z][^{]*\{/gm) ?? [];
    const nonRoot = selectors.filter(s => !s.includes(':root'));
    expect(nonRoot).toEqual([]);
  });
});
