// Active 탭의 계산 (순수 로직)
//
// 이 화면이 답하는 질문은 하나다 — **«지금 안 끝나고 있는 게 뭐고, 무엇 때문인가».**
//
// 재료는 `OBJECT_ACTIVE_SERVICE_LIST` 한 벌이다. 실측으로 확인한 성격 두 가지가
// 화면 설계를 거의 결정한다:
//
//   1. **순간 스냅샷이다.** 5초·44표본에서 `sql`/`subcall` 이 차 있던 것은 7건뿐이었다.
//      빠른 쿼리는 거의 안 잡힌다. 뒤집으면 **느린 것은 잘 잡힌다** — 그래서 목록은
//      느린 것부터 놓고, 「전부 보여준다」고 말하지 않는다.
//   2. **목록에는 바인드 값이 없다** (`where product_id=?`). 쿼리는 **문장 단위**로만
//      묶을 수 있다. 같은 문장이 여러 건이면 그게 곧 «이 쿼리에 N건 매달림» 이다.
//      (값 자체는 스레드 상세의 `SQLActiveBindVar` 로 온다 — 쿼리 상세 창이 묻는다.)
//
// 구간은 **기존 액티브 막대(`activeSpeed.ts`)와 같은 3단계**를 쓴다. 한 앱에서
// 같은 것을 두 가지로 나누면 «3초 이상이 왜 저기선 5건 여기선 3건인가» 가 된다.

import type { ActiveService } from '../xlog/types/object';

/** 1 = 1초 미만, 2 = 1~3초, 3 = 3초 이상 (`activeSpeed.ts` 의 SpeedStep 과 같은 경계) */
export type SpeedStep = 1 | 2 | 3;

const STEP2_MS = 1_000;
const STEP3_MS = 3_000;

export function stepOf(elapsedMs: number): SpeedStep {
  if (elapsedMs >= STEP3_MS) return 3;
  if (elapsedMs >= STEP2_MS) return 2;
  return 1;
}

/** 단계별 건수. 0인 단계도 자리를 지킨다 — 칸이 사라지면 «줄었다» 가 «없다» 로 읽힌다 */
export interface StepCounts {
  step1: number;
  step2: number;
  step3: number;
  total: number;
  /** 가장 오래 붙들고 있는 것. 3단계는 3초와 60초를 같이 담으므로 따로 적는다 */
  maxElapsed: number;
}

export function stepCounts(rows: readonly ActiveService[]): StepCounts {
  const c: StepCounts = { step1: 0, step2: 0, step3: 0, total: rows.length, maxElapsed: 0 };
  for (const r of rows) {
    if (r.elapsed > c.maxElapsed) c.maxElapsed = r.elapsed;
    const s = stepOf(r.elapsed);
    if (s === 1) c.step1 += 1;
    else if (s === 2) c.step2 += 1;
    else c.step3 += 1;
  }
  return c;
}

// ─── 무엇을 붙들고 있나 ────────────────────────────────────────

/**
 * 지금 이 트랜잭션이 기다리고 있는 것.
 *
 * `sql` 과 `subcall` 이 **둘 다 찰 수 있다** (쿼리 도중 외부 호출을 하지는 않지만,
 * 에이전트가 직전 값을 남겨 두는 경우가 있다). 그때는 `sql` 을 먼저 본다 — DB 가
 * 더 흔한 병목이고, 둘을 합쳐 「기타」로 몰면 묶음 자체가 쓸모없어진다.
 */
export type ResourceKind = 'sql' | 'api' | 'cpu';

export interface Resource {
  kind: ResourceKind;
  /** 묶음 키. 같은 문장·같은 대상이면 같은 키다 */
  key: string;
  /** 화면에 적을 것. `cpu` 는 기다리는 대상이 없으므로 빈 문자열 */
  label: string;
}

/**
 * 종류 이름.
 *
 * **`t()` 에 변수로 넘어간다.** 소스에 리터럴이 안 남아 사전 스캔이 못 잡으므로,
 * 순수 모듈에 두고 `coverage.test.ts` 가 직접 본다 (SHORTCUT_LABEL 과 같은 이유).
 */
export const KIND_LABEL: Record<ResourceKind, string> = {
  sql: 'DB 쿼리',
  api: '외부 호출',
  cpu: '제 코드',
};

