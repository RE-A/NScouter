// 과거 XLog 시간 범위 조회 (페이지 반복)
//
// 백엔드는 **한 페이지씩** 준다. 페이지 경계에서 같은 시각의 트랜잭션이
// 다시 오므로 txid 로 걸러야 한다 (verified-facts.md F-28).
//
// 그 반복과 중복 제거를 여기 한 곳에 모은다 — 화면이 이걸 알 필요는 없다.
//
// **구간을 조각으로 나눠 동시에 받는다.** 콜렉터는 요청 하나에 소켓 하나라(F-1) 페이지마다 왕복이
// 둘 이상 든다. 왕복 500ms 실측(`probe_scan_parallel_under_latency`, 9분 1.2만 건, 500건 페이지):
// 순서대로 18.3초 → 조각 4개 4.6초 → **조각 8개 3.1초**. 페이지를 키우지 않는 것은 화면으로 가는
// 한 덩어리를 작게 두기 위해서다(CLAUDE.md 3.3) — 대신 동시에 묻는다.

import { invoke } from '@tauri-apps/api/core';
import type { XLogPack } from '../types/xlog';

export interface PastCursor {
  has_more: boolean;
  last_txid: number;
  last_xlog_time: number;
  /**
   * 고른 서버가 콜렉터 여럿에 걸칠 때 콜렉터마다의 자리 (Rust `HubCursor`). **화면은 열어 보지 않고
   * 받은 그대로 되돌려 준다.** 그때 `last_xlog_time` 은 콜렉터들 자리의 합이라 «밀렸나» 만 볼 수 있다
   */
  parts?: unknown[];
}

interface PastXLogPage {
  xlogs: XLogPack[];
  cursor: PastCursor;
}

/** 한 번에 받아올 페이지 크기. 크면 왕복이 줄지만 첫 응답이 늦고 한 덩어리가 커진다. */
export const PAGE_COUNT = 500;

/** 한꺼번에 묻는 조각 수의 기본값 (위 머리말의 실측). 설정 «콜렉터 요청» 에서 바꾼다 */
export const PAST_PARALLEL = 8;

let pastParallel = PAST_PARALLEL;

/** 설정에서 온 조각 수를 건다 (`useViewOptions`) */
export function setPastParallel(n: number | undefined): void {
  pastParallel = Number.isFinite(n) && (n as number) >= 1 ? Math.min(16, Math.round(n as number)) : PAST_PARALLEL;
}

/** 조각을 이보다 잘게 나누지 않는다 — 짧은 구간은 한 번에 끝난다 */
export const MIN_SLICE_MS = 60_000;

/** 구간을 고르게 나눈 조각들 — 시간 순, 빈틈·겹침 없이 */
export function planSlices(stime: number, etime: number): [number, number][] {
  const span = Math.max(0, etime - stime);
  const n = Math.max(1, Math.min(pastParallel, Math.ceil(span / MIN_SLICE_MS)));
  return Array.from({ length: n }, (_, i): [number, number] => [
    stime + Math.floor((span * i) / n),
    i === n - 1 ? etime : stime + Math.floor((span * (i + 1)) / n),
  ]);
}

/**
 * 무한 루프를 막는 상한.
 *
 * 서버가 `hasMore=true` 를 계속 주거나 커서가 전진하지 않으면 영원히 돈다.
 * 10분 구간이 13,000건 남짓이므로 이 정도면 몇 시간치를 덮는다.
 */
export const MAX_PAGES = 200;

export interface PastQuery {
  objHashes: number[];
  /** 콜렉터 타임존 기준 yyyymmdd (F-18) */
  date: string;
  stime: number;
  etime: number;
}

export interface PastProgress {
  pages: number;
  loaded: number;
  done: boolean;
  /** 상한에 걸려 멈췄는가 — 조용히 잘린 것처럼 보이면 안 된다 */
  truncated: boolean;
}

/**
 * 구간 전체를 페이지 단위로 받아온다.
 *
 * @param onProgress 페이지마다 호출. 수만 건이라 화면이 진행 상황을 보여줘야 한다.
 * @param signal 중단 신호. 사용자가 구간을 바꾸면 이전 조회는 버려야 한다.
 */
export async function loadPastXLogs(
  query: PastQuery,
  onProgress: (rows: XLogPack[], progress: PastProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const seen = new Set<string>();
  let pages = 0;
  let loaded = 0;
  /** 상한(`MAX_PAGES`)에 닿았다 — 다른 조각도 멈춘다 */
  let capped = false;

  /** 조각 하나를 페이지로 끝까지 */
  const runSlice = async ([s, e]: [number, number]) => {
    let cursor: PastCursor | null = null;
    for (;;) {
      if (signal?.aborted || capped) return;
      if (pages >= MAX_PAGES) {
        capped = true;
        return;
      }
      pages += 1;

      const page: PastXLogPage = await invoke<PastXLogPage>('load_past_xlog', {
        objHashes: query.objHashes,
        date: query.date,
        stime: s,
        etime: e,
        pageCount: PAGE_COUNT,
        cursor,
      });
      if (signal?.aborted) return;

      // txid 는 i64 라 문자열로 온다. 숫자로 바꾸면 정밀도가 깨져 서로 다른
      // 트랜잭션이 같은 값이 될 수 있다 — 문자열 그대로 비교한다.
      // 조각 경계·페이지 경계의 같은 시각은 양쪽에서 다 온다 — 한 번만 담는다.
      const fresh: XLogPack[] = [];
      for (const x of page.xlogs) {
        if (seen.has(x.txid)) continue;
        seen.add(x.txid);
        fresh.push(x);
      }
      loaded += fresh.length;
      onProgress(fresh, { pages, loaded, done: false, truncated: false });

      const done = !page.cursor.has_more;
      // 커서가 전진하지 않으면 다음 페이지도 같은 내용이다. 도는 것보다 멈춘다.
      const stuck = cursor !== null && page.cursor.last_xlog_time === cursor.last_xlog_time;
      if (done || stuck) return;
      cursor = page.cursor;
    }
  };

  await Promise.all(planSlices(query.stime, query.etime).map(runSlice));
  if (signal?.aborted) return;
  onProgress([], { pages, loaded, done: true, truncated: capped });
}
