// 활성 서비스 폴링 + 추적
//
// **공짜가 아니다.** 에이전트에 지금 돌고 있는 것을 물어보는 요청이라, 화면을 열어
// 둔 채 잊으면 대상 WAS 에 계속 부담이 간다. 그래서 세 가지를 지킨다:
//
//   1. 이 탭을 보고 있지 않으면 **부르지 않는다** (`enabled`).
//   2. 주기를 사람이 고를 수 있게 둔다 — 운영마다 허용 부하가 다르다.
//   3. 앞 요청이 아직 안 왔으면 **겹쳐 보내지 않는다.** 느린 콜렉터에서 2초 주기로
//      쌓으면 큐가 밀리고, 그때 화면이 보여 주는 것은 «지금» 이 아니라 과거다.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getTypeActiveServices } from '../xlog/api/scouterApi';
import type { ActiveService } from '../xlog/types/object';
import { advanceHolds, type Hold } from './activeModel';

/** 고를 수 있는 주기. `0` 은 «멈춤» 이다 */
export const POLL_MS = [1_000, 2_000, 5_000, 0] as const;
export type PollMs = (typeof POLL_MS)[number];
export const DEFAULT_POLL_MS: PollMs = 2_000;

export interface ActiveFeed {
  rows: ActiveService[];
  /** 같은 리소스를 붙들고 있은 시간을 재기 위한 표 */
  holds: ReadonlyMap<string, Hold>;
  /** 마지막으로 받은 시각. 멈춰 둔 동안 «언제 것인가» 를 말해야 한다 */
  at: number | null;
  /** 끝까지 답하지 않은 오브젝트. 조용히 적게 보여주면 «한가하다» 로 읽힌다 */
  incomplete: number[];
  error: string | null;
  loading: boolean;
  /** 지금 한 번 다시 받는다 (멈춰 둔 채로도 쓸 수 있어야 한다) */
  refresh: () => void;
}

/**
 * @param objType javaee 오브젝트의 objType. 액티브는 objHash 로는 못 묻는다 (F-34)
 * @param enabled 이 탭을 보고 있고 접속돼 있는가
 * @param periodMs 폴링 주기. `0` 이면 처음 한 번만 받고 멈춘다
 */
export function useActiveServices(
  objType: string,
  enabled: boolean,
  periodMs: PollMs,
): ActiveFeed {
  const [rows, setRows] = useState<ActiveService[]>([]);
  const [incomplete, setIncomplete] = useState<number[]>([]);
  const [at, setAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState(0);

  // 추적표는 렌더와 무관하게 이어져야 한다. state 로 두면 폴링마다 새 Map 을
  // 만들어 넣게 되고, 그 사이에 들어온 응답이 앞 표를 못 본다.
  const holdsRef = useRef<Map<string, Hold>>(new Map());
  const [holds, setHolds] = useState<ReadonlyMap<string, Hold>>(holdsRef.current);
  /** 앞 요청이 아직 안 왔는가 */
  const busyRef = useRef(false);

  const refresh = useCallback(() => setManual(n => n + 1), []);

  useEffect(() => {
    if (!enabled || objType === '') {
      // 꺼질 때 추적을 버린다. 다시 켰을 때 «10분째 붙들림» 이 뜨면 거짓말이다.
      holdsRef.current = new Map();
      setHolds(holdsRef.current);
      setRows([]);
      setAt(null);
      return;
    }

    let alive = true;
    const poll = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      setLoading(true);
      try {
        const res = await getTypeActiveServices(objType);
        if (!alive) return;
        const now = Date.now();
        holdsRef.current = advanceHolds(holdsRef.current, res.rows, now);
        setHolds(holdsRef.current);
        setRows(res.rows);
        setIncomplete(res.incomplete);
        setAt(now);
        setError(null);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        busyRef.current = false;
        if (alive) setLoading(false);
      }
    };

    void poll();
    if (periodMs === 0) return () => { alive = false; };

    const timer = setInterval(() => void poll(), periodMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [objType, enabled, periodMs, manual]);

  return { rows, holds, at, incomplete, error, loading, refresh };
}
