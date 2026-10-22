// 무엇을 보기로 골랐는가 — **그룹 이름과 낱개 해시로 들고 있는다.**
//
// 그룹을 고른 순간의 해시들을 집어넣으면 ECS 에서 바로 틀어진다. Task 는 재배포·
// 오토스케일로 계속 갈리니, 새 Task 는 안 들어오고 죽은 Task 는 조회 대상에 남는다.
// 그래서 **고른 것은 이름**이고, 해시는 명단이 갱신될 때마다 다시 푼다.
//
// 화면 아래쪽(XLog·Active·Counter·Visualize)이 쓰는 것은 여전히 **해시 집합 하나**다.
// 그 계약은 바꾸지 않는다 — 네 화면이 같은 선택을 본다는 구조가 그대로 산다.

import { serviceNameOf, type GroupRule } from '../components/instanceGroup';
import type { AgentObject } from '../types/xlog';

export interface GroupSelection {
  /** 통째로 고른 서비스 이름 */
  services: ReadonlySet<string>;
  /** 펼쳐서 낱개로 고른 Task */
  hashes: ReadonlySet<number>;
}

export const EMPTY_SELECTION: GroupSelection = { services: new Set(), hashes: new Set() };

/** 고른 것이 하나도 없는가 */
export function isEmptySelection(sel: GroupSelection): boolean {
  return sel.services.size === 0 && sel.hashes.size === 0;
}

function toggle<T>(set: ReadonlySet<T>, v: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(v)) next.add(v);
  return next;
}

export function toggleService(sel: GroupSelection, name: string): GroupSelection {
  return { ...sel, services: toggle(sel.services, name) };
}

export function toggleHash(sel: GroupSelection, hash: number): GroupSelection {
  return { ...sel, hashes: toggle(sel.hashes, hash) };
}

/**
 * 지금 명단 기준으로 **조회할 해시**를 푼다.
 *
 * **살아 있는 것만 넣는다.** 죽은 Task 를 넣으면 콜렉터가 매번 빈손을 돌려주고,
 * 화면은 그걸 «못 받았다» 로 읽어 경고를 띄운다 — 없는 서버를 계속 찾는 셈이다.
 * 죽은 것을 명단에 잠시 남겨 두는 것(`mergeObjects`)과는 다른 일이다. 그건
 * «방금까지 있었다» 를 보여주기 위한 것이고, 이건 «지금 물어볼 곳» 이다.
 *
 * 그룹과 낱개가 겹쳐도 `Set` 이 한 번만 센다.
 */
export function resolveSelection(
  sel: GroupSelection,
  agents: readonly AgentObject[],
  rule: GroupRule,
): Set<number> {
  const out = new Set<number>();
  if (isEmptySelection(sel)) return out;

  const alive = new Map(agents.filter(a => a.alive).map(a => [a.obj_hash, a]));

  if (sel.services.size > 0) {
    // **`groupByService` 를 쓰지 않는다.** 그쪽은 «한 대짜리는 묶음을 안 만든다» 는
    // **표시** 규칙을 갖고 있어서, 서비스가 1대로 줄면 고른 것이 통째로 풀려 버린다.
    // 여기서 묻는 것은 «이 Task 가 그 서비스인가» 하나뿐이다.
    for (const a of agents) {
      if (!alive.has(a.obj_hash)) continue;
      const name = serviceNameOf(a, rule);
      if (name !== null && sel.services.has(name)) out.add(a.obj_hash);
    }
  }
  // 목록에서 사라진 낱개는 넣지 않는다 — 없는 것을 조회하면 매번 빈손이다.
  for (const h of sel.hashes) if (alive.has(h)) out.add(h);

  return out;
}

