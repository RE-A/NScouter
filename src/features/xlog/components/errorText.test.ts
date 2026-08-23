// 에러 텍스트 요약
//
// APM 의 에러 텍스트는 짧은 문장이 아니라 **스택 트레이스**다.
// 그대로 펼치면 50줄 빨간 벽이 되어 정작 봐야 할 프로파일을 밀어낸다.
// 첫 줄(예외 타입과 메시지)만 보이고 나머지는 접는다.

import { describe, it, expect } from 'vitest';
import { summarizeError } from './errorText';

describe('summarizeError', () => {
  it('한 줄짜리는 그대로 두고 접을 게 없다', () => {
    const r = summarizeError('Read timed out');
    expect(r.head).toBe('Read timed out');
    expect(r.rest).toBe('');
    expect(r.restLines).toBe(0);
  });

  it('첫 줄과 나머지를 나눈다', () => {
    const r = summarizeError('java.net.SocketTimeoutException: Read timed out\n\tat a.b.C()\n\tat d.e.F()');
    expect(r.head).toBe('java.net.SocketTimeoutException: Read timed out');
    expect(r.restLines).toBe(2);
    expect(r.rest).toContain('a.b.C()');
  });

  // Scouter 는 메시지와 스택을 이어 붙여 보내기도 한다.
  // 첫 줄이 프레임이면 예외 타입을 잃으므로 앞의 빈 줄은 건너뛴다.
  it('앞쪽 빈 줄을 건너뛰고 첫 내용 줄을 머리로 삼는다', () => {
    const r = summarizeError('\n\n  java.lang.NullPointerException\n\tat x.Y()');
    expect(r.head).toBe('java.lang.NullPointerException');
    expect(r.restLines).toBe(1);
  });

  it('빈 문자열은 비어 있다고 알린다', () => {
    const r = summarizeError('');
    expect(r.head).toBe('');
    expect(r.isEmpty).toBe(true);
  });

  it('공백만 있어도 비어 있다', () => {
    expect(summarizeError('   \n  ').isEmpty).toBe(true);
  });

  // 한 줄이 지나치게 길면 그것만으로 패널이 밀린다.
  it('머리 줄이 너무 길면 자른다', () => {
    const long = 'E: ' + 'x'.repeat(400);
    const r = summarizeError(long);
    expect(r.head.length).toBeLessThanOrEqual(200);
    expect(r.head.endsWith('…')).toBe(true);
  });

  it('CRLF 도 처리한다', () => {
    const r = summarizeError('java.lang.Error: boom\r\n\tat a()\r\n');
    expect(r.head).toBe('java.lang.Error: boom');
    expect(r.restLines).toBe(1);
  });
});
