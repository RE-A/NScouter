// 지표 줄이 화면에 무엇을 적는가.
//
// 스파크라인 말고는 전부 글자라 jsdom 에서 그대로 읽을 수 있다.
// 색은 클래스로만 드러나므로 «띠가 붙었는가» 로 본다 — 등급 판정 자체는
// `threshold.test.ts` 가 맡는다.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KPI_DEFS, KPI_IDS, type KpiId } from './kpi';
import { KpiStrip } from './KpiStrip';
import { DEFAULT_THRESHOLDS, type ThresholdMap } from './threshold';
import type { KpiSample, KpiSamples } from './useKpiSamples';

function samples(over: Partial<Record<KpiId, KpiSample>>): KpiSamples {
  const out = {} as KpiSamples;
  for (const id of KPI_IDS) out[id] = over[id] ?? { value: null, samples: [] };
  return out;
}

/** 세 Family 를 다 고른 상태. 「안 고른 Family」 는 아래 절에서 따로 본다 */
const ALL_FAMILIES: ReadonlySet<string> = new Set(['javaee', 'host', 'datasource']);

function draw(
  over: Partial<Record<KpiId, KpiSample>>,
  opts: {
    lastReceivedAt?: number | null;
    thresholds?: ThresholdMap;
    families?: ReadonlySet<string>;
  } = {},
) {
  return render(
    <KpiStrip
      kpis={samples(over)}
      lastReceivedAt={opts.lastReceivedAt === undefined ? Date.now() : opts.lastReceivedAt}
      connected
      thresholds={opts.thresholds ?? DEFAULT_THRESHOLDS}
      families={opts.families ?? ALL_FAMILIES}
    />,
  );
}

describe('KpiStrip', () => {
  it('지표를 하나도 빠뜨리지 않는다', () => {
    draw({});
    for (const def of KPI_DEFS) {
      expect(screen.getAllByText(def.label).length).toBeGreaterThan(0);
    }
  });

  it('아직 값이 없으면 0이 아니라 줄표다', () => {
    // 0을 적으면 «지금 0 TPS» 로 읽혀 트래픽이 끊긴 것처럼 보인다.
    draw({});
    expect(screen.getAllByText('—').length).toBe(KPI_DEFS.length);
  });

  it('자릿수를 끊어 적는다', () => {
    draw({ tps: { value: 1234.5, samples: [1234.5] } });
    expect(screen.getByText('1,234.5')).toBeTruthy();
  });

  it('지표마다 정해진 소수 자릿수를 지킨다', () => {
    // 2초마다 자릿수가 늘었다 줄었다 하면 숫자가 흔들려 보인다.
    draw({
      elapsed: { value: 320.7, samples: [320.7] },
      error: { value: 0.5, samples: [0.5] },
    });
    expect(screen.getByText('321')).toBeTruthy();
    expect(screen.getByText('0.50')).toBeTruthy();
  });

  it('임계를 넘으면 띠가 붙는다', () => {
    // CPU 기본 임계는 주의 70 · 위험 90.
    const { container } = draw({ cpu: { value: 95, samples: [95] } });
    expect(container.querySelectorAll('.bg-danger').length).toBe(1);
    expect(container.querySelectorAll('.bg-warn').length).toBe(0);
  });

  it('주의 구간은 주의 색이다', () => {
    const { container } = draw({ cpu: { value: 75, samples: [75] } });
    expect(container.querySelectorAll('.bg-warn').length).toBe(1);
    expect(container.querySelectorAll('.bg-danger').length).toBe(0);
  });

  it('임계 안이면 아무 색도 쓰지 않는다', () => {
    // 괜찮은 값까지 칠하면 화면이 늘 알록달록해 정작 빨간 하나가 안 보인다.
    const { container } = draw({ cpu: { value: 20, samples: [20] } });
    expect(container.querySelectorAll('.bg-warn, .bg-danger').length).toBe(0);
  });

  it('임계를 끈 지표는 아무리 커도 색이 없다', () => {
    // TPS 는 200이 평시인 곳도 있고 20이 비상인 곳도 있다.
    const { container } = draw({ tps: { value: 99_999, samples: [99_999] } });
    expect(container.querySelectorAll('.bg-warn, .bg-danger').length).toBe(0);
  });

  it('임계를 마우스로 확인할 수 있다', () => {
    // 어디에도 안 적으면 노란색이 왜 노란지 알 수 없다.
    // 임계도 **값과 같은 자릿수**로 적는다 — 타일에는 62.4 라고 떠 있는데
    // 임계가 70 이면 두 수를 같은 자로 견주는 것인지 잠깐 멈추게 된다.
    draw({ cpu: { value: 75, samples: [75] } });
    expect(screen.getByTitle('CPU — 주의 70.0 · 위험 90.0')).toBeTruthy();
  });

  it('임계가 없으면 없다고 적는다', () => {
    draw({});
    expect(screen.getByTitle('TPS — 임계 없음')).toBeTruthy();
  });

  it('받고 있는 동안에는 상태를 적지 않는다', () => {
    // 정상일 때까지 문구가 붙어 있으면 그 자리를 읽지 않게 된다.
    draw({ tps: { value: 10, samples: [10] } });
    expect(screen.queryByText(/수신/)).toBeNull();
  });

  it('한 번도 못 받았으면 대기 중이라고 적는다', () => {
    draw({}, { lastReceivedAt: null });
    expect(screen.getByText(/수신 대기 중/)).toBeTruthy();
  });

  it('오래 끊기면 값이 남아 있어도 그렇다고 적는다', () => {
    // **마지막 값을 정상인 척 붙들고 있으면 안 된다.**
    draw({ tps: { value: 10, samples: [10] } }, { lastReceivedAt: Date.now() - 30_000 });
    expect(screen.getByText(/수신 없음/)).toBeTruthy();
  });
});

describe('KpiStrip — 안 고른 Family', () => {
  it('그 지표를 주는 서버를 안 골랐다고 말한다', () => {
    // CPU 는 host 만 준다. tomcat 만 골라 두면 값이 영영 안 오는데,
    // 줄표만 띄우면 고장으로 읽힌다.
    draw({}, { families: new Set(['javaee']) });
    expect(screen.getByTitle('CPU — 이 지표를 주는 서버를 안 골랐습니다')).toBeTruthy();
  });

  it('그런 타일에는 «미선택» 을 적는다', () => {
    draw({}, { families: new Set(['javaee']) });
    expect(screen.getByText('미선택')).toBeTruthy();
  });

  it('고른 Family 의 타일은 그대로다', () => {
    draw({ tps: { value: 10, samples: [10] } }, { families: new Set(['javaee']) });
    expect(screen.getByTitle('TPS — 임계 없음')).toBeTruthy();
  });
});
