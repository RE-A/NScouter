// src/features/xlog/hooks/useXLogStream.ts
// Tauri 이벤트 listen + XLogDataStore 관리

import { useCallback, useEffect, useRef, useState } from 'react';
import { onXLogData, onXLogError } from '../api/scouterApi';
import { subscribe } from '../api/subscribe';
import { XLogDataStore } from '../store/XLogDataStore';
import { xlogColumnsToSXLogs } from '../types/xlog';
import type { XLogChartConfig } from '../types/xlog';

interface UseXLogStreamResult {
  store: XLogDataStore;
  streamError: string | null;
  clearError: () => void;
}

export function useXLogStream(config: XLogChartConfig): UseXLogStreamResult {
  const storeRef = useRef(new XLogDataStore());
  const [streamError, setStreamError] = useState<string | null>(null);

  useEffect(() => {
    // 해지 함수가 Promise 로 오므로 직접 담아 두면 안 된다 — 정리가 먼저 돌면
    // 리스너가 살아남아 XLog 가 저장소에 두 번 들어간다. `subscribe` 참고.
    const off = subscribe(
      // **열로 받아 여기서 행으로 엮는다.** 건당 이벤트면 10,000건에 콜백이 1만 번 돈다.
      onXLogData(cols => {
        storeRef.current.addBatch(xlogColumnsToSXLogs(cols));
      }),
      onXLogError(msg => {
        setStreamError(msg);
      }),
    );

    // 주기적으로 시간 윈도우 밖 데이터 정리
    const pruneInterval = setInterval(() => {
      storeRef.current.prune(Date.now(), config.timeRangeMs);
    }, 5000);

    return () => {
      off();
      clearInterval(pruneInterval);
    };
  }, [config.timeRangeMs]);

  const clearError = useCallback(() => setStreamError(null), []);

  return {
    store: storeRef.current,
    streamError,
    clearError,
  };
}
