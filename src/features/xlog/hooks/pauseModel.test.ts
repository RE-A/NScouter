// 실시간 일시정지 — **멈춘 사이에 일어난 일을 잃지 않는가.**
//
// 멈추는 이유는 «방금 그 점을 보려고» 다. 그런데 멈춰 둔 사이의 데이터가 사라지거나
// 고정해 둔 창이 비어 가면, 멈춘 목적과 정반대가 된다.

import { describe, expect, it } from 'vitest';
import {
  arrivedWhilePaused,
  frozenWindow,
  NOT_PAUSED,
  pause,
  pruneRangeMs,
} from './pauseModel';

const NOW = 1_700_000_000_000;
const RANGE = 300_000; // 5분

describe('멈추기', () => {
  it('멈춘 시각과 그때까지 받은 수를 기억한다', () => {
    expect(pause(NOW, 1_234)).toEqual({ at: NOW, receivedAt: 1_234 });
  });

  it('흐르고 있으면 창을 고정하지 않는다', () => {
    // null 은 «부르는 쪽이 매 프레임 now 로 만들라» 는 뜻이다.
    expect(frozenWindow(NOT_PAUSED, RANGE)).toBeNull();
  });

  it('멈추면 그 순간의 창을 돌려준다', () => {
    expect(frozenWindow(pause(NOW, 0), RANGE)).toEqual({ start: NOW - RANGE, end: NOW });
  });
});

describe('멈춘 사이 들어온 건수', () => {
  it('받은 누적의 차이로 센다', () => {
    const p = pause(NOW, 1_000);
    expect(arrivedWhilePaused(p, 1_234)).toBe(234);
  });

  it('흐르고 있으면 0 이다', () => {
    expect(arrivedWhilePaused(NOT_PAUSED, 9_999)).toBe(0);
  });

  it('누적이 되돌아가도 음수를 내지 않는다', () => {
    // 접속이 바뀌면 저장소를 비우고 누적도 0 부터 다시 센다.
    expect(arrivedWhilePaused(pause(NOW, 500), 0)).toBe(0);
  });
});

describe('멈춘 동안 지우는 범위', () => {
  it('흐를 때는 창 길이 그대로다', () => {
    expect(pruneRangeMs(NOT_PAUSED, RANGE, NOW)).toBe(RANGE);
  });

  it('멈춘 뒤 흐른 만큼 늘려 고정 창을 덮는다', () => {
    // 늘리지 않으면 멈춰 놓고 보는 중에 창 왼쪽부터 점이 사라진다.
    const p = pause(NOW, 0);
    expect(pruneRangeMs(p, RANGE, NOW + 60_000)).toBe(RANGE + 60_000);
  });

  it('시계가 뒤로 가도 범위를 줄이지 않는다', () => {
    const p = pause(NOW, 0);
    expect(pruneRangeMs(p, RANGE, NOW - 5_000)).toBe(RANGE);
  });
});
