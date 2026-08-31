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

  useEffect(() => {
    if (!range || objHashes.length === 0) {
      storeRef.current.clear();
      setProgress(null);
      setError(null);
      return;
    }

    // 구간이 바뀌면 이전 결과가 섞이면 안 된다.
    storeRef.current.clear();
    setLoading(true);
    setError(null);
    setProgress(null);

    const ac = new AbortController();
    loadPastXLogs(
      {
        objHashes,
        date: yyyymmdd(range.stime),
        stime: range.stime,
        etime: range.etime,
      },
      (rows, p) => {
        if (ac.signal.aborted) return;
        for (const pack of rows) {
          storeRef.current.add(xlogPackToSXLog(pack));
        }
        setProgress(p);
      },
      ac.signal,
    )
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
