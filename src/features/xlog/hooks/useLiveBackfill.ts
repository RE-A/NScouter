// 실시간 화면의 왼쪽 빈 구간을 뒤늦게 채운다
//
// 실시간 스트림은 «지금부터» 만 준다. 30분 창을 켜 놓으면 30분을 기다려야 창이 찬다.
// **그 30분은 이미 콜렉터에 있다** — 과거 조회로 받아 같은 저장소에 부어 넣는다.
// 무엇을 받을지는 `planBackfill` 이 정한다(겹치지 않게).
//
// 실시간 저장소에 그대로 담는 이유는 **창이 흐르기 때문**이다. 따로 두면 시간이 지나
// 창 밖으로 나간 뒤에도 남아 있어야 할 이유가 없는데 지우는 쪽이 없다.
// 실시간 저장소는 이미 창 밖을 주기적으로 잘라낸다(prune).

import { useEffect, useRef, useState } from 'react';
import { loadPastXLogs } from '../api/pastXLog';
import { XLogDataStore } from '../store/XLogDataStore';
import { xlogPackToSXLog } from '../types/xlog';
import { planBackfill, type BackfillCoverage } from '../types/backfill';
import { yyyymmdd } from '../types/timeRange';

/**
 * 채우기를 시작하기 전에 기다리는 시간.
 *
 * 스트림은 붙자마자 **최근 것을 한 묶음** 준다(TRANX_REAL_TIME_GROUP_LATEST).
 * 그게 도착하기 전에 계획을 세우면 «실시간으로 받아 둔 가장 오래된 점» 이 없어
 * 창 전체를 받게 되고, 곧 도착할 묶음과 겹쳐 같은 트랜잭션이 두 번 그려진다.
 * 폴링이 500ms 라 한 번은 돌고도 남을 만큼 둔다.
 *
 * 서버를 고르는 동안 클릭이 몇 번 이어질 때 조회가 그만큼 나가는 것도 이 대기가 막는다.
 */
export const BACKFILL_DELAY_MS = 2_000;

export interface UseLiveBackfillResult {
  /** 지금 채우는 중인가 */
  loading: boolean;
  /** 이번에 채운 건수. 화면이 «뒤늦게 들어오는 중» 이라고 말할 근거다 */
  loaded: number;
  /**
   * 너무 많아 다 못 채웠는가.
   *
   * 조회에는 페이지 상한이 있다(MAX_PAGES). 걸리면 창의 왼쪽이 **덜 찬 채로** 끝나는데,
   * 조용히 두면 «그 시간대에 트래픽이 없었다» 로 읽힌다.
   */
  truncated: boolean;
  error: string | null;
}

/**
 * @param store       실시간 저장소. 여기에 그대로 담는다
 * @param timeRangeMs 보고 있는 창의 길이
 * @param objHashes   대상 오브젝트. 실시간 스트림과 같은 목록이어야 한다
 * @param enabled     실시간 모드이고 접속돼 있을 때만
 */
export function useLiveBackfill(
  store: XLogDataStore,
  timeRangeMs: number,
  objHashes: number[],
  enabled: boolean,
): UseLiveBackfillResult {
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 어느 서버를 채워 봤나. «어디까지» 는 저장소가 안다(`oldestEndTime`) */
  const coveredRef = useRef<BackfillCoverage | null>(null);

  // 배열은 매 렌더 새로 만들어지므로 내용으로 견준다.
  const hashKey = objHashes.join(',');

  useEffect(() => {
    if (!enabled) {
      // 끊겼다 다시 붙으면 그 사이가 비어 있다 — 어느 서버를 채워 봤는지는 잊는다.
      // «어디까지» 는 저장소가 들고 있으므로 이걸 잊어도 겹쳐 받지 않는다.
      coveredRef.current = null;
      return;
    }
    if (objHashes.length === 0) return;

    const ac = new AbortController();
    const start = () => {
      const plan = planBackfill({
        now: Date.now(),
        timeRangeMs,
        hashes: objHashes,
        covered: coveredRef.current,
        // **저장소에 있는 것이 곧 갖고 있는 것이다.** 여기 왼쪽이 아직 못 받은 구간.
        oldest: store.oldestEndTime,
      });

      coveredRef.current = plan.next;
      if (plan.jobs.length === 0) return;

      setLoading(true);
      setError(null);
      setLoaded(0);
      setTruncated(false);

      let total = 0;
      const run = async () => {
        for (const job of plan.jobs) {
          if (ac.signal.aborted) return;
          await loadPastXLogs(
            {
              objHashes: job.objHashes,
              date: yyyymmdd(job.stime),
              stime: job.stime,
              etime: job.etime,
            },
            (rows, p) => {
              if (ac.signal.aborted) return;
              // 페이지가 올 때마다 담는다 — 다 받을 때까지 기다리면 몇 초 동안
              // 화면이 그대로다. 늦게 차오르는 편이 낫다.
              store.addHistory(rows.map(xlogPackToSXLog));
              total += rows.length;
              setLoaded(total);
              if (p.truncated) setTruncated(true);
            },
            ac.signal,
          );
        }
      };

      run()
        .catch(e => {
          if (!ac.signal.aborted) setError(String(e));
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
    };

    const timer = setTimeout(start, BACKFILL_DELAY_MS);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
    // hashKey 로 배열 정체성 대신 내용을 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hashKey, timeRangeMs, store]);

  return { loading, loaded, truncated, error };
}
