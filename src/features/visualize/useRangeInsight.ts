// «이 구간에 무엇이 있었나» 를 받아 오는 훅.
//
// 두 가지를 같은 구간으로 묻는다.
//   · **분포** — 트랜잭션을 세야 나온다. 콜렉터에 커맨드가 없어 Rust 가 XLog 를
//     훑고 버킷만 돌려준다 (`get_xlog_distribution`).
//   · **서비스 순위** — 콜렉터가 이미 집계해 둔 것을 받는다 (`LOAD_SERVICE_SUMMARY`).
//
// **자동으로 돌리지 않는다.** 분포 쪽은 1시간이 실측 8만 건이라, 탭을 열 때마다
// 나가면 그게 이 화면에서 제일 무거운 일이 된다. 사용자가 펼쳤을 때만 받는다
// (`SummaryPanel` 이 «구간 전체를 훑는 무거운 조회» 를 다루는 방식과 같다).

import { useCallback, useEffect, useState } from 'react';
import {
  getSummary,
  getXLogDistribution,
  type ElapsedDistribution,
} from '../xlog/api/scouterApi';
import type { SummaryRow } from '../xlog/types/summary';
import { yyyymmdd } from '../xlog/types/timeRange';
import { useTextResolver } from '../xlog/hooks/useTextResolver';
import type { Range } from './timelineScale';

/** 순위표 한 줄 — 이름까지 풀린 상태 */
export interface ServiceRow extends SummaryRow {
  /** 서비스명. 못 풀었으면 해시를 그대로 적는다 — 빈칸이면 누를 수도 없다 */
  name: string;
}

export interface RangeInsight {
  distribution: ElapsedDistribution | null;
  services: ServiceRow[];
  /**
   * 순위표가 **고른 서버만** 센 것인가.
   *
   * 콜렉터는 요약을 오브젝트 하나 또는 **타입 전체**로만 준다 (`objHash=0`).
   * 여러 대를 골랐으면 타입 전체를 받을 수밖에 없는데, 그걸 말하지 않으면
   * 안 고른 서버의 호출까지 «내가 고른 것» 으로 읽힌다.
   */
  wholeType: boolean;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * @param enabled 펼쳐져 있고 접속돼 있는가. 꺼져 있으면 **아무것도 묻지 않는다**
 * @param objTypes javaee objType 들. 비어 있으면 물을 데가 없다. 여럿이면 종류마다 물어 더한다
 * @param picked  고른 서버. 한 대면 그 대만, 여럿이면 타입 전체를 받는다
 */
export function useRangeInsight(
  enabled: boolean,
  objTypes: readonly string[],
  picked: ReadonlySet<number>,
  range: Range | null,
): RangeInsight {
  // 배열은 내용이 같아도 매번 새것일 수 있다. 내용으로 견준다.
  const typesKey = [...objTypes].sort().join('\u0000');
  const [distribution, setDistribution] = useState<ElapsedDistribution | null>(null);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [wholeType, setWholeType] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const { resolve } = useTextResolver();

  const reload = useCallback(() => setNonce(n => n + 1), []);

  // 고른 목록은 배열로 굳혀 둔다 — Set 은 매 렌더 같은 내용으로도 다른 값이다.
  const pickedKey = [...picked].sort((a, b) => a - b).join(',');

  useEffect(() => {
    const types = typesKey === '' ? [] : typesKey.split('\u0000');
    if (!enabled || types.length === 0 || range === null || picked.size === 0) {
      setDistribution(null);
      setServices([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const hashes = pickedKey === '' ? [] : pickedKey.split(',').map(Number);
    // 한 대만 골랐으면 그 대만 물을 수 있다. 여럿이면 타입 전체가 온다.
    const single = hashes.length === 1 ? hashes[0] : 0;

    const run = async () => {
      const [dist, rows] = await Promise.all([
        getXLogDistribution(hashes, range.stime, range.etime),
        getSummary('service', yyyymmdd(range.stime), range.stime, range.etime, types, single),
      ]);
      if (cancelled) return;

      const names = await resolve('service', rows.map(r => r.id));
      if (cancelled) return;

      setDistribution(dist);
      setWholeType(single === 0);
      setServices(
        rows.map(r => ({ ...r, name: names[r.id] ?? `0x${(r.id >>> 0).toString(16)}` })),
      );
    };

    run()
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // pickedKey 로 내용을 견주므로 Set 자체는 의존성에 넣지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, typesKey, pickedKey, range?.stime, range?.etime, nonce, resolve]);

  return { distribution, services, wholeType, loading, error, reload };
}
