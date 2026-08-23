// 에러 텍스트 요약 (순수 함수)

export interface ErrorSummary {
  /** 첫 내용 줄 — 보통 `예외타입: 메시지` */
  head: string;
  /** 나머지 (스택 프레임) */
  rest: string;
  /** 접힌 줄 수 — 펼치기 버튼에 쓴다 */
  restLines: number;
  isEmpty: boolean;
}

/** 한 줄이 이보다 길면 그것만으로 패널이 밀린다 */
const HEAD_MAX = 200;

/**
 * 스택 트레이스를 "첫 줄 + 접힌 나머지"로 나눈다.
 *
 * APM 의 에러 텍스트는 대부분 스택 트레이스라 그대로 그리면
 * 빨간 벽이 되어 프로파일을 화면 밖으로 밀어낸다.
 * 진단에 필요한 건 대개 첫 줄(예외 타입과 메시지)이다.
 */
export function summarizeError(raw: string): ErrorSummary {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  // 앞쪽 빈 줄을 건너뛰지 않으면 예외 타입 대신 빈 줄이 머리가 된다.
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;

  if (i >= lines.length) {
    return { head: '', rest: '', restLines: 0, isEmpty: true };
  }

  let head = lines[i].trim();
  if (head.length > HEAD_MAX) {
    head = head.slice(0, HEAD_MAX - 1) + '…';
  }

  const restLines = lines
    .slice(i + 1)
    .filter(l => l.trim() !== '');

  return {
    head,
    rest: restLines.join('\n'),
    restLines: restLines.length,
    isEmpty: false,
  };
}
