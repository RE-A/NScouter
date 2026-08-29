// 에이전트 목록 묶기·찾기 (순수 로직)
//
// 실환경은 오브젝트가 161개(활성 40)다. 평평한 목록에서는 **찾을 수가 없다.**
//
// 묶는 기준은 `obj_type` 이다. 운영 환경에서는 이 값이 시스템 이름으로 쓰이고
// (CJFW · PRD-ORD · CJFW_QA · WayLo_QA), 나머지는 종류(tomcat · datasource ·
// reqproc · linux)로 남는다 — 둘 다 "같이 보고 싶은 것끼리" 모인다.
//
// 이름의 경로(`/CJFW/PRD-FSCP/FDMKT-BO`)로도 묶을 수 있다. 처음에는 «깊이가
// 제각각이라 계층이 들쭉날쭉해진다» 는 이유로 안 넣었는데, 그건 **계층으로 쌓을 때**의
// 문제였다. 부모 경로를 통째로 한 묶음 이름으로 쓰면 깊이가 달라도 섞이지 않는다.
//
// **콜렉터에는 오브젝트 그룹이라는 개념이 없다.** `RequestCmd` 의 `..._GROUP` 은 전부
// «여러 오브젝트를 한 번에» 라는 뜻이다. 그래서 그룹은 이름에서 읽어 낼 수밖에 없다.
//
// 두 기준은 서로를 대신하지 못한다:
//   타입   tomcat · datasource · linux  (무엇인가)
//   그룹   /CJFW · /order-app           (어느 호스트에 있는가)
// 운영에서는 obj_type 에 시스템 이름을 넣어 쓰기도 해서(CJFW · PRD-ORD) 겹치기도 하는데,
// 그때도 그룹 쪽이 한 겹 더 잘게 나눈다.

import type { AgentObject } from '../types/xlog';

/** 무엇으로 묶을 것인가 */
export type GroupBy = 'type' | 'group';

export interface AgentGroup {
  /** 묶음 이름. 기준에 따라 obj_type 이거나 이름의 부모 경로다 */
  type: string;
  agents: AgentObject[];
  /** 살아 있는 수. 접힌 채로도 이건 보여야 한다 */
  aliveCount: number;
}

/** 목록에 쓰는 짧은 이름. `/CJFW/PRD-FSCP/FDMKT-BO` → `FDMKT-BO` */
export function shortName(objName: string): string {
  const last = objName.split('/').filter(Boolean).pop();
  return last ?? objName;
}

/**
 * 검색어와 맞는가.
 *
 * **이름과 타입 둘 다** 본다. 사용자는 `CJFW`(시스템)로도 찾고 `BO`(이름)로도 찾는다.
 * 이름은 짧은 이름이 아니라 **전체 경로**로 본다 — `/PRD-FSCP/` 같은 중간 마디로도 찾게.
 */
function matches(agent: AgentObject, needle: string): boolean {
  if (needle === '') return true;
  return (
    agent.obj_name.toLowerCase().includes(needle) ||
    agent.obj_type.toLowerCase().includes(needle)
  );
}

/**
 * 이름에서 그룹을 읽어 낸다 — **첫 마디(호스트)**.
 *
 * `/CJFW/PRD-FSCP/FDMKT-BO`          → `/CJFW`
 * `/order-app/order-app`             → `/order-app`
 * `/order-app/order-app/HikariPool-1` → `/order-app`
 *
 * **Scouter 의 이름 규칙이 `/{host}/{name}` 이다.** ASIS 도 같은 자리를 잘라 호스트를
 * 찾는다(`ObjectNavigationView`: `objName.substring(0, objName.indexOf("/", 1))`).
 *
 * 처음에는 «마지막 마디를 뺀 앞부분» 으로 잡았다가 바꿨다. 그러면 앱과 그 앱의
 * datasource 가 **다른 묶음**으로 갈라진다 — `/order-app/order-app` 과
 * `/order-app/order-app/HikariPool-1` 이 각각 1개짜리 묶음이 됐다(화면에서 확인).
 * 호스트로 자르면 한 대에 있는 것이 한자리에 모인다.
 *
 * ASIS 는 두 번째 `/` 가 없으면 `substring(0, -1)` 로 터진다. 여기서는 그냥
 * 속한 곳이 없는 것으로 둔다.
 */
export function groupNameOf(objName: string): string {
  const parts = objName.split('/').filter(Boolean);
  if (parts.length <= 1) return '(그룹 없음)';
  return `/${parts[0]}`;
}

/**
 * 묶고 검색어로 거른다.
 *
 * 그룹은 **이름순**으로 고정한다. 살아 있는 수로 정렬하면 10초마다 목록이 춤춘다.
 * 그룹 안은 **살아 있는 것 먼저** — 죽은 것이 위에 쌓이면 스크롤이 늘어난다.
 * 이건 에이전트가 죽거나 살아날 때만 바뀌고, 그때는 자리가 바뀌는 게 오히려 신호다.
 */
export function groupAgents(
  agents: readonly AgentObject[],
  query: string,
  by: GroupBy = 'type',
): AgentGroup[] {
  const needle = query.trim().toLowerCase();
  const buckets = new Map<string, AgentObject[]>();

  for (const a of agents) {
    if (!matches(a, needle)) continue;
    const key = by === 'group' ? groupNameOf(a.obj_name) : a.obj_type || '(unknown)';
    const list = buckets.get(key);
    if (list) list.push(a);
    else buckets.set(key, [a]);
  }

  return [...buckets.entries()]
    .map(([type, list]) => ({
      type,
      agents: [...list].sort((x, y) => {
        if (x.alive !== y.alive) return x.alive ? -1 : 1;
        return shortName(x.obj_name).localeCompare(shortName(y.obj_name));
      }),
      aliveCount: list.filter(a => a.alive).length,
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
}
