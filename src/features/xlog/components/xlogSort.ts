// 트랜잭션 목록 정렬 (순수 로직)
//
// **자르는 기준과 보는 기준은 다르다.** 목록은 500건까지만 그리는데, 그 500건을
// 고르는 기준은 언제나 «느린 순» 이다 — 구간을 드래그하는 이유가 «무엇이 느렸나»
// 라서, 시간순으로 앞에서 자르면 1ms 짜리 잡음만 남는다(실제로 그랬다).
//
// 그 위에 사용자가 고른 기준으로 **다시 늘어놓는다.** 그래서 «시간순으로 보기» 를
// 골라도 화면에 있는 것은 여전히 느린 상위 500건이고, 화면이 그렇다고 적는다.

import type { SXLog } from '../types/xlog';

export type SortKey = 'time' | 'server' | 'url' | 'ip' | 'elapsed' | 'y';
export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/**
 * 처음 보는 순서.
 *
 * **실시간과 과거가 같다.** 과거 구간은 «오래된 것부터» 가 자연스러워 보이지만,
 * 두 화면의 기본이 다르면 모드를 오갈 때마다 목록이 뒤집혀 읽던 자리를 잃는다.
 * 둘 다 «방금 무슨 일이 있었나» 를 먼저 묻는 화면이므로 최신이 위다.
 */
export const DEFAULT_SORT: SortState = { key: 'time', dir: 'desc' };

/**
 * 그 열을 처음 눌렀을 때의 방향.
 *
 * 수(시간·소요시간)는 **큰 것 먼저**, 글자(서버·URL·IP)는 **사전순**이다.
 * 반대로 두면 누를 때마다 한 번 더 눌러야 원하는 것이 나온다.
 */
function firstDir(key: SortKey): SortDir {
  return key === 'server' || key === 'url' || key === 'ip' ? 'asc' : 'desc';
}

/** 같은 열을 다시 누르면 뒤집고, 다른 열이면 그 열의 기본 방향으로 */
export function nextSort(cur: SortState, key: SortKey): SortState {
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: firstDir(key) };
}

/** 헤더에 붙일 표시. 정렬 중이 아닌 열은 빈칸이다 — 모든 열에 화살표를 달면 어느 것이 켜졌는지 안 보인다 */
export function sortMark(cur: SortState, key: SortKey): string {
  if (cur.key !== key) return '';
  return cur.dir === 'asc' ? '▲' : '▼';
}

/** 정렬에 쓸 이름들. 해시는 화면에 뜨는 글자로 풀어서 견준다 */
export interface SortNames {
  /** objHash → 서버 이름 */
  server: (objHash: number) => string;
  /** service hash → URL */
  url: (serviceHash: number) => string;
  /** 지금 차트가 그리는 축의 값. `y` 로 정렬할 때만 쓴다 */
  yValue: (x: SXLog) => number;
}

function compare(a: SXLog, b: SXLog, key: SortKey, names: SortNames): number {
  switch (key) {
    case 'time':
      return a.endTime - b.endTime;
    case 'elapsed':
      return a.elapsed - b.elapsed;
    case 'y':
      return names.yValue(a) - names.yValue(b);
    case 'server':
      return names.server(a.objHash).localeCompare(names.server(b.objHash));
    case 'url':
      return names.url(a.service).localeCompare(names.url(b.service));
    case 'ip':
      return a.ipAddr.localeCompare(b.ipAddr);
  }
}

/**
 * 고른 기준으로 늘어놓는다.
 *
 * **같은 값끼리는 시간 역순으로 고정한다.** 안 그러면 서버명처럼 값이 겹치는 열로
 * 정렬할 때 같은 서버 안의 순서가 갱신마다 달라져, 읽던 줄이 매번 다른 자리에 간다.
 */
export function sortXLogs(
  rows: readonly SXLog[],
  state: SortState,
  names: SortNames,
): SXLog[] {
  const sign = state.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const d = compare(a, b, state.key, names);
    if (d !== 0) return d * sign;
    return b.endTime - a.endTime;
  });
}

/**
 * 목록에 그릴 것을 고른다 — **자르기 전의 수를 함께 돌려준다.**
 *
 * 자른 뒤의 배열로는 «잘렸는가» 를 알 수 없다. 길이가 상한을 넘을 수 없어서 늘
 * «안 잘림» 이 되기 때문이다 — 실제로 그렇게 짜서, 검색으로 상한보다 많이 걸러도
 * 안내가 영영 안 떴다.
 *
 * 고르는 기준은 언제나 **느린 순**이다. 구간을 드래그하는 이유가 «무엇이 느렸나» 라서,
 * 시간순으로 앞에서 자르면 1ms 짜리 잡음만 남는다. 보는 순서는 그 위에서 따로 정한다.
 */
export function pickTableRows(
  xlogs: readonly SXLog[],
  /** 검색에 걸린 txid 들. `null` 은 «검색을 안 했다» 라서 전부 본다 (빈 것과 다르다) */
  searchHits: { has(txid: string): boolean } | null,
  limit: number,
): { matched: number; rows: SXLog[] } {
  const base = searchHits === null ? xlogs : xlogs.filter(x => searchHits.has(x.txid));
  return {
    matched: base.length,
    rows: [...base].sort((a, b) => b.elapsed - a.elapsed).slice(0, limit),
  };
}
