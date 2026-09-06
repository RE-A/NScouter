// 어느 서버를 고른 상태인가 (순수 함수)
//
// **빈 집합은 «전부» 가 아니라 «아직 안 골랐다» 다.**
//
// 예전 판은 빈 집합을 «전부» 로 읽었다. 서버가 서너 대인 환경에서는 그게 편했지만,
// 운영에서는 한 콜렉터에 100대가 넘게 붙는다 — 켜자마자 카운터 차트 하나에 선이
// 100개 겹치고(팔레트 색은 6개라 같은 색이 17번씩 돈다), 콜렉터에는 안 볼 서버의
// 카운터까지 매 2초 요청이 나간다.
//
// 그래서 **고른 것만 그린다.** 아무것도 안 골랐으면 아무것도 그리지 않고 고르라고 말한다.

/**
 * - `plain`    아직 아무도 안 골랐다. 강조할 것이 없다
 * - `picked`   골랐다
 * - `excluded` 고르는 중인데 이건 빠졌다
 */
export type AgentRowState = 'plain' | 'picked' | 'excluded';

export function agentRowState(selected: ReadonlySet<number>, hash: number): AgentRowState {
  // 하나도 안 골랐을 때 전 행을 «빠짐» 으로 칠하면 목록이 통째로 죽은 것처럼 보인다.
  if (selected.size === 0) return 'plain';
  return selected.has(hash) ? 'picked' : 'excluded';
}

/** 묶음의 체크 상태. `some` 은 일부만 골랐다는 뜻이다 */
export type GroupCheck = 'none' | 'some' | 'all';

export function groupCheck(
  selected: ReadonlySet<number>,
  hashes: readonly number[],
): GroupCheck {
  if (hashes.length === 0) return 'none';
  let picked = 0;
  for (const h of hashes) if (selected.has(h)) picked += 1;
  if (picked === 0) return 'none';
  return picked === hashes.length ? 'all' : 'some';
}

/**
 * 묶음을 통째로 켜고 끈다.
 *
 * **일부만 골라 둔 상태에서는 마저 켠다.** 거기서 끄면 애써 고른 몇 대가 사라지는데,
 * 그건 되돌릴 방법이 없다 — 다시 켜는 것은 클릭 한 번이지만 무엇을 골랐었는지는 잊는다.
 * 100대짜리 목록에서 한 대씩 누르게 두지 않으려고 두는 자리다.
 */
export function toggleGroupPick(
  selected: ReadonlySet<number>,
  hashes: readonly number[],
): Set<number> {
  const next = new Set(selected);
  if (groupCheck(selected, hashes) === 'all') {
    for (const h of hashes) next.delete(h);
  } else {
    for (const h of hashes) next.add(h);
  }
  return next;
}

/**
 * 목록에서 사라진 오브젝트를 선택에서 지운다.
 *
 * 에이전트가 내려가면 그 해시는 더 이상 오지 않는다. 남겨 두면 «3대 골랐는데 화면은
 * 비어 있다» 로 굳는다. 바뀐 게 없으면 **같은 객체를 돌려준다** —
 * 새 Set 을 만들면 리렌더가 끝없이 돈다.
 */
export function prunePicked(
  selected: ReadonlySet<number>,
  alive: readonly number[],
): ReadonlySet<number> {
  const live = new Set(alive);
  const kept = new Set([...selected].filter(h => live.has(h)));
  return kept.size === selected.size ? selected : kept;
}
