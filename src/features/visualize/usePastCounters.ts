// 타임라인이 그릴 구간 데이터.
//
// 실시간 스트림은 «지금부터» 만 준다 — 최근 5분이 화면에 쌓이려면 5분을 기다려야 하고,
// 한 시간 전을 보려면 방법이 없다. **볼 수 있는 것은 이미 콜렉터에 있다.**
//
// **objType 단위로 묻는다.** 콜렉터가 objHash 목록을 안 받는다(`getPastCounter`).
// 그래서 타입 전체가 오고, 고른 서버만 골라 쓰는 것은 여기서 한다.

import { useCallback, useEffect, useState } from 'react';
import { getPastCounter, type CounterSeries } from '../xlog/api/scouterApi';
import type { CounterName } from '../xlog/types/counter';
import type { Range } from './timelineScale';

/** 한 줄이 무엇을 어디에 물을지 */
export interface CounterQuery {
  counter: CounterName;
  /** 이 카운터를 가진 Family 의 objType. 비어 있으면 묻지 않는다 */
  objType: string;
}

export interface CounterRow {
  counter: CounterName;
  /** 고른 서버의 시계열만. 빈 배열이면 이 구간에 값이 없었다 */
  series: CounterSeries[];
}

export interface UsePastCountersResult {
  rows: CounterRow[];
  loading: boolean;
  error: string | null;
  /** 다시 받는다. 구간을 그대로 두고 새로 고칠 때 */
  reload: () => void;
}

/**
 * @param queries 무엇을 물을지. **순서가 곧 줄 순서**다
 * @param picked  고른 서버. 타입 전체가 오므로 여기서 거른다
 */
export function usePastCounters(
  enabled: boolean,
  queries: readonly CounterQuery[],
  range: Range | null,
  picked: ReadonlySet<number>,
): UsePastCountersResult {
  const [rows, setRows] = useState<CounterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce(n => n + 1), []);

  // 배열·집합은 매 렌더 새로 만들어지므로 내용으로 견준다.
  const queryKey = queries.map(q => `${q.counter}@${q.objType}`).join('|');
  const pickedKey = [...picked].sort((a, b) => a - b).join(',');

  useEffect(() => {
    if (!enabled || range === null || queries.length === 0 || picked.size === 0) {
      setRows([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const run = async () => {
      const out: CounterRow[] = [];
      for (const q of queries) {
        if (cancelled) return;
        // objType 을 모르는 Family 는 물을 방법이 없다 — 호스트 에이전트가 없는 곳이 그렇다.
        if (q.objType === '') {
          out.push({ counter: q.counter, series: [] });
          continue;
        }
        const all = await getPastCounter(q.counter, q.objType, range.stime, range.etime);
        out.push({ counter: q.counter, series: all.filter(s => picked.has(s.obj_hash)) });
      }
      if (!cancelled) setRows(out);
    };

    run()
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // 내용으로 견주므로 배열·집합 자체는 의존성에 넣지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, queryKey, pickedKey, range?.stime, range?.etime, nonce]);

  return { rows, loading, error, reload };
}
