// 과거 XLog 시간 범위 조회 (페이지 반복)
//
// 백엔드는 **한 페이지씩** 준다. 페이지 경계에서 같은 시각의 트랜잭션이
// 다시 오므로 txid 로 걸러야 한다 (verified-facts.md F-28).
//
// 그 반복과 중복 제거를 여기 한 곳에 모은다 — 화면이 이걸 알 필요는 없다.

import { invoke } from '@tauri-apps/api/core';
import type { XLogPack } from '../types/xlog';

export interface PastCursor {
  has_more: boolean;
  last_txid: number;
  last_xlog_time: number;
}

interface PastXLogPage {
  xlogs: XLogPack[];
  cursor: PastCursor;
}

/** 한 번에 받아올 페이지 크기. 크면 왕복이 줄지만 첫 응답이 늦다. */
export const PAGE_COUNT = 500;

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
  let cursor: PastCursor | null = null;
  let pages = 0;
  let loaded = 0;

  while (pages < MAX_PAGES) {
    if (signal?.aborted) return;

    const page: PastXLogPage = await invoke<PastXLogPage>('load_past_xlog', {
      objHashes: query.objHashes,
      date: query.date,
      stime: query.stime,
      etime: query.etime,
      pageCount: PAGE_COUNT,
      cursor,
    });
    if (signal?.aborted) return;

    pages += 1;

    // txid 는 i64 라 문자열로 온다. 숫자로 바꾸면 정밀도가 깨져 서로 다른
    // 트랜잭션이 같은 값이 될 수 있다 — 문자열 그대로 비교한다.
    const fresh: XLogPack[] = [];
    for (const x of page.xlogs) {
      if (seen.has(x.txid)) continue;
      seen.add(x.txid);
      fresh.push(x);
    }
    loaded += fresh.length;

    const done = !page.cursor.has_more;
    // 커서가 전진하지 않으면 다음 페이지도 같은 내용이다. 도는 것보다 멈춘다.
    const stuck =
      cursor !== null && page.cursor.last_xlog_time === cursor.last_xlog_time;

    onProgress(fresh, {
      pages,
      loaded,
      done: done || stuck,
      truncated: false,
    });

    if (done || stuck) return;
    cursor = page.cursor;
  }

  onProgress([], { pages, loaded, done: true, truncated: true });
}
