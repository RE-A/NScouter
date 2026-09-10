// src/features/xlog/engine/PointMap.ts
// Uint8Array 기반 O(1) 충돌 감지
// ASIS: XLogViewPainter.java pointMap 로직 포팅
//
// **층을 나눈다.** 한 칸에 점을 하나만 그리는 것은 촘촘한 구간에서 그리기가
// 폭발하지 않게 하려는 것인데, 층이 없으면 **먼저 온 정상 점이 에러 점을 가린다** —
// 에러 하나를 찾으려고 보는 화면에서 그 에러가 사라진다.
// 에러는 정상 점의 자리를 무시하고 그리되, 저희끼리는 여전히 한 칸에 하나다.

/** 정상 점이 찍힌 자리 */
export const LAYER_NORMAL = 1;
/** 에러 점이 찍힌 자리 */
export const LAYER_ERROR = 2;
/** 무엇이든 있는가 */
export const LAYER_ANY = LAYER_NORMAL | LAYER_ERROR;

export class PointMap {
  private bitmap: Uint8Array;
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.bitmap = new Uint8Array(width * height);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.bitmap = new Uint8Array(width * height);
  }

  /**
   * 이 자리에 이미 점이 있는가.
   *
   * @param mask 어느 층을 볼지. 기본은 **아무거나** — 정상 점이 물을 때의 뜻이다.
   *   에러 점은 `LAYER_ERROR` 만 보고 물어 정상 점 위에라도 찍힌다.
   */
  has(x: number, y: number, mask: number = LAYER_ANY): boolean {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return false;
    return (this.bitmap[iy * this.width + ix] & mask) !== 0;
  }

  /** 좌표 주변 dotSize×dotSize 영역 마킹 */
  set(x: number, y: number, dotSize: number, layer: number = LAYER_NORMAL): void {
    const half = Math.floor(dotSize / 2);
    const x0 = Math.round(x) - half;
    const y0 = Math.round(y) - half;
    for (let dy = 0; dy < dotSize; dy++) {
      for (let dx = 0; dx < dotSize; dx++) {
        const px = x0 + dx;
        const py = y0 + dy;
        if (px >= 0 && py >= 0 && px < this.width && py < this.height) {
          this.bitmap[py * this.width + px] |= layer;
        }
      }
    }
  }

  clear(): void {
    this.bitmap.fill(0);
  }

  /** 사각형 영역 내 마킹된 픽셀 위치 목록 반환 */
  queryRect(
    x1: number, y1: number,
    x2: number, y2: number,
  ): Array<{ x: number; y: number }> {
    const lx = Math.max(0, Math.min(x1, x2));
    const rx = Math.min(this.width - 1, Math.max(x1, x2));
    const ty = Math.max(0, Math.min(y1, y2));
    const by = Math.min(this.height - 1, Math.max(y1, y2));

    const result: Array<{ x: number; y: number }> = [];
    for (let py = ty; py <= by; py++) {
      for (let px = lx; px <= rx; px++) {
        if (this.bitmap[py * this.width + px]) {
          result.push({ x: px, y: py });
        }
      }
    }
    return result;
  }
}
