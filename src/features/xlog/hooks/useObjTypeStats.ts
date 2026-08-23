// objType 단위 통계 폴링
//
// 액티브 서비스는 **지금 이 순간**의 스냅샷이라 계속 다시 물어야 한다.
// 오늘 누적·방문자는 5분 단위로만 바뀌므로 훨씬 드물게 본다 —
// 같은 주기로 돌리면 288포인트를 2초마다 받는 낭비가 된다.

import { useEffect, useState } from 'react';
import {
  getActiveSpeed,
  getActiveSpeedByObject,
  getTodayCounter,
  getTodayVisitor,
  type ActiveSpeed,
  type CounterSeries,
} from '../api/scouterApi';

const LIVE_MS = 2_000;
const TODAY_MS = 60_000;

export interface ObjTypeStats {
  /** 타입 전체 합계 + TPS */
  group: ActiveSpeed | null;
  /** 오브젝트별 */
  perObject: ActiveSpeed[];
  todayCount: CounterSeries[];
  visitors: number | null;
  error: string | null;
}

const EMPTY: ObjTypeStats = {
  group: null,
  perObject: [],
  todayCount: [],
  visitors: null,
  error: null,
};

export function useObjTypeStats(objType: string, enabled: boolean): ObjTypeStats {
  const [state, setState] = useState<ObjTypeStats>(EMPTY);

  useEffect(() => {
    if (!enabled || !objType) {
      setState(EMPTY);
      return;
    }

    let alive = true;

    const pollLive = async () => {
      try {
        const [group, perObject] = await Promise.all([
          getActiveSpeed(objType),
          getActiveSpeedByObject(objType),
        ]);
        if (!alive) return;
        setState(prev => ({ ...prev, group, perObject, error: null }));
      } catch (err) {
        if (!alive) return;
        setState(prev => ({ ...prev, error: err instanceof Error ? err.message : String(err) }));
      }
    };

    const pollToday = async () => {
      try {
        const [todayCount, visitors] = await Promise.all([
          getTodayCounter('ServiceCount', objType),
          getTodayVisitor(objType),
        ]);
        if (!alive) return;
        setState(prev => ({ ...prev, todayCount, visitors }));
      } catch {
        // 오늘 누적이 실패해도 액티브 화면은 살아 있어야 한다.
        // 여기서 error 를 세우면 멀쩡한 쪽까지 에러 배너에 덮인다.
      }
    };

    void pollLive();
    void pollToday();
    const liveTimer = setInterval(pollLive, LIVE_MS);
    const todayTimer = setInterval(pollToday, TODAY_MS);

    return () => {
      alive = false;
      clearInterval(liveTimer);
      clearInterval(todayTimer);
    };
  }, [objType, enabled]);

  return state;
}