/**
 * **과거 구간**을 볼 때 조회할 해시.
 *
 * 실시간과 반대로 **죽은 Task 도 넣는다.** 어제 오후를 보는데 지금 살아 있는 Task 만 물으면,
 * ECS 처럼 그 사이 재배포가 있었던 서비스는 그때 돌던 Task 가 하나도 안 남아 빈 화면이 된다.
 * 그 Task 들이 남긴 XLog 는 콜렉터에 그대로 있다 — 해시만 알면 물을 수 있다.
 *
 * `candidates` 는 «그 구간에 있었을 수 있는 오브젝트» 다. 부르는 쪽이 지금 목록,
 * 그날 콜렉터 목록(`OBJECT_LIST_LOAD_DATE`), 이 앱이 본 기록을 합쳐 넘긴다 — 정리하면
 * 지금 목록에서는 빠지고, 오늘자 목록은 정리 직후에도 남았지만(실측 F-61) 언제까지 남는지는
 * 장담할 수 없어 셋째를 둔다.
 *
 * 구간에 실제로 있었는지는 거르지 않는다. 그 시각에 없던 Task 는 물어도 0건이라 손해가 없고,
 * 거르려면 Task 가 언제 떴는지를 알아야 하는데 콜렉터는 그걸 남기지 않는다(`objectTimeline.ts`).
 *
 * 낱개로 고른 것은 **목록에 없어도 넣는다** — 사용자가 직접 짚은 Task 다.
 */
export function resolvePastSelection(
  sel: GroupSelection,
  candidates: readonly AgentObject[],
  rule: GroupRule,
): Set<number> {
  const out = new Set<number>();
  if (isEmptySelection(sel)) return out;

  if (sel.services.size > 0) {
    for (const a of candidates) {
      const name = serviceNameOf(a, rule);
      if (name !== null && sel.services.has(name)) out.add(a.obj_hash);
    }
  }
  for (const h of sel.hashes) out.add(h);
  return out;
}

/** 과거 구간 기준의 `selectionState` */
export function pastSelectionState(
  sel: GroupSelection,
  candidates: readonly AgentObject[],
  rule: GroupRule,
): 'none' | 'empty-group' | 'ok' {
  if (isEmptySelection(sel)) return 'none';
  return resolvePastSelection(sel, candidates, rule).size > 0 ? 'ok' : 'empty-group';
}

/**
 * 과거 후보를 하나로 모은다. **같은 해시는 앞의 것이 이긴다** — 지금 목록이 가장 정확하다
 * (태그가 있다). 그날 목록과 본 기록에는 태그가 없거나 오래됐을 수 있다.
 */
export function mergeCandidates(...lists: readonly (readonly AgentObject[])[]): AgentObject[] {
  const out = new Map<number, AgentObject>();
  for (const list of lists) {
    for (const a of list) if (!out.has(a.obj_hash)) out.set(a.obj_hash, a);
  }
  return [...out.values()];
}

/**
 * 고른 상태가 무엇을 뜻하나.
 *
 * **«안 골랐다» 와 «골랐는데 비었다» 는 다른 일이다.** 둘 다 화면은 비어 보이지만
 * 할 일이 다르다 — 앞은 고르면 되고, 뒤는 그 서비스가 통째로 내려갔다는 뜻이다.
 * 같은 빈 화면을 보여주면 운영자가 «앱이 고장났나» 를 먼저 의심한다.
 */
export function selectionState(
  sel: GroupSelection,
  agents: readonly AgentObject[],
  rule: GroupRule,
): 'none' | 'empty-group' | 'ok' {
  if (isEmptySelection(sel)) return 'none';
  return resolveSelection(sel, agents, rule).size > 0 ? 'ok' : 'empty-group';
}

/**
 * 펼쳐서 **개별 Task** 를 누른다.
 *
 * 그 Task 가 속한 서비스를 통째로 골라 둔 상태였다면, 그 서비스를 **낱개 선택으로 풀고**
 * 나서 누른 하나를 뒤집는다. 「그룹을 펼쳐 특정 Task 만 보기」가 그 뜻이다.
 *
 * 안 풀면 «3대 중 1대를 껐는데 그대로 3대» 가 된다 — 그룹이 매번 다시 채우기 때문이다.
 * 대신 풀고 나면 **그 서비스는 더 이상 자동으로 안 따라간다.** 낱개를 고른다는 것은
 * «지금 이 Task 들» 을 보겠다는 뜻이라 그게 맞다.
 */
export function pickTask(
  sel: GroupSelection,
  agent: AgentObject,
  agents: readonly AgentObject[],
  rule: GroupRule,
): GroupSelection {
  const svc = serviceNameOf(agent, rule);
  if (svc === null || !sel.services.has(svc)) return toggleHash(sel, agent.obj_hash);

  const services = new Set(sel.services);
  services.delete(svc);

  const hashes = new Set(sel.hashes);
  for (const a of agents) {
    if (a.alive && serviceNameOf(a, rule) === svc) hashes.add(a.obj_hash);
  }
  hashes.delete(agent.obj_hash);
  return { services, hashes };
}
