// src/features/xlog/store/XLogDataStore.ts
// 시간 윈도우 기반 XLog 데이터 관리

import type { SXLog } from '../types/xlog';

const MAX_ITEMS = 100_000;

export class XLogDataStore {
  private items: SXLog[] = [];
  private dirty = false;

  add(xlog: SXLog): void {
    this.items.push(xlog);
    this.dirty = true;
  }

  addBatch(xlogs: SXLog[]): void {
    for (const x of xlogs) this.items.push(x);
    if (xlogs.length > 0) this.dirty = true;
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
