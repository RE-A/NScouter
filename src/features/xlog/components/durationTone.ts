// 소요 시간 → 색 등급 (순수 함수)
//
// 색은 **느린 것에만** 쓴다. 목록의 대부분 행은 빠르므로
// 빠른 것에 초록을 칠하면 정보가 아니라 초록 기둥이 하나 생길 뿐이다.
//
// **빨강(--error)은 쓰지 않는다.** 현장에서 «소요 시간이 빨간데 에러인 줄 알았다» 가
// 나왔다. 같은 화면에서 에러 해시·에러 건수도 빨강이라 둘이 구별되지 않는다.
// 느림은 «주의» 이지 «실패» 가 아니다 — 주황 한 색으로 두고, 가장 느린 구간만
// 글자 굵기로 한 단계 더 세운다.

/** 이 아래는 정상이라 색을 쓰지 않는다 */
const WARN_MS = 300;
/** 여기부터는 같은 색에 굵기를 더한다. 색을 하나 더 쓰지 않는다 */
const SLOW_MS = 1000;

/** 숫자 글자색 */
export function durationTone(ms: number): string {
  if (ms >= SLOW_MS) return 'text-warn font-medium';
  if (ms >= WARN_MS) return 'text-warn';
  return 'text-fg-muted';
}

/** 폭포수 막대 배경색 — 같은 경계를 쓴다 */
export function durationBar(ms: number): string {
  if (ms >= WARN_MS) return 'bg-warn';
  return 'bg-accent';
}
