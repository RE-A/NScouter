// 오브젝트별 지표 모으기.
//
// `useKpiSamples` 는 같은 스트림을 듣지만 **접은 값 하나**만 든다. 격자는 반대로
// 접기 전의 오브젝트별 값이 필요하다 — 그게 «어느 서버가» 에 답하는 유일한 자리다.
//
// **표본을 쌓지 않는다.** 격자는 «지금» 만 말하고, 서버 백 대 × 지표 여섯 개의
// 시계열을 드는 것은 아무도 안 보는 것을 위해 메모리를 쓰는 일이다.
// 추세가 궁금하면 그 서버를 눌러 파고들면 된다.

import { useEffect, useState } from 'react';
import { onCounterData } from '../xlog/api/scouterApi';
import { subscribe } from '../xlog/api/subscribe';
import type { CounterUpdate } from '../xlog/types/counter';
import { foldKpi, kpiByCounter } from './kpi';
import type { InstanceValues } from './instanceRows';

export interface UseInstanceKpisResult {
  /** objHash → 지금 값들 */
  samples: Map<number, InstanceValues>;
  lastReceivedAt: number | null;
}

const EMPTY: UseInstanceKpisResult = { samples: new Map(), lastReceivedAt: null };

/**
 * @param enabled 접속돼 있고 이 탭을 보고 있을 때만. 끄면 들고 있던 것을 버린다 —
 *   내려간 서버의 마지막 값이 남아 있으면 «아직 살아 있다» 로 읽힌다.
 */
export function useInstanceKpis(enabled: boolean): UseInstanceKpisResult {
  const [state, setState] = useState<UseInstanceKpisResult>(EMPTY);

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY);
      return;
    }

    return subscribe(
      onCounterData((update: CounterUpdate) => {
        const def = kpiByCounter(update.counter);
        if (!def) return;

        const at = Date.now();
        setState(prev => {
          const next = new Map(prev.samples);
          let changed = false;

          for (const row of update.values) {
            // **오브젝트 하나짜리로 접는다.** 쌍 카운터(Heap)를 %로 읽는 규칙이
            // 여기 한 번 더 적히면 스트립과 격자가 다른 수를 낸다.
            const value = foldKpi(def, [row]);
            if (value === null) continue;
            next.set(row.obj_hash, { ...next.get(row.obj_hash), [def.id]: value });
            changed = true;
          }

          if (!changed) return { ...prev, lastReceivedAt: at };
          return { samples: next, lastReceivedAt: at };
        });
      }),
    );
  }, [enabled]);

  return state;
}
