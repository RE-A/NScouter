// 오브젝트 생명주기 알림을 **서비스 단위로 묶는다.**
//
// ECS 는 재배포 한 번에 Task 를 통째로 갈아 끼운다. 콜렉터는 내려간 Task 마다
// `INACTIVE_OBJECT` 를 보낸다 — 4대짜리 서비스면 배포 한 번에 4건이다. 그중 장애는 없다.
// 그런데 진짜 장애(그 서비스가 통째로 내려감)도 똑같은 `INACTIVE_OBJECT` 로 온다.
// 둘이 같은 모양으로 섞이면 알림을 안 보게 된다.
//
// `ACTIVATED_OBJECT` 는 **새 Task 에는 안 온다** — 죽었던 오브젝트가 되살아날 때만 나간다(F-62).
// 그래서 «새 Task 가 떴나» 는 알림이 아니라 목록 기록(`objectTimeline.ts`)으로 본다.
//
// 그래서 묶어서 **한 줄로 말한다.**
//   · 교체 — 내려간 Task 마다, 그때 같은 서비스의 다른 Task 가 살아 있었다
//   · 살아 있는 Task 없음 — 내려간 것 중 하나라도 대신 받아 줄 Task 가 없었다
//
// **판정은 그릴 때마다 다시 한다.** 새 Task 가 옛 Task 보다 늦게 뜨는 배포(최소 정상 0%)
// 에서는 알림이 온 순간에는 아무도 없다가 1분 뒤 새 Task 가 뜬다. 그때 다시 보면 교체다.

import { serviceNameOf, type GroupRule } from '../components/instanceGroup';
import { asAgent, type SeenObject } from '../hooks/objectTimeline';
import type { AlertPack } from '../types/alert';

export const ALERT_OBJECT_DOWN = 'INACTIVE_OBJECT';
export const ALERT_OBJECT_UP = 'ACTIVATED_OBJECT';

/**
 * 대신 받을 Task 가 «늦게 떠도 되는» 여유.
 *
 * ECS 롤링 배포는 보통 새 Task 를 먼저 띄우지만, 최소 정상 비율을 0% 로 두면 옛 Task 를
 * 내리고 나서 새 Task 를 띄운다. 이미지 받기·기동까지 1~2분이 흔하다.
 */
export const REPLACE_GRACE_MS = 3 * 60_000;

/**
 * 대신 받았다고 치려면 내려간 뒤로 **이만큼은 더 살아 있었어야** 한다.
 *
 * 한꺼번에 내려가면(장애) 하트비트 몇 초 차이로 «남이 더 오래 살았다» 가 된다.
 * 그걸 대신 받은 것으로 치면 장애가 교체로 숨는다.
 */
export const REPLACE_OVERLAP_MS = 30_000;

/** 같은 서비스의 생명주기 알림이 이보다 띄엄띄엄 오면 다른 일로 본다 */
export const BURST_GAP_MS = 5 * 60_000;

export interface AlertBurst {
  kind: 'burst';
  service: string;
  status: 'replaced' | 'down';
  /** 최신순 */
  alerts: AlertPack[];
  from: number;
  to: number;
  /** 내려간 / 올라온 Task 수 (알림 수가 아니라 Task 수다) */
  down: number;
  up: number;
  /** 장애였는데 **지금은** 살아 있는 Task 가 있다 */
  recovered: boolean;
}

export type AlertRow = { kind: 'single'; alert: AlertPack } | AlertBurst;

export interface GroupOptions {
  graceMs?: number;
  overlapMs?: number;
  burstGapMs?: number;
}

function isLifecycle(a: AlertPack): boolean {
  return a.title === ALERT_OBJECT_DOWN || a.title === ALERT_OBJECT_UP;
}

/**
 * @param alerts  최신순 (useAlertStream 이 그렇게 쌓는다)
 * @param history 이 앱이 본 오브젝트 기록 (`objectTimeline.ts`)
 * @returns 최신순. 묶음은 가장 최근 알림의 자리에 선다
 */
