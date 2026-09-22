// 타임라인이 그릴 구간 데이터.
//
// 실시간 스트림은 «지금부터» 만 준다 — 최근 5분이 화면에 쌓이려면 5분을 기다려야 하고,
// 한 시간 전을 보려면 방법이 없다. **볼 수 있는 것은 이미 콜렉터에 있다.**
//
// **objType 단위로 묻는다.** 콜렉터가 objHash 목록을 안 받는다(`getPastCounter`).
// 그래서 타입 전체가 오고, 고른 서버만 골라 쓰는 것은 여기서 한다.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPastCounter, type CounterSeries } from '../xlog/api/scouterApi';
import type { CounterName } from '../xlog/types/counter';
import type { Range } from './timelineScale';

/** 한 줄이 무엇을 어디에 물을지 */
export interface CounterQuery {
  counter: CounterName;
  /**
   * 이 카운터를 가진 Family 의 objType 들. 비어 있으면 묻지 않는다.
   *
   * **여럿일 수 있다** — 커스텀 종류(`monitoring_group_type`)를 쓰면 시스템마다 종류가 다르다.
   */
  objTypes: readonly string[];
}

export interface CounterRow {
  counter: CounterName;
  /** 고른 서버의 시계열만. 빈 배열이면 이 구간에 값이 없었다 */
  series: CounterSeries[];
  /**
   * 물어보기는 했는가.
   *
   * **«안 물었다» 와 «물었는데 없다» 는 다른 말이다.** CPU 는 host 오브젝트만 주는데
   * 호스트를 안 골랐으면 물을 데가 없다 — 그걸 «이 구간에 값이 없습니다» 로 적으면
   * 수집이 고장난 줄 알고 엉뚱한 데를 뒤진다.
   */
  asked: boolean;
}

export interface UsePastCountersResult {
  rows: CounterRow[];
  loading: boolean;
  error: string | null;
  /** 다시 받는다. 구간을 그대로 두고 새로 고칠 때 */
  reload: () => void;
}

/**
 * 오브젝트당 받을 점의 최대 수.
 *
 * 화면 폭이 2,000픽셀을 넘는 일은 드물다 — 그보다 촘촘한 점은 같은 픽셀에 겹쳐
 * 그려지므로 받아 봐야 보이지 않는다. 1시간 구간(2초 간격 1,800점)은 이 아래라
 * 원본 그대로 오고, 6시간(10,800점)만 줄어든다.
 */
export const MAX_POINTS = 2_000;

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
  /** 콜렉터가 준 것 그대로 (타입 전체). 고르기는 아래에서 얹는다 */
  const [raw, setRaw] = useState<CounterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce(n => n + 1), []);

  // 배열은 매 렌더 새로 만들어지므로 내용으로 견준다.
  const queryKey = queries.map(q => `${q.counter}@${[...q.objTypes].sort().join(',')}`).join('|');
  /**
   * **어느 서버를 골랐는지는 조회 조건이 아니다.**
   *
   * 콜렉터는 objHash 목록을 안 받아 어차피 타입 전체를 준다 — 같은 objType·같은 구간이면
   * 누구를 골랐든 응답이 같다. 고른 목록을 조회 키에 넣으면 서버를 하나 누를 때마다
   * 4연결이 다시 나가고, 100대짜리 목록에서는 그게 400번이 된다.
   * 여기서 보는 것은 «하나라도 골랐는가» 뿐이고, 거르기는 받은 뒤에 한다.
   */
  const hasPick = picked.size > 0;

  useEffect(() => {
    if (!enabled || range === null || queries.length === 0 || !hasPick) {
      setRaw([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const run = async () => {
      const out: CounterRow[] = [];
      for (const q of queries) {
        if (cancelled) return;
        // 물을 데가 없으면 묻지 않는다 — 호스트 에이전트가 아예 없거나, 있어도
        // 고르지 않았을 때다. **받아 봐야 전부 걸러진다** — 서버가 100대인 곳에서
        // 6시간치를 받아 통째로 버리는 셈이다.
        if (q.objTypes.length === 0) {
          out.push({ counter: q.counter, series: [], asked: false });
          continue;
        }
        const all = await getPastCounter(
          q.counter,
          q.objTypes,
          range.stime,
          range.etime,
          MAX_POINTS,
        );
        out.push({ counter: q.counter, series: all, asked: true });
      }
      if (!cancelled) setRaw(out);
    };

    run()
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // 내용으로 견주므로 배열 자체는 의존성에 넣지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, queryKey, hasPick, range?.stime, range?.etime, nonce]);

  // 고르기는 **받은 뒤에** 얹는다. 콜렉터를 다시 두드릴 일이 아니다.
  const rows = useMemo(
    () => raw.map(r => ({ ...r, series: r.series.filter(s => picked.has(s.obj_hash)) })),
    [raw, picked],
  );

  return { rows, loading, error, reload };
}
