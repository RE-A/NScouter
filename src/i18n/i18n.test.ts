// 언어 전환
//
// 한국어 원문이 키다. 그래서 확인할 것은 두 가지뿐이다:
// 영어일 때 사전대로 바뀌는가, **사전에 없을 때 한국어가 그대로 나오는가.**

import { beforeEach, describe, expect, it } from 'vitest';
import { getLang, setLang, t, toLang } from './index';
import { EN } from './en';

beforeEach(() => {
  setLang('ko');
});

describe('t', () => {
  it('한국어에서는 원문 그대로다', () => {
    expect(t('프로파일 검색')).toBe('프로파일 검색');
  });

  it('영어에서는 사전대로 바꾼다', () => {
    setLang('en');
    expect(t('프로파일 검색')).toBe('Search profiles');
  });

  it('사전에 없으면 한국어가 나온다', () => {
    // 빈칸이나 키를 내보내면 **번역이 빠진 자리가 고장으로 보인다**
    setLang('en');
    expect(t('아직 번역하지 않은 문구')).toBe('아직 번역하지 않은 문구');
  });
});

describe('toLang', () => {
  it("'en' 만 영어고 나머지는 한국어다", () => {
    expect(toLang('en')).toBe('en');
    expect(toLang('ko')).toBe('ko');
    // 설정 파일을 손으로 고쳐 이상한 값이 들어와도 화면은 떠야 한다
    expect(toLang('zz')).toBe('ko');
    expect(toLang(undefined)).toBe('ko');
  });
});

describe('setLang', () => {
  it('바꾼 언어가 유지된다', () => {
    setLang('en');
    expect(getLang()).toBe('en');
  });
});

describe('사전', () => {
  it('영어 번역이 비어 있지 않다', () => {
    // 조사·단위는 영어에서 사라진다 — '356건' 은 '356' 이다. 그 셋만 비울 수 있고
    // 나머지가 비면 번역을 하다 만 것이다.
    const DROPPED = ['건', '개', '가'];
    const empty = Object.entries(EN).filter(([k, v]) => v.trim() === '' && !DROPPED.includes(k));
    expect(empty).toEqual([]);
  });

  it('한국어 원문을 그대로 번역으로 둔 자리가 없다', () => {
    const same = Object.entries(EN).filter(([k, v]) => k === v);
    expect(same).toEqual([]);
  });
});
