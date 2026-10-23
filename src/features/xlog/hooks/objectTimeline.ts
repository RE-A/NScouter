// 오브젝트가 **언제 보였고 언제까지 살아 있었나.**
//
// ECS 처럼 Task 가 갈리는 곳에서 두 가지를 답하려고 둔다.
//   · 과거 조회 — «그때 이 서비스에 어떤 Task 가 있었나». 지금 목록에는 정리돼 없을 수 있다
//   · 알림 — Task 가 내려갔을 때 **같은 서비스의 다른 Task 가 그때 살아 있었나**.
//     살아 있었으면 교체고, 아무도 없었으면 장애다
//
// **콜렉터의 `wakeup` 은 시작 시각이 아니다.** 하트비트마다 `ObjectPack.wakeup()` 이
// 지금 시각으로 덮어쓴다(2.21.3 바이트코드 `AgentManager.active`). 그래서 죽은 것의
// `wakeup` 은 «마지막으로 살아 있던 때» 이고, 처음 뜬 때는 콜렉터가 어디에도 안 남긴다.
// 처음 본 때는 여기서 적는다.
//
// **모듈 저장소다** (`agentNames.ts` 와 같은 이유). 지우지 않고 쌓는다 — 정리된 Task 도
// 그날의 과거 조회와 알림 판정에는 필요하다.
//
// **껐다 켜도 남는다.** 메인 창이 서버마다 파일로 남기고(`object_history_store.rs`) 붙을 때 되살린다.
// 남기는 것은 최근 며칠치만이다(`persistableHistory`).

import type { AgentObject } from '../types/xlog';

export interface SeenObject {
  obj_hash: number;
  obj_name: string;
  obj_type: string;
  tags: AgentObject['tags'];
  /**
   * 이 앱이 처음 본 시각. **처음 받은 목록에 이미 있던 것은 0** 이다 — 언제 떴는지 모르지만
   * 이 앱이 보기 전부터 있었다. 알림은 접속한 뒤에만 오므로 «그때 있었다» 로 쳐도 맞다.
   */
  firstSeen: number;
  /** 마지막으로 살아 있던 시각. 살아 있으면 본 시각, 죽었으면 콜렉터의 `wakeup` */
  lastAlive: number;
  /** 마지막으로 본 상태 */
  alive: boolean;
}

const seen = new Map<number, SeenObject>();
/** 첫 목록인가 — 첫 목록의 것은 «원래 있던 것» 이다 */
let primed = false;

/**
 * 받은 목록을 적는다. 목록에 없는 것은 **그대로 둔다** — 정리로 사라진 것도 기억한다.
 *
 * @param now 받은 시각. 살아 있는 것의 `lastAlive` 가 된다
 */
export function observeObjects(agents: readonly AgentObject[], now: number): void {
  for (const a of agents) {
    const prev = seen.get(a.obj_hash);
    const lastAlive = a.alive ? now : Math.max(a.wakeup, prev?.lastAlive ?? 0);
    seen.set(a.obj_hash, {
      obj_hash: a.obj_hash,
      // 빈 이름으로 덮지 않는다 (agentNames 와 같은 이유 — F-34)
      obj_name: a.obj_name !== '' ? a.obj_name : (prev?.obj_name ?? ''),
      obj_type: a.obj_type !== '' ? a.obj_type : (prev?.obj_type ?? ''),
      tags: a.tags.length > 0 ? a.tags : (prev?.tags ?? []),
      firstSeen: prev?.firstSeen ?? (primed ? now : 0),
      lastAlive,
      alive: a.alive,
    });
  }
  primed = true;
}

/** 지금까지 본 전부 */
export function objectHistory(): ReadonlyMap<number, SeenObject> {
  return seen;
}

/** 비운다. **콜렉터를 갈아탈 때만** (해시가 이름의 해시라 서버가 달라도 겹친다 — F-35) */
export function clearObjectHistory(): void {
  seen.clear();
  primed = false;
}

/** 파일에 남기는 기간 — 마지막으로 살아 있던 때가 이보다 오래된 것은 버린다 */
export const HISTORY_KEEP_MS = 7 * 24 * 60 * 60_000;

/** 파일에 남기는 최대 건수 — 최근에 살아 있던 것부터. ECS 에서 배포가 잦아도 며칠이면 이 안이다 */
export const HISTORY_KEEP_MAX = 5_000;

/** 파일에 남길 것 — 최근 `HISTORY_KEEP_MS` 안에 살아 있던 것을, 최근 것부터 `HISTORY_KEEP_MAX` 건까지 */
export function persistableHistory(now: number): SeenObject[] {
  return [...seen.values()]
    .filter(s => s.alive || s.lastAlive >= now - HISTORY_KEEP_MS)
    .sort((a, b) => b.lastAlive - a.lastAlive)
    .slice(0, HISTORY_KEEP_MAX);
}

function isTag(v: unknown): v is [string, string] {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string';
}

/** 파일에서 온 한 건을 믿을 수 있는 모양으로. 모양이 틀리면 null */
function toSeen(v: unknown): SeenObject | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.obj_hash !== 'number' || !Number.isFinite(o.obj_hash) ||
    typeof o.obj_name !== 'string' || typeof o.obj_type !== 'string' ||
    typeof o.firstSeen !== 'number' || typeof o.lastAlive !== 'number' ||
    !Array.isArray(o.tags)
  ) return null;
  return {
    obj_hash: o.obj_hash,
    obj_name: o.obj_name,
    obj_type: o.obj_type,
    tags: o.tags.filter(isTag),
    firstSeen: o.firstSeen,
    lastAlive: o.lastAlive,
    // **죽은 것으로 되살린다.** 남긴 때 살아 있던 것이 지금도 살아 있는지는 모른다 — 살아 있으면
    // 다음 목록이 살린다. 살아 있다고 두면 꺼 둔 사이 내려간 Task 가 «대신 받았다» 로 장애를 숨긴다.
    alive: false,
  };
}

/**
 * 파일에 남긴 기록을 들인다. **이미 본 것은 건드리지 않는다** — 지금 목록이 파일보다 새것이다.
 *
 * 처음 받은 목록(`primed`)은 건드리지 않는다 — 파일보다 늦게 와도, 일찍 와도 그 목록의 새것은
 * «원래 있던 것» 이다.
 *
 * @returns 들인 건수
 */
export function restoreObjectHistory(data: unknown): number {
  if (!Array.isArray(data)) return 0;
  let n = 0;
  for (const v of data) {
    const x = toSeen(v);
    if (!x || seen.has(x.obj_hash)) continue;
    seen.set(x.obj_hash, x);
    n++;
  }
  return n;
}

/** 서비스 묶기 규칙에 넘길 수 있는 모양으로. 살아 있는지는 마지막으로 본 상태다 */
export function asAgent(s: SeenObject): AgentObject {
  return {
    obj_hash: s.obj_hash,
    obj_name: s.obj_name,
    obj_type: s.obj_type,
    address: '',
    version: '',
    alive: s.alive,
    wakeup: s.lastAlive,
    tags: s.tags,
  };
}
