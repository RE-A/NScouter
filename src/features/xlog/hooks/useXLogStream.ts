// src/features/xlog/hooks/useXLogStream.ts
// Tauri 이벤트 listen + XLogDataStore 관리

import { useCallback, useEffect, useRef, useState } from 'react';
import { onXLogData, onXLogError } from '../api/scouterApi';
import { subscribe } from '../api/subscribe';
import { XLogDataStore } from '../store/XLogDataStore';
import { useViewOptions } from './useViewOptions';
import { xlogColumnsToSXLogs } from '../types/xlog';
import type { XLogChartConfig } from '../types/xlog';
import { NOT_PAUSED, pruneRangeMs, type PauseState } from './pauseModel';

interface UseXLogStreamResult {
  store: XLogDataStore;
  streamError: string | null;
  clearError: () => void;
  /**
   * 지금까지 **받은** 누적 건수.
   *
   * 저장소의 건수와 다르다 — 창 밖으로 밀려나거나 상한에 걸려 버려진 것이 빠지기
   * 때문이다. «멈춘 사이 몇 건 왔나» 는 이 값으로만 셀 수 있다 (`pauseModel`).
   */
  receivedTotal: number;
}

/**
 * 오류 배너를 띄워 두는 시간.
 *
 * 스트림은 끊겨도 **1초마다 스스로 다시 붙는다**(Rust `run_xlog_stream`). 그래서 한 번의
 * 출렁임으로 뜬 배너가 그대로 남으면 «지금도 고장» 으로 읽힌다 — 실제로는 이미 복구됐다.
 * 트래픽이 한가하면 복구돼도 새 XLog 가 없어 데이터로는 알 수 없으므로, 시간으로도 지운다.
 * 계속 끊겨 있으면 다음 오류가 곧바로 다시 띄운다.
 */
const ERROR_LINGER_MS = 10_000;

/**
 * @param pause 화면을 멈춘 상태. 멈춰 있으면 **지우는 범위를 늘려** 고정된 창을 덮는다 —
 *              안 그러면 멈춰 놓고 보는 중에 창 왼쪽부터 점이 사라진다.
 */
export function useXLogStream(
  config: XLogChartConfig,
  pause: PauseState = NOT_PAUSED,
  /**
   * 지금 보고 있는 탭인가.
   *
   * 탭을 여러 개 띄우면 모두 같은 스트림을 듣는다 — 그대로 두면 탭 수만큼
   * 같은 데이터가 쌓인다(버퍼는 탭마다 따로다). 안 보는 탭은 받지 않고,
   * 그 동안의 공백은 화면이 그대로 보여 준다 — «안 보는 것은 받지 않는다».
   */
  active = true,
): UseXLogStreamResult {
  const storeRef = useRef(new XLogDataStore());
  const [streamError, setStreamError] = useState<string | null>(null);
  const [receivedTotal, setReceivedTotal] = useState(0);
  const { bufferMax } = useViewOptions();

  // 지우기는 흐르는 타이머 안에서 도므로, 멈춤 상태를 ref 로 들고 본다.
  const pauseRef = useRef(pause);
  pauseRef.current = pause;

  useEffect(() => {
    if (streamError === null) return;
    const id = setTimeout(() => setStreamError(null), ERROR_LINGER_MS);
    return () => clearTimeout(id);
  }, [streamError]);

  /**
   * 설정에서 바꾼 상한을 **살아 있는 저장소에** 물린다.
   *
   * 새로 만들지 않는다 — 만들면 지금까지 받아 둔 점이 통째로 사라져서,
   * 상한을 올리려다 화면을 비우는 꼴이 된다.
   */
  useEffect(() => {
    storeRef.current.setMaxItems(bufferMax);
  }, [bufferMax]);

  useEffect(() => {
    // 해지 함수가 Promise 로 오므로 직접 담아 두면 안 된다 — 정리가 먼저 돌면
    // 리스너가 살아남아 XLog 가 저장소에 두 번 들어간다. `subscribe` 참고.
    if (!active) return;

    const off = subscribe(
      // **열로 받아 여기서 행으로 엮는다.** 건당 이벤트면 10,000건에 콜백이 1만 번 돈다.
      onXLogData(cols => {
        const rows = xlogColumnsToSXLogs(cols);
        storeRef.current.addBatch(rows);
        setReceivedTotal(n => n + rows.length);
        // 데이터가 다시 오면 지난 오류는 끝난 이야기다. 그대로 두면 «지금도 끊겨 있다» 로 읽힌다.
        setStreamError(null);
      }),
      onXLogError(msg => {
        setStreamError(msg);
      }),
    );

    // 주기적으로 시간 윈도우 밖 데이터 정리
    const pruneInterval = setInterval(() => {
      const now = Date.now();
      storeRef.current.prune(now, pruneRangeMs(pauseRef.current, config.timeRangeMs, now));
    }, 5000);

    return () => {
      off();
      clearInterval(pruneInterval);
    };
  }, [config.timeRangeMs, active]);

  const clearError = useCallback(() => setStreamError(null), []);

  return {
    store: storeRef.current,
    streamError,
    clearError,
    receivedTotal,
  };
}
