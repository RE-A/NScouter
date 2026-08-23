// 카운터 합산 (ASIS CounterRealTimeTotalView)
//
// 오브젝트별 선을 겹쳐 보는 화면과 **합쳐서 한 선으로 보는 화면**은 다른 질문에 답한다.
// 앞은 "어느 서버가 이상한가", 뒤는 "전체가 견디고 있나"다.
//
// **전부 더하면 안 된다.** CPU 두 대가 각각 50% 인데 100% 라고 그리면 거짓말이다.
// ASIS 도 카운터마다 sum / avg 를 갈라 쓴다 (`CounterUtil.getTotalMode`).

import { counterMeta, type CounterName } from '../types/counter';

export type TotalMode = 'sum' | 'avg';

/**
 * 단위가 % 가 아닌데도 평균으로 봐야 하는 카운터 (ASIS `counterAvgSet`).
 *
 * 응답시간은 더하면 뜻이 없다 — 두 서버가 각각 100ms 인 것과
 * 한 서버가 200ms 인 것은 전혀 다른 상황인데 합계는 같다.
 */
const AVG_COUNTERS: readonly string[] = ['ErrorRate', 'ElapsedTime', 'Elapsed90%'];

export function totalMode(counter: CounterName): TotalMode {
  if (AVG_COUNTERS.includes(counter)) return 'avg';
  return counterMeta(counter).unit === '%' ? 'avg' : 'sum';
}

/**
 * 한 시점의 오브젝트 값들을 하나로 접는다.
 *
 * **값이 없을 때 0을 만들어 내지 않는다.** 0은 "전부 멈췄다"는 뜻이라
 * 수집이 안 된 구간과 구별되지 않는다 — 그래서 null 이다.
 */
export function aggregate(values: readonly number[], mode: TotalMode): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, v) => a + v, 0);
  return mode === 'avg' ? sum / values.length : sum;
}
