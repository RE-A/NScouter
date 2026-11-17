// src/features/xlog/store/XLogDataStore.ts
// 시간 윈도우 기반 XLog 데이터 관리

import type { SXLog } from '../types/xlog';
import { serverNow } from '../utils/serverClock';

/**
 * 점 상한 **기본값** — **앱 전체 예산**이다(판 여럿이 나눠 쓴다, 아래 `enforceBudget`). 설정에서 바꾼다.
 *
 * 예전에는 탭(판)마다 10만씩 따로 들었다. 판이 16개까지 늘면 따로 드는 방식은 메모리를 예측할 수 없어서
 * 앱 전체 하나로 바꾸고 기본을 100만(≈370MB)으로 올렸다. 저장소 하나가 혼자 예산 전부를 쓸 수도 있다.
 *
 * (아래는 탭마다 상한일 때 적은 것이다 — 건당 크기·실측은 그대로 맞다)
 *
 * 창(1~30분)이 진짜 경계이고 이 값은 메모리가 끝없이 늘지 않게 하는 마지막 빗장이다.
 * 기본을 10만으로 두는 이유는 **메모리**다 — 10만이 약 37MB, 100만이 약 371MB 다.
 * 대부분의 환경에서 10만이면 5분 창을 333 TPS 까지 담는다.
 *
 * 다만 트래픽이 크고 창이 넓으면(30분이면 55 TPS 만 넘어도) 이 값이 창보다 먼저 걸려,
 * 창은 30분인데 화면에는 그보다 짧은 구간만 남는다 — 현장에서 «중간 넘어가면 뒷부분이
 * 갑자기 날아간다» 고 한 것이 이것이다. 그때는 **설정에서 올린다.**
 * 걸리고 있다는 것은 차트가 말해 준다(조용히 버리지 않는다).
 *
 * 30만 건 실측(jsdom, 이 저장소 기준): prune 1.0ms · heap 113MB.
 * 그리기는 10만 건에 2.1ms 였으므로(perf-baseline) 몇 배로도 프레임 안에 든다 —
 * 올릴 때 걸리는 것은 시간이 아니라 메모리다.
 */
export const DEFAULT_MAX_ITEMS = 1_000_000;

/**
 * 설정에서 받을 수 있는 범위.
 *
 * 아래는 «상한이 창보다 먼저 걸려도 쓸모는 있는» 최소, 위는 이 앱이 지고 갈 만한 메모리의 끝이다
 * (100만 ≈ 370MB 추정 — 30만에서 잰 건당 크기로 늘린 값이다).
 * 설정 파일은 사람이 여는 곳이라 **읽는 쪽에서 자른다.**
 */
export const MIN_MAX_ITEMS = 100_000;
/** 300만 ≈ 1.1GB — 고를 때 화면이 경고한다 */
export const LIMIT_MAX_ITEMS = 3_000_000;

/** 설정에서 온 값을 쓸 수 있는 수로 다듬는다 */
export function clampMaxItems(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_ITEMS;
  return Math.min(Math.max(Math.round(n), MIN_MAX_ITEMS), LIMIT_MAX_ITEMS);
}

export class XLogDataStore {
  private items: SXLog[] = [];
  private maxItems: number;
  private dirty = false;
  private lastReceived: number | null = null;
  private skewMs: number | null = null;
  private droppedByCap = 0;
  private lastDropAt: number | null = null;
  /** 과거 데이터를 섞어 담았는가. 담았으면 배열이 시간순이 아니다 (`addHistory`) */
  private hasHistory = false;

  constructor(maxItems: number = DEFAULT_MAX_ITEMS) {
    this.maxItems = clampMaxItems(maxItems);
  }

  /** 지금 걸려 있는 상한. 화면이 «얼마에서 잘렸는지» 를 말할 때 쓴다 */
  get maxItemCount(): number {
    return this.maxItems;
  }

  /**
   * 상한을 바꾼다. 설정에서 바로 반영하려고 둔다 — 저장소를 새로 만들면
   * **지금까지 받아 둔 점이 통째로 사라진다.**
   *
   * 줄이면 다음 prune 에서 잘리고, 늘리면 그때부터 더 담는다. 이미 버린 것은 안 돌아온다.
   */
  setMaxItems(v: number): void {
    this.maxItems = clampMaxItems(v);
  }

