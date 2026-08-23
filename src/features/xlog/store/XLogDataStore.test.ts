// src/features/xlog/store/XLogDataStore.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { XLogDataStore } from './XLogDataStore';
import type { SXLog } from '../types/xlog';

function makeSXLog(endTime: number, elapsed: number = 100): SXLog {
  return {
    txid: String(endTime),
    gxid: '0',
    caller: '0',
    endTime,
    elapsed,
    objHash: 1001,
    service: 0,
    error: 0,
    xType: 0,
    cpu: 10,
    sqlCount: 0,
    sqlTime: 0,
    apiCallCount: 0,
    apiCallTime: 0,
    ipAddr: '127.0.0.1',
    allocKBytes: 0,
    threadNameHash: 0,
  };
}

describe('XLogDataStore', () => {
  let store: XLogDataStore;

  beforeEach(() => {
    store = new XLogDataStore();
  });

  it('초기 size가 0이어야 함', () => {
    expect(store.size).toBe(0);
  });

  it('add 후 size가 1이어야 함', () => {
    store.add(makeSXLog(1000));
    expect(store.size).toBe(1);
  });

  it('add 후 isDirty가 true이어야 함', () => {
    store.add(makeSXLog(1000));
    expect(store.isDirty()).toBe(true);
  });

  it('clearDirty 후 isDirty가 false이어야 함', () => {
    store.add(makeSXLog(1000));
    store.clearDirty();
    expect(store.isDirty()).toBe(false);
  });

  it('addBatch: 여러 항목 일괄 추가', () => {
    store.addBatch([makeSXLog(1000), makeSXLog(2000), makeSXLog(3000)]);
    expect(store.size).toBe(3);
    expect(store.isDirty()).toBe(true);
  });

  it('addBatch: 빈 배열은 dirty 변경 없음', () => {
    store.addBatch([]);
    expect(store.isDirty()).toBe(false);
  });

  it('clear: 모든 항목 제거 후 size=0, dirty=true', () => {
    store.add(makeSXLog(1000));
    store.clearDirty();
    store.clear();
    expect(store.size).toBe(0);
    expect(store.isDirty()).toBe(true);
  });

  it('getAll: 추가한 항목 반환', () => {
    const xlog = makeSXLog(5000, 200);
    store.add(xlog);
    expect(store.getAll()).toContain(xlog);
  });

  it('prune: timeRangeMs 밖 항목 제거', () => {
    const now = 10_000;
    store.add(makeSXLog(1000));  // 9000ms 이전 → 제거
    store.add(makeSXLog(8000));  // 2000ms 이전 → 유지
    store.add(makeSXLog(9500));  // 500ms 이전 → 유지
    store.prune(now, 5_000);
    expect(store.size).toBe(2);
    expect(store.isDirty()).toBe(true);
  });

  it('prune: 모두 범위 내이면 size 변경 없음', () => {
    store.add(makeSXLog(9000));
    store.add(makeSXLog(9500));
    store.clearDirty();
    store.prune(10_000, 5_000);
    expect(store.size).toBe(2);
    expect(store.isDirty()).toBe(false);
  });

  it('prune: MAX_ITEMS(100000) 초과 시 오래된 항목 제거', () => {
    const COUNT = 100_002;
    for (let i = 0; i < COUNT; i++) {
      store.add(makeSXLog(i * 10));
    }
    // 전체 시간 범위를 크게 잡아 시간 필터는 통과
    store.prune(COUNT * 10 + 1000, COUNT * 10 + 1000);
    expect(store.size).toBeLessThanOrEqual(100_000);
  });

  // "비어 있음"이 고장인지 데이터가 없는 건지 구분하려면
  // 마지막으로 실제 수신한 시각이 필요하다.
  it('lastReceivedAt: 아무것도 안 받았으면 null', () => {
    expect(store.lastReceivedAt).toBeNull();
  });

  it('lastReceivedAt: add 하면 수신 시각이 기록된다', () => {
    store.add(makeSXLog(1000), 12_345);
    expect(store.lastReceivedAt).toBe(12_345);
  });

  it('lastReceivedAt: addBatch 도 기록된다', () => {
    store.addBatch([makeSXLog(1000)], 22_222);
    expect(store.lastReceivedAt).toBe(22_222);
  });

  it('lastReceivedAt: 빈 배치는 시각을 갱신하지 않는다', () => {
    store.addBatch([makeSXLog(1000)], 100);
    store.addBatch([], 999);
    expect(store.lastReceivedAt).toBe(100);
  });

  it('lastReceivedAt: prune 은 수신 시각을 건드리지 않는다', () => {
    store.add(makeSXLog(1000), 500);
    store.prune(1_000_000, 1);
    expect(store.size).toBe(0);
    expect(store.lastReceivedAt).toBe(500);
  });
});
