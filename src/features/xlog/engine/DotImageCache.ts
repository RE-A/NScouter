// src/features/xlog/engine/DotImageCache.ts
// 5x5 점 이미지 캐시 (OffscreenCanvas 기반 동기 블리팅)
// ASIS: ImageCache.createXPImage6() 포팅

export class DotImageCache {
  private cache = new Map<string, OffscreenCanvas>();

  /** 색상 + 크기별 OffscreenCanvas 반환 (없으면 생성) */
  getDot(color: string, size: number): OffscreenCanvas {
    const key = `${color}:${size}`;
    let dot = this.cache.get(key);
    if (!dot) {
      dot = this.createDot(color, size);
      this.cache.set(key, dot);
    }
    return dot;
  }

  private createDot(color: string, size: number): OffscreenCanvas {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d')!;

    // 기본 색상으로 채움
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);

    // ASIS ImageCache.createXPImage6() — 흰색 노이즈 픽셀 4개
    // 원본 좌표: (1,0), (4,1), (0,3), (3,4) (5x5 기준)
    if (size >= 5) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(1, 0, 1, 1);
      ctx.fillRect(size - 1, 1, 1, 1);
      ctx.fillRect(0, size - 2, 1, 1);
      ctx.fillRect(size - 2, size - 1, 1, 1);
    }

    return canvas;
  }

  clear(): void {
    this.cache.clear();
  }

  invalidate(color: string, size: number): void {
    this.cache.delete(`${color}:${size}`);
  }
}
