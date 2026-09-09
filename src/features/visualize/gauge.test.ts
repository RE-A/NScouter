// 게이지 눈금 — **자를 만들어 내지 않는가.**
//
// 게이지에서 가장 쉬운 거짓말이 «적당한 최대치» 다. 여기서 지키는 것은 셋:
//   · 눈금의 출처가 임계이거나 관측이거나, 둘 중 하나임을 화면이 알 수 있다
//   · 표본이 없으면 눈금을 만들지 않는다
//   · 눈금을 넘은 값을 지우지 않고, 넘었다는 사실을 들고 나간다

import { describe, expect, it } from 'vitest';
import {
  arcPath,
  gaugeScale,
  needleAt,
  niceMax,
  observedScale,
  polar,
  scaleLabel,
  thresholdScale,
} from './gauge';

describe('niceMax', () => {
  it('1 · 2 · 2.5 · 5 의 자릿수 배수만 쓴다', () => {
    // `4,500ms` 같은 끝 눈금이 나오면 바늘을 읽을 때마다 나눗셈을 해야 한다.
    expect(niceMax(4_500)).toBe(5_000);
    expect(niceMax(7.5)).toBe(10);
    expect(niceMax(135)).toBe(200);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(2.1)).toBe(2.5);
  });

  it('말이 안 되는 수에도 눈금은 남는다', () => {
    // 0 을 돌려주면 나눗셈이 무한대가 되어 바늘이 사라진다.
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
    expect(niceMax(NaN)).toBe(1);
  });
});

describe('thresholdScale', () => {
  it('끝은 위험의 1.5배다 — 넘어선 정도를 볼 수 있어야 한다', () => {
    // 위험을 끝으로 두면 넘어선 순간 바늘이 벽에 붙어 «얼마나» 를 잃는다.
    const s = thresholdScale({ warn: 1_000, danger: 3_000 }, false);
    expect(s.max).toBe(5_000);
    expect(s.kind).toBe('threshold');
  });

  it('백분율은 100 을 넘지 않는다', () => {
    // CPU 위험 90 × 1.5 = 135% 짜리 눈금은 없는 자다.
    expect(thresholdScale({ warn: 70, danger: 90 }, true).max).toBe(100);
    expect(thresholdScale({ warn: 70, danger: 90 }, false).max).toBe(200);
  });

  it('주의·위험 구간만 자리를 잡는다', () => {
    // 괜찮은 구간까지 칠하면 화면이 늘 알록달록해 빨간 하나가 안 보인다.
    const s = thresholdScale({ warn: 50, danger: 100 }, false);
    expect(s.zones.map(z => z.grade)).toEqual(['warn', 'danger']);
    // 위험 100 × 1.5 = 150 → 눈금 끝은 «보기 좋은 수» 200 이다.
    expect(s.max).toBe(200);
    expect(s.zones[0].from).toBeCloseTo(0.25); // 주의 50
    expect(s.zones[1].from).toBeCloseTo(0.5); // 위험 100
    expect(s.zones[1].to).toBe(1);
  });

  it('임계가 눈금 밖이면 그 구간을 그리지 않는다', () => {
    // 백분율에서 위험을 150 으로 적어 둔 경우. 없는 자리에 색을 칠하지 않는다.
    const s = thresholdScale({ warn: 150, danger: 200 }, true);
    expect(s.max).toBe(100);
    expect(s.zones).toEqual([]);
  });
});

describe('observedScale', () => {
  it('최근 최대를 눈금 끝으로 삼는다', () => {
    const s = observedScale([3, 18, 7]);
    expect(s?.max).toBe(20);
    expect(s?.kind).toBe('observed');
  });

  it('상대 눈금에는 구간 색이 없다', () => {
    // 바늘이 끝에 있어도 «위험» 이 아니라 «최근 중 제일 높다» 다.
    expect(observedScale([5])?.zones).toEqual([]);
  });

  it('표본이 없으면 눈금을 만들지 않는다', () => {
    // 없는 자를 그려 놓고 바늘을 얹으면 그 자리가 통째로 거짓이다.
    expect(observedScale([])).toBeNull();
    expect(observedScale([0, 0])).toBeNull();
    expect(observedScale([NaN])).toBeNull();
  });
});

describe('gaugeScale', () => {
  it('사람이 정한 자가 관측보다 앞선다', () => {
    const s = gaugeScale({ warn: 1, danger: 5 }, [999], true);
    expect(s?.kind).toBe('threshold');
    expect(s?.max).toBe(10);
  });

  it('임계가 없으면 관측으로 간다', () => {
    expect(gaugeScale(null, [40], false)?.kind).toBe('observed');
  });

  it('임계도 표본도 없으면 게이지가 없다', () => {
    expect(gaugeScale(null, [], false)).toBeNull();
  });
});

describe('needleAt', () => {
  it('눈금을 넘으면 끝에 붙이고 넘었다고 말한다', () => {
    // 지워 버리면 제일 큰 값일 때 바늘이 사라져 «값이 없다» 로 읽힌다.
    expect(needleAt(150, 100)).toEqual({ frac: 1, over: true });
    expect(needleAt(50, 100)).toEqual({ frac: 0.5, over: false });
  });

  it('값이 없으면 바늘도 없다', () => {
    expect(needleAt(null, 100)).toBeNull();
    expect(needleAt(NaN, 100)).toBeNull();
  });

  it('음수는 0 자리다', () => {
    expect(needleAt(-3, 100)?.frac).toBe(0);
  });
});

describe('polar', () => {
  it('왼쪽 끝에서 오른쪽 끝으로 도는 반원이다', () => {
    const left = polar(50, 50, 40, 0);
    const top = polar(50, 50, 40, 0.5);
    const right = polar(50, 50, 40, 1);

    expect(left.x).toBeCloseTo(10);
    expect(left.y).toBeCloseTo(50);
    expect(top.x).toBeCloseTo(50);
    expect(top.y).toBeCloseTo(10);
    expect(right.x).toBeCloseTo(90);
    expect(right.y).toBeCloseTo(50);
  });
});

describe('arcPath', () => {
  it('큰 호 플래그를 쓰지 않는다 — 반원이라 조각이 180°를 넘지 않는다', () => {
    expect(arcPath(50, 50, 40, 0, 1)).toMatch(/A 40 40 0 0 1/);
  });

  it('시작과 끝이 눈금 위치와 맞는다', () => {
    expect(arcPath(50, 50, 40, 0, 0.5)).toBe('M 10 50 A 40 40 0 0 1 50 10');
  });
});

describe('scaleLabel', () => {
  it('자릿수가 길면 줄여 적는다', () => {
    // 반원 밑에 적히는 자리라 길면 넘친다.
    expect(scaleLabel(100)).toBe('100');
    expect(scaleLabel(5_000)).toBe('5k');
    expect(scaleLabel(2_500_000)).toBe('2.5M');
    expect(scaleLabel(2.5)).toBe('2.5');
  });
});
