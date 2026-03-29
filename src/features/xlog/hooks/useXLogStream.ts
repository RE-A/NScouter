// src/features/xlog/hooks/useXLogStream.ts
// Tauri 이벤트 listen + XLogDataStore 관리

import { useCallback, useEffect, useRef, useState } from 'react';
import { onXLogData, onXLogError } from '../api/scouterApi';
import { XLogDataStore } from '../store/XLogDataStore';
import { xlogPackToSXLog } from '../types/xlog';
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
    let unlistenData: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;

    onXLogData(xlogPack => {
      const sxlog = xlogPackToSXLog(xlogPack);
      storeRef.current.add(sxlog);
    }).then(fn => { unlistenData = fn; });

    onXLogError(msg => {
      setStreamError(msg);
    }).then(fn => { unlistenError = fn; });

    // 주기적으로 시간 윈도우 밖 데이터 정리
    const pruneInterval = setInterval(() => {
      storeRef.current.prune(Date.now(), config.timeRangeMs);
    }, 5000);

    return () => {
      unlistenData?.();
      unlistenError?.();
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
