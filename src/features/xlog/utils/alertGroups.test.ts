// 생명주기 알림 묶기의 계약
//
// 지키려는 것:
//   · 롤링 배포(새 Task 먼저)는 교체다
//   · 최소 정상 0% 배포(옛 Task 먼저, 새 Task 는 1~2분 뒤)도 교체다
//   · 한꺼번에 내려가면 장애다 — 하트비트 몇 초 차이로 «남이 더 오래 살았다» 가 되면 안 된다
//   · 차례로 내려가도 마지막 하나를 받아 줄 Task 가 없으면 장애다
//   · 장애 뒤 한참 있다 뜬 Task 는 대신 받은 것이 아니다 — 장애이되 «복구됨»
//   · 서비스를 모르는 알림, 생명주기가 아닌 알림은 건드리지 않는다
//   · 교체로 판정된 묶음만 배지에서 뺀다

import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALERT_OBJECT_DOWN,
  ALERT_OBJECT_UP,
  groupAlerts,
  quietAlerts,
  type AlertBurst,
} from './alertGroups';
import type { SeenObject } from '../hooks/objectTimeline';
import { DEFAULT_GROUP_RULE } from '../components/instanceGroup';
import type { AlertPack } from '../types/alert';

const MIN = 60_000;
const T0 = 1_800_000_000_000;

let history: Map<number, SeenObject>;

function task(n: number, s: Partial<SeenObject>, svc = 'safs'): void {
  history.set(n, {
    obj_hash: n,
    obj_name: `/vm/${svc}-ip-10-0-0-${n}`,
    obj_type: 'tomcat',
    tags: [],
    firstSeen: 0,
    lastAlive: T0,
    alive: true,
    ...s,
  });
}

function alert(title: string, hash: number, time: number, level = 1): AlertPack {
  return { time, obj_type: 'scouter', obj_hash: hash, level, title, message: '' };
}

/** useAlertStream 처럼 최신순으로 */
const newestFirst = (xs: AlertPack[]) => [...xs].sort((a, b) => b.time - a.time);

function bursts(alerts: AlertPack[]): AlertBurst[] {
  return groupAlerts(newestFirst(alerts), history, DEFAULT_GROUP_RULE).filter(
    (r): r is AlertBurst => r.kind === 'burst',
  );
}

beforeEach(() => { history = new Map(); });

describe('교체', () => {
  it('롤링 배포 — 새 Task 가 먼저 뜨고 옛 Task 가 내려간다', () => {
    task(1, { alive: false, lastAlive: T0 + 2 * MIN });
    task(2, { alive: false, lastAlive: T0 + 3 * MIN });
    task(3, { firstSeen: T0 + 1 * MIN });
    task(4, { firstSeen: T0 + 1 * MIN });
    const b = bursts([
      alert(ALERT_OBJECT_UP, 3, T0 + 1 * MIN),
      alert(ALERT_OBJECT_UP, 4, T0 + 1 * MIN),
      alert(ALERT_OBJECT_DOWN, 1, T0 + 2 * MIN + 8_000),
      alert(ALERT_OBJECT_DOWN, 2, T0 + 3 * MIN + 8_000),
    ]);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ service: 'safs', status: 'replaced', down: 2, up: 2, replaced: 2, lost: 0 });
  });

  it('최소 정상 0% — 옛 Task 가 먼저 내려가고 새 Task 가 1분 뒤에 뜬다', () => {
    task(1, { alive: false, lastAlive: T0 });
    task(2, { firstSeen: T0 + 1 * MIN });
    const b = bursts([
      alert(ALERT_OBJECT_DOWN, 1, T0 + 8_000),
      alert(ALERT_OBJECT_UP, 2, T0 + 1 * MIN),
    ]);
    expect(b[0].status).toBe('replaced');
  });

  it('남은 Task 가 그대로 살아 있으면(축소) 교체다', () => {
    task(1, { alive: false, lastAlive: T0 });
    task(2, {}); // 처음부터 있던 것
    expect(bursts([alert(ALERT_OBJECT_DOWN, 1, T0 + 8_000)])[0].status).toBe('replaced');
  });

  it('올라오기만 한 묶음(확장)도 교체 쪽이다 — 장애가 아니다', () => {
    task(5, { firstSeen: T0 });
    expect(bursts([alert(ALERT_OBJECT_UP, 5, T0)])[0]).toMatchObject({ status: 'replaced', up: 1, down: 0 });
  });
});

