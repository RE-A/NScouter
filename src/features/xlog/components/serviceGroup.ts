// 서비스 그룹 표 (ASIS ServiceGroup TPS / Elapsed)
//
// 콜렉터가 최근 **30초**의 XLog 를 이름 규칙으로 묶어 준다.
// 실측 응답: `/shop` `/order` `/**` — 규칙에 안 걸린 것은 `/**` 로 떨어진다.

import type { ServiceGroupRow } from '../api/scouterApi';

/** 콜렉터 집계 구간 (초). 응답의 count 가 이 구간의 누적이다 */
export const GROUP_WINDOW_SEC = 30;

export interface GroupStat extends ServiceGroupRow {
  tps: number;
  /** 0~100 */
  errorRate: number;
  /** 이 그룹이 전체 호출에서 차지하는 비율 (%) */
  share: number;
}

/**
 * 화면에 낼 값으로 바꾼다.
 *
 * **count 를 TPS 라고 그리면 30배 부풀려진다** — 30초 구간의 누적이다
 * (ASIS 도 30으로 나눈다).
 */
export function toStats(rows: readonly ServiceGroupRow[]): GroupStat[] {
  const total = rows.reduce((s, r) => s + r.count, 0);
  return rows.map(r => ({
    ...r,
    tps: r.count / GROUP_WINDOW_SEC,
    errorRate: r.count > 0 ? (r.error / r.count) * 100 : 0,
    share: total > 0 ? (r.count / total) * 100 : 0,
  }));
}

/**
 * 정렬. 기본은 호출이 많은 순이다.
 *
 * **에러가 있는 그룹을 뒤로 밀지 않는다** — 같은 건수면 에러가 있는 쪽이 먼저다.
 * 목록이 길어지면 정작 봐야 할 그룹이 스크롤 밖으로 나간다.
 */
export function sortGroups(stats: readonly GroupStat[]): GroupStat[] {
  return [...stats].sort((a, b) => {
    if ((a.error > 0) !== (b.error > 0)) return a.error > 0 ? -1 : 1;
    return b.count - a.count;
  });
}