  /**
   * 마지막으로 데이터를 실제 수신한 시각(epoch ms). 한 번도 없으면 null.
   *
   * 화면이 비었을 때 **고장인지 데이터가 없는 건지** 구분하는 근거다.
   * `prune` 으로 항목이 0이 되어도 이 값은 유지된다 — "받은 적은 있다"가 중요하다.
   */
  get lastReceivedAt(): number | null {
    return this.lastReceived;
  }

  /**
   * 콜렉터가 준 시각과 이 PC 시각의 차(ms). 한 번도 못 받았으면 null.
   *
   * **양수면 데이터가 «미래»에서 온다.** 차트의 오른쪽 끝은 이 PC 의 «지금» 이므로,
   * 그만큼 앞선 점은 창 밖에 놓여 **그려지지 않는다** — 스트림은 멀쩡한데 화면에서만
   * 사라진 것처럼 보인다. 음수면 반대로 오른쪽이 비어 보인다.
   * 두 서버의 시계가 몇 분씩 어긋난 환경에서 실제로 일어난다.
   */
  get clockSkewMs(): number | null {
    return this.skewMs;
  }

  /** 시계 차를 잊는다 — 창 끝을 데이터에 맞춘 직후. 다음 묶음이 새 기준으로 다시 잰다 */
  resetClockSkew(): void {
    this.skewMs = null;
  }

  // 받은 시각은 **콜렉터 시계**다(serverNow) — 시계 차를 «PC 시계 탓» 이 아닌 것만 재려고
  add(xlog: SXLog, receivedAt: number = serverNow()): void {
    this.items.push(xlog);
    this.dirty = true;
    this.lastReceived = receivedAt;
    this.skewMs = xlog.endTime - receivedAt;
  }

  addBatch(xlogs: SXLog[], receivedAt: number = serverNow()): void {
    let newest = 0;
    for (const x of xlogs) {
      this.items.push(x);
      if (x.endTime > newest) newest = x.endTime;
    }
    if (xlogs.length > 0) {
      this.dirty = true;
      this.lastReceived = receivedAt;
      // 한 묶음에서 **가장 최근 것**으로 잰다. 오래된 것이 섞여 와도 시계 차가 아니다.
      this.skewMs = newest - receivedAt;
    }
    // 받을 때도 예산을 본다 — 정리(prune)는 5초마다라, 판이 많고 바쁘면 그 사이에 예산을 한참 넘긴다
    this.checkBudget(receivedAt);
  }

  /** 등록된 저장소면 잠깐에 한 번 앱 전체 예산을 본다 (`enforceBudget`) */
  private checkBudget(now: number): void {
    if (live.has(this) && now - lastEnforceAt >= ENFORCE_EVERY_MS) {
      lastEnforceAt = now;
      enforceBudget(now);
    }
  }

