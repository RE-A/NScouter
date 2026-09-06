// KPI 표본 모으기 — 카운터 스트림을 **한 번** 듣고 여섯 지표를 함께 든다.
//
// 카운터 차트는 컴포넌트마다 구독한다(`CounterChart`). 40장이 각자 자기 카운터만
// 걸러 내는 구조라 그게 맞다. 여기서 그러면 타일 여섯 개가 같은 이벤트를 여섯 번
// 훑는데, 스트립은 한 덩어리로 움직이므로 나눌 이유가 없다.
//
// 스트림 자체는 App 이 접속 직후 켠다(`startCounterStream`). 이 훅은 듣기만 한다 —
// 탭을 열 때 스트림을 다시 켜면 Counter 탭의 차트가 쌓아 둔 것이 끊긴다.

import { useEffect, useState } from 'react';
import { onCounterData } from '../xlog/api/scouterApi';
import { subscribe } from '../xlog/api/subscribe';
import { MAX_COUNTER_SAMPLES, type CounterUpdate } from '../xlog/types/counter';
import { foldKpi, kpiByCounter, KPI_IDS, type KpiId } from './kpi';

export interface KpiSample {
  /** 지금 값. 아직 못 받았으면 null */
  value: number | null;
  /** 최근 표본. 스파크라인과 추세가 읽는다 */
  samples: number[];
}

export type KpiSamples = Record<KpiId, KpiSample>;

export interface UseKpiSamplesResult {
  kpis: KpiSamples;
  /**
   * 마지막으로 무엇이든 받은 시각(로컬 시계). 없으면 아직 한 번도 못 받았다.
   *
   * 콜렉터가 준 `time` 이 아니라 **받은 시각**이다. 서버 시계가 밀려 있으면
   * «몇 초 전에 받았나» 가 통째로 틀린다 (`CounterChart` 와 같은 규칙).
   */
  lastReceivedAt: number | null;
}

function emptyKpis(): KpiSamples {
  const out = {} as KpiSamples;
  for (const id of KPI_IDS) out[id] = { value: null, samples: [] };
  return out;
}

/**
 * @param enabled 접속돼 있고 이 탭을 보고 있을 때만. 끄면 쌓아 둔 것을 버린다 —
 *   끊긴 동안의 값을 이어 두면 다시 붙었을 때 없던 계단이 생긴다.
 * @param visible 접을 대상. 스트림은 고른 것만 주지만, 고르기를 바꾼 직후에는
 *   이전 서버의 값이 한 폴링 더 들어온다 — 그것까지 접으면 방금 뺀 서버가
 *   접은 값 안에서 한 번 더 살아난다.
 */
export function useKpiSamples(
  enabled: boolean,
  visible: ReadonlySet<number>,
): UseKpiSamplesResult {
  const [state, setState] = useState<UseKpiSamplesResult>(() => ({
    kpis: emptyKpis(),
    lastReceivedAt: null,
  }));

  const visibleKey = [...visible].sort((a, b) => a - b).join(',');

  useEffect(() => {
    if (!enabled) {
      setState({ kpis: emptyKpis(), lastReceivedAt: null });
      return;
    }

    return subscribe(
      onCounterData((update: CounterUpdate) => {
        const def = kpiByCounter(update.counter);
        if (!def) return;

        const rows = update.values.filter(v => visible.has(v.obj_hash));
        const folded = foldKpi(def, rows);
        const at = Date.now();

        setState(prev => {
          // 접히지 않은 시점은 **버린다.** 0으로 채우면 «전부 멈췄다» 로 읽히고,
          // 그건 대상이 없는 것과 전혀 다른 상황이다.
          if (folded === null) return { ...prev, lastReceivedAt: at };

          const samples = [...prev.kpis[def.id].samples, folded];
          if (samples.length > MAX_COUNTER_SAMPLES) samples.shift();

          return {
            kpis: { ...prev.kpis, [def.id]: { value: folded, samples } },
            lastReceivedAt: at,
          };
        });
      }),
    );
    // visible 은 내용이 같아도 매번 새 Set 일 수 있다. 내용으로 견준다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, visibleKey]);

  return state;
}
