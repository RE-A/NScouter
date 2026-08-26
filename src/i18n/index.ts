// 언어 전환
//
// **한국어 원문이 곧 키다.** 키를 따로 만들면(`xlog.toolbar.realtime`) 화면을 고칠 때마다
// 사전을 찾아가야 하고, 사전에 없으면 화면에 키가 그대로 뜬다.
// 원문을 키로 쓰면 번역이 없을 때 **한국어가 나온다** — 덜 갖춰진 상태에서도 읽을 수 있다.
//
// 그래서 이 파일에 있는 건 영어 사전 하나뿐이다. 한국어는 코드에 있는 그대로다.

import { useEffect, useState } from 'react';
import { EN } from './en';

export type Lang = 'ko' | 'en';

/** 지금 언어. 모듈 하나에만 둔다 (뷰 옵션과 같은 이유) */
let current: Lang = 'ko';
const listeners = new Set<(l: Lang) => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (current === lang) return;
  current = lang;
  for (const fn of listeners) fn(lang);
}

/**
 * 문구를 지금 언어로 바꾼다.
 *
 * 영어 사전에 없으면 **원문을 그대로** 돌려준다. 빈칸이나 키를 내보내면
 * 번역이 빠진 자리가 고장으로 보인다.
 */
export function t(text: string): string {
  if (current === 'ko') return text;
  return EN[text] ?? text;
}

/**
 * 컴포넌트에서 쓰는 형태.
 *
 * 언어가 바뀌면 다시 그려야 하므로 구독한다 — `t` 만 부르면 바뀐 걸 모른다.
 */
export function useT(): { t: (text: string) => string; lang: Lang } {
  const [lang, setLangState] = useState<Lang>(current);

  useEffect(() => {
    listeners.add(setLangState);
    return () => {
      listeners.delete(setLangState);
    };
  }, []);

  return { t, lang };
}

/** 설정에서 온 값을 언어로 다듬는다. 모르는 값이면 한국어다 */
export function toLang(v: unknown): Lang {
  return v === 'en' ? 'en' : 'ko';
}
