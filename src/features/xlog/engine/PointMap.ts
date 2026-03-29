// src/features/xlog/engine/PointMap.ts
// Uint8Array 기반 O(1) 충돌 감지
// ASIS: XLogViewPainter.java pointMap 로직 포팅

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

  has(x: number, y: number): boolean {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return false;
    return this.bitmap[iy * this.width + ix] !== 0;
  }

  /** 좌표 주변 dotSize×dotSize 영역 마킹 */
  set(x: number, y: number, dotSize: number): void {
    const half = Math.floor(dotSize / 2);
    const x0 = Math.round(x) - half;
    const y0 = Math.round(y) - half;
    for (let dy = 0; dy < dotSize; dy++) {
      for (let dx = 0; dx < dotSize; dx++) {
        const px = x0 + dx;
        const py = y0 + dy;
        if (px >= 0 && py >= 0 && px < this.width && py < this.height) {
          this.bitmap[py * this.width + px] = 1;
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
