// 번역 빠짐 감시
//
// 화면에 문구를 새로 넣으면서 사전에 안 넣는 일이 반드시 생긴다.
// 그때 영어 화면에는 한국어가 섞여 나온다 — 고장은 아니지만 어중간하다.
// 사람 눈으로 잡을 수 없으니 여기서 잡는다.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN } from './en';

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...tsxFiles(p));
    } else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) {
      out.push(p);
    }
  }
  return out;
}

describe('영어 사전', () => {
  it('화면에서 쓰는 문구를 모두 담고 있다', () => {
    const used = new Set<string>();
    for (const f of tsxFiles('src')) {
      const src = readFileSync(f, 'utf-8');
      for (const m of src.matchAll(/\b(?:t|tr)\('([^']*)'\)/g)) {
        used.add(m[1]);
      }
    }
    expect(used.size).toBeGreaterThan(100);

    const missing = [...used].filter(k => !(k in EN)).sort();
    expect(missing).toEqual([]);
  });
});