/** 기다리는 대상이 없는 행의 묶음 키. 실제 리소스 이름과 겹치지 않게 접두사를 둔다 */
export const NO_RESOURCE_KEY = 'cpu:';

export function resourceOf(row: ActiveService): Resource {
  const sql = row.sql.trim();
  if (sql !== '') return { kind: 'sql', key: `sql:${sql}`, label: sql };
  const api = row.subcall.trim();
  if (api !== '') return { kind: 'api', key: `api:${api}`, label: api };
  // 쿼리도 외부 호출도 아니면 제 코드를 돌고 있거나(RUNNABLE) 잠들어 있다.
  // **«없음» 이 아니라 하나의 묶음이다** — 여기 몰려 있으면 그것도 답이다.
  return { kind: 'cpu', key: NO_RESOURCE_KEY, label: '' };
}

export interface ResourceGroup extends Resource {
  count: number;
  /** 이 묶음에서 가장 오래된 것. 묶음을 정렬하는 기준이다 */
  maxElapsed: number;
}

/**
 * 리소스로 묶는다. **건수가 아니라 가장 오래된 것으로 정렬한다.**
 *
 * 건수로 세우면 1초짜리 100건이 8초짜리 1건을 밀어낸다. 이 화면을 여는 이유는
 * 뒤쪽이다 — 많이 도는 것이 아니라 **안 끝나는 것**을 찾으러 온다.
 * 같으면 건수, 그것도 같으면 이름순으로 고정한다 (2초마다 순서가 춤추면 못 읽는다).
 */
export function groupByResource(rows: readonly ActiveService[]): ResourceGroup[] {
  const map = new Map<string, ResourceGroup>();
  for (const row of rows) {
    const r = resourceOf(row);
    const got = map.get(r.key);
    if (got) {
      got.count += 1;
      if (row.elapsed > got.maxElapsed) got.maxElapsed = row.elapsed;
    } else {
      map.set(r.key, { ...r, count: 1, maxElapsed: row.elapsed });
    }
  }
  return [...map.values()].sort(
    (a, b) => b.maxElapsed - a.maxElapsed || b.count - a.count || a.key.localeCompare(b.key),
  );
}

// ─── 같은 것을 얼마나 붙들고 있나 ──────────────────────────────
//
// `elapsed` 는 **트랜잭션이 시작된 뒤**의 시간이다. «3초 걸리는 중» 은 알려주지만
// «3초 내내 같은 쿼리에 매달려 있었나, 방금 그 쿼리로 넘어왔나» 는 말해 주지 않는다.
// 둘은 완전히 다른 이야기라(앞은 그 쿼리가 범인, 뒤는 아니다) 폴링 사이에 이어 붙인다.

export interface Hold {
  /** 이 트랜잭션이 붙들고 있는 리소스 */
  resourceKey: string;
  /** 그 리소스를 잡은 것으로 **처음 본** 시각 */
  since: number;
}

/**
 * 이번 응답으로 추적표를 갱신한다.
 *
 * - 처음 보는 트랜잭션이면 지금부터 센다.
 * - 리소스가 바뀌었으면 **다시 센다** — 다른 쿼리로 넘어간 것을 «계속 붙들려 있다» 고
 *   적으면 범인을 잘못 지목한다.
 * - 목록에서 사라진 것은 버린다. 안 버리면 하루 종일 도는 화면에서 표가 무한정 자란다.
 *
 * `txid` 가 없는 행은 추적하지 않는다. 다음 응답의 어느 행과 같은 것인지 말할 수 없다.
 */
export function advanceHolds(
  prev: ReadonlyMap<string, Hold>,
  rows: readonly ActiveService[],
  now: number,
): Map<string, Hold> {
  const next = new Map<string, Hold>();
  for (const row of rows) {
    if (row.txid === null) continue;
    const key = resourceOf(row).key;
    const was = prev.get(row.txid);
    next.set(row.txid, was && was.resourceKey === key ? was : { resourceKey: key, since: now });
  }
  return next;
}

