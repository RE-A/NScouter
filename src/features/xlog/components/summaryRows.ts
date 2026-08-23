// 요약 표의 파생값과 정렬 (순수 로직)
//
// 콜렉터는 **합계만** 준다 — 평균은 여기서 낸다.
// 정렬 기준이 곧 질문이다:
//   합계: 시간을 어디서 썼나 · 횟수: 무엇이 많이 불렸나 · 평균: 한 방이 비싼 것

import type { SummaryRow } from '../types/summary';

export type SummarySortKey = 'sum' | 'count' | 'avg' | 'error';

export interface SummaryView extends SummaryRow {
  /** 한 번당 평균(ms). elapsed 가 없는 종류면 null */
  avg: number | null;
}

/**
 * 평균을 붙인다.
 *
 * **count 가 0 이면 나누지 않는다.** 0으로 나눈 Infinity 를 표에 그리면
 * 정렬이 통째로 망가지고 "무한히 느린 서비스"가 맨 위에 온다.
 */
export function withAverage(rows: readonly SummaryRow[]): SummaryView[] {
  return rows.map(r => ({
    ...r,
    avg: r.elapsed === null || r.count <= 0 ? null : Math.round(r.elapsed / r.count),
  }));
}

/** 기준별 내림차순. 값이 없는 행은 항상 뒤로 보낸다 */
export function sortSummary(rows: readonly SummaryView[], by: SummarySortKey): SummaryView[] {
  const key = (r: SummaryView): number | null => {
    switch (by) {
      case 'sum': return r.elapsed;
      case 'count': return r.count;
      case 'avg': return r.avg;
      case 'error': return r.error;
    }
  };
  return [...rows].sort((a, b) => {
    const av = key(a);
    const bv = key(b);
    // null 을 0 으로 보면 "값이 없다"와 "0이다"가 섞인다.
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  });
}

/**
 * IP 요약의 `id` 는 해시가 아니라 **IPv4 를 담은 int** 다.
 *
 * 실측으로 확인했다 — `173605394` = `10.89.2.18`.
 * 사전으로 풀려고 하면 영영 안 나온다.
 */
export function ipFromInt(id: number): string {
  const n = id >>> 0;
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
}
