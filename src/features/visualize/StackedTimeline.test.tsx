// 타임라인이 캔버스에 **무엇을 그리라고 시키는가.**
//
// jsdom 에는 2D 컨텍스트가 없다. 그림을 볼 수 없으니 받아 적어 확인한다
// (`src/test/fakeCanvas.ts`, `XLogChartRenderer.test.ts` 와 같은 방식).
// 자(눈금·좌표)는 `timelineScale.test.ts` 가 맡는다 — 여기서는 **무엇을 적는가** 만 본다.

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeCanvasContext, textsOf } from '../../test/fakeCanvas';
import { StackedTimeline } from './StackedTimeline';
import type { Range } from './timelineScale';
import type { CounterRow } from './usePastCounters';

const RANGE: Range = { stime: 1_000_000, etime: 1_000_000 + 3_600_000 };

const agentMap = new Map<number, string>([
  [11, '/h/shop-app'],
  [22, '/h/order-app'],
]);

let ctx: FakeCanvasContext;
let restore: (() => void) | null = null;

beforeEach(() => {
  ctx = new FakeCanvasContext();
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (k: string) => unknown;
  };
  const original = proto.getContext;
  proto.getContext = () => ctx;
  // 폭이 0 이면 그릴 자리가 없어 아무것도 안 그린다.
  const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    value: 800,
  });
  restore = () => {
    proto.getContext = original;
    if (offset) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offset);
  };
});

afterEach(() => { restore?.(); restore = null; });

/** rAF 한 프레임을 돌린다 — 그리기는 루프 안에서 일어난다 */
async function frame() {
  await act(async () => {
    await new Promise(r => requestAnimationFrame(() => r(null)));
    await new Promise(r => setTimeout(r, 0));
  });
}

const series = (obj_hash: number, values: number[]) => ({
  obj_hash,
  times: values.map((_, i) => RANGE.stime + i * 60_000),
  values,
});

async function draw(rows: CounterRow[]) {
  render(<StackedTimeline rows={rows} range={RANGE} agentMap={agentMap} />);
  await frame();
  return textsOf(ctx);
}

describe('StackedTimeline', () => {
  it('줄마다 카운터 이름을 적는다', async () => {
    const texts = await draw([
      { counter: 'TPS', series: [series(11, [1, 2])] },
      { counter: 'Cpu', series: [series(22, [10, 20])] },
    ]);
    expect(texts).toContain('TPS');
    expect(texts).toContain('CPU');
  });

  it('축 위쪽 값을 계단으로 올려 적는다', async () => {
    // 실제 최댓값을 그대로 쓰면 23↔24 로 오갈 때마다 선 전체가 출렁인다.
    const texts = await draw([{ counter: 'TPS', series: [series(11, [23])] }]);
    expect(texts).toContain('50tps');
  });

  it('값이 없는 줄은 비었다고 말한다', async () => {
    // 빈 줄만 두면 «수집이 안 된다» 로 읽힌다.
    const texts = await draw([{ counter: 'Cpu', series: [] }]);
    expect(texts).toContain('이 구간에 값이 없습니다');
  });

  it('시각 눈금을 적는다', async () => {
    const texts = await draw([{ counter: 'TPS', series: [series(11, [1, 2])] }]);
    expect(texts.some(x => /^\d{2}:\d{2}$/.test(x))).toBe(true);
  });

  it('마우스를 올리기 전에는 값을 적지 않는다', async () => {
    // 크로스헤어 없이 값이 떠 있으면 «어느 시각» 인지 알 수 없다.
    const texts = await draw([{ counter: 'TPS', series: [series(11, [7])] }]);
    expect(texts.some(x => x.includes('shop-app'))).toBe(false);
  });

  it('줄 하나가 늘면 캔버스도 그만큼 높아진다', async () => {
    const { container, rerender } = render(
      <StackedTimeline
        rows={[{ counter: 'TPS', series: [series(11, [1])] }]}
        range={RANGE}
        agentMap={agentMap}
      />,
    );
    await frame();
    const one = (container.querySelector('canvas') as HTMLCanvasElement).style.height;

    rerender(
      <StackedTimeline
        rows={[
          { counter: 'TPS', series: [series(11, [1])] },
          { counter: 'Cpu', series: [series(22, [1])] },
        ]}
        range={RANGE}
        agentMap={agentMap}
      />,
    );
    await frame();
    const two = (container.querySelector('canvas') as HTMLCanvasElement).style.height;

    expect(parseInt(two, 10)).toBeGreaterThan(parseInt(one, 10));
  });
});