export function groupAlerts(
  alerts: readonly AlertPack[],
  history: ReadonlyMap<number, SeenObject>,
  rule: GroupRule,
  opts: GroupOptions = {},
): AlertRow[] {
  const grace = opts.graceMs ?? REPLACE_GRACE_MS;
  const overlap = opts.overlapMs ?? REPLACE_OVERLAP_MS;
  const gap = opts.burstGapMs ?? BURST_GAP_MS;

  const serviceOfHash = new Map<number, string | null>();
  const serviceOf = (hash: number): string | null => {
    if (serviceOfHash.has(hash)) return serviceOfHash.get(hash) ?? null;
    const seen = history.get(hash);
    const svc = seen ? serviceNameOf(asAgent(seen), rule) : null;
    serviceOfHash.set(hash, svc);
    return svc;
  };

  // 서비스별로 모은다. 서비스를 모르는 것은 그대로 한 줄이다.
  const byService = new Map<string, AlertPack[]>();
  const singles: AlertPack[] = [];
  for (const a of alerts) {
    const svc = isLifecycle(a) ? serviceOf(a.obj_hash) : null;
    if (svc === null) { singles.push(a); continue; }
    const list = byService.get(svc);
    if (list) list.push(a); else byService.set(svc, [a]);
  }

  /** 내려간 X 를 그때 같은 서비스의 다른 Task 가 대신 받았나 */
  const covered = (a: AlertPack, svc: string): boolean => {
    const x = history.get(a.obj_hash);
    // 내려간 때는 **마지막 하트비트**다. 알림은 콜렉터의 판정 지연(object_deadtime_ms)만큼 늦다.
    const tDown = x && !x.alive && x.lastAlive > 0 && x.lastAlive <= a.time ? x.lastAlive : a.time;
    for (const y of history.values()) {
      if (y.obj_hash === a.obj_hash) continue;
      if (serviceOf(y.obj_hash) !== svc) continue;
      if (y.firstSeen > tDown + grace) continue;
      if (y.alive || y.lastAlive >= tDown + overlap) return true;
    }
    return false;
  };

  const bursts: AlertBurst[] = [];
  for (const [svc, list] of byService) {
    const asc = [...list].sort((p, q) => p.time - q.time);
    let cur: AlertPack[] = [];
    const flush = () => {
      if (cur.length === 0) return;
      const downHashes = new Set(cur.filter(a => a.title === ALERT_OBJECT_DOWN).map(a => a.obj_hash));
      const upHashes = new Set(cur.filter(a => a.title === ALERT_OBJECT_UP).map(a => a.obj_hash));
      const isDown = cur.some(a => a.title === ALERT_OBJECT_DOWN && !covered(a, svc));
      const aliveNow = [...history.values()].some(y => y.alive && serviceOf(y.obj_hash) === svc);
      bursts.push({
        kind: 'burst',
        service: svc,
        status: isDown ? 'down' : 'replaced',
        alerts: [...cur].reverse(),
        from: cur[0].time,
        to: cur[cur.length - 1].time,
        down: downHashes.size,
        up: upHashes.size,
        recovered: isDown && aliveNow,
      });
      cur = [];
    };
    for (const a of asc) {
      if (cur.length > 0 && a.time - cur[cur.length - 1].time > gap) flush();
      cur.push(a);
    }
    flush();
  }

  const rows: { at: number; row: AlertRow }[] = [
    ...singles.map(a => ({ at: a.time, row: { kind: 'single', alert: a } as AlertRow })),
    ...bursts.map(b => ({ at: b.to, row: b as AlertRow })),
  ];
  // 같은 시각이면 들어온 순서(안정 정렬)를 지킨다
  rows.sort((p, q) => q.at - p.at);
  return rows.map(r => r.row);
}

/**
 * 배지에서 **세지 않을** 알림 — 교체로 판정된 묶음의 것.
 *
 * 배포 한 번에 배지가 Task 수만큼 뛰면 배지를 안 보게 된다. 장애 묶음과 서비스를 모르는 알림은 센다.
 */
export function quietAlerts(rows: readonly AlertRow[]): Set<AlertPack> {
  const out = new Set<AlertPack>();
  for (const r of rows) {
    if (r.kind === 'burst' && r.status === 'replaced') for (const a of r.alerts) out.add(a);
  }
  return out;
}
