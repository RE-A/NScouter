// 과거 구간 XLog 로딩
//
// 실시간 스트림(useXLogStream)과 **별도 스토어**를 쓴다.
// 실시간 스토어는 시간 창 밖을 주기적으로 잘라내는데(prune), 과거 구간은
// 시간이 흘러도 그대로 있어야 하기 때문이다.

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadPastXLogs, type PastProgress } from '../api/pastXLog';
import { XLogDataStore } from '../store/XLogDataStore';
import { useViewOptions } from './useViewOptions';
import { xlogPackToSXLog } from '../types/xlog';
import type { PastRange } from '../types/timeRange';
import { yyyymmdd } from '../types/timeRange';
import { planFetch } from '../types/pastWindow';

export interface UsePastXLogResult {
  store: XLogDataStore;
  loading: boolean;
  progress: PastProgress | null;
  error: string | null;
  /** 같은 구간을 다시 받아온다 */
  reload: () => void;
}

/**
 * @param range   조회 구간. null 이면 아무것도 하지 않는다(실시간 모드).
 * @param objHashes 대상 오브젝트. 비면 조회하지 않는다 — 전체 조회는 너무 무겁다.
 */
export function usePastXLog(
  range: PastRange | null,
  objHashes: number[],
): UsePastXLogResult {
  const storeRef = useRef(new XLogDataStore());
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<PastProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce(n => n + 1), []);

  // 과거 조회도 같은 상한을 쓴다. 여기만 상한이 다르면 «같은 구간인데 실시간과
  // 과거의 점 수가 다르다» 가 된다.
  const { bufferMax } = useViewOptions();
  useEffect(() => {
    storeRef.current.setMaxItems(bufferMax);
  }, [bufferMax]);

  // objHashes 는 매 렌더 새 배열이라 그대로 의존성에 넣으면 무한 재조회가 된다.
  const hashKey = objHashes.join(',');

  /**
   * 이미 받아 둔 구간.
   *
   * **좌우로 옮길 때마다 창 전체를 다시 받지 않기 위해** 들고 있는다.
   * 대상 오브젝트가 바뀌거나 다시 받기(F5)를 누르면 비운다 — 그때는 갖고 있는 것이
   * 다른 조건의 결과라 이어 붙이면 안 된다.
   */
  const loadedRef = useRef<PastRange | null>(null);

  useEffect(() => {
    // 대상이 바뀌면 갖고 있는 것은 다른 조건의 결과다.
    loadedRef.current = null;
  }, [hashKey, nonce]);

  useEffect(() => {
    if (!range || objHashes.length === 0) {
      storeRef.current.clear();
      loadedRef.current = null;
      setProgress(null);
      setError(null);
      return;
    }

    const plan = planFetch(range, loadedRef.current);
    if (plan.reset) {
      // 이어 붙일 수 없는 자리 — 처음 받거나, 멀리 뛰어 사이가 빈 경우다.
      storeRef.current.clear();
    }
    if (plan.fetch.length === 0) {
      // 이미 받아 둔 구간 안이다(확대·축소). 다시 받을 이유가 없다.
      loadedRef.current = plan.loaded;
      return;
    }

    setLoading(true);
    setError(null);
    if (plan.reset) setProgress(null);

    const ac = new AbortController();
    // 모자란 쪽만 차례로 받는다. 둘일 수 있다(양쪽으로 넓힌 경우).
    const run = async () => {
      for (const part of plan.fetch) {
        if (ac.signal.aborted) return;
        await loadPastXLogs(
          {
            objHashes,
            date: yyyymmdd(part.stime),
            stime: part.stime,
            etime: part.etime,
          },
          (rows, p) => {
            if (ac.signal.aborted) return;
            for (const pack of rows) {
              storeRef.current.add(xlogPackToSXLog(pack));
            }
            setProgress(p);
          },
          ac.signal,
        );
      }
    };

    run()
      .then(() => {
        if (!ac.signal.aborted) loadedRef.current = plan.loaded;
      })
      .catch(e => {
        if (!ac.signal.aborted) setError(String(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    return () => ac.abort();
    // hashKey 로 배열 정체성 대신 내용을 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range?.stime, range?.etime, hashKey, nonce]);

  return { store: storeRef.current, loading, progress, error, reload };
}
