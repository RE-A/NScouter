// 오브젝트 목록을 **계속 따라간다.**
//
// 예전에는 접속할 때 한 번만 읽었다. 왼쪽 패널만 10초마다 다시 읽고 있어서,
// 새 Task 가 떠도 카운터 대상에 안 들어가고 이름이 `#해시` 로 남았다 —
// ECS 에서는 Task 가 재배포·장애복구·오토스케일로 수시로 갈리므로
// 명단을 사진처럼 찍어 두면 금방 틀어진다.
//
// 다만 **읽은 것을 그대로 갈아 끼우면 안 된다.** 재배포 중 몇 초 비는 사이에
// 서버가 화면에서 통째로 사라지면 그건 «장애» 로 읽힌다. 잠시 죽은 채로 남겨 둔다.

import type { AgentObject } from '../types/xlog';

/**
 * 사라진 Task 를 죽은 채로 들고 있을 시간.
 *
 * 재배포 한 바퀴를 덮을 만큼은 되어야 하고, 그보다 길면 이미 없는 것이 오래 떠 있는다.
 * 1분이면 새 Task 가 떠서 하트비트를 보내기까지를 넉넉히 덮는다.
 */
export const TERMINATED_KEEP_MS = 60_000;

/**
 * 직전 명단과 방금 받은 명단을 합친다.
 *
 * **새로 받은 값이 이긴다** — 이름이 바뀌었으면 바뀐 이름을 쓴다.
 * `next` 에 없는 것은 죽은 것으로 표시해 두되, `keepMs` 가 지나면 버린다.
 *
 * 죽었다고 **지우지 않는 이유**는 두 가지다. 재배포 중의 빈 구간을 장애로 보이지
 * 않게 하는 것이 하나고, 방금 내려간 Task 의 이름을 아직 풀 수 있어야 하는 것이
 * 다른 하나다 — 그 Task 가 남긴 XLog 는 목록에 그대로 있다.
 */
export function mergeObjects(
  prev: readonly AgentObject[],
  next: readonly AgentObject[],
  now: number,
  keepMs: number = TERMINATED_KEEP_MS,
): AgentObject[] {
  const fresh = new Map(next.map(a => [a.obj_hash, a]));
  const out: AgentObject[] = [...next];

  for (const old of prev) {
    if (fresh.has(old.obj_hash)) continue;
    // `wakeup` 이 0 이면 살아 있음을 알린 적이 없는 것이다. 그때는 지금부터 센다 —
    // 0 을 시각으로 읽으면 1970년이라 곧바로 버려진다.
    const since = old.wakeup > 0 ? old.wakeup : now;
    if (now - since > keepMs) continue;
    out.push(old.alive ? { ...old, alive: false } : old);
  }
  return out;
}
