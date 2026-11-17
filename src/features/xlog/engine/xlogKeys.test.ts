// XLog 차트 키 — 원본 스카우터와 같은 걸음
import { describe, expect, it } from 'vitest';
import { xlogKeyAction } from './xlogKeys';

const live = (yMax: number, timeRangeMs = 300_000) => ({ yMax, timeRangeMs, pastRange: null });
const past = { yMax: 5, timeRangeMs: 300_000, pastRange: { stime: 100_000, etime: 200_000 } };

describe('xlogKeyAction', () => {
  it('↑ — 2초 이상이면 1초씩, 아래면 0.1초씩', () => {
    expect(xlogKeyAction('ArrowUp', live(5))).toEqual({ yMax: 6 });
    expect(xlogKeyAction('ArrowUp', live(0.3))).toEqual({ yMax: 0.4 });
    expect(xlogKeyAction('ArrowUp', live(1.9))).toEqual({ yMax: 2 });
  });

  it('↓ — 0.5초 아래로는 0.05초씩, 0.05초 아래로는 안 내린다', () => {
    expect(xlogKeyAction('ArrowDown', live(5))).toEqual({ yMax: 4 });
    expect(xlogKeyAction('ArrowDown', live(1))).toEqual({ yMax: 0.9 });
    expect(xlogKeyAction('ArrowDown', live(0.3))).toEqual({ yMax: 0.25 });
    expect(xlogKeyAction('ArrowDown', live(0.05))).toBeNull();
  });

  it('+ / - — 실시간 창 폭을 1분씩 (1분~30분)', () => {
    expect(xlogKeyAction('-', live(5))).toEqual({ timeRangeMs: 360_000 });
    expect(xlogKeyAction('+', live(5))).toEqual({ timeRangeMs: 240_000 });
    expect(xlogKeyAction('=', live(5, 60_000))).toBeNull();
    expect(xlogKeyAction('-', live(5, 1_800_000))).toBeNull();
    expect(xlogKeyAction('-', past)).toBeNull();
  });

  it('← / → — 과거 구간을 10초씩 옮긴다. 실시간은 안 옮긴다', () => {
    expect(xlogKeyAction('ArrowLeft', past)).toEqual({ pastRange: { stime: 90_000, etime: 190_000 } });
    expect(xlogKeyAction('ArrowRight', past)).toEqual({ pastRange: { stime: 110_000, etime: 210_000 } });
    expect(xlogKeyAction('ArrowLeft', live(5))).toBeNull();
  });

  it('다른 키는 모른다', () => {
    expect(xlogKeyAction('a', live(5))).toBeNull();
  });
});
