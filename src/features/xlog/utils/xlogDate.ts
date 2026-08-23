// XLog 조회용 날짜 문자열
//
// Scouter 는 XLog 를 **날짜별로** 저장한다. 프로파일·상세 조회에 "yyyyMMdd" 가 반드시 붙고,
// 하루가 틀리면 에러가 아니라 **빈 결과**가 온다 (F-15 와 같은 실패 방식).

/**
 * epoch ms → "yyyyMMdd" (로컬 시간대).
 *
 * **UTC 로 계산하면 안 된다.** 콜렉터는 자기 시간대의 날짜로 파일을 나누므로
 * 자정 근처에서 하루가 어긋나 조회가 통째로 빈다.
 */
export function toDateString(endTimeMs: number): string {
  const d = new Date(endTimeMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}
