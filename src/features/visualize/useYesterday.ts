// 어제 하루치를 **한 번만** 받아 든다.
//
// 지난 하루는 더 이상 바뀌지 않는다. 실시간 지표처럼 2초마다 물으면 아무것도
// 새로 알게 되는 것 없이 콜렉터만 두드린다.
//
// 오늘 누적과 같은 커맨드다(`COUNTER_PAST_DATE_ALL`) — 5분 버킷 288개가 온다.
// 「어제 이 시각」 하나만 쓰려고 288개를 받지만, 하루에 한 번이라 그게 더 싸다.

import { useEffect, useState } from 'react';
import { getTodayCounter, type CounterSeries } from '../xlog/api/scouterApi';
import type { CounterName } from '../xlog/types/counter';
import { yyyymmdd } from '../xlog/types/timeRange';
import type { CounterQuery } from './usePastCounters';
import { sameTimeYesterday } from './yesterday';

/** 카운터명 → 어제 하루치 (오브젝트별 5분 버킷) */
export type YesterdayMap = ReadonlyMap<CounterName, CounterSeries[]>;

const EMPTY: YesterdayMap = new Map();

export function useYesterday(enabled: boolean, queries: readonly CounterQuery[]): YesterdayMap {
  const [map, setMap] = useState<YesterdayMap>(EMPTY);

  const queryKey = queries.map(q => `${q.counter}@${[...q.objTypes].sort().join(',')}`).join('|');
  // **날짜가 바뀌면 다시 받는다.** 자정을 넘긴 뒤에도 그제 것을 «어제» 라고 적으면
  // 하루 내내 틀린 수를 견주게 된다.
  const dateKey = yyyymmdd(sameTimeYesterday(Date.now()));

  useEffect(() => {
    if (!enabled || queries.length === 0) {
      setMap(EMPTY);
      return;
    }

    let cancelled = false;
    const run = async () => {
      const out = new Map<CounterName, CounterSeries[]>();
      for (const q of queries) {
        if (cancelled) return;
        if (q.objTypes.length === 0) continue;
        // 어제 것이 아예 없는 콜렉터도 있다(어제 켜지 않았거나 보관 기간을 넘겼거나).
        // 그건 오류가 아니라 «견줄 것이 없다» 라서, 한 줄이 실패해도 나머지는 살린다.
        try {
          out.set(q.counter, await getTodayCounter(q.counter, q.objTypes, dateKey));
        } catch {
          /* 이 지표만 «어제 없음» 으로 둔다 */
        }
      }
      if (!cancelled) setMap(out);
    };
    void run();

    return () => { cancelled = true; };
    // 내용으로 견주므로 배열 자체는 의존성에 넣지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, queryKey, dateKey]);

  return map;
}
