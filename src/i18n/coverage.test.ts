// 번역 빠짐 감시
//
// 화면에 문구를 새로 넣으면서 사전에 안 넣는 일이 반드시 생긴다.
// 그때 영어 화면에는 한국어가 섞여 나온다 — 고장은 아니지만 어중간하다.
// 사람 눈으로 잡을 수 없으니 여기서 잡는다.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN } from './en';
import { SHORTCUT_LABEL } from '../features/settings/SettingsDialog';
import { SHORTCUT_HELP } from '../features/xlog/hooks/shortcuts';

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

describe('모듈 상수', () => {
  it('t() 를 임포트 시점에 부르지 않는다', () => {
    // 모듈 최상위 상수는 **임포트 때 한 번** 평가된다. 그때는 config.json 을 읽기 전이라
    // 언어가 늘 한국어다 — 영어로 바꿔도 그 문구만 한국어로 남는다.
    // 실제로 로그 레벨·요약 탭·토폴로지 층 이름이 그렇게 굳어 있었다.
    const bad: string[] = [];
    for (const f of tsxFiles('src')) {
      const lines = readFileSync(f, 'utf-8').split('\n');
      let inTopLiteral = false;
      for (const line of lines) {
        // 최상위에서 여러 줄로 여는 상수만 본다: `const X = {` / `const X: T[] = [`
        if (/^(export )?const [A-Za-z_$][\w$]*(: [^=]+)? = [[{]$/.test(line)) inTopLiteral = true;
        else if (/^[}\]]/.test(line)) inTopLiteral = false;
        else if (inTopLiteral && /\b(?:t|tr)\('/.test(line)) bad.push(`${f}: ${line.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('간접 호출', () => {
  it('단축키 설명이 사전에 있다', () => {
    // **위의 스캔이 못 잡는 자리다.** `t(SHORTCUT_LABEL[action])` 처럼 변수를 넘기면
    // 소스에 문구가 리터럴로 안 남아 빠짐을 눈치채지 못한다 —
    // 영어 화면에서 그 줄만 한국어로 남는다. 여기서 직접 본다.
    const missing = Object.values(SHORTCUT_LABEL).filter(v => !(v in EN)).sort();
    expect(missing).toEqual([]);
  });

  it('모든 단축키 동작에 설명이 붙어 있다', () => {
    // 동작을 새로 넣고 설명을 안 붙이면 설정 창에 빈칸이 뜬다.
    for (const row of SHORTCUT_HELP) {
      expect(SHORTCUT_LABEL[row.action], `${row.keys} 에 설명이 없다`).toBeTruthy();
    }
  });
});
