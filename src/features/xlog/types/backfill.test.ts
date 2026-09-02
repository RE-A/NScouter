import { describe, it, expect } from 'vitest';
import { planBackfill, MIN_BACKFILL_MS, type BackfillCoverage } from './backfill';

/** 2026-01-15 12:00:00 로컬 — 자정에서 멀어 하루 경계에 걸리지 않는다 */
const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime();
const MIN = 60_000;

describe('planBackfill', () => {
  it('처음 켰고 받아 둔 것이 없으면 창 전체를 받는다', () => {
    const plan = planBackfill({
      now: NOW,
      timeRangeMs: 30 * MIN,
      hashes: [1, 2],
      covered: null,
      oldestFresh: null,
      oldest: null,
    });
    expect(plan.jobs).toEqual([
      { stime: NOW - 30 * MIN, etime: NOW, objHashes: [1, 2] },
    ]);
    expect(plan.next.hashes).toEqual([1, 2]);
  });

  it('스트림이 이미 준 구간은 받지 않는다 — 겹치면 같은 건이 두 번 그려진다', () => {
    const plan = planBackfill({
      now: NOW,
      timeRangeMs: 30 * MIN,
      hashes: [1],
      covered: null,
      // 붙자마자 온 묶음이 5분치를 줬다
      oldestFresh: null,
      oldest: NOW - 5 * MIN,
    });
    expect(plan.jobs).toEqual([
      { stime: NOW - 30 * MIN, etime: NOW - 5 * MIN, objHashes: [1] },
    ]);
  });

  it('창 안이면 받을 것이 없다', () => {
    const covered: BackfillCoverage = { hashes: [1] };
    const plan = planBackfill({
      now: NOW + MIN,
      timeRangeMs: 30 * MIN,
      hashes: [1],
      covered,
      oldestFresh: null,
      oldest: NOW - 30 * MIN,
    });
    expect(plan.jobs).toEqual([]);
  });

  it('창을 넓히면 왼쪽으로 늘어난 만큼만 받는다', () => {
    const covered: BackfillCoverage = { hashes: [1, 2] };
    const plan = planBackfill({
      now: NOW,
      timeRangeMs: 30 * MIN,
      hashes: [1, 2],
      covered,
      oldestFresh: null,
      oldest: NOW - 5 * MIN,
    });
    expect(plan.jobs).toEqual([
      { stime: NOW - 30 * MIN, etime: NOW - 5 * MIN, objHashes: [1, 2] },
    ]);
  });

  it('새로 고른 서버도 스트림이 방금 준 묶음 왼쪽만 받는다', () => {
    const covered: BackfillCoverage = { hashes: [1] };
    const plan = planBackfill({
      now: NOW,
      timeRangeMs: 30 * MIN,
      hashes: [1, 2],
      covered,
      oldest: NOW - 30 * MIN,
      // 스트림이 다시 열리면서 2번 서버의 최근 3분치를 줬다
      oldestFresh: NOW - 3 * MIN,
    });
    expect(plan.jobs).toEqual([
      { stime: NOW - 30 * MIN, etime: NOW - 3 * MIN, objHashes: [2] },
    ]);
  });

  it('새로 고른 서버는 창 전체를 받는다 — 스트림이 그동안 주지 않았다', () => {
    const covered: BackfillCoverage = { hashes: [1] };
    const plan = planBackfill({
      now: NOW,
      timeRangeMs: 30 * MIN,
      hashes: [1, 2],
      covered,
      oldestFresh: null,
      oldest: NOW - 30 * MIN,
    });
    expect(plan.jobs).toEqual([
      { stime: NOW - 30 * MIN, etime: NOW, objHashes: [2] },
    ]);
    expect(plan.next.hashes).toEqual([1, 2]);
  });

  it('뺐다 다시 고른 서버는 받지 않는다 — 갖고 있는 구간이 통째로 겹친다', () => {
    const covered: BackfillCoverage = { hashes: [1, 2] };
    const plan = planBackfill({
      now: NOW,
      timeRangeMs: 30 * MIN,
      hashes: [2],
      covered,
      oldestFresh: null,
      oldest: NOW - 30 * MIN,
    });
    expect(plan.jobs).toEqual([]);
  });

  it('새 서버와 넓힌 창이 겹치면 서로 다른 구간을 받는다', () => {
    const covered: BackfillCoverage = { hashes: [1] };
    const plan = planBackfill({
      now: NOW,
      timeRangeMs: 30 * MIN,
      hashes: [1, 2],
      covered,
      oldestFresh: null,
      oldest: NOW - 5 * MIN,
    });
    expect(plan.jobs).toEqual([
      { stime: NOW - 30 * MIN, etime: NOW, objHashes: [2] },
      { stime: NOW - 30 * MIN, etime: NOW - 5 * MIN, objHashes: [1] },
    ]);
  });

  it('짧은 구멍은 그냥 둔다 — 창은 늘 조금씩 밀린다', () => {
    const plan = planBackfill({
      now: NOW,
      timeRangeMs: 30 * MIN,
      hashes: [1],
      covered: { hashes: [1] },
      oldestFresh: null,
      oldest: NOW - 30 * MIN + (MIN_BACKFILL_MS - 1),
    });
    expect(plan.jobs).toEqual([]);
  });

  it('자정을 넘지 않는다 — 콜렉터는 날짜별로 담는다', () => {
    const justAfterMidnight = new Date(2026, 0, 15, 0, 10, 0).getTime();
    const plan = planBackfill({
      now: justAfterMidnight,
      timeRangeMs: 30 * MIN,
      hashes: [1],
      covered: null,
      oldestFresh: null,
      oldest: null,
    });
    expect(plan.jobs[0].stime).toBe(new Date(2026, 0, 15, 0, 0, 0).getTime());
  });

  it('대상이 없으면 아무것도 하지 않는다', () => {
    const plan = planBackfill({
      now: NOW,
      timeRangeMs: 30 * MIN,
      hashes: [],
      covered: null,
      oldestFresh: null,
      oldest: null,
    });
    expect(plan.jobs).toEqual([]);
  });
});
