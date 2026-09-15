// 풀 카운터 구독
//
// **새로 요청하지 않는다.** 앱은 이미 고른 오브젝트의 카운터를 2초마다 스트리밍하고
// 있고(`startCounterStream`), 거기에 ConnActive·ConnIdle·ConnMax 가 들어 있다
// (App.tsx 의 ALL_CHART_COUNTERS). 여기서는 흘러오는 것 중 셋만 주워 담는다 —
// 이 화면을 연다고 에이전트에 부담이 늘지 않아야 한다.
//
// 그래서 **고르지 않은 풀의 값은 오지 않는다.** 스트림 대상이 고른 오브젝트뿐이라서다.
// WAS 만 고르고 그 아래 풀을 안 골랐으면 값이 영영 안 오는데, 그걸 «수집이 안 된다»
// 로 읽으면 엉뚱한 데를 뒤진다 — 화면이 그 경우를 따로 말해야 한다.

import { useEffect, useState } from 'react';
import { onCounterData } from '../xlog/api/scouterApi';
import { subscribe } from '../xlog/api/subscribe';
import type { CounterUpdate } from '../xlog/types/counter';
import type { PoolCounters } from './poolModel';

/** 스트림에서 주워 담을 카운터 이름 → 우리 필드 */
const FIELD: Record<string, keyof PoolCounters> = {
  ConnActive: 'active',
  ConnIdle: 'idle',
  ConnMax: 'max',
};

const EMPTY: PoolCounters = { active: null, idle: null, max: null };

/**
 * 풀별 최신값.
 *
 * @param enabled 이 탭을 보고 있는가. 꺼지면 값을 버린다 — 다시 켰을 때 옛 숫자가
 *                지금 값인 척하면 안 된다.
 */
export function usePoolCounters(enabled: boolean): ReadonlyMap<number, PoolCounters> {
  const [byHash, setByHash] = useState<ReadonlyMap<number, PoolCounters>>(new Map());

  useEffect(() => {
    if (!enabled) {
      setByHash(new Map());
      return;
    }

    return subscribe(
      onCounterData((update: CounterUpdate) => {
        const field = FIELD[update.counter];
        if (!field) return;

        setByHash(prev => {
          const next = new Map(prev);
          for (const row of update.values) {
            const was = next.get(row.obj_hash) ?? EMPTY;
            next.set(row.obj_hash, { ...was, [field]: row.value });
          }
          return next;
        });
      }),
    );
  }, [enabled]);

  return byHash;
}
