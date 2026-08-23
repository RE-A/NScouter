// 프로파일 스텝 레이아웃 계산
//
// 트랜잭션의 "시간이 어디로 갔나"를 숫자 암산이 아니라 **모양**으로 읽게 하려고 만든다.
// 막대 위치가 틀리면 조용히 거짓말을 하므로 테스트로 고정한다.

import { describe, it, expect } from 'vitest';
import { stepDepth, waterfallGeometry } from './stepLayout';

describe('waterfallGeometry', () => {
  it('시작 시각과 소요 시간을 전체 대비 비율로 준다', () => {
    const g = waterfallGeometry(250, 500, 1000);
    expect(g.leftPct).toBeCloseTo(25);
    expect(g.widthPct).toBeCloseTo(50);
  });

  it('맨 앞에서 시작하면 left 가 0이다', () => {
    expect(waterfallGeometry(0, 100, 1000).leftPct).toBe(0);
  });

  // elapsed 0 인 스텝(대부분의 메서드)도 위치는 보여야 한다.
  // 폭이 0이면 화면에서 사라져 "언제 실행됐는지"를 잃는다.
  it('소요 시간이 0이어도 최소 폭을 준다', () => {
    const g = waterfallGeometry(500, 0, 1000);
    expect(g.leftPct).toBeCloseTo(50);
    expect(g.widthPct).toBeGreaterThan(0);
  });

  // 전체를 모르면 비율을 못 낸다. 0으로 나누면 NaN 이 되어 막대가 사라진다.
  it('전체가 0이면 NaN 대신 0을 준다', () => {
    const g = waterfallGeometry(10, 20, 0);
    expect(Number.isFinite(g.leftPct)).toBe(true);
    expect(Number.isFinite(g.widthPct)).toBe(true);
  });

  // 프로파일 스텝의 합이 XLog elapsed 를 넘길 수 있다(측정 시점 차이).
  // 막대가 트랙 밖으로 나가면 레이아웃이 깨진다.
  it('트랙을 넘지 않는다', () => {
    const g = waterfallGeometry(900, 500, 1000);
    expect(g.leftPct + g.widthPct).toBeLessThanOrEqual(100);
  });

  it('음수 입력에도 트랙 안에 머문다', () => {
    const g = waterfallGeometry(-50, -10, 1000);
    expect(g.leftPct).toBeGreaterThanOrEqual(0);
    expect(g.widthPct).toBeGreaterThan(0);
  });
});

describe('stepDepth', () => {
  // `parent` 는 **부모 스텝의 index** 지 깊이가 아니다.
  // 이걸 깊이로 쓰면 parent=50 인 스텝이 600px 들여쓰기된다.
  const parents = [-1, 0, 1, 1, -1];

  it('루트는 깊이 0', () => {
    expect(stepDepth(parents, 0)).toBe(0);
    expect(stepDepth(parents, 4)).toBe(0);
  });

  it('부모를 따라 깊이를 센다', () => {
    expect(stepDepth(parents, 1)).toBe(1);
    expect(stepDepth(parents, 2)).toBe(2);
    expect(stepDepth(parents, 3)).toBe(2);
  });

  // 잘못된 데이터로 무한 루프에 빠지면 화면이 멈춘다.
  it('부모가 자기 자신이어도 멈춘다', () => {
    expect(stepDepth([0], 0)).toBe(0);
  });

  it('부모가 순환해도 멈춘다', () => {
    const d = stepDepth([1, 0], 0);
    expect(Number.isFinite(d)).toBe(true);
  });

  it('범위 밖 parent 는 루트로 본다', () => {
    expect(stepDepth([99], 0)).toBe(0);
  });

  // 깊이가 깊어도 좁은 패널에서 내용이 밀려나면 안 된다.
  it('깊이에 상한이 있다', () => {
    const deep = Array.from({ length: 30 }, (_, i) => i - 1);
    expect(stepDepth(deep, 29)).toBeLessThanOrEqual(6);
  });
});
