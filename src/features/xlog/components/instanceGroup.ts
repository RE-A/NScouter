// 물리 인스턴스(ECS Task) 위에 얹는 **논리 서비스**.
//
// 이름이 같은 Task 여러 개는 콜렉터가 한 대로 본다(F-58). 그래서 이름을 Task 마다
// 유니크하게 나누는데, 나누고 나면 이번엔 **같은 서비스가 여러 줄로 흩어진다** —
// 「SAFS 전체가 지금 어떤가」를 보려면 세 줄을 눈으로 합쳐야 한다.
//
// **묶음을 저장해 두지 않는다.** ECS 에서 Task 는 계속 갈린다. 명단을 들고 있으면
// 재배포 한 번에 틀어지므로, 매번 이름에서 **다시 푼다**. 규칙이 같으면 새 Task 도
// 같은 서비스로 떨어진다.
//
// 이름이 비슷한 `serviceGroup.ts` 는 **URL 묶음**(ASIS ServiceGroup)이라 다른 것이다.

import { shortName } from './agentTree';
import type { AgentObject } from '../types/xlog';

/**
 * 어느 Task 가 어느 서비스인가를 정하는 규칙.
 *
 * 사이트마다 이름 짓는 법이 다르다. ECS 가 아닐 수도 있고 `svc-1`·`svc-2` 일 수도 있어서
 * 설정에서 고칠 수 있게 둔다.
 */
export interface GroupRule {
  /** 이 키의 태그가 있으면 그 값이 곧 서비스 이름이다 */
  tagKey: string;
  /** 태그가 없을 때 짧은 이름에 거는 정규식. **첫 캡처 그룹이 서비스 이름**이다 */
  pattern: string;
}

/**
 * 기본 규칙.
 *
 * ECS 에서 `obj_name` 을 `{서비스}-$HOSTNAME` 으로 짓게 안내하고 있고
 * (`docs/duplicate-objname-guide.md`), 그때 호스트명이 `ip-10-75-113-103...` 이라
 * 그 앞까지를 서비스로 본다. `.+?` 로 **가장 짧게** 끊는다 — 욕심내면
 * `A-ip-1-B-ip-2` 같은 이름에서 뒤까지 먹는다.
 */
export const DEFAULT_GROUP_RULE: GroupRule = {
  tagKey: 'service',
  pattern: '^(?<svc>.+?)-ip-[0-9-]+',
};

/** 정규식은 설정에서 오므로 깨져 있을 수 있다. 던지지 않고 «못 쓴다» 로 돌린다 */
function compile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/**
 * 이 Task 가 속한 논리 서비스. 못 정하면 `null`.
 *
 * **우선순위가 있다** — 에이전트가 태그로 직접 말했으면 그게 사실이고,
 * 이름 규칙은 그다음이다. 이름은 사람이 짓는 것이라 언제든 예외가 생긴다.
 */
export function serviceNameOf(agent: AgentObject, rule: GroupRule): string | null {
  for (const [k, v] of agent.tags) {
    // 빈 값은 없는 것으로 본다. 빈 이름으로 묶으면 안 걸린 것들이 전부 한 덩어리가 된다.
    if (k === rule.tagKey && v.trim() !== '') return v.trim();
  }

  const re = compile(rule.pattern);
  if (!re) return null;
  const m = re.exec(shortName(agent.obj_name));
  if (!m) return null;

  // 이름 있는 그룹(`svc`)을 먼저 보고, 없으면 첫 캡처. **캡처가 없으면 묶지 않는다** —
  // 무엇을 이름으로 쓸지 모르는 채로 묶으면 전부 같은 이름이 된다.
  const name = m.groups?.svc ?? m[1];
  return name !== undefined && name.trim() !== '' ? name.trim() : null;
}

/**
 * 서비스별로 Task 를 모은다.
 *
 * **한 대짜리는 빼고 돌려준다.** 묶을 것이 없는데 그룹 마디를 만들면 깊이만 한 겹 늘고,
 * 펼쳤을 때 한 줄만 있는 마디가 줄줄이 생긴다.
 *
 * **죽은 Task 도 넣는다.** 여기는 «어느 서비스인가» 만 정하는 자리다 — 조회 대상에서
 * 빼는 것은 고르는 쪽(`groupSelection`)의 일이고, 그래야 화면이 «방금 내려간 Task» 를
 * 보여줄 수 있다.
 */
export function groupByService(
  agents: readonly AgentObject[],
  rule: GroupRule,
): Map<string, AgentObject[]> {
  const buckets = new Map<string, AgentObject[]>();

  for (const a of agents) {
    const name = serviceNameOf(a, rule);
    if (name === null) continue;
    const list = buckets.get(name);
    if (list) list.push(a);
    else buckets.set(name, [a]);
  }

  for (const [name, list] of buckets) {
    if (list.length <= 1) buckets.delete(name);
  }
  return buckets;
}

/**
 * 목록 한 줄에 적을 **인스턴스 이름**.
 *
 * 그룹으로 묶어 보면 서비스 이름이 줄마다 반복된다 — 이미 왼쪽에서 고른 것이라
 * 거기서 알 수 있고, 줄에서 알고 싶은 것은 **넷 중 어느 Task 인가** 다.
 * 그래서 서비스 부분을 떼고 남는 것을 쓴다.
 *
 * 떼어낼 것이 없으면(묶이지 않은 오브젝트) 짧은 이름을 그대로 쓴다 —
 * 빈 칸으로 두면 «못 받았다» 로 읽힌다.
 */
export function instanceLabel(objName: string, rule: GroupRule): string {
  const short = shortName(objName);
  const svc = serviceNameOf(
    { obj_name: objName, tags: [] } as unknown as AgentObject,
    rule,
  );
  if (svc === null || !short.startsWith(svc)) return short;

  // 서비스와 인스턴스를 가르는 글자(`-`·`_`·`.`)까지 같이 뗀다
  const rest = short.slice(svc.length).replace(/^[-_.]+/, '');
  return rest === '' ? short : rest;
}