  /** 가장 이른·늦은 시각. 시간순이면 양 끝만 본다(과거를 섞었으면 훑는다). 비었으면 null */
  timeBounds(): [number, number] | null {
    const n = this.items.length;
    if (n === 0) return null;
    if (!this.hasHistory) return [this.items[0].endTime, this.items[n - 1].endTime];
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const x of this.items) {
      if (x.endTime < lo) lo = x.endTime;
      if (x.endTime > hi) hi = x.endTime;
    }
    return [lo, hi];
  }

  /**
   * **화면 왼쪽의 빈 구간을 메우려고 뒤늦게 받아 온 과거 XLog.**
   *
   * `addBatch` 와 두 가지가 다르다:
   *   · 수신 시각을 갱신하지 않는다 — 이건 «방금 들어온 것» 이 아니다.
   *     여기서 갱신하면 스트림이 끊겼는데도 «수신 중» 으로 보인다
   *   · 시계 차를 재지 않는다 — 30분 전 데이터로 재면 «30분 뒤처짐» 이 되어
   *     엉뚱한 경고가 뜬다
   *
   * 담기는 자리는 배열 **뒤**다. 시간순으로는 앞이지만, 페이지가 오래된 것부터
   * 오므로 앞에 밀어 넣으면 페이지끼리 순서가 뒤집힌다. 대신 `prune` 에게
   * «앞부분만 보면 안 된다» 고 알린다.
   */
  addHistory(xlogs: SXLog[]): void {
    if (xlogs.length === 0) return;
    for (const x of xlogs) this.items.push(x);
    this.hasHistory = true;
    this.dirty = true;
  }

  /** 시간 윈도우 밖 데이터 제거 + 상한 초과 시 오래된 항목 제거 */
  prune(now: number, timeRangeMs: number): void {
    const cutoff = now - timeRangeMs;
    const before = this.items.length;

    if (this.hasHistory) {
      // **과거를 뒤에 붙였으므로 앞부분만 보면 안 된다.** 앞이 최신이면 스캔이 0에서
      // 멈춰, 뒤에 있는 창 밖 데이터가 한 창(최대 30분) 내내 남는다 —
      // 그리지도 않을 것이 상한만 잡아먹는다.
      // 훑는 것은 싸다(30만 건 1ms). 버릴 게 없으면 새 배열도 만들지 않는다.
      if (this.items.some(x => x.endTime < cutoff)) {
        this.items = this.items.filter(x => x.endTime >= cutoff);
      }
    } else {
      // 시간 기준 필터 (items는 endTime 순으로 추가되므로 앞부분 제거)
      let i = 0;
      while (i < this.items.length && this.items[i].endTime < cutoff) i++;
      if (i > 0) {
        this.items = this.items.slice(i);
      }
    }

    // MAX_ITEMS 초과 시 앞부분 제거.
    // **조용히 버리면 안 된다.** 창 안에 있어야 할 점이 사라지는 것이라,
    // 화면이 말해 주지 않으면 «데이터가 유실된다» 로 읽힌다.
    if (this.items.length > this.maxItems) {
      const drop = this.items.length - this.maxItems;
      this.items = this.items.slice(drop);
      this.droppedByCap += drop;
      this.lastDropAt = now;
    }

    if (this.items.length !== before) this.dirty = true;

    // 앱 전체 예산 — 등록된 저장소만, 잠깐에 한 번
    this.checkBudget(now);
  }

  /**
   * 앱 전체 예산에 넣는다 — 화면에 떠 있는 차트의 저장소만. `useRef(new XLogDataStore())` 는 그릴 때마다
   * 새 것을 만들었다 버리므로 **생성자에서 넣지 않는다** — 훅이 효과에서 넣고 뺀다.
   */
  register(): void {
    live.add(this);
  }

  unregister(): void {
    live.delete(this);
  }

  /** `t` 이후(포함) 점 수. 시간순이면 이분 탐색, 과거를 섞어 담았으면 훑는다 */
  countSince(t: number): number {
    if (this.hasHistory) {
      let n = 0;
      for (const x of this.items) if (x.endTime >= t) n++;
      return n;
    }
    return this.items.length - firstAtOrAfter(this.items, t);
  }

  /** `t` 보다 오래된 점을 버린다 — 예산 때문에 버린 것으로 센다(화면이 «상한에 걸려 버림» 을 말한다) */
  dropBefore(t: number, now: number): void {
    const before = this.items.length;
    if (this.hasHistory) this.items = this.items.filter(x => x.endTime >= t);
    else {
      const i = firstAtOrAfter(this.items, t);
      if (i > 0) this.items = this.items.slice(i);
    }
    const dropped = before - this.items.length;
    if (dropped > 0) {
      this.droppedByCap += dropped;
      this.lastDropAt = now;
      this.dirty = true;
    }
  }

  /** 상한 때문에 버린 누적 건수. 창 밖으로 나가 지운 것은 세지 않는다 */
  get droppedCount(): number {
    return this.droppedByCap;
  }

  /** 마지막으로 상한에 걸린 시각. 한 번도 없으면 null */
  get lastDropAtMs(): number | null {
    return this.lastDropAt;
  }

  /**
   * 갖고 있는 것 중 **가장 오래된 시각.** 비었으면 null.
   *
   * 실시간 화면의 왼쪽을 얼마나 채워야 하는지가 이 값이다 — «어디까지 받았다» 를 따로
   * 기억하면 그 기억과 저장소가 어긋난다(창을 좁히면 prune 이 지우고, 과거 모드를
   * 다녀오면 기억만 초기화된다). **저장소에 있는 것이 곧 갖고 있는 것이다.**
   *
   * 전부 훑는다. 과거를 섞어 담으면(`addHistory`) 앞이 가장 오래된 것이라는 보장이
   * 없기 때문이다. 계획을 세울 때만 부르므로 30만 건이어도 1ms 다.
   */
  get oldestEndTime(): number | null {
    let oldest: number | null = null;
    for (const x of this.items) {
      if (oldest === null || x.endTime < oldest) oldest = x.endTime;
    }
    return oldest;
  }

  /**
   * **고른 서버들만 놓고 봤을 때** 가장 오래된 시각. 하나도 없으면 null.
   *
   * 서버를 새로 고르면 스트림이 다시 열리면서 그 서버의 최근 것을 한 묶음 준다.
   * 그걸 모르고 창 전체를 다시 받으면 겹친다 — 새 서버의 경계는 **그 서버의**
   * 가장 오래된 점이지, 저장소 전체의 것이 아니다(다른 서버 것이라 상관이 없다).
   */
  oldestEndTimeOf(hashes: ReadonlySet<number>): number | null {
    let oldest: number | null = null;
    for (const x of this.items) {
      if (!hashes.has(x.objHash)) continue;
      if (oldest === null || x.endTime < oldest) oldest = x.endTime;
    }
    return oldest;
  }

  getAll(): SXLog[] {
    return this.items;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  clearDirty(): void {
    this.dirty = false;
  }

  clear(): void {
    this.items = [];
    this.dirty = true;
    this.hasHistory = false;
  }

  get size(): number {
    return this.items.length;
  }
}

