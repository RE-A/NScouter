// TPS — **이미 도는 카운터 스트림에서 줍는다.**
//
// 새로 묻지 않는다. App 이 고른 서버의 카운터를 2초마다 받고 있고(`ALL_CHART_COUNTERS`),
// 거기 `TPS` 가 들어 있다. 이 화면을 연다고 콜렉터·에이전트에 요청이 늘지 않는다.
//
// **에이전트가 센 값을 쓴다.** 화면에서 XLog 를 세어 초당으로 나눌 수도 있지만, 그러면
// 스캐터가 받는 범위(고른 서버·버퍼 상한)에 따라 수가 달라진다 — 같은 순간을 두고
// Counter 탭과 다른 수를 적게 된다.

import { useEffect, useState } from 'react';
import { onCounterData } from '../xlog/api/scouterApi';
import { subscribe } from '../xlog/api/subscribe';
import type { CounterUpdate } from '../xlog/types/counter';

/**
 * 고른 서버들의 TPS 합.
 *
 * 아직 한 번도 못 받았으면 `null` 이다 — **0 으로 두지 않는다.** 0 은 «일이 없다» 고
 * 읽히는데, 모르는 것과 한가한 것은 화면에서 전혀 다른 뜻이다.
 *
 * @param enabled 이 탭을 보고 있는가. 꺼지면 버린다 — 다시 켰을 때 옛 수가
 *                지금 값인 척하면 안 된다.
 * @param picked  고른 서버. 비었으면 «전부» 다 (화면의 다른 곳과 같은 규칙)
 */
export function useTps(enabled: boolean, picked: ReadonlySet<number>): number | null {
  const [byHash, setByHash] = useState<ReadonlyMap<number, number>>(new Map());

  useEffect(() => {
    if (!enabled) {
      setByHash(new Map());
      return;
    }

    return subscribe(
      onCounterData((update: CounterUpdate) => {
        if (update.counter !== 'TPS') return;
        setByHash(prev => {
          const next = new Map(prev);
          for (const row of update.values) next.set(row.obj_hash, row.value);
          return next;
        });
      }),
    );
  }, [enabled]);

  if (byHash.size === 0) return null;

  let sum = 0;
  for (const [hash, v] of byHash) {
    if (picked.size > 0 && !picked.has(hash)) continue;
    sum += v;
  }
  return sum;
}
