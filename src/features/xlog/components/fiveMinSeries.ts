// 5분 집계 시계열 다듬기
//
// 콜렉터의 `COUNTER_TODAY_ALL` 응답은 **하루치 288 슬롯을 통째로** 준다 —
// 자정부터 23:55 까지, 아직 오지 않은 시각도 값 0으로 채워서.
// 그대로 그리면 지금 시각 이후가 바닥에 붙어 **"방금 0으로 떨어졌다"** 로 읽힌다.
// 실측: 12:47 에 조회했는데 마지막 포인트가 23:55 였다 (L4:live_host_five_min_counters).

import type { CounterSeries } from '../api/scouterApi';

/** 5분 슬롯 간격 (ms) */
export const SLOT_MS = 5 * 60 * 1000;

export interface TrimmedSeries {
  obj_hash: number;
  times: number[];
  values: number[];
}

/**
 * 아직 시작하지 않은 슬롯을 잘라낸다.
 *
 * 슬롯의 시각은 **구간의 시작**이다. 그래서 경계는 `now` 그 자체다 —
 * 시작 시각이 지금보다 뒤면 미래고, 같거나 앞이면 이미 시작된 구간이다.
 * 진행 중인 슬롯(집계가 아직 안 끝난 마지막 하나)은 남긴다. 이걸 자르면
 * 최신 값이 5분 내내 안 보인다.
 *
 * 길이가 어긋나면 짧은 쪽에 맞춘다 — 없는 값을 0으로 메우면 없던 골짜기가 생긴다.
 */
export function trimFuture(series: CounterSeries, now: number): TrimmedSeries {
  const n = Math.min(series.times.length, series.values.length);
  const times: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < n; i++) {
    if (series.times[i] > now) break;
    times.push(series.times[i]);
    values.push(series.values[i]);
  }
  return { obj_hash: series.obj_hash, times, values };
}

export function trimAll(list: CounterSeries[], now: number): TrimmedSeries[] {
  return list.map(s => trimFuture(s, now));
}

/**
 * Y 축 상한. 전 오브젝트를 통틀어 본다.
 *
 * 오브젝트마다 축이 다르면 선끼리 비교가 안 된다.
 * 값이 전부 0이어도 1을 준다 — 0으로 나누면 선이 NaN 이 되어 아무것도 안 그려진다.
 */
export function seriesMax(list: TrimmedSeries[]): number {
  let max = 0;
  for (const s of list) {
    for (const v of s.values) {
      if (v > max) max = v;
    }
  }
  return max > 0 ? max : 1;
}

/**
 * 값이 하나라도 0이 아닌가.
 *
 * **"응답이 왔다"와 "수집된 값이 있다"는 다르다.** SYN_SENT 처럼 순간 상태인
 * 카운터는 슬롯 288개가 전부 0으로 온다. 이걸 구분하지 못하면
 * 바닥에 붙은 직선을 보고 고장으로 읽는다.
 */
export function hasAnyValue(list: TrimmedSeries[]): boolean {
  return list.some(s => s.values.some(v => v !== 0));
}