describe('살아 있는 Task 없음', () => {
  it('한꺼번에 내려가면 장애다 — 하트비트 몇 초 차이는 대신 받은 것이 아니다', () => {
    task(1, { alive: false, lastAlive: T0 });
    task(2, { alive: false, lastAlive: T0 + 3_000 });
    const b = bursts([
      alert(ALERT_OBJECT_DOWN, 1, T0 + 8_000),
      alert(ALERT_OBJECT_DOWN, 2, T0 + 11_000),
    ]);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ status: 'down', down: 2, replaced: 0, lost: 2, recovered: false });
  });

  it('옆 Task 가 몇 초 뒤 죽었고 그 알림은 아직 안 왔어도 장애다', () => {
    // 2 는 목록에서 이미 죽음(하트비트 3초 뒤 끊김)인데 콜렉터의 INACTIVE 알림은 판정 지연 때문에
    // 아직 안 왔다. 1 의 알림만 보고 «2 가 더 오래 살았으니 대신 받았다» 고 하면 장애가 숨는다.
    task(1, { alive: false, lastAlive: T0 });
    task(2, { alive: false, lastAlive: T0 + 3_000 });
    expect(bursts([alert(ALERT_OBJECT_DOWN, 1, T0 + 8_000)])[0].status).toBe('down');
  });

  it('차례로 내려가도 마지막 하나를 받아 줄 Task 가 없으면 장애다', () => {
    // 1 이 내려간 뒤 2 가 2분 더 살았다 — 1 만 보면 «대신 받았다» 지만 2 는 아무도 안 받았다.
    task(1, { alive: false, lastAlive: T0 });
    task(2, { alive: false, lastAlive: T0 + 2 * MIN });
    const b = bursts([
      alert(ALERT_OBJECT_DOWN, 1, T0 + 8_000),
      alert(ALERT_OBJECT_DOWN, 2, T0 + 2 * MIN + 8_000),
    ]);
    expect(b).toHaveLength(1);
    expect(b[0].status).toBe('down');
    // «내려감 2» 가 아니라 «교체 1 · 대신 받을 Task 없이 내려감 1» — 1 은 정상 교체였다
    expect(b[0]).toMatchObject({ down: 2, replaced: 1, lost: 1 });
  });

  it('교체 직후 장애 — 교체된 것과 홀로 내려간 것을 따로 센다', () => {
    // 1·2 를 3·4 가 대신 받았다(롤링 배포). 그 뒤 3·4 가 한꺼번에 내려갔다.
    task(1, { alive: false, lastAlive: T0 });
    task(2, { alive: false, lastAlive: T0 + 10_000 });
    task(3, { firstSeen: T0 - MIN, alive: false, lastAlive: T0 + 3 * MIN });
    task(4, { firstSeen: T0 - MIN, alive: false, lastAlive: T0 + 3 * MIN + 2_000 });
    const b = bursts([
      alert(ALERT_OBJECT_DOWN, 1, T0 + 8_000),
      alert(ALERT_OBJECT_DOWN, 2, T0 + 18_000),
      alert(ALERT_OBJECT_DOWN, 3, T0 + 3 * MIN + 8_000),
      alert(ALERT_OBJECT_DOWN, 4, T0 + 3 * MIN + 10_000),
    ]);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ status: 'down', down: 4, replaced: 2, lost: 2 });
  });

  it('장애 뒤 한참 있다 뜬 Task 는 대신 받은 것이 아니다 — 장애이되 복구됨', () => {
    task(1, { alive: false, lastAlive: T0 });
    task(2, { firstSeen: T0 + 4 * MIN }); // 여유(3분)를 넘겨 떴다
    const b = bursts([
      alert(ALERT_OBJECT_DOWN, 1, T0 + 8_000),
      alert(ALERT_OBJECT_UP, 2, T0 + 4 * MIN),
    ]);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ status: 'down', recovered: true });
  });

  it('대신 받을 후보는 같은 서비스여야 한다', () => {
    task(1, { alive: false, lastAlive: T0 });
    task(9, {}, 'other');
    expect(bursts([alert(ALERT_OBJECT_DOWN, 1, T0 + 8_000)])[0].status).toBe('down');
  });

  it('내려간 시각은 마지막 하트비트다 — 알림 시각(판정 지연만큼 늦다)이 아니다', () => {
    // 하트비트는 T0 에 끊겼고 콜렉터가 5분 뒤에야 알렸다(object_deadtime_ms 를 크게 둔 곳).
    // 새 Task 는 T0+4분에 떴다 — 알림 시각 기준이면 «여유 안» 이지만 실제로는 4분 동안 아무도 없었다.
    task(1, { alive: false, lastAlive: T0 });
    task(2, { firstSeen: T0 + 4 * MIN });
    expect(bursts([alert(ALERT_OBJECT_DOWN, 1, T0 + 5 * MIN)])[0].status).toBe('down');
  });
});

