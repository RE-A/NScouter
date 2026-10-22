// 과거 구간에 **있었을 수 있는** 오브젝트 — 그날 콜렉터 목록.
//
// 서비스로 묶어 고른 채 과거 구간을 보면, 지금 살아 있는 Task 만으로는 그때 돌던 Task 를
// 못 찾는다(ECS 재배포). 콜렉터는 날짜마다 그날 붙었던 오브젝트를 남겨 두므로
// (`OBJECT_LIST_LOAD_DATE`) 그걸 받아 후보에 보탠다 — 고르기 규칙은 `resolvePastSelection`.
//
// **지난 날짜는 한 번만 받는다.** 그날 목록은 더 바뀌지 않는다. 오늘은 구간이 바뀔 때마다
// 다시 받는다 — 그 사이 새 Task 가 떴을 수 있다.

import { useEffect, useRef, useState } from 'react';
import { getObjectListByDate, type DailyObject } from '../api/scouterApi';
import type { PastRange } from '../types/timeRange';
import { yyyymmdd } from '../types/timeRange';
import type { AgentObject } from '../types/xlog';

/** 구간이 걸친 날짜들 (콜렉터 기준 yyyyMMdd, F-18). 구간은 최대 6시간이라 많아야 둘이다 */
export function datesOf(range: PastRange): string[] {
  const out: string[] = [];
  const first = yyyymmdd(range.stime);
  out.push(first);
  const last = yyyymmdd(range.etime);
  if (last !== first) out.push(last);
  return out;
}

/** 그날 목록의 한 줄을 오브젝트 모양으로. **살아 있지 않은 것으로 둔다** — 그날의 기록일 뿐이다 */
export function dailyToAgent(d: DailyObject): AgentObject {
  return {
    obj_hash: d.obj_hash,
    obj_type: d.obj_type,
    obj_name: d.obj_name,
    address: '',
    version: '',
    alive: false,
    wakeup: 0,
    tags: [],
  };
}

/**
 * @param range   과거 구간. `null` 이면(실시간) 아무것도 안 받는다
 * @param epoch   접속이 바뀌면 받아 둔 것을 버린다 — 해시가 이름의 해시라 콜렉터가 달라도 겹친다
 */
export function usePastCandidates(
  range: PastRange | null,
  connected: boolean,
  epoch: number,
): AgentObject[] {
  const cacheRef = useRef(new Map<string, AgentObject[]>());
  const [list, setList] = useState<AgentObject[]>([]);

  useEffect(() => {
    cacheRef.current.clear();
    setList([]);
  }, [epoch]);

  const key = range ? datesOf(range).join(',') : '';
  // 오늘이 걸려 있으면 구간이 바뀔 때마다 다시 받는다 (구간 자체를 키에 넣는다)
  const today = yyyymmdd(Date.now());
  const refreshKey = key.includes(today) && range ? `${key}@${range.stime}-${range.etime}` : key;

  useEffect(() => {
    if (!connected || key === '') { setList([]); return; }
    let cancelled = false;
    const dates = key.split(',');
    Promise.all(
      dates.map(async d => {
        const cached = cacheRef.current.get(d);
        if (cached && d !== yyyymmdd(Date.now())) return cached;
        const got = (await getObjectListByDate(d)).map(dailyToAgent);
        cacheRef.current.set(d, got);
        return got;
      }),
    )
      .then(parts => { if (!cancelled) setList(parts.flat()); })
      // 못 받아도 고르기는 지금 목록과 본 기록으로 돈다 — 화면을 막지 않는다
      .catch(() => {});
    return () => { cancelled = true; };
  }, [connected, key, refreshKey]);

  return list;
}
