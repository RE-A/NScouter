// 어제 이 시각에는 얼마였나. **순수 함수다.**
//
// 지표 하나만 크게 띄우면 그 수가 큰지 작은지는 보는 사람이 안다는 뜻이 된다.
// 임계는 «위험한가» 에 답하지만 «평소와 다른가» 에는 답하지 못한다 —
// 평소 20 TPS 인 곳에서 8 TPS 는 임계 안이어도 사건이다.
//
// **어제 것은 한 번만 받으면 된다.** 지난 하루는 더 이상 바뀌지 않는다.

import { aggregate, totalMode } from '../xlog/components/counterTotal';
import type { CounterName } from '../xlog/types/counter';
import type { CounterSeries } from '../xlog/api/scouterApi';
import { nearestIndex } from './timelineScale';

/**
 * 어제 같은 시각.
 *
 * **24시간을 빼지 않는다.** 서머타임이 있는 곳에서는 하루가 23시간이거나 25시간이라,
 * 밀리초로 빼면 «어제 이 시각» 이 한 시간씩 어긋난다. 달력으로 하루를 물린다.
 */
export function sameTimeYesterday(now: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return d.getTime();
}

/**
 * 어제 것을 «같은 시각» 으로 인정할 최대 거리.
 *
 * 어제 누적은 5분 버킷이다. 이보다 멀리 있는 버킷을 집으면 트래픽이 없던 시간대의
 * 엉뚱한 값을 «어제 이 시각» 이라고 적게 된다.
 */
export const NEAR_ENOUGH_MS = 5 * 60_000;

/**
 * 어제 그 시각의 접은 값. 없으면 null.
 *
 * **오브젝트별 값을 지금과 같은 방식으로 접는다** — 지금은 합계인데 어제는 평균이면
 * 두 수를 견주는 것이 아무 뜻이 없다 (`counterTotal.totalMode`).
 */
export function yesterdayValue(
  series: readonly CounterSeries[],
  picked: ReadonlySet<number>,
  counter: CounterName,
  atMs: number,
): number | null {
  const values: number[] = [];
  for (const s of series) {
    if (!picked.has(s.obj_hash)) continue;
    const idx = nearestIndex(s.times, atMs);
    if (idx < 0) continue;
    if (Math.abs(s.times[idx] - atMs) > NEAR_ENOUGH_MS) continue;
    const v = s.values[idx];
    // **null 은 «그 시각에 수집이 없었다» 다.** 0 으로 세면 «어제는 놀았다» 가 된다.
    if (v !== null && Number.isFinite(v)) values.push(v);
  }
  return aggregate(values, totalMode(counter));
}