describe('묶는 범위', () => {
  it('띄엄띄엄 오면(5분 넘게) 다른 묶음이다', () => {
    task(1, { alive: false, lastAlive: T0 });
    task(2, { alive: false, lastAlive: T0 + 20 * MIN });
    task(3, { firstSeen: 0 });
    const b = bursts([
      alert(ALERT_OBJECT_DOWN, 1, T0 + 8_000),
      alert(ALERT_OBJECT_DOWN, 2, T0 + 20 * MIN + 8_000),
    ]);
    expect(b).toHaveLength(2);
  });

  it('서비스가 다르면 다른 묶음이다', () => {
    task(1, { alive: false, lastAlive: T0 });
    task(2, { alive: false, lastAlive: T0 }, 'order');
    expect(bursts([alert(ALERT_OBJECT_DOWN, 1, T0), alert(ALERT_OBJECT_DOWN, 2, T0)])).toHaveLength(2);
  });

  it('같은 Task 가 내렸다 올렸다 해도 Task 수로 센다', () => {
    task(1, { alive: true, firstSeen: 0 });
    task(2, {});
    const b = bursts([
      alert(ALERT_OBJECT_DOWN, 1, T0),
      alert(ALERT_OBJECT_UP, 1, T0 + 30_000),
      alert(ALERT_OBJECT_DOWN, 1, T0 + 60_000),
    ]);
    expect(b[0]).toMatchObject({ down: 1, up: 1 });
    expect(b[0].alerts).toHaveLength(3);
  });

  it('묶음 안은 최신순이고 from/to 는 처음과 끝이다', () => {
    task(1, { alive: false, lastAlive: T0 });
    task(2, {});
    const b = bursts([alert(ALERT_OBJECT_DOWN, 1, T0 + 1_000), alert(ALERT_OBJECT_UP, 2, T0 + 5_000)]);
    expect(b[0].alerts.map(a => a.time)).toEqual([T0 + 5_000, T0 + 1_000]);
    expect([b[0].from, b[0].to]).toEqual([T0 + 1_000, T0 + 5_000]);
  });
});

describe('건드리지 않는 것', () => {
  it('생명주기가 아닌 알림은 그대로 한 줄이다', () => {
    task(1, {});
    const rows = groupAlerts([alert('WARNING_CPU_HIGH', 1, T0)], history, DEFAULT_GROUP_RULE);
    expect(rows).toEqual([{ kind: 'single', alert: expect.objectContaining({ title: 'WARNING_CPU_HIGH' }) }]);
  });

  it('본 적 없는 오브젝트의 생명주기 알림은 그대로다 — 어느 서비스인지 모른다', () => {
    const rows = groupAlerts([alert(ALERT_OBJECT_DOWN, 404, T0)], history, DEFAULT_GROUP_RULE);
    expect(rows[0].kind).toBe('single');
  });

  it('서비스 규칙에 안 걸리는 이름은 그대로다', () => {
    history.set(7, {
      obj_hash: 7, obj_name: '/vm/shop-app', obj_type: 'tomcat', tags: [],
      firstSeen: 0, lastAlive: T0, alive: false,
    });
    const rows = groupAlerts([alert(ALERT_OBJECT_DOWN, 7, T0)], history, DEFAULT_GROUP_RULE);
    expect(rows[0].kind).toBe('single');
  });
});

describe('줄 순서와 배지', () => {
  it('묶음은 가장 최근 알림의 자리에 선다', () => {
    task(1, { alive: false, lastAlive: T0 });
    task(2, {});
    const cpu = alert('WARNING_CPU_HIGH', 2, T0 + 2_000);
    const rows = groupAlerts(
      newestFirst([alert(ALERT_OBJECT_DOWN, 1, T0 + 1_000), cpu, alert(ALERT_OBJECT_UP, 2, T0 + 3_000)]),
      history,
      DEFAULT_GROUP_RULE,
    );
    expect(rows.map(r => r.kind)).toEqual(['burst', 'single']);
  });

  it('교체 묶음만 배지에서 뺀다 — 장애와 다른 알림은 센다', () => {
    task(1, { alive: false, lastAlive: T0 });
    task(2, {});
    task(3, { alive: false, lastAlive: T0 }, 'order');
    const replacedDown = alert(ALERT_OBJECT_DOWN, 1, T0 + 8_000);
    const outage = alert(ALERT_OBJECT_DOWN, 3, T0 + 8_000);
    const cpu = alert('WARNING_CPU_HIGH', 2, T0);
    const rows = groupAlerts(newestFirst([replacedDown, outage, cpu]), history, DEFAULT_GROUP_RULE);
    const quiet = quietAlerts(rows);
    expect(quiet.has(replacedDown)).toBe(true);
    expect(quiet.has(outage)).toBe(false);
    expect(quiet.has(cpu)).toBe(false);
  });
});
