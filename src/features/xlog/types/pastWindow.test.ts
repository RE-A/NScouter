// 과거 구간을 옮길 때 무엇을 더 받는가
//
// 좌우로 옮길 때마다 창 전체를 다시 받으면 같은 데이터를 매번 수만 건씩 끌어온다.

import { describe, expect, it } from 'vitest';
import { fetchSpan, planFetch } from './pastWindow';

const r = (stime: number, etime: number) => ({ stime, etime });

describe('planFetch', () => {
  it('처음에는 창 전체를 받는다', () => {
    const plan = planFetch(r(100, 200), null);
    expect(plan).toEqual({ reset: true, fetch: [r(100, 200)], loaded: r(100, 200) });
  });

  it('받아 둔 구간 안쪽이면 아무것도 안 받는다', () => {
    // 확대·축소가 여기로 온다.
    const plan = planFetch(r(120, 180), r(100, 200));
    expect(plan.fetch).toEqual([]);
    expect(plan.reset).toBe(false);
    expect(plan.loaded).toEqual(r(100, 200));
  });

  it('오른쪽으로 옮기면 **뒤쪽만** 받는다', () => {
    const plan = planFetch(r(150, 250), r(100, 200));
    expect(plan.fetch).toEqual([r(200, 250)]);
    expect(plan.reset).toBe(false);
    expect(plan.loaded).toEqual(r(100, 250));
    // 창은 100 인데 받는 것은 50 뿐이다
    expect(fetchSpan(plan)).toBe(50);
  });

  it('왼쪽으로 옮기면 앞쪽만 받는다', () => {
    const plan = planFetch(r(50, 150), r(100, 200));
    expect(plan.fetch).toEqual([r(50, 100)]);
    expect(plan.loaded).toEqual(r(50, 200));
  });

  it('양쪽으로 넓히면 양쪽을 받는다', () => {
    const plan = planFetch(r(50, 250), r(100, 200));
    expect(plan.fetch).toEqual([r(50, 100), r(200, 250)]);
    expect(fetchSpan(plan)).toBe(100);
  });

  it('멀리 뛰면 이어 붙이지 않고 새로 받는다', () => {
    // 사이가 비어 있는 채로 이어 붙이면 «없는 구간» 이 있는 줄 모르고 보게 된다.
    const plan = planFetch(r(500, 600), r(100, 200));
    expect(plan).toEqual({ reset: true, fetch: [r(500, 600)], loaded: r(500, 600) });
  });

  it('닿아 있으면 이어 붙인다', () => {
    // 끝과 시작이 같은 자리는 빈 곳이 없다.
    const plan = planFetch(r(200, 300), r(100, 200));
    expect(plan.reset).toBe(false);
    expect(plan.fetch).toEqual([r(200, 300)]);
  });
});
