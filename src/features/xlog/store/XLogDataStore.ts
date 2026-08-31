// src/features/xlog/store/XLogDataStore.ts
// 시간 윈도우 기반 XLog 데이터 관리

import type { SXLog } from '../types/xlog';

/**
 * 버퍼 상한. 넘으면 **오래된 것부터** 버린다.
 *
 * 창(1~30분)이 진짜 경계이고 이 값은 메모리가 끝없이 늘지 않게 하는 마지막 빗장이다.
 * 100,000 이던 것을 올렸다 — 5분 창이면 333 TPS, 30분 창이면 **55 TPS 만 넘어도**
 * 상한이 먼저 걸려서, 창은 30분인데 화면에는 그보다 짧은 구간만 남았다.
 * 현장에서 «중간 넘어가면 뒷부분이 갑자기 날아간다» 고 한 것이 이것이다.
 *
 * 30만 건 실측(jsdom, 이 저장소 기준): prune 1.0ms · heap 113MB.
 * 그리기는 10만 건에 2.1ms 였으므로(perf-baseline) 3배로도 프레임 안에 든다.
 * 메모리가 비용이라 무한정 올리지는 않는다 — 대신 **버릴 때 화면에 말한다.**
 */
export const MAX_ITEMS = 300_000;

export class XLogDataStore {
  private items: SXLog[] = [];
  private dirty = false;
  private lastReceived: number | null = null;
  private skewMs: number | null = null;
  private droppedByCap = 0;
  private lastDropAt: number | null = null;

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

  add(xlog: SXLog, receivedAt: number = Date.now()): void {
    this.items.push(xlog);
    this.dirty = true;
    this.lastReceived = receivedAt;
    this.skewMs = xlog.endTime - receivedAt;
  }

  addBatch(xlogs: SXLog[], receivedAt: number = Date.now()): void {
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
  }

  /** 시간 윈도우 밖 데이터 제거 + MAX_ITEMS 초과 시 오래된 항목 제거 */
  prune(now: number, timeRangeMs: number): void {
    const cutoff = now - timeRangeMs;
    const before = this.items.length;

    // 시간 기준 필터 (items는 endTime 순으로 추가되므로 앞부분 제거)
    let i = 0;
    while (i < this.items.length && this.items[i].endTime < cutoff) i++;
    if (i > 0) {
      this.items = this.items.slice(i);
    }

    // MAX_ITEMS 초과 시 앞부분 제거.
    // **조용히 버리면 안 된다.** 창 안에 있어야 할 점이 사라지는 것이라,
    // 화면이 말해 주지 않으면 «데이터가 유실된다» 로 읽힌다.
    if (this.items.length > MAX_ITEMS) {
      const drop = this.items.length - MAX_ITEMS;
      this.items = this.items.slice(drop);
      this.droppedByCap += drop;
      this.lastDropAt = now;
    }

    if (this.items.length !== before) this.dirty = true;
  }

  /** 상한 때문에 버린 누적 건수. 창 밖으로 나가 지운 것은 세지 않는다 */
  get droppedCount(): number {
    return this.droppedByCap;
  }

  /** 마지막으로 상한에 걸린 시각. 한 번도 없으면 null */
  get lastDropAtMs(): number | null {
    return this.lastDropAt;
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
  }

  get size(): number {
    return this.items.length;
  }
}