/**
 * 같은 리소스를 붙들고 있은 시간.
 *
 * 처음 본 순간은 `0` 이다 — `null` 이 아니다. «아직 모른다» 와 «방금 시작했다» 는
 * 다르고, 이 함수가 0을 주는 쪽은 뒤가 아니라 **앞**이므로 화면에서 가려야 한다.
 * 그래서 처음 본 행은 `null` 로 돌려준다 (`since === now`).
 */
export function heldMs(
  holds: ReadonlyMap<string, Hold>,
  row: ActiveService,
  now: number,
): number | null {
  if (row.txid === null) return null;
  const hold = holds.get(row.txid);
  if (!hold) return null;
  const ms = now - hold.since;
  return ms > 0 ? ms : null;
}

// ─── 목록 ──────────────────────────────────────────────────────

/** 느린 것부터. 같으면 서버·스레드로 고정한다 — 순서가 흔들리면 누를 수가 없다 */
export function sortRows(rows: readonly ActiveService[]): ActiveService[] {
  return [...rows].sort(
    (a, b) => b.elapsed - a.elapsed || a.obj_hash - b.obj_hash || a.id - b.id,
  );
}

/** 목록의 한 줄을 가리키는 키. txid 가 없어도 흔들리지 않아야 한다 */
export function rowKey(row: ActiveService): string {
  return `${row.obj_hash}:${row.id}:${row.txid ?? row.service}`;
}

/**
 * 찾기 — 서비스·쿼리·외부 호출·스레드 이름·IP 를 가로지른다.
 *
 * 장애 중에 치는 말은 «order» 하나다. 그게 서비스명인지 호출 대상인지 테이블
 * 이름인지 미리 정해 두게 하면 한 번 더 헛치게 된다.
 */
export function matchesRow(row: ActiveService, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return (
    row.service.toLowerCase().includes(q) ||
    row.sql.toLowerCase().includes(q) ||
    row.subcall.toLowerCase().includes(q) ||
    row.name.toLowerCase().includes(q) ||
    row.ip.toLowerCase().includes(q)
  );
}

/** 막대가 차지할 비율(%). 가장 오래된 것을 100 으로 둔다 */
export function elapsedPct(elapsedMs: number, maxMs: number): number {
  if (maxMs <= 0) return 0;
  const pct = (elapsedMs / maxMs) * 100;
  // 0.4초짜리가 8초짜리 옆에 있으면 5% 라 막대가 사라진다. 있다는 것은 보여야 한다.
  return Math.max(2, Math.min(100, pct));
}

// ─── 시간 표기 ─────────────────────────────────────────────────

/**
 * 경과 시간을 읽을 수 있게.
 *
 * 앱의 다른 곳은 `1,234ms` 로 적는다. 거기서는 대부분이 1초 미만이라 그게 맞는데,
 * **이 화면은 안 끝나는 것을 모아 놓은 자리다.** 5분째 붙들린 트랜잭션이
 * `300,000ms` 로 뜨면 자릿수를 세어야 «5분» 이 나온다 — 장애 중에 할 일이 아니다.
 * 그래서 여기서만 단위를 올린다. 1초 미만은 그대로 ms 로 둔다.
 */
