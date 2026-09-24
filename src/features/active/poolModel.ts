// 커넥션 풀 (순수 로직)
//
// **왜 Active 탭에 붙이는가.** 「풀이 찼다」와 「무엇 때문에 찼나」는 늘 붙어 다니는
// 질문인데, 지금은 앞이 Counter 탭의 추세 차트에, 뒤가 여기 목록에 있어서 두 화면을
// 오가야 인과가 나온다. 한 줄만 올려 두면 «상한 10에 활성 10 · 그 아래 같은 쿼리 6건»
// 이 한 화면에서 읽힌다.
//
// **풀이 어느 WAS 의 것인지는 이름으로 안다.** 이 프로젝트는 «이름으로 추측하지
// 않는다» 를 규칙으로 두고 있으므로(objectTypes.ts), 여기서는 추측이 아님을 밝혀 둔다:
// 에이전트 바이트코드(`TomcatJMXPerf`)가 풀 오브젝트 이름을
// **`Configure.getObjName()` + `/` + 풀이름** 으로 만든다. 즉 부모 WAS 의 objName 이
// 접두사인 것은 규칙이지 우연이 아니다. 실측도 같다 —
// `/shop-app/shop-app` 아래 `/shop-app/shop-app/HikariPool-1`.
//
// 다만 **풀과 개별 쿼리를 잇는 키는 없다.** 액티브 목록의 쿼리에는 어느 풀에서
// 커넥션을 얻었는지가 안 붙는다. 그래서 말할 수 있는 것은 「이 WAS 의 풀」 까지이고,
// 한 WAS 에 풀이 둘이면 그 이상은 화면이 단정하지 않는다.

/** 스트림에서 받은 풀 한 개의 최신값. 아직 안 온 값은 `null` */
export interface PoolCounters {
  active: number | null;
  idle: number | null;
  max: number | null;
}

export interface Pool extends PoolCounters {
  objHash: number;
  /** 콜렉터가 준 전체 이름 (`/shop-app/shop-app/HikariPool-1`) */
  objName: string;
  /** 마지막 마디. 화면에 크게 적는 이름이다 */
  poolName: string;
  /** 부모 WAS 의 objName. 없으면 빈 문자열 */
  parentName: string;
}

/**
 * 부모 WAS 의 objName.
 *
 * 마지막 마디를 떼면 된다 (에이전트가 `objName + "/" + 풀이름` 으로 짓는다).
 * 마디가 하나뿐이면 뗄 것이 없으므로 빈 문자열이다 — 없는 부모를 지어내지 않는다.
 */
export function parentObjName(poolObjName: string): string {
  const cut = poolObjName.lastIndexOf('/');
  if (cut <= 0) return '';
  return poolObjName.slice(0, cut);
}

/** 마지막 마디. 목록에서는 이것만 보여도 충분하다 */
export function poolShortName(poolObjName: string): string {
  const cut = poolObjName.lastIndexOf('/');
  return cut < 0 ? poolObjName : poolObjName.slice(cut + 1);
}

/**
 * 소진율(%). 상한을 모르면 `null` 이다 — **0으로 두지 않는다.**
 *
 * 0%는 «여유롭다» 로 읽히는데, 모르는 것과 여유로운 것은 정반대의 상황일 수 있다.
 */
export function usagePct(c: PoolCounters): number | null {
  if (c.active === null || c.max === null || c.max <= 0) return null;
  return Math.min(100, (c.active / c.max) * 100);
}

/** 소진 경고 단계. 색과 문구를 여기 한 곳에서 정한다 */
export type PoolLevel = 'unknown' | 'ok' | 'warn' | 'full';

/** 90% 부터는 «곧 막힌다» 다. 70% 는 지켜볼 자리 */
const WARN_PCT = 70;
const FULL_PCT = 90;

export function poolLevel(c: PoolCounters): PoolLevel {
  const pct = usagePct(c);
  if (pct === null) return 'unknown';
  if (pct >= FULL_PCT) return 'full';
  if (pct >= WARN_PCT) return 'warn';
  return 'ok';
}

/**
 * 화면에 놓을 풀 목록.
 *
 * **소진율 높은 순이다.** 이름순으로 두면 열 개 중 하나만 찬 상황에서 그 하나가
 * 가운데 묻힌다. 모르는 것(값이 아직 안 온 것)은 뒤로 보내되 버리지는 않는다 —
 * 사라지면 «풀이 없다» 로 읽힌다.
 * 같은 소진율이면 이름순으로 고정한다. 2초마다 순서가 춤추면 못 읽는다.
 */
export function buildPools(
  entries: readonly { objHash: number; objName: string }[],
  counters: ReadonlyMap<number, PoolCounters>,
): Pool[] {
  const pools = entries.map(e => {
    const c = counters.get(e.objHash) ?? { active: null, idle: null, max: null };
    return {
      objHash: e.objHash,
      objName: e.objName,
      poolName: poolShortName(e.objName),
      parentName: parentObjName(e.objName),
      ...c,
    };
  });

  return pools.sort((a, b) => {
    const pa = usagePct(a);
    const pb = usagePct(b);
    if (pa === null && pb === null) return a.objName.localeCompare(b.objName);
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pb - pa || a.objName.localeCompare(b.objName);
  });
}

/** 이 트랜잭션의 서버가 쓰는 풀인가 — 부모 이름으로 잇는다 */
export function poolsOfServer(pools: readonly Pool[], serverObjName: string): Pool[] {
  return pools.filter(p => p.parentName === serverObjName);
}

/**
 * 고른 WAS **아래에 달린** 풀 오브젝트들.
 *
 * 풀을 보려고 왼쪽 목록에서 풀 오브젝트까지 따로 골라야 했다. 무엇을 골라야
 * 하는지가 목록만 봐서는 안 보인다 — `datasource` 는 이름이 `HikariPool-1` 처럼
 * 다 비슷하고, WAS·reqproc 과 섞여 있다.
 *
 * **이름으로 잇는 것은 추측이 아니다.** 에이전트가 풀 이름을
 * `Configure.getObjName() + "/" + 풀이름` 으로 짓는다 (`TomcatJMXPerf` 바이트코드,
 * 실측 F-41). 그래서 부모를 **정확히 한 겹** 위로만 본다 — 접두사 비교로 넓게 잡으면
 * `/a/app` 이 `/a/app-batch` 의 풀까지 제 것으로 삼는다.
 */
export function poolsUnder(
  pools: readonly { objHash: number; objName: string }[],
  parentNames: readonly string[],
): number[] {
  const parents = new Set(parentNames.filter(n => n !== ''));
  if (parents.size === 0) return [];
  return pools.filter(p => parents.has(parentObjName(p.objName))).map(p => p.objHash);
}
