import { describe, expect, it } from 'vitest';
import type { CounterValue } from '../xlog/types/counter';
import {
  formatKpi,
  formatTrend,
  foldKpi,
  kpiByCounter,
  KPI_DEFS,
  KPI_IDS,
  trendPct,
  TREND_MIN_SAMPLES,
  type KpiDef,
} from './kpi';

const def = (id: string): KpiDef => {
  const found = KPI_DEFS.find(d => d.id === id);
  if (!found) throw new Error(`없는 지표: ${id}`);
  return found;
};

const val = (obj_hash: number, value: number, total?: number): CounterValue =>
  total === undefined ? { obj_hash, value } : { obj_hash, value, total };

describe('KPI 정의', () => {
  it('지표마다 카운터가 하나씩이고 겹치지 않는다', () => {
    // 두 타일이 같은 카운터를 보면 같은 수가 두 번 뜬다.
    const counters = KPI_DEFS.map(d => d.counter);
    expect(new Set(counters).size).toBe(KPI_DEFS.length);
  });

  it('KPI_IDS 는 정의 순서 그대로다', () => {
    // 화면 순서와 저장 순서가 갈리면 설정 창의 줄과 스트립의 타일이 어긋난다.
    expect(KPI_IDS).toEqual(KPI_DEFS.map(d => d.id));
  });

  it('카운터명으로 정의를 찾는다', () => {
    // 스트림은 카운터 단위로 오므로 이 방향으로만 찾을 수 있다.
    expect(kpiByCounter('TPS')?.id).toBe('tps');
    expect(kpiByCounter('HeapTotUsage')?.id).toBe('heap');
    expect(kpiByCounter('GcCount')).toBeUndefined();
  });
});

describe('foldKpi — 접기', () => {
  it('TPS 는 서버를 더한다', () => {
    expect(foldKpi(def('tps'), [val(1, 40), val(2, 60)])).toBe(100);
  });

  it('응답시간은 더하지 않고 평균낸다', () => {
    // 두 서버가 각각 100ms 인 것과 한 서버가 200ms 인 것은 전혀 다르다.
    expect(foldKpi(def('elapsed'), [val(1, 100), val(2, 300)])).toBe(200);
  });

  it('CPU 는 평균이다', () => {
    // 두 대가 각각 50% 인데 100% 라고 그리면 거짓말이다.
    expect(foldKpi(def('cpu'), [val(1, 40), val(2, 60)])).toBe(50);
  });

  it('접는 방식은 counterTotal 과 같은 것을 쓴다', () => {
    // Counter 탭의 «합계» 선과 다른 수가 나오면 두 화면 중 하나가 거짓말이다.
    expect(foldKpi(def('error'), [val(1, 2), val(2, 4)])).toBe(3);
  });

  it('대상이 없으면 0이 아니라 null 이다', () => {
    // 0은 "전부 멈췄다"라서 수집이 안 된 것과 구별되지 않는다.
    expect(foldKpi(def('tps'), [])).toBeNull();
  });
});

describe('foldKpi — 쌍 카운터 비율', () => {
  it('Heap 은 사용량/상한 % 로 접는다', () => {
    // HeapTotUsage 는 value=사용량, total=총량으로 온다 (F-33).
    expect(foldKpi(def('heap'), [val(1, 50, 200)])).toBeCloseTo(25, 6);
  });

  it('여러 서버는 사용량 합 / 상한 합이다', () => {
    // 서버별 %를 평균내면 힙이 큰 서버와 작은 서버가 같은 무게가 된다.
    // 1GB 중 900MB 쓴 서버와 100MB 중 10MB 쓴 서버의 평균은 «50%» 인데,
    // 실제로 위험한 것은 앞의 한 대다.
    expect(foldKpi(def('heap'), [val(1, 900, 1000), val(2, 10, 100)])).toBeCloseTo(82.7, 1);
  });

  it('상한이 없는 행은 분모에도 분자에도 넣지 않는다', () => {
    // 사용량만 더하면 분모가 작아져 있지도 않은 포화가 뜬다.
    expect(foldKpi(def('heap'), [val(1, 50, 200), val(2, 999)])).toBeCloseTo(25, 6);
  });

  it('상한이 하나도 없으면 null 이다', () => {
    // % 자리에 MB 를 적으면 74MB 가 «74%» 로 읽힌다.
    expect(foldKpi(def('heap'), [val(1, 74)])).toBeNull();
    expect(foldKpi(def('heap'), [val(1, 74, 0)])).toBeNull();
  });
});

describe('trendPct', () => {
  it('표본이 모자라면 말하지 않는다', () => {
    // 두세 점으로 «30% 올랐다» 고 적으면 한 번 튄 것을 사건으로 만든다.
    const few = Array.from({ length: TREND_MIN_SAMPLES - 1 }, () => 10);
    expect(trendPct(few)).toBeNull();
  });

  it('마지막 값을 그 앞의 평균과 견준다', () => {
    // 앞 넷의 평균 10 → 마지막 15 는 +50%
    expect(trendPct([10, 10, 10, 10, 15])).toBeCloseTo(50, 6);
  });

  it('마지막 값은 기준에 섞지 않는다', () => {
    // 섞으면 자기 자신이 기준을 끌어올려 변화가 늘 실제보다 작게 나온다.
    // 기준에 섞였다면 15/11 → +36% 가 나왔을 것이다.
    expect(trendPct([10, 10, 10, 10, 15])).not.toBeCloseTo(36, 0);
  });

  it('떨어진 것도 말한다', () => {
    expect(trendPct([10, 10, 10, 10, 5])).toBeCloseTo(-50, 6);
  });

  it('기준이 0이면 말하지 않는다', () => {
    // 0에서 5로 간 것은 «무한대 증가» 가 아니라 «없다가 생겼다» 다.
    expect(trendPct([0, 0, 0, 0, 5])).toBeNull();
  });

  it('변화가 없으면 0이다', () => {
    expect(trendPct([10, 10, 10, 10, 10])).toBe(0);
  });
});

describe('formatKpi', () => {
  it('자릿수를 끊어 적는다', () => {
    expect(formatKpi(1234, 0)).toBe('1,234');
    expect(formatKpi(1234567, 0)).toBe('1,234,567');
  });

  it('소수 자릿수를 맞춘다', () => {
    // 2초마다 자릿수가 늘었다 줄었다 하면 숫자가 흔들려 보인다.
    expect(formatKpi(3.14159, 2)).toBe('3.14');
    expect(formatKpi(3, 2)).toBe('3.00');
    expect(formatKpi(3.7, 0)).toBe('4');
  });

  it('음수도 자리를 끊는다', () => {
    expect(formatKpi(-1234, 0)).toBe('-1,234');
  });

  it('값이 없으면 0이 아니라 줄표다', () => {
    // 0을 적으면 «지금 0건» 으로 읽힌다.
    expect(formatKpi(null, 0)).toBe('—');
    expect(formatKpi(NaN, 0)).toBe('—');
    expect(formatKpi(Infinity, 1)).toBe('—');
  });
});

describe('formatTrend', () => {
  it('오르내림을 화살표로 적는다', () => {
    expect(formatTrend(12.4)).toBe('▲12%');
    expect(formatTrend(-30)).toBe('▼30%');
  });

  it('반올림해서 0이면 적지 않는다', () => {
    // ±0% 가 늘 붙어 있으면 «움직인다» 는 인상만 남기고 아무것도 알려 주지 않는다.
    expect(formatTrend(0)).toBe('');
    expect(formatTrend(0.4)).toBe('');
    expect(formatTrend(null)).toBe('');
  });
});