// ─── 앱 전체 점 예산 ──────────────────────────────────────────
//
// 판 여럿(최대 16)이 **예산 하나를 나눠 쓴다.** 넘치면 **판 상관없이 가장 오래된 점부터** 버린다 —
// 기준 시각 하나를 찾아 모든 저장소에서 그보다 오래된 것을 버린다. 그러면 모든 실시간 판이 «같은 최근 N분» 을
// 들게 되어 판끼리 견주기 쉽고, 한가한 판이 몫을 쥔 채 놀지 않는다. 판이 늘면 그 N분이 준다.

/** 화면에 떠 있는 저장소들 */
const live = new Set<XLogDataStore>();
let budget = DEFAULT_MAX_ITEMS;
let lastEnforceAt = Number.NEGATIVE_INFINITY;
/** 예산을 보는 간격 — 판마다 매 프레임 볼 일은 아니다 */
const ENFORCE_EVERY_MS = 500;

/** 예산을 정한다 (설정 «XLog 점 예산») */
export function setPointBudget(n: number): void {
  budget = clampMaxItems(n);
  lastEnforceAt = Number.NEGATIVE_INFINITY;
}

export function pointBudget(): number {
  return budget;
}

/** 등록된 저장소 전부의 점 수 */
export function livePointCount(): number {
  let n = 0;
  for (const s of live) n += s.size;
  return n;
}

/** 시간순 배열에서 `endTime >= t` 인 첫 자리 */
function firstAtOrAfter(items: readonly SXLog[], t: number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].endTime < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 예산을 넘었으면 기준 시각을 찾아 그보다 오래된 점을 모든 저장소에서 버린다. 버린 기준 시각(넘지 않았으면 null).
 *
 * 기준 시각은 **이분 탐색**으로 찾는다 — «그 시각 이후 점 수 ≤ 예산» 인 가장 이른 시각.
 * 저장소마다 이분 탐색이라(과거를 섞은 것만 훑는다) 100만 건이어도 몇 밀리초다.
 */
export function enforceBudget(now: number): number | null {
  let total = 0;
  let oldest = Number.POSITIVE_INFINITY;
  let newest = Number.NEGATIVE_INFINITY;
  for (const s of live) {
    total += s.size;
    const b = s.timeBounds();
    if (b === null) continue;
    if (b[0] < oldest) oldest = b[0];
    if (b[1] > newest) newest = b[1];
  }
  if (total <= budget || !Number.isFinite(oldest)) return null;
  const count = (t: number) => {
    let n = 0;
    for (const s of live) n += s.countSince(t);
    return n;
  };
  let lo = oldest; // count(lo) = total > budget
  let hi = newest + 1; // count(hi) = 0 ≤ budget
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (count(mid) > budget) lo = mid;
    else hi = mid;
  }
  for (const s of live) s.dropBefore(hi, now);
  return hi;
}

