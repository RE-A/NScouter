// 한눈 지표(KPI) — 무엇을 띄우고 어떻게 접을지. **순수 함수다.**
//
// Counter 탭은 카운터 40장을 같은 무게로 나열한다. 그건 «무엇이 어떻게 변했나» 에는
// 답하지만 «지금 정상인가» 에는 답하지 않는다 — 40장을 다 훑어야 알기 때문이다.
// 여기 있는 여섯 개는 그 질문 하나에만 답한다.
//
// **여섯인 이유**: 한 줄에 놓고 눈이 한 번에 훑을 수 있는 수다. 늘리면 다시 나열이 되고,
// 나열은 Counter 탭이 이미 한다.

import type { CounterName, CounterValue } from '../xlog/types/counter';
import { aggregate, totalMode } from '../xlog/components/counterTotal';

export type KpiId = 'tps' | 'elapsed' | 'error' | 'active' | 'cpu' | 'heap';

export interface KpiDef {
  id: KpiId;
  /** counters.xml 표기 그대로. 틀리면 에러 없이 0건이 온다 (F-15) */
  counter: CounterName;
  /** 화면에 적을 이름. 카운터 표시명(`counterMeta`)보다 짧다 — 타일이 좁다 */
  label: string;
  unit: string;
  /**
   * 쌍 카운터를 «사용량 / 상한 %» 로 읽는다.
   *
   * 없으면 접는 방식은 `counterTotal.totalMode` 가 정한다. **여기 두 벌로 두지 않는다** —
   * 갈리면 같은 카운터가 Counter 탭의 합계 선과 다른 수를 낸다.
   */
  ratio?: boolean;
  /** 화면에 적을 소수 자릿수 */
  digits: number;
}

/**
 * 순서가 곧 화면 순서다.
 *
 * 앞의 넷은 «들어오는 것»(javaee), 뒤의 둘은 «버티는 것»(host). 섞으면 눈이
 * 매번 어느 쪽 이야기인지 다시 판단해야 한다.
 */
export const KPI_DEFS: readonly KpiDef[] = [
  { id: 'tps', counter: 'TPS', label: 'TPS', unit: '', digits: 1 },
  { id: 'elapsed', counter: 'ElapsedTime', label: '응답시간', unit: 'ms', digits: 0 },
  { id: 'error', counter: 'ErrorRate', label: '에러율', unit: '%', digits: 2 },
  { id: 'active', counter: 'ActiveService', label: '액티브', unit: '', digits: 0 },
  { id: 'cpu', counter: 'Cpu', label: 'CPU', unit: '%', digits: 1 },
  // 사용량(MB)만 크게 띄우면 여유가 있는지 없는지는 알 수 없다. 상한과 함께 %로 읽는다.
  { id: 'heap', counter: 'HeapTotUsage', label: 'Heap', unit: '%', ratio: true, digits: 1 },
];

export const KPI_IDS: readonly KpiId[] = KPI_DEFS.map(d => d.id);

/** 카운터명 → 정의. 스트림은 카운터 단위로 오므로 이 방향으로 찾는다 */
export function kpiByCounter(counter: string): KpiDef | undefined {
  return KPI_DEFS.find(d => d.counter === counter);
}

/**
 * 한 시점의 오브젝트 값들을 지표 하나로 접는다.
 *
 * **접히지 않으면 null 이다.** 0을 만들어 내면 «전부 멈췄다» 로 읽히고,
 * 그건 수집이 안 된 것과 전혀 다른 상황이다 (`counterTotal.aggregate` 와 같은 규칙).
 */
export function foldKpi(def: KpiDef, values: readonly CounterValue[]): number | null {
  if (values.length === 0) return null;

  if (def.ratio) {
    let used = 0;
    let cap = 0;
    for (const v of values) {
      // 상한이 없는 행은 비율을 만들 수 없다. 사용량만 더해 놓으면 분모가 작아져
      // 있지도 않은 «포화» 가 뜬다.
      if (typeof v.total !== 'number' || !Number.isFinite(v.total) || v.total <= 0) continue;
      used += v.value;
      cap += v.total;
    }
    return cap > 0 ? (used / cap) * 100 : null;
  }

  return aggregate(values.map(v => v.value), totalMode(def.counter));
}

/**
 * 추세를 말하려면 이만큼은 쌓여야 한다.
 *
 * 두세 점으로 «30% 올랐다» 고 적으면 카운터가 한 번 튄 것을 사건으로 만든다.
 * 2초 폴링이라 5점이면 10초다.
 */
export const TREND_MIN_SAMPLES = 5;

/**
 * 지금 값이 최근 흐름에서 얼마나 벗어났는가 (%).
 *
 * 기준은 **마지막을 뺀 나머지의 평균**이다. 마지막까지 넣으면 자기 자신이 기준에
 * 섞여 변화가 늘 실제보다 작게 나온다.
 *
 * 말할 수 없으면 null 이다 — 표본이 모자라거나, 기준이 0 이거나.
 * 0에서 5로 간 것은 «무한대 증가» 가 아니라 «없다가 생겼다» 이고, 그건 값 자체가 말한다.
 */
export function trendPct(samples: readonly number[]): number | null {
  if (samples.length < TREND_MIN_SAMPLES) return null;

  const last = samples[samples.length - 1];
  const before = samples.slice(0, -1);
  const base = before.reduce((sum, v) => sum + v, 0) / before.length;
  if (base === 0 || !Number.isFinite(base) || !Number.isFinite(last)) return null;

  return ((last - base) / base) * 100;
}

/**
 * 숫자를 화면에 적을 글자로.
 *
 * **`toLocaleString` 을 쓰지 않는다.** 자릿수 구분이 실행 환경(ICU)에 따라 달라져
 * 같은 코드가 어디서는 `1,234` 를, 어디서는 `1234` 를 낸다.
 */
export function formatKpi(value: number | null, digits: number): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const [int, frac] = value.toFixed(digits).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

/** 추세를 적을 글자. 없으면 빈 문자열 */
export function formatTrend(pct: number | null): string {
  if (pct === null) return '';
  // 소수점까지 적으면 2초마다 뒷자리가 흔들려 «움직인다» 는 인상만 남는다.
  const rounded = Math.round(pct);
  if (rounded === 0) return '';
  return `${rounded > 0 ? '▲' : '▼'}${Math.abs(rounded)}%`;
}