export function formatElapsed(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}초`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1_000);
  return `${min}분 ${String(sec).padStart(2, '0')}초`;
}

// ─── 못 닿은 서버 ──────────────────────────────────────────────
//
// **갱신마다 떴다 사라졌다 하던 이유가 둘이다.** 처음에는 하나만 막고 고쳤다고 했는데
// 아니었다.
//
//   1. **콜렉터가 에이전트 연결을 못 얻었다.** 에이전트가 열어 둔 TCP 연결을 꺼내 쓰는데
//      `net_tcp_get_agent_connection_wait_ms`(기본 1초) 안에 못 얻으면 `S501` 을 남기고
//      **objHash 만 든 빈 팩**을 보낸다.
//   2. **콜렉터가 아예 묻지 않았다.** 하트비트(UDP)가 `object_deadtime_ms`(기본 8초) 안에
//      안 오면 그 오브젝트를 «살아 있지 않다» 로 보고 조회 대상에서 뺀다
//      (코드: `AgentManager.getLiveObjHashList` 는 `alive` 인 것만 돌려준다).
//      이때는 **팩이 아예 없다** — 빈 팩조차 없어서 1번의 신호로는 잡히지 않는다.
//
// 둘 다 «못 물어본 것» 이지 «한가한 것» 이 아니다. 그 순간 행을 지우면 «끝났다» 로 읽힌다.
// 그래서 직전 값을 **지난 값이라고 표시해** 잠깐 이어 보여준다. 다만 끝없이 이어 붙이면
// 죽은 서버의 옛 트랜잭션이 영원히 «실행 중» 으로 남으므로 시간을 둔다.

/**
 * 지난 값을 이어 보여줄 시간.
 *
 * **횟수가 아니라 시간이다.** 폴링 주기를 1·2·5초 중에 고를 수 있어서, 횟수로 재면
 * 같은 화면이 주기마다 다르게 움직인다. 하트비트가 끊긴 것으로 판정되는 데 기본 8초가
 * 걸리므로(`object_deadtime_ms`), 그보다 넉넉히 두어 한 번의 출렁임을 덮는다.
 */
export const CARRY_MS = 15_000;

/** 왜 못 받았나 */
export type MissKind =
  /** 빈 팩이 왔다 — 콜렉터가 에이전트 연결을 제때 못 얻음 */
  | 'empty'
  /** 팩이 아예 없다 — 콜렉터가 살아 있지 않다고 보고 묻지 않음 */
  | 'silent';

export interface CarryState {
  /** 오브젝트별로 마지막에 **실제로 받은** 행과 그 시각 */
  lastRows: ReadonlyMap<number, { rows: readonly ActiveService[]; at: number }>;
}

export const EMPTY_CARRY: CarryState = { lastRows: new Map() };

export interface CarryInput {
  /** 이번에 받은 행 전부 */
  fresh: readonly ActiveService[];
  /** 팩을 하나라도 돌려준 오브젝트 */
  answered: readonly number[];
  /** 그중 빈 팩이던 오브젝트 */
  empty: readonly number[];
  /** 물었어야 할 오브젝트 — 여기 있는데 답이 없으면 «묻지도 않았다» 다 */
  expected: readonly number[];
  now: number;
}

export interface CarryResult {
  /** 화면에 놓을 행 — 이번에 받은 것 + 이어 붙인 지난 값 */
  rows: ActiveService[];
  /** 지난 값을 보여주고 있는 서버 */
  stale: ReadonlySet<number>;
  /** 이번에 못 받은 서버와 그 이유 (지난 값이 있든 없든) */
  missed: ReadonlyMap<number, MissKind>;
  next: CarryState;
}

/**
 * 이번 응답과 직전 상태를 합친다.
 *
 * **«답했다» 의 기준은 팩이 왔는가다.** 행이 있는가로 가르면 한가해진 서버의 옛 행이
 * 영영 안 지워진다 — 0건인 서버는 행으로 드러나지 않기 때문이다.
 */
export function carryUnreached(prev: CarryState, input: CarryInput): CarryResult {
  const { fresh, answered, empty, expected, now } = input;
  const answeredSet = new Set(answered);

  const missed = new Map<number, MissKind>();
  for (const h of empty) missed.set(h, 'empty');
  for (const h of expected) {
    if (!answeredSet.has(h)) missed.set(h, 'silent');
  }

  const byHash = new Map<number, ActiveService[]>();
  for (const r of fresh) {
    if (missed.has(r.obj_hash)) continue;
    const list = byHash.get(r.obj_hash);
    if (list) list.push(r);
    else byHash.set(r.obj_hash, [r]);
  }

  const lastRows = new Map<number, { rows: readonly ActiveService[]; at: number }>();
  const rows: ActiveService[] = [];
  const stale = new Set<number>();

  // 답한 서버 — 받은 그대로. 행이 하나도 없어도 «한가하다» 로 기록한다.
  for (const h of answeredSet) {
    if (missed.get(h) === 'empty') continue;
    const list = byHash.get(h) ?? [];
    lastRows.set(h, { rows: list, at: now });
    rows.push(...list);
  }

  // 못 받은 서버 — 아직 시간 안이면 지난 값을 이어 붙인다.
  for (const h of missed.keys()) {
    const last = prev.lastRows.get(h);
    if (!last || last.rows.length === 0 || now - last.at > CARRY_MS) continue;
    lastRows.set(h, last);
    rows.push(...last.rows);
    stale.add(h);
  }

  return { rows, stale, missed, next: { lastRows } };
}
