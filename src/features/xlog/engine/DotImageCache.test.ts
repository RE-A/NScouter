// 점 그림 캐시
//
// 점 하나는 5x5 이고 프레임마다 수만 번 찍힌다. 매번 새로 그리면 그 자체가 부하다.
// 여기서 지키는 것은 **같은 색·같은 크기면 같은 그림을 돌려준다** 와
// **원본(ASIS ImageCache.createXPImage6)의 흰 점 4개를 그대로 찍는다** 둘이다.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DotImageCache } from './DotImageCache';
import { FakeOffscreenCanvas, installFakeOffscreenCanvas, opsOf } from '../../../test/fakeCanvas';

let uninstall: () => void;

beforeAll(() => {
  uninstall = installFakeOffscreenCanvas();
});

afterAll(() => {
  uninstall();
});

/** 가짜 캔버스에 받아 적힌 그리기 기록 */
function opsOfDot(dot: OffscreenCanvas, op: string) {
  return opsOf((dot as unknown as FakeOffscreenCanvas).ctx, op);
}

describe('DotImageCache', () => {
  it('같은 색·크기를 다시 물으면 **그때 만든 그것**을 준다', () => {
    const cache = new DotImageCache();
    const a = cache.getDot('#ff0000', 5);
    const b = cache.getDot('#ff0000', 5);
    expect(b).toBe(a);
  });

  it('색이나 크기가 다르면 다른 그림이다', () => {
    const cache = new DotImageCache();
    const red = cache.getDot('#ff0000', 5);
    expect(cache.getDot('#00ff00', 5)).not.toBe(red);
    expect(cache.getDot('#ff0000', 7)).not.toBe(red);
  });

  it('크기대로 만들고 그 색으로 전부 칠한다', () => {
    const cache = new DotImageCache();
    const dot = cache.getDot('#123456', 5);

    expect(dot.width).toBe(5);
    expect(dot.height).toBe(5);

    const fills = opsOfDot(dot, 'fillRect');
    expect(fills[0].args).toEqual([0, 0, 5, 5]);
    expect(fills[0].fillStyle).toBe('#123456');
  });

  it('5px 이상이면 흰 점 4개를 원본 좌표에 찍는다', () => {
    const cache = new DotImageCache();
    const fills = opsOfDot(cache.getDot('#123456', 5), 'fillRect');

    // 첫 칸은 바탕. 나머지 넷이 노이즈다
    expect(fills).toHaveLength(5);
    expect(fills.slice(1).map(f => f.args)).toEqual([
      [1, 0, 1, 1],
      [4, 1, 1, 1],
      [0, 3, 1, 1],
      [3, 4, 1, 1],
    ]);
    expect(fills[1].fillStyle).toBe('rgba(255,255,255,0.6)');
  });

  it('5px 보다 작으면 노이즈를 넣지 않는다 — 넣을 자리가 없다', () => {
    const cache = new DotImageCache();
    const fills = opsOfDot(cache.getDot('#123456', 3), 'fillRect');
    expect(fills).toHaveLength(1);
    expect(fills[0].args).toEqual([0, 0, 3, 3]);
  });

  it('clear 는 전부 버린다 — 다음에 물으면 새로 만든다', () => {
    const cache = new DotImageCache();
    const before = cache.getDot('#ff0000', 5);
    cache.clear();
    expect(cache.getDot('#ff0000', 5)).not.toBe(before);
  });

  it('invalidate 는 그것 하나만 버린다', () => {
    const cache = new DotImageCache();
    const red = cache.getDot('#ff0000', 5);
    const green = cache.getDot('#00ff00', 5);

    cache.invalidate('#ff0000', 5);

    expect(cache.getDot('#ff0000', 5)).not.toBe(red);
    expect(cache.getDot('#00ff00', 5)).toBe(green);
  });
});
