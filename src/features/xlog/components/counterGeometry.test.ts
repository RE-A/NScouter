// 카운터 차트의 시간축 좌표
//
// 이전 식은 표본 인덱스를 **버퍼 용량**으로 나눴다:
//
//     const x = (j / (MAX_COUNTER_SAMPLES - 1)) * w;
//
// 표본이 12개면 12/154 ≈ 8% 만 그려지고 나머지 폭이 비었다.
// 폭이 차려면 5분(155 × 2초)을 기다려야 했고, 그 사이 화면은 고장으로 보인다.
// 게다가 선이 왼쪽에서 오른쪽으로 자란다 — 모니터링 차트는 최신이 오른쪽이다.

import { describe, it, expect } from 'vitest';
import { sampleX, totalLineVisible } from './counterGeometry';

const W = 1000;
const CAP = 155;

describe('sampleX', () => {
  it('가장 최신 표본은 오른쪽 끝에 붙는다', () => {
    expect(sampleX(11, 12, W, CAP)).toBe(W);
    expect(sampleX(154, 155, W, CAP)).toBe(W);
  });

  it('버퍼가 다 차면 가장 오래된 표본이 왼쪽 끝이다', () => {
    expect(sampleX(0, CAP, W, CAP)).toBe(0);
  });

  // 이게 회귀 테스트다. 예전 식은 여기서 80(=11/154*1000) 근처를 돌려줬다.
  it('표본이 적으면 왼쪽이 아니라 오른쪽에 모인다', () => {
    const newest = sampleX(11, 12, W, CAP);
    const oldest = sampleX(0, 12, W, CAP);
    expect(newest).toBe(W);
    expect(oldest).toBeGreaterThan(W * 0.9);
    expect(oldest).toBeLessThan(W);
  });

  it('표본 1개는 오른쪽 끝에 점 하나로 놓인다', () => {
    expect(sampleX(0, 1, W, CAP)).toBe(W);
  });

  // 시간축은 표본 수와 무관하게 고정이어야 한다.
  // 표본이 늘어도 이미 그려진 점이 옆으로 밀리면 안 된다(간격이 일정해야 한다).
  it('표본 간격은 표본 수와 무관하게 일정하다', () => {
    const step = W / (CAP - 1);
    const gapEarly = sampleX(11, 12, W, CAP) - sampleX(10, 12, W, CAP);
    const gapLater = sampleX(99, 100, W, CAP) - sampleX(98, 100, W, CAP);
    expect(gapEarly).toBeCloseTo(step, 6);
    expect(gapLater).toBeCloseTo(step, 6);
  });

  it('용량이 1이어도 0으로 나누지 않는다', () => {
    expect(Number.isFinite(sampleX(0, 1, W, 1))).toBe(true);
  });
});

describe('totalLineVisible', () => {
  it('총량이 사용량과 비슷한 규모면 기준선을 그린다', () => {
    // Heap: 총 114MB / 사용 44MB — 같은 축에 놓으면 "얼마나 남았나"가 보인다.
    expect(totalLineVisible(44, 114)).toBe(true);
  });

  it('총량이 지나치게 크면 그리지 않는다', () => {
    // FdUsage: 상한 1,048,576 / 열린 것 36. 같은 축에 놓으면 사용량 선이
    // 바닥에 붙어 **추세가 통째로 사라진다.** 숫자로만 보여주는 편이 낫다.
    expect(totalLineVisible(36, 1_048_576)).toBe(false);
  });

  it('총량이 없으면 그리지 않는다', () => {
    expect(totalLineVisible(44, null)).toBe(false);
  });

  it('사용량이 0이어도 터지지 않는다', () => {
    expect(totalLineVisible(0, 100)).toBe(false);
  });
});
