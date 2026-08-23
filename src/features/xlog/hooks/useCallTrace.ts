// 분산 트랜잭션 조회 훅
//
// 선택한 트랜잭션이 다른 앱을 부른 요청의 일부였다면, 형제/부모 XLog 를 함께 가져와
// 하나의 트리로 세운다. gxid 가 0 이면 혼자 끝난 요청이라 아무것도 하지 않는다.

import { useEffect, useState } from 'react';
import { loadXLogByGxid } from '../api/scouterApi';
import { buildCallTree, type TraceNode } from '../trace/callTree';
import type { SXLog } from '../types/xlog';
import { xlogPackToSXLog } from '../types/xlog';
import { yyyymmdd } from '../types/timeRange';
import { useTextResolver } from './useTextResolver';

export interface CallTraceState {
  loading: boolean;
  error: string | null;
  roots: TraceNode[];
  /** 트리로 세우기 전의 원본. 흐름 보기가 프로파일을 이어 받는 데 쓴다 */
  rows: SXLog[];
  /** service hash → 이름 */
  texts: Record<number, string>;
}

const EMPTY: CallTraceState = { loading: false, error: null, roots: [], rows: [], texts: {} };

export function useCallTrace(xlog: SXLog | null): CallTraceState {
  const [state, setState] = useState<CallTraceState>(EMPTY);
  const { resolve } = useTextResolver();

  const gxid = xlog?.gxid ?? '0';
  const endTime = xlog?.endTime ?? 0;

  useEffect(() => {
    // gxid 가 0 이면 이 요청은 한 앱에서 끝났다. 부를 이유가 없다.
    if (!gxid || gxid === '0') {
      setState(EMPTY);
      return;
    }

    // 응답이 늦게 도착했을 때 **이미 다른 트랜잭션을 보고 있으면 버린다.**
    // 안 버리면 방금 고른 것 위에 이전 결과가 덮인다.
    let alive = true;
    setState({ ...EMPTY, loading: true });

    (async () => {
      try {
        const packs = await loadXLogByGxid(gxid, yyyymmdd(endTime));
        if (!alive) return;

        const rows: SXLog[] = packs.map(xlogPackToSXLog);
        const roots = buildCallTree(rows);
        const texts = await resolve(
          'service',
          rows.map(r => r.service).filter(h => h !== 0),
        );
        if (!alive) return;

        setState({ loading: false, error: null, roots, rows, texts });
      } catch (err) {
        if (!alive) return;
        setState({ ...EMPTY, error: err instanceof Error ? err.message : String(err) });
      }
    })();

    return () => {
      alive = false;
    };
  }, [gxid, endTime, resolve]);

  return state;
}
