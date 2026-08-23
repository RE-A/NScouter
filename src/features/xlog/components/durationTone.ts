// 소요 시간 → 색 등급 (순수 함수)
//
// 색은 **느린 것에만** 쓴다. 목록의 대부분 행은 빠르므로
// 빠른 것에 초록을 칠하면 정보가 아니라 초록 기둥이 하나 생길 뿐이다.

/** 이 아래는 정상이라 색을 쓰지 않는다 */
const WARN_MS = 300;
const DANGER_MS = 1000;

/** 숫자 글자색 */
export function durationTone(ms: number): string {
  if (ms >= DANGER_MS) return 'text-danger';
  if (ms >= WARN_MS) return 'text-warn';
  return 'text-fg-muted';
}

/** 폭포수 막대 배경색 — 같은 경계를 쓴다 */
export function durationBar(ms: number): string {
  if (ms >= DANGER_MS) return 'bg-danger';
  if (ms >= WARN_MS) return 'bg-warn';
  return 'bg-accent';
}
