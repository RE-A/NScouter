// 누를 수 있는 것은 **누를 수 있게 보여야 한다.**
//
// 「버튼이 버튼인지 모르겠다」가 나와서 재 봤다. 버튼 133개 중 56개가 평상시 윤곽이
// 없었고, 테두리를 그린 것들도 `--border` 가 배경과 1.19:1 이라 안 보이기는 마찬가지였다.
// 색은 `--border-control` 로, 모양은 `.btn` / `.btn-ghost` 로 풀었다.
//
// 여기서 지키는 것은 **다음에 누가 그 자리를 되돌리지 않는가** 다. 토큰은 숫자로,
// 공용 클래스는 소스를 훑어 막는다 (searchField.test.ts 와 같은 방식).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, 'tokens.css'), 'utf-8');
const INDEX = readFileSync(join(__dirname, 'index.css'), 'utf-8');

/** src 아래 컴포넌트 전부. 테스트는 뺀다 (searchField.test.ts 와 같은 방식) */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

function cssVar(name: string): string {
  const m = CSS.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`${name} 를 tokens.css 에서 못 찾았다`);
  return m[1];
}

/** WCAG 상대 휘도 */
function luminance(hex: string): number {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = rgb.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 테두리가 놓일 수 있는 **모든** 배경. 하나라도 빠지면 거기서만 안 보인다 */
const BACKGROUNDS = ['--bg-base', '--bg-surface', '--bg-raised', '--bg-overlay', '--bg-input', '--bg-hover'];

describe('제어 요소 경계', () => {
  it('어느 배경에 놓여도 3:1 을 넘는다 (WCAG 1.4.11)', () => {
    const control = cssVar('--border-control');
    for (const bg of BACKGROUNDS) {
      const ratio = contrast(control, cssVar(bg));
      expect(ratio, `${bg} 위에서 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  it('호버에서 한 단계 더 세운다 — 경계가 밝아지는 것이 «눌린다» 는 신호다', () => {
    const base = cssVar('--border-control');
    const hover = cssVar('--border-control-hover');
    expect(luminance(hover)).toBeGreaterThan(luminance(base));
  });

  it('구분선은 올리지 않는다 — 목록 수백 줄이 격자로 덮인다', () => {
    // `--border` 는 패널·행을 가르는 선이라 은은해야 한다. 역할이 다르다는 것이
    // 이 두 토큰을 나눈 이유이고, 그래서 여기서는 «낮음» 을 지킨다.
    expect(contrast(cssVar('--border'), cssVar('--bg-surface'))).toBeLessThan(2);
  });
});

describe('accent 를 글자로 쓸 때', () => {
  // `--accent` 는 **채워진 바탕 위의 흰 글자**용으로 고른 색이다. 그대로 글자색에 쓰면
  // 어두운 바탕에서 3.99~4.93:1 이라, 작은 글씨(11~12px)가 쓰이는 자리에서 기준(4.5)을
  // 못 넘는 배경이 셋 있었다. 그래서 글자용을 따로 뺐다.
  it('--accent-bright 는 어느 배경에서도 본문 기준 4.5:1 을 넘는다', () => {
    const bright = cssVar('--accent-bright');
    for (const bg of BACKGROUNDS) {
      const ratio = contrast(bright, cssVar(bg));
      expect(ratio, `${bg} 위에서 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('--accent 자체는 글자로 쓰면 모자란다 — 두 토큰을 나눈 이유', () => {
    expect(contrast(cssVar('--accent'), cssVar('--bg-hover'))).toBeLessThan(4.5);
  });

  it('컴포넌트가 `text-accent` 로 되돌아가지 않는다', () => {
    // 다음에 누가 옛 줄을 복사해 오면 그 한 자리만 다시 어두워진다. 소스를 훑어 막는다.
    const offenders: string[] = [];
    for (const f of sourceFiles(join(__dirname, '..'))) {
      if (/text-accent(?!-)/.test(readFileSync(f, 'utf-8'))) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});

describe('공용 버튼 클래스', () => {
  it('포커스 표시를 가지고 있다 — 키보드로 옮기면 어디인지 보여야 한다', () => {
    expect(INDEX).toMatch(/\.btn:focus-visible/);
    expect(INDEX).toMatch(/\.btn-ghost:focus-visible/);
  });

  it('눌린 토글을 aria-pressed 로 읽는다 — 화면과 보조기술이 같은 것을 본다', () => {
    expect(INDEX).toMatch(/\.btn\[aria-pressed='true'\]/);
  });

  it('못 누르는 것은 못 누르게 보인다', () => {
    expect(INDEX).toMatch(/\.btn:disabled/);
    expect(INDEX).toMatch(/cursor:\s*not-allowed/);
  });

  it('`.btn` 은 평상시에도 윤곽이 있고 `.btn-ghost` 는 닿을 때 생긴다', () => {
    // 목록 안의 작은 보조 버튼까지 상자를 두르면 화면이 상자로 덮인다 — 그래서 둘로 나눴다.
    const btn = INDEX.slice(INDEX.indexOf('.btn {'), INDEX.indexOf('.btn:hover'));
    expect(btn).toMatch(/border-color:\s*var\(--border-control\)/);
    expect(INDEX).toMatch(/\.btn-ghost:hover:not\(:disabled\)|\.btn-ghost:hover/);
  });
});
