// 실시간 화면 일시정지 (순수 로직)
//
// **멈추는 것은 화면뿐이다.** 수집은 계속 돈다 — 멈춰 두는 동안 오간 트랜잭션이
// 없어지면, 멈춘 이유(«방금 그 점을 보려고») 와 정반대로 그 구간을 영영 못 본다.
// 스트림도 그대로 둔다. 다시 열면 콜렉터가 최신 만 건을 새로 주므로(0.5.5 에서 겪었다)
// 멈췄다 켜는 것만으로 무거워진다.
//
// 그래서 일시정지는 **«지금» 을 얼려 두는 일**이다. 실시간 창은 `now` 를 오른쪽 끝으로
// 삼아 흐르는데, 그 `now` 를 멈춘 시각에 고정하면 화면이 선다. 과거 구간을 보는 것과
// 같은 구조라(고정된 창) 그리기 쪽은 손댈 것이 없다.

import type { TimeWindow } from '../engine/CoordinateMapper';

export interface PauseState {
  /** 멈춘 시각(epoch ms). 흐르고 있으면 null */
  at: number | null;
  /** 멈출 때까지 받은 누적 건수 — «그 뒤로 몇 건 왔나» 를 세는 기준 */
  receivedAt: number;
}

export const NOT_PAUSED: PauseState = { at: null, receivedAt: 0 };

/** 멈춘다. 그 순간의 시각과 누적 수신 건수를 기억한다 */
export function pause(now: number, receivedTotal: number): PauseState {
  return { at: now, receivedAt: receivedTotal };
}

/**
 * 멈춘 동안 들어온 건수.
 *
 * **저장소의 건수를 세면 안 된다.** 창 밖으로 밀려나거나 상한에 걸려 버려진 것이
 * 빠져서, 실제로 받은 수보다 적게 나온다 — «멈춘 사이 아무 일 없었다» 로 읽힌다.
 * 받은 누적으로만 센다.
 */
export function arrivedWhilePaused(state: PauseState, receivedTotal: number): number {
  if (state.at === null) return 0;
  return Math.max(0, receivedTotal - state.receivedAt);
}

/**
 * 화면에 그릴 창.
 *
 * 흐르고 있으면 `null` 이다 — 부르는 쪽이 매 프레임 `now` 로 창을 만든다.
 * 멈춰 있으면 **멈춘 그 순간의 창**을 돌려준다.
 */
export function frozenWindow(state: PauseState, timeRangeMs: number): TimeWindow | null {
  if (state.at === null) return null;
  return { start: state.at - timeRangeMs, end: state.at };
}

/**
 * 멈춰 있는 동안 **지우지 말아야 할 범위.**
 *
 * 저장소는 «지금으로부터 창 길이만큼» 만 남기고 지운다(`prune`). 멈춘 채 그대로 두면
 * 고정된 창의 왼쪽부터 점이 사라진다 — 멈춰 놓고 보는 중에 화면이 비어 간다.
 * 멈춘 뒤 흐른 시간만큼 범위를 늘려 **고정 창을 덮는다.**
 *
 * 늘리는 것은 시간 기준뿐이고 **건수 상한은 그대로다** — 상한을 넘으면 오래된 것부터
 * 버린다. 멈춰 두었다고 메모리를 무한히 쓰지는 않는다.
 */
export function pruneRangeMs(state: PauseState, timeRangeMs: number, now: number): number {
  if (state.at === null) return timeRangeMs;
  return timeRangeMs + Math.max(0, now - state.at);
}
