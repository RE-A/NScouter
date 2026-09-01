// 과거 구간을 **옮길 때 무엇을 더 받아야 하는가** (순수 함수)
//
// 좌우로 옮길 때마다 창 전체를 다시 받으면, 같은 데이터를 매번 수만 건씩 다시 끌어온다.
// 이미 받아 둔 구간과 겹치면 **모자란 쪽만** 받으면 된다.
//
// 겹치지 않으면(멀리 뛰면) 이어 붙일 것이 없으므로 새로 받는다 — 그때는 사이가 비어 있어
// 이어 붙이면 «없는 구간» 이 있는 채로 보게 된다.

import type { PastRange } from './timeRange';

export interface FetchPlan {
  /** 지금 갖고 있는 것을 버리는가 */
  reset: boolean;
  /** 더 받아야 할 구간들. 비어 있으면 받을 것이 없다 */
  fetch: PastRange[];
  /** 이 계획을 다 받고 나면 갖게 되는 구간 */
  loaded: PastRange;
}

/**
 * 보는 창과 받아 둔 구간을 견줘 **받을 것만** 고른다.
 *
 * 겹치는 판정은 «닿기만 해도» 로 본다. 1ms 라도 떨어져 있으면 그 사이의 트랜잭션을
 * 영영 안 받게 되므로 이어 붙이지 않는다.
 */
export function planFetch(view: PastRange, loaded: PastRange | null): FetchPlan {
  if (!loaded) {
    return { reset: true, fetch: [view], loaded: view };
  }

  // 완전히 안쪽이면 받을 것이 없다 — 확대·축소가 여기로 온다.
  if (view.stime >= loaded.stime && view.etime <= loaded.etime) {
    return { reset: false, fetch: [], loaded };
  }

  // 서로 떨어져 있으면 이어 붙일 수 없다.
  if (view.etime < loaded.stime || view.stime > loaded.etime) {
    return { reset: true, fetch: [view], loaded: view };
  }

  const fetch: PastRange[] = [];
  if (view.stime < loaded.stime) {
    // 왼쪽으로 옮겼다 — 앞쪽만 받는다
    fetch.push({ stime: view.stime, etime: loaded.stime });
  }
  if (view.etime > loaded.etime) {
    // 오른쪽으로 옮겼다 — 뒤쪽만 받는다
    fetch.push({ stime: loaded.etime, etime: view.etime });
  }

  return {
    reset: false,
    fetch,
    loaded: {
      stime: Math.min(view.stime, loaded.stime),
      etime: Math.max(view.etime, loaded.etime),
    },
  };
}

/** 이 계획이 실제로 받아야 할 시간의 합(ms). 얼마나 아꼈는지 말할 때 쓴다 */
export function fetchSpan(plan: FetchPlan): number {
  return plan.fetch.reduce((sum, r) => sum + (r.etime - r.stime), 0);
}
