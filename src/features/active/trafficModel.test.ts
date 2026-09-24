// 실시간 트래픽 차트 자리 계산 — **점이 거짓말을 하지 않는가.**
//
// 이 차트의 쓸모는 «목록이 비었는데 점은 빽빽하다» 를 읽게 하는 것이다. 그러려면
// 창 밖의 것을 가장자리에 쌓아 두지 않아야 하고, 축이 멋대로 오르내리지 않아야 한다.

import { describe, expect, it } from 'vitest';
import {
  layoutTraffic,
  neededYMax,
  nextYMax,
  niceCeil,
  pickNearest,
  MIN_Y_MS,
} from './trafficModel';
import type { SXLog } from '../xlog/types/xlog';
import type { ActiveService } from '../xlog/types/object';

const NOW = 1_700_000_000_000;
const WINDOW = 60_000;

function done(endTime: number, elapsed: number, o: Partial<SXLog> = {}): SXLog {
  return {
    txid: 't',
    gxid: '0',
    caller: '0',
    endTime,
    elapsed,
    objHash: 1,
    service: 7,
    error: 0,
    xType: 0,
    cpu: 0,
    sqlCount: 0,
    sqlTime: 0,
    apiCallCount: 0,
    apiCallTime: 0,
    ipAddr: '',
    allocKBytes: 0,
    threadNameHash: 0,
    ...o,
  };
}

function live(elapsed: number, objHash = 1): ActiveService {
  return {
    obj_hash: objHash,
    id: 1,
    name: 'exec-1',
    service: '/shop',
    stat: 'RUNNABLE',
    elapsed,
    cpu: 0,
    ip: '',
    login: '',
    sql: '',
    subcall: '',
    txid: 'a',
  };
}

const base = { now: NOW, windowMs: WINDOW, yMax: 10_000, picked: new Set<number>() };

describe('점 놓기', () => {
  it('끝난 시각이 오른쪽 끝에 가까울수록 1 에 가깝다', () => {
    const pts = layoutTraffic({ ...base, done: [done(NOW, 500), done(NOW - WINDOW / 2, 500)], live: [] });
    expect(pts[0].tx).toBe(1);
    expect(pts[1].tx).toBeCloseTo(0.5);
  });

  it('창 밖의 점은 버린다 — 가장자리에 쌓아 두지 않는다', () => {
    // 0 에 붙여 두면 왼쪽 끝에 점이 쌓여 «저기서 뭔가 계속 일어난다» 로 읽힌다.
    const pts = layoutTraffic({ ...base, done: [done(NOW - WINDOW - 1, 500)], live: [] });
    expect(pts).toEqual([]);
  });

  it('상한을 넘는 것은 천장에 붙이되 버리지는 않는다', () => {
    // 버리면 **가장 느린 것**이 화면에서 사라진다 — 그게 보려던 것이다.
    const pts = layoutTraffic({ ...base, done: [done(NOW, 99_000)], live: [] });
    expect(pts[0].ty).toBe(1);
  });

  it('실행 중인 것은 오른쪽 끝에 놓고 따로 표시한다', () => {
    const pts = layoutTraffic({ ...base, done: [], live: [live(5_000)] });
    expect(pts[0].tx).toBe(1);
    expect(pts[0].running).toBe(true);
    expect(pts[0].ty).toBeCloseTo(0.5);
    expect(pts[0].live).not.toBeNull();
  });

  it('속도 단계와 실패 여부를 함께 낸다 — 색이 갈린다', () => {
    const pts = layoutTraffic({
      ...base,
      done: [done(NOW, 200), done(NOW, 2_000), done(NOW, 5_000, { error: 9 })],
      live: [],
    });
    expect(pts.map(p => p.step)).toEqual([1, 2, 3]);
    expect(pts.map(p => p.failed)).toEqual([false, false, true]);
  });

  it('고른 서버가 있으면 그 서버 것만 놓는다', () => {
    const pts = layoutTraffic({
      ...base,
      picked: new Set([2]),
      done: [done(NOW, 100, { objHash: 1 }), done(NOW, 100, { objHash: 2 })],
      live: [live(100, 1), live(100, 2)],
    });
    expect(pts).toHaveLength(2);
    expect(pts.every(p => (p.done?.objHash ?? p.live?.obj_hash) === 2)).toBe(true);
  });
});

describe('세로축 상한', () => {
  it('1·2·5 배수로 올린다', () => {
    expect(niceCeil(1_234)).toBe(2_000);
    expect(niceCeil(2_100)).toBe(5_000);
    expect(niceCeil(6_000)).toBe(10_000);
  });

  it('필요보다 낮게 잡지 않는다', () => {
    expect(nextYMax(1_000, 3_500)).toBe(5_000);
  });

  it('쉽게 내리지 않는다 — 점이 위아래로 춤추면 못 읽는다', () => {
    // 절반 아래로 내려갔을 때만 내린다.
    expect(nextYMax(10_000, 6_000)).toBe(10_000);
    expect(nextYMax(10_000, 1_500)).toBe(2_000);
  });

  it('바닥은 1초다 — 빠른 요청이 전부 바닥에 붙으면 못 읽는다', () => {
    expect(nextYMax(MIN_Y_MS, 10)).toBe(MIN_Y_MS);
  });

  it('필요한 상한은 실행 중인 것도 본다', () => {
    // 실행 중인 것이 제일 오래 걸리는 일이 흔하다 — 그게 안 보이면 이 화면의 뜻이 없다.
    const need = neededYMax({
      now: NOW,
      windowMs: WINDOW,
      picked: new Set<number>(),
      done: [done(NOW, 900)],
      live: [live(42_000)],
    });
    expect(need).toBe(42_000);
  });
});

describe('점 고르기', () => {
  const pts = layoutTraffic({ ...base, done: [done(NOW - WINDOW / 2, 5_000)], live: [live(2_500)] });

  it('반경 안에서 가장 가까운 것을 준다', () => {
    // 폭 200 · 높이 100 에서 끝난 점은 (100, 50) 자리다.
    const hit = pickNearest(pts, 100, 50, 200, 100);
    expect(hit?.running).toBe(false);
  });

  it('아무것도 없으면 null 이다 — 엉뚱한 점을 열지 않는다', () => {
    expect(pickNearest(pts, 10, 10, 200, 100)).toBeNull();
  });
});
