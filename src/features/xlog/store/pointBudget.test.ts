// 앱 전체 점 예산 — 판 여럿이 하나를 나눠 쓰고, 넘치면 판 상관없이 가장 오래된 점부터 버린다

import { afterEach, describe, expect, it } from 'vitest';
import type { SXLog } from '../types/xlog';
import { enforceBudget, livePointCount, setPointBudget, XLogDataStore, MIN_MAX_ITEMS } from './XLogDataStore';

const x = (t: number): SXLog => ({ endTime: t, txid: String(t) }) as SXLog;
const fill = (s: XLogDataStore, from: number, to: number, step: number) => {
  const rows: SXLog[] = [];
  for (let t = from; t < to; t += step) rows.push(x(t));
  s.addBatch(rows, to);
};

const made: XLogDataStore[] = [];
const store = () => {
  const s = new XLogDataStore();
  s.register();
  made.push(s);
  return s;
};
afterEach(() => {
  for (const s of made.splice(0)) s.unregister();
  setPointBudget(1_000_000);
});

describe('enforceBudget', () => {
  it('넘지 않으면 아무것도 버리지 않는다', () => {
    setPointBudget(MIN_MAX_ITEMS);
    const a = store();
    fill(a, 0, 50_000, 1);
    expect(enforceBudget(50_000)).toBeNull();
    expect(a.size).toBe(50_000);
  });

  it('넘으면 판 상관없이 같은 기준 시각보다 오래된 것을 버린다 — 바쁜 판이 많이 잃는다', () => {
    setPointBudget(MIN_MAX_ITEMS);
    const busy = store();
    const idle = store();
    fill(busy, 0, 120_000, 1); // 12만 건 (1ms 마다)
    fill(idle, 0, 120_000, 10); // 1.2만 건 (10ms 마다)
    const cut = enforceBudget(120_000);
    expect(cut).not.toBeNull();
    expect(livePointCount()).toBeLessThanOrEqual(MIN_MAX_ITEMS);
    // 같은 «최근 N분» — 두 판 모두 기준 시각 이후만 남는다
    for (const s of [busy, idle]) expect(Math.min(...s.getAll().map(p => p.endTime))).toBeGreaterThanOrEqual(cut!);
    // 버린 것은 «상한에 걸려 버림» 으로 센다
    expect(busy.droppedCount).toBeGreaterThan(0);
    // 남은 수는 예산에 꽉 차게 — 하나 더 남기면 넘는 자리
    expect(livePointCount()).toBeGreaterThan(MIN_MAX_ITEMS - 20);
  });

  it('등록을 뺀 저장소는 세지도 버리지도 않는다 (화면에서 내린 판)', () => {
    setPointBudget(MIN_MAX_ITEMS);
    const a = store();
    const gone = new XLogDataStore();
    fill(a, 0, 60_000, 1);
    fill(gone, 0, 90_000, 1);
    expect(enforceBudget(90_000)).toBeNull();
    expect(gone.size).toBe(90_000);
  });

  it('과거를 섞어 담은 저장소(시간순이 아님)도 같은 기준으로', () => {
    setPointBudget(MIN_MAX_ITEMS);
    const a = store();
    fill(a, 100_000, 160_000, 1);
    a.addHistory(Array.from({ length: 60_000 }, (_, i) => x(i)));
    const cut = enforceBudget(160_000)!;
    expect(a.size).toBeLessThanOrEqual(MIN_MAX_ITEMS);
    expect(a.getAll().every(p => p.endTime >= cut)).toBe(true);
  });

  it('prune 이 잠깐에 한 번 예산을 본다', () => {
    setPointBudget(MIN_MAX_ITEMS);
    const a = store();
    fill(a, 0, 150_000, 1);
    a.prune(150_000, 10 * 60_000);
    expect(livePointCount()).toBeLessThanOrEqual(MIN_MAX_ITEMS);
  });
});

describe('받을 때도 예산을 본다', () => {
  it('정리(prune)를 기다리지 않고 묶음을 받을 때 예산을 넘기지 않는다', () => {
    setPointBudget(MIN_MAX_ITEMS);
    const a = store();
    const b = store();
    for (let i = 0; i < 30; i++) {
      const t0 = i * 10_000;
      fill(a, t0, t0 + 10_000, 1);
      fill(b, t0, t0 + 10_000, 1);
    }
    // 마지막 검사 뒤 0.5초 안에 들어온 묶음 한두 개만큼만 넘을 수 있다
    expect(livePointCount()).toBeLessThanOrEqual(MIN_MAX_ITEMS + 2 * 10_000);
  });
});
