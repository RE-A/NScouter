// 카운터에서 «그릴 서버» 고르기 규칙 (순수 함수)
//
// **빈 집합이 곧 전부다.** 고르지 않은 상태와 «하나도 안 고른» 상태를 가르지 않는다 —
// 아무것도 안 그려진 화면은 고장으로 읽히고, 처음 연 사람은 나머지 서버를
// 없는 것으로 읽는다.
//
// 그래서 체크를 다루는 자리가 한 번 꼬인다: 전체 상태에서는 모든 칸이 켜 보이므로
// 하나를 누르는 것은 «이것만 빼고» 라는 뜻이다. 그냥 집합에 더하면 정반대가 된다
// (누른 하나만 남는다).

/** 다음 선택. `picked` 가 비어 있으면 전부를 뜻한다 */
export function nextPicked(
  picked: ReadonlySet<number>,
  hashes: readonly number[],
  hash: number,
): Set<number> {
  // 전체 상태에서 하나를 풀면 «그것만 빼고 전부»
  if (picked.size === 0) return new Set(hashes.filter(h => h !== hash));

  const next = new Set(picked);
  if (next.has(hash)) next.delete(hash);
  else next.add(hash);
  return next;
}

/**
 * 사라진 오브젝트를 선택에서 지운다.
 *
 * 에이전트가 죽으면 그 해시는 더 이상 오지 않는다. 남겨 두면 «3대 중 0대» 처럼
 * 아무것도 안 그려지는 상태로 굳는다.
 * 바뀐 게 없으면 **같은 객체를 돌려준다** — 새 Set 을 만들면 리렌더가 끝없이 돈다.
 */
export function prunePicked(
  picked: ReadonlySet<number>,
  hashes: readonly number[],
): ReadonlySet<number> {
  const alive = new Set([...picked].filter(h => hashes.includes(h)));
  return alive.size === picked.size ? picked : alive;
}
