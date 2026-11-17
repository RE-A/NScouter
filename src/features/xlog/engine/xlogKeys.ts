// XLog 차트 키 — 원본 스카우터와 같은 손버릇 (`scouter.client` `XLogViewPainter.keyPressed`)
//
//   ↑ / ↓   Y축 최대 — 2초 이상이면 1초씩, 아래면 0.1초씩(0.5초 아래로는 0.05초씩). 0.05초 아래로는 안 내린다
//   + / -   시간 폭 — 1분씩 좁히고 넓힌다 (1분 ~ 30분). 실시간 창의 폭이다
//   ← / →   시간 10초 이동 — 과거 구간을 옮긴다. 실시간은 «지금» 에 붙어 있어 옮기지 않는다
//
// 휠·Ctrl+휠은 그대로 둔다 — 키는 원본에 익숙한 사람을 위한 것이다. **순수 함수다.**

import type { PastRange } from '../types/timeRange';

const MIN_Y = 0.05;
const MIN_RANGE_MS = 60_000;
const MAX_RANGE_MS = 1_800_000;
const STEP_MS = 10_000;

export type XLogKeyAction =
  | { yMax: number }
  | { timeRangeMs: number }
  | { pastRange: PastRange };

/** 소수 둘째 자리로 — 0.1 을 거듭 더하면 0.30000000000000004 가 된다 */
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * 키 하나 → 바꿀 것. 이 키가 아니거나 바꿀 것이 없으면 null.
 * @param key `KeyboardEvent.key`
 */
export function xlogKeyAction(
  key: string,
  s: { yMax: number; timeRangeMs: number; pastRange: PastRange | null },
): XLogKeyAction | null {
  switch (key) {
    case 'ArrowUp':
      return { yMax: round2(s.yMax + (s.yMax >= 2 ? 1 : 0.1)) };
    case 'ArrowDown': {
      const step = s.yMax >= 2 ? 1 : s.yMax < 0.5 ? 0.05 : 0.1;
      const v = Math.max(MIN_Y, round2(s.yMax - step));
      return v === s.yMax ? null : { yMax: v };
    }
    case '-':
    case '_': {
      if (s.pastRange) return null;
      const v = Math.min(MAX_RANGE_MS, s.timeRangeMs + 60_000);
      return v === s.timeRangeMs ? null : { timeRangeMs: v };
    }
    case '+':
    case '=': {
      if (s.pastRange) return null;
      const v = Math.max(MIN_RANGE_MS, s.timeRangeMs - 60_000);
      return v === s.timeRangeMs ? null : { timeRangeMs: v };
    }
    case 'ArrowLeft':
    case 'ArrowRight': {
      if (!s.pastRange) return null;
      const d = key === 'ArrowLeft' ? -STEP_MS : STEP_MS;
      return { pastRange: { stime: s.pastRange.stime + d, etime: s.pastRange.etime + d } };
    }
    default:
      return null;
  }
}
