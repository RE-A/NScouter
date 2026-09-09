// 오브젝트 타입 식별 (순수 로직)
//
// 목록에 뜬 이름만으로는 **그게 무엇인지 알 수 없다.** `/order-app/order-app` 과
// `/order-app/order-app/HikariPool-1` 은 한 글자 차이지만 하나는 WAS 고 하나는
// 커넥션 풀이라, 물을 수 있는 것도 볼 수 있는 것도 다르다.
//
// **이름으로 추측하지 않는다.** 종류는 콜렉터가 `ObjectPack.objType` 으로 알려준다
// (N-4 에서 순서를 고친 그 필드다). 이름 규칙은 현장마다 달라서 — 운영에서는
// objType 자리에 시스템 이름(CJFW · PRD-ORD)을 넣어 쓰기도 한다 — 이름을 파서
// 종류를 정하면 그런 환경에서 통째로 틀린다.
//
// Family 는 counters.xml 이 정한 상위 묶음이다(javaee · host · datasource).
// objType 은 환경마다 늘어나지만 Family 는 셋뿐이라, **색은 Family 로** 준다 —
// 처음 보는 objType 이 와도 색이 없어지지 않는다.

import type { AgentObject } from '../types/xlog';
import { isDatasourceObjectType, isHostObjectType, isJavaeeObjectType } from '../types/counter';

/** counters.xml 이 정한 상위 묶음. 모르는 종류는 `null` */
export type ObjectFamily = 'javaee' | 'host' | 'datasource' | null;

export function objectFamily(objType: string): ObjectFamily {
  if (isJavaeeObjectType(objType)) return 'javaee';
  if (isHostObjectType(objType)) return 'host';
  if (isDatasourceObjectType(objType)) return 'datasource';
  return null;
}

/** 목록에 뜬 종류 하나 */
export interface TypeCount {
  type: string;
  count: number;
  /** 살아 있는 수. 필터 칩에서 «지금 볼 것이 있는 종류인가» 를 가른다 */
  aliveCount: number;
}

/**
 * 목록에 실제로 있는 종류들.
 *
 * **화면이 스스로 알아낸다.** 알려진 objType 목록을 박아 두면 처음 보는 종류
 * (`reqproc` · `redis` · 현장에서 새로 붙인 것)가 조용히 «없는 것» 이 된다.
 *
 * 이름순으로 고정한다 — 개수로 정렬하면 10초마다 칩 순서가 춤춘다.
 */
export function typeCounts(agents: readonly AgentObject[]): TypeCount[] {
  const acc = new Map<string, TypeCount>();
  for (const a of agents) {
    const type = a.obj_type || UNKNOWN_TYPE;
    const row = acc.get(type);
    if (row) {
      row.count += 1;
      if (a.alive) row.aliveCount += 1;
    } else {
      acc.set(type, { type, count: 1, aliveCount: a.alive ? 1 : 0 });
    }
  }
  return [...acc.values()].sort((a, b) => a.type.localeCompare(b.type));
}

/** objType 이 비어 온 오브젝트. 목록에는 떠 있으니 이름은 줘야 한다 */
export const UNKNOWN_TYPE = '(unknown)';

/** 그 오브젝트를 무엇으로 부를 것인가 — 배지에 적히는 글자 */
export function typeLabel(objType: string): string {
  return objType || UNKNOWN_TYPE;
}

/**
 * 배지 글자색.
 *
 * **채우지 않는다.** 이 화면은 색을 데이터(살아 있음 · 고름 · 에러)에 쓰고 있어서,
 * 종류마다 색을 채운 알약을 놓으면 목록이 색 기둥이 된다.
 * 프로파일 스텝 종류(`ProfileStepList.KIND`)와 같은 규칙이다 — 글자색만 준다.
 */
export function typeTone(objType: string): string {
  switch (objectFamily(objType)) {
    case 'javaee':
      return 'text-accent';
    case 'host':
      return 'text-[var(--cat-api)]';
    case 'datasource':
      return 'text-[var(--cat-sql)]';
    default:
      return 'text-fg-faint';
  }
}

/**
 * 배지를 띄울 만한가.
 *
 * **한 종류뿐이면 적을 말이 없다.** 모든 줄에 `tomcat` 이 붙으면 그건 정보가 아니라
 * 여백을 먹는 글자다. 종류가 둘 이상일 때만 «이건 저것과 다르다» 가 성립한다.
 */
export function shouldShowTypes(agents: readonly AgentObject[]): boolean {
  const seen = new Set<string>();
  for (const a of agents) {
    seen.add(a.obj_type || UNKNOWN_TYPE);
    if (seen.size > 1) return true;
  }
  return false;
}
