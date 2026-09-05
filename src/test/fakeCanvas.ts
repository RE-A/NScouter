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
