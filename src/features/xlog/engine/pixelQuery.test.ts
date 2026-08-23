// 클릭 지점 근처의 점 찾기
//
// 스캐터의 점은 2~4px 이라 클릭이 정확히 같은 픽셀에 떨어지는 일은 거의 없다.
// 반경 안에서 **가장 가까운** 점을 골라야 한다.

import { describe, it, expect } from 'vitest';
import { findNearestPixel } from './pixelQuery';

const W = 100;
const key = (x: number, y: number) => y * W + x;

describe('findNearestPixel', () => {
  it('정확히 같은 픽셀이면 그 값을 준다', () => {
    const idx = new Map([[key(10, 20), 7]]);
    expect(findNearestPixel(idx, W, 10, 20, 4)).toBe(7);
  });

  it('반경 안에 있으면 찾는다', () => {
    const idx = new Map([[key(10, 20), 7]]);
    expect(findNearestPixel(idx, W, 12, 22, 4)).toBe(7);
  });

  it('반경 밖이면 못 찾는다', () => {
    const idx = new Map([[key(10, 20), 7]]);
    expect(findNearestPixel(idx, W, 30, 40, 4)).toBeUndefined();
  });

  // 점이 겹쳐 있을 때 엉뚱한 걸 열면 사용자가 바로 알아챈다.
  it('여러 후보 중 가장 가까운 것을 준다', () => {
    const idx = new Map([
      [key(10, 20), 1],   // 클릭(12,20)에서 거리 2
      [key(13, 20), 2],   // 거리 1
    ]);
    expect(findNearestPixel(idx, W, 12, 20, 5)).toBe(2);
  });

  it('빈 인덱스면 undefined', () => {
    expect(findNearestPixel(new Map(), W, 10, 20, 4)).toBeUndefined();
  });

  // 좌상단 모서리에서 음수 좌표로 훑으면 다른 행의 픽셀을 잘못 집는다.
  it('캔버스 왼쪽 경계를 넘어가 이웃 행을 집지 않는다', () => {
    const idx = new Map([[key(99, 5), 42]]); // 5행 오른쪽 끝
    // (1,6) 클릭 → x-2 = -1 이 되는데, 이걸 그냥 key 로 만들면 5행 99열이 걸린다
    expect(findNearestPixel(idx, W, 1, 6, 3)).toBeUndefined();
  });

  it('소수 좌표는 반올림해서 본다', () => {
    const idx = new Map([[key(10, 20), 7]]);
    expect(findNearestPixel(idx, W, 10.4, 19.6, 1)).toBe(7);
  });
});
