// 테마는 **늘어난다.** 늘어날 때마다 같은 것을 지켜야 한다.
//
// 색을 한 벌 더 만드는 일은 눈으로만 보면 통과한다 — 「어두운 데서 보니 괜찮네」.
// 그런데 어긋나는 자리는 늘 같다: 가장 밝은 배경 위의 가장 흐린 글자,
// 가장 어두운 배경 위의 테두리. 그래서 테마마다 **모든 배경 × 모든 글자**를 재서 막는다.
//
// 규칙 넷은 tokens.css 의 테마 머리말과 같은 것이고, 여기가 그 집행이다.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, 'tokens.css'), 'utf-8');

/** 테마 이름 → 그 테마가 실제로 쓰는 색 표 (기본값 위에 덮어쓴 결과) */
function themeVars(): Map<string, Map<string, string>> {
  // `:root` 는 기본 벌, `[data-theme='x']` 는 그 위에 얹는 벌이다.
  // 뿌리에만 묶지 않는 이유는 tokens.css 의 테마 머리말 참고 (설정 창 미리보기가 쓴다).
  const blocks = [...CSS.matchAll(/(?::root|\[data-theme='([\w-]+)'\])\s*\{([\s\S]*?)\n\}/g)];
  const base = new Map<string, string>();
  const out = new Map<string, Map<string, string>>();

  for (const [, name, body] of blocks) {
    const vars = new Map<string, string>();
    for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      vars.set(m[1], m[2].trim());
    }
    if (name === undefined) {
      for (const [k, v] of vars) base.set(k, v);
      out.set('dark', new Map(base));
    } else {
      // 테마는 기본값 위에 **얹는다.** 안 적은 토큰은 기본 테마 값을 그대로 쓴다.
      out.set(name, new Map([...base, ...vars]));
    }
  }
  return out;
}

function luminance(hex: string): number {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = rgb.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 테두리·글자가 놓일 수 있는 **모든** 배경. 하나라도 빠지면 거기서만 안 보인다 */
const BACKGROUNDS = [
  '--bg-base', '--bg-surface', '--bg-raised', '--bg-overlay', '--bg-input', '--bg-hover',
] as const;

const THEMES = themeVars();

/** 색 토큰은 테마마다 다 있어야 한다 — 빠지면 다른 테마의 색이 섞여 보인다 */
const COLOR_TOKENS = [
  ...BACKGROUNDS,
  '--border', '--border-strong', '--border-control', '--border-control-hover',
  '--bg-search', '--border-search',
  '--text', '--text-muted', '--text-dim', '--text-faint',
  '--accent', '--accent-soft', '--accent-bright',
  '--success', '--warn', '--error', '--error-soft',
  '--cat-method', '--cat-sql', '--cat-api', '--cat-socket', '--cat-msg',
  '--row-ok', '--row-err', '--row-api', '--row-neutral',
] as const;

function get(theme: string, name: string): string {
  const v = THEMES.get(theme)?.get(name);
  if (v === undefined) throw new Error(`${theme} 에 ${name} 이 없다`);
  return v;
}

describe('테마 목록', () => {
  it('다섯 가지를 모두 정의한다', () => {
    expect([...THEMES.keys()].sort()).toEqual(
      ['contrast', 'dark', 'light', 'slate', 'warm'],
    );
  });

  it('테마마다 색 토큰이 하나도 빠지지 않는다', () => {
    const missing: string[] = [];
    for (const theme of THEMES.keys()) {
      for (const token of COLOR_TOKENS) {
        if (!THEMES.get(theme)?.has(token)) missing.push(`${theme}: ${token}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe.each([...THEMES.keys()])('%s 테마', theme => {
  it('글자는 어느 배경에서도 4.5:1 을 넘는다', () => {
    const bad: string[] = [];
    for (const fg of ['--text', '--text-muted', '--text-dim', '--text-faint']) {
      for (const bg of BACKGROUNDS) {
        const r = contrast(get(theme, fg), get(theme, bg));
        if (r < 4.5) bad.push(`${fg} on ${bg} = ${r.toFixed(2)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('제어 요소 경계는 어느 배경에서도 3:1 을 넘는다 (WCAG 1.4.11)', () => {
    const bad: string[] = [];
    for (const bg of BACKGROUNDS) {
      const r = contrast(get(theme, '--border-control'), get(theme, bg));
      if (r < 3) bad.push(`${bg} = ${r.toFixed(2)}`);
    }
    expect(bad).toEqual([]);
  });

  it('accent 는 글자로 쓰이므로 4.5:1 을 넘는다', () => {
    const bad: string[] = [];
    for (const bg of BACKGROUNDS) {
      const r = contrast(get(theme, '--accent-bright'), get(theme, bg));
      if (r < 4.5) bad.push(`${bg} = ${r.toFixed(2)}`);
    }
    expect(bad).toEqual([]);
  });

  it('구분선은 은은하다 — 또렷해지면 목록이 격자로 덮인다', () => {
    expect(contrast(get(theme, '--border'), get(theme, '--bg-surface'))).toBeLessThan(2);
  });

  it('호버 경계가 평상시보다 또렷하다 — 밝아지는 것이 «눌린다» 는 신호다', () => {
    // 라이트 테마에서는 **어두워지는** 쪽이 또렷해지는 것이다. 방향이 아니라 대비로 잰다.
    const base = contrast(get(theme, '--border-control'), get(theme, '--bg-surface'));
    const hover = contrast(get(theme, '--border-control-hover'), get(theme, '--bg-surface'));
    expect(hover).toBeGreaterThan(base);
  });
});
