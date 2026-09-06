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
 * @param visible 칸을 만들 오브젝트. 고르기에서 뺀 서버의 칸은 **그 자리에서** 사라져야
 *   한다 — 다음 폴링까지 남아 있으면 뺀 것이 안 빠진 것처럼 보인다.
 */
export function useInstanceKpis(
  enabled: boolean,
  visible: ReadonlySet<number>,
): UseInstanceKpisResult {
  const [state, setState] = useState<UseInstanceKpisResult>(EMPTY);

  const visibleKey = [...visible].sort((a, b) => a - b).join(',');

  /**
   * 고르기에서 뺀 칸을 **그 자리에서** 지운다.
   *
   * 다음 폴링을 기다리면 2초 동안 뺀 서버가 그대로 떠 있어 «안 빠졌다» 로 읽힌다.
   * 그렇다고 통째로 비우면 남은 칸까지 사라졌다 2초 뒤에 돌아와 화면이 깜빡인다.
   */
  useEffect(() => {
    setState(prev => {
      const kept = new Map([...prev.samples].filter(([h]) => visible.has(h)));
      return kept.size === prev.samples.size ? prev : { ...prev, samples: kept };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey]);

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
            if (!visible.has(row.obj_hash)) continue;
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
    // visible 은 내용이 같아도 매번 새 Set 일 수 있다. 내용으로 견준다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, visibleKey]);

  return state;
}
