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

/**
 * @param date `yyyyMMdd`. 주면 **그날의** 누적을 받는다(`COUNTER_PAST_DATE_ALL`).
 *   오늘이면 주지 않는다 — 같은 값이 오지만(L4 `live_past_date_counter` 실측)
 *   커맨드가 갈리면 «오늘» 이 어느 쪽인지 코드에서 안 보인다.
 */
export function useObjTypeStats(
  objType: string,
  enabled: boolean,
  date?: string,
): ObjTypeStats {
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
          getTodayCounter('ServiceCount', objType, date),
          // **방문자는 «지금까지» 만 있다.** VISITOR_REALTIME_TOTAL 에는 날짜가 없다 —
          // 과거 날짜를 보는 중에 오늘 숫자를 같이 띄우면 그날 것으로 읽힌다.
          date ? Promise.resolve(null) : getTodayVisitor(objType),
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
    // **지난 날은 다시 물을 이유가 없다.** 이미 끝난 하루라 값이 바뀌지 않는다.
    const todayTimer = date ? null : setInterval(pollToday, TODAY_MS);

    return () => {
      alive = false;
      clearInterval(liveTimer);
      if (todayTimer !== null) clearInterval(todayTimer);
    };
  }, [objType, enabled, date]);

  return state;
}
