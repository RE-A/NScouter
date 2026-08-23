// 에이전트 필터의 행 상태 (순수 함수)

/**
 * - `plain`    필터 없음. 전부 보이는 중이라 강조할 게 없다.
 * - `picked`   필터에 포함됨.
 * - `excluded` 필터 중인데 빠짐.
 */
export type AgentRowState = 'plain' | 'picked' | 'excluded';

/**
 * `objHashSet` 은 화이트리스트다. 비어 있으면 필터가 없다
 * (XLogChartRenderer.passesFilter 가 `size > 0` 일 때만 거른다).
 */
export function agentRowState(selected: ReadonlySet<number>, hash: number): AgentRowState {
  if (selected.size === 0) return 'plain';
  return selected.has(hash) ? 'picked' : 'excluded';
}
