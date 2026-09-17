// 검색 칸은 한 모양이다 — **새로 만든 검색창이 옛 색으로 돌아가지 않게.**
//
// 여섯 군데 검색창이 각자 `bg-input · border-line` 으로 칠해져 있었고, 그 색은 놓인 배경과
// 1.1:1 이라 칸이 있다는 것 자체가 안 보였다 (tokens.css «검색 칸» 참고).
// 공용 클래스로 모았지만, 다음에 누가 검색창을 하나 더 만들면서 옛 줄을 복사해 오면
// 그 하나만 다시 안 보인다. 소스를 훑어 막는다 (i18n coverage 와 같은 방식).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (p.endsWith('.tsx') && !p.endsWith('.test.tsx')) out.push(p);
  }
  return out;
}

/**
 * `<input ... />` 덩어리들.
 *
 * **`>` 에서 자르면 안 된다** — `onChange={e => ...}` 의 화살표에서 끊겨 className 이 빠진다.
 * 이 코드베이스의 input 은 전부 스스로 닫히므로 `/>` 까지 자른다.
 */
function inputs(source: string): string[] {
  return [...source.matchAll(/<input\b[\s\S]*?\/>/g)].map(m => m[0]);
}

/** 검색창인가 — 찾기·검색이라고 말하거나 type=search 인 칸 */
function isSearchBox(tag: string): boolean {
  return (
    /type="search"/.test(tag) ||
    /(placeholder|aria-label)=\{t(r)?\('[^']*(찾기|검색)[^']*'\)\}/.test(tag) ||
    /placeholder=\{disabled \? t\('[^']*'\) : t\('SQL·예외·URL 일부'\)\}/.test(tag)
  );
}

describe('검색 칸', () => {
  const boxes = tsxFiles(ROOT).flatMap(file =>
    inputs(readFileSync(file, 'utf-8'))
      .filter(isSearchBox)
      .map(tag => ({ file: file.slice(ROOT.length + 1), tag })),
  );

  it('검색창을 실제로 찾아낸다 — 못 찾으면 이 검사는 아무것도 지키지 않는다', () => {
    expect(boxes.length).toBeGreaterThanOrEqual(6);
  });

  it('모든 검색창이 공용 모양(search-field)을 쓴다', () => {
    const stray = boxes.filter(b => !/className="[^"]*\bsearch-field\b/.test(b.tag)).map(b => b.file);
    expect(stray).toEqual([]);
  });

  it('공용 모양을 색·테두리 유틸로 덮지 않는다', () => {
    // components 층이라 유틸이 붙으면 그쪽이 이긴다 — 옛 색으로 되돌아간다.
    const overridden = boxes
      .filter(b => /className="[^"]*\b(bg-input|border-line|border-line-strong|placeholder:text-fg-faint|px-\d)/.test(b.tag))
      .map(b => b.file);
    expect(overridden).toEqual([]);
  });
});
