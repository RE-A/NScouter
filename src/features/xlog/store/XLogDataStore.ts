// src/features/xlog/store/XLogDataStore.ts
// 시간 윈도우 기반 XLog 데이터 관리

import type { SXLog } from '../types/xlog';

const MAX_ITEMS = 100_000;

export class XLogDataStore {
  private items: SXLog[] = [];
  private dirty = false;
  private lastReceived: number | null = null;
  private skewMs: number | null = null;

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

    // MAX_ITEMS 초과 시 앞부분 제거
    if (this.items.length > MAX_ITEMS) {
      this.items = this.items.slice(this.items.length - MAX_ITEMS);
    }

    if (this.items.length !== before) this.dirty = true;
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
