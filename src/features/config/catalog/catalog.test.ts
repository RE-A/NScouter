// 카탈로그 두 겹이 서로 맞는가
//
// 공식 원문(`official.ts`)은 생성 파일이고 한국어(`ko.ts`)는 사람이 쓴다. 공식 문서를 다시
// 뽑으면 항목이 늘거나 이름이 바뀌는데, 그때 한국어가 **조용히** 빠지면 화면에 영어 키만
// 덩그러니 남는다. 여기서 잡는다.

import { describe, expect, it } from 'vitest';
import { KO } from './ko';
import { OFFICIAL } from './official';
import { SECTIONS } from './sections';
import type { ConfigScope } from './types';

const SCOPES: ConfigScope[] = ['server', 'java', 'host'];

describe('설정 카탈로그', () => {
  it.each(SCOPES)('%s — 공식 항목마다 한국어 이름이 있다', scope => {
    const missing = OFFICIAL[scope].map(o => o.key).filter(k => !(k in KO[scope]));
    expect(missing).toEqual([]);
  });

  it.each(SCOPES)('%s — 공식 문서에 없는 한국어 항목이 없다', scope => {
    // 이름이 바뀐 항목의 옛 번역이 남아 있으면 아무 데도 안 쓰이면서 틀린 채로 굳는다.
    const keys = new Set(OFFICIAL[scope].map(o => o.key));
    const stale = Object.keys(KO[scope]).filter(k => !keys.has(k));
    expect(stale).toEqual([]);
  });

  it.each(SCOPES)('%s — 공식 구역마다 화면 구역이 있다', scope => {
    // 새 구역 주석이 생기면 그 항목들이 통째로 «기타» 로 떨어진다.
    const mapped = new Set(SECTIONS[scope].flatMap(s => s.from));
    const unmapped = [...new Set(OFFICIAL[scope].map(o => o.section))].filter(s => !mapped.has(s));
    expect(unmapped).toEqual([]);
  });

  it.each(SCOPES)('%s — 한국어 이름이 비어 있지 않다', scope => {
    const empty = Object.entries(KO[scope]).filter(([, [label]]) => label.trim() === '');
    expect(empty).toEqual([]);
  });

  it('공식 문서에서 뽑은 수가 문서와 맞다', () => {
    // 파서가 항목을 건너뛰면 설명이 다음 항목으로 밀린다 — 실제로 `$` 가 든 이름을
    // 건너뛰어 visitor_hourly_count_enabled 에 텔레그래프 설명이 붙은 적이 있다.
    expect(OFFICIAL.server.length).toBe(134);
    expect(OFFICIAL.java.length).toBe(282);
    expect(OFFICIAL.host.length).toBe(36);
    const visitor = OFFICIAL.server.find(o => o.key === 'visitor_hourly_count_enabled');
    expect(visitor?.desc).toBe('');
  });

  it('여러 줄로 이어 붙인 공식 설명을 한 덩어리로 읽는다', () => {
    const idx = OFFICIAL.server.find(o => o.key === '_mgr_text_db_index_default_mb');
    expect(idx?.desc).toContain('(restart required)');
  });
});
