import { describe, expect, it } from 'vitest';
import { toDateString } from './xlogDate';

describe('toDateString', () => {
  it('yyyyMMdd 로 만든다', () => {
    expect(toDateString(new Date(2026, 7, 22, 13, 4, 5).getTime())).toBe('20260822');
  });

  it('한 자리 월·일에 0 을 채운다', () => {
    // "202613" 처럼 붙어 버리면 콜렉터가 에러 없이 빈 결과를 준다.
    expect(toDateString(new Date(2026, 0, 3, 0, 0, 0).getTime())).toBe('20260103');
  });

  it('자정 직전·직후가 로컬 기준으로 갈린다', () => {
    // UTC 로 계산하면 여기서 하루가 어긋나 조회가 통째로 빈다.
    expect(toDateString(new Date(2026, 7, 22, 23, 59, 59).getTime())).toBe('20260822');
    expect(toDateString(new Date(2026, 7, 23, 0, 0, 0).getTime())).toBe('20260823');
  });
});
