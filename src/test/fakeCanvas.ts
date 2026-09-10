// src/test/fakeCanvas.ts
// jsdom 에는 2D 컨텍스트도 OffscreenCanvas 도 없다.
//
// 그림을 눈으로 볼 수 없으니 **무엇을 그리라고 시켰는지**를 받아 적는다.
// 색·글꼴·정렬은 호출한 그 순간의 것을 함께 적어 둔다 — 나중에 바뀐 값으로 읽으면
// 어느 색으로 칠했는지 알 수 없다.

export interface DrawOp {
  op: string;
  args: readonly unknown[];
  fillStyle: string;
  strokeStyle: string;
  font: string;
  textAlign: string;
}

export class FakeCanvasContext {
  readonly ops: DrawOp[] = [];

  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  globalAlpha = 1;
  /**
   * 가산 합성 등. **바뀐 것을 받아 적는다** — 값만 들고 있으면
   * «언제 켰다 껐는지» 가 안 남아 «점 위에 밝기만 더했는가» 를 볼 수 없다.
   */
  private composite = 'source-over';
  get globalCompositeOperation(): string {
    return this.composite;
  }
  set globalCompositeOperation(v: string) {
    this.composite = v;
    this.record('setCompositeOperation', v);
  }
  font = '10px sans-serif';
  textAlign = 'left';
  textBaseline = 'alphabetic';

  private record(op: string, ...args: unknown[]): void {
    this.ops.push({
      op,
      args,
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      font: this.font,
      textAlign: this.textAlign,
    });
  }

  save(): void {
    this.record('save');
  }
  restore(): void {
    this.record('restore');
  }
  beginPath(): void {
    this.record('beginPath');
  }
  stroke(): void {
    this.record('stroke');
  }
  fill(): void {
    this.record('fill');
  }
  /** 고해상도 보정. `scale` 과 같은 이유로 좌표를 바꾸지 않는다 */
  setTransform(): void {
    this.record('setTransform');
  }
  roundRect(x: number, y: number, w: number, h: number, r: number): void {
    this.record('roundRect', x, y, w, h, r);
  }
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    this.record('bezierCurveTo', x1, y1, x2, y2, x, y);
  }
  setLineDash(pattern: number[]): void {
    this.record('setLineDash', pattern);
  }
  moveTo(x: number, y: number): void {
    this.record('moveTo', x, y);
  }
  lineTo(x: number, y: number): void {
    this.record('lineTo', x, y);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.record('fillRect', x, y, w, h);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.record('strokeRect', x, y, w, h);
  }
  fillText(text: string, x: number, y: number): void {
    this.record('fillText', text, x, y);
  }
  drawImage(image: unknown, x: number, y: number): void {
    this.record('drawImage', image, x, y);
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.record('clearRect', x, y, w, h);
  }
  /**
   * 고해상도 화면 보정. **좌표를 실제로 바꾸지는 않는다** —
   * 받아 적는 좌표는 CSS 픽셀이어야 «어디에 그렸나» 를 사람이 읽을 수 있다.
   */
  scale(x: number, y: number): void {
    this.record('scale', x, y);
  }
  measureText(text: string): TextMetrics {
    // 실제 글꼴 폭은 알 수 없다. **자릿수에 비례**하기만 하면 «글자 뒤에 이어 적기» 를 볼 수 있다.
    return { width: text.length * 6 } as TextMetrics;
  }
}

/** `op` 이름으로 그린 것만 골라 낸다 */
export function opsOf(ctx: FakeCanvasContext, op: string): DrawOp[] {
  return ctx.ops.filter(o => o.op === op);
}

/** 화면에 적힌 글자만 순서대로 */
export function textsOf(ctx: FakeCanvasContext): string[] {
  return opsOf(ctx, 'fillText').map(o => String(o.args[0]));
}

/** 렌더러에 물릴 가짜 캔버스. 전역을 건드리지 않는다 */
export function makeFakeCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: FakeCanvasContext } {
  const ctx = new FakeCanvasContext();
  const canvas = {
    width,
    height,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  return { canvas, ctx };
}

export class FakeOffscreenCanvas {
  readonly ctx = new FakeCanvasContext();
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext(): FakeCanvasContext {
    return this.ctx;
  }
}

/**
 * `OffscreenCanvas` 는 전역이라 바꿔 끼우는 수밖에 없다 (DotImageCache 가 직접 `new` 한다).
 * 되돌리는 함수를 준다 — 켜 둔 채로 다른 파일에 새면 원인을 찾기 어렵다.
 */
export function installFakeOffscreenCanvas(): () => void {
  const saved = Reflect.get(globalThis, 'OffscreenCanvas') as unknown;
  Reflect.set(globalThis, 'OffscreenCanvas', FakeOffscreenCanvas);
  return () => {
    Reflect.set(globalThis, 'OffscreenCanvas', saved);
  };
}
