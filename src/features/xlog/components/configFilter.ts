// 설정 항목 거르기 (순수 로직)
//
// 306개를 다 늘어놓으면 "무엇이 기본과 다른가"를 못 찾는다.
// 그게 이 화면을 여는 이유이므로 거르기가 곧 기능이다.

import type { ConfigEntry } from '../types/config';

/**
 * 검색어와 "바뀐 것만" 을 함께 건다.
 *
 * **검색은 값에도 걸어야 한다.** `6100` 으로 찾는 사람은 키 이름을 모르고
 * 포트 번호만 아는 사람이다. 키만 뒤지면 아무것도 안 나온다.
 */
export function filterConfig(
  entries: readonly ConfigEntry[],
  query: string,
  changedOnly: boolean,
): ConfigEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter(e => {
    if (changedOnly && !e.changed) return false;
    if (!q) return true;
    return (
      e.key.toLowerCase().includes(q) ||
      e.value.toLowerCase().includes(q) ||
      e.default.toLowerCase().includes(q)
    );
  });
}
