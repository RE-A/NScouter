// 설정 항목 거르기 (순수 로직)
//
// 306개를 다 늘어놓으면 "무엇이 기본과 다른가"를 못 찾는다.
// 그게 이 화면을 여는 이유이므로 거르기가 곧 기능이다.

import type { ConfigEntry } from '../types/config';
import { matchesQuery } from './configEdits';

/**
 * 검색어와 "바뀐 것만" 을 함께 건다.
 *
 * **검색은 값에도 걸어야 한다.** `6100` 으로 찾는 사람은 키 이름을 모르고
 * 포트 번호만 아는 사람이다. 키만 뒤지면 아무것도 안 나온다.
 * 설명(에이전트가 준 것)에도 건다 — 규칙은 `matchesQuery` 한 곳에 있다.
 *
 * @param keep 조건과 무관하게 **남길** 키. 고치고 있는 항목이 «바뀐 것만» 에 걸려
 *   입력하는 도중에 사라지면 안 된다.
 */
export function filterConfig(
  entries: readonly ConfigEntry[],
  query: string,
  changedOnly: boolean,
  keep?: ReadonlySet<string>,
): ConfigEntry[] {
  return entries.filter(e => {
    if (keep?.has(e.key)) return true;
    if (changedOnly && !e.changed) return false;
    return matchesQuery(e, query);
  });
}
