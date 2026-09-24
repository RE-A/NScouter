// 실시간 트래픽 차트 — **끝난 것과 돌고 있는 것을 눈으로 가를 수 있는가.**
//
// 이 차트의 존재 이유가 그 둘을 한자리에 겹쳐 놓는 것이다. 같은 모양으로 그리면
// 아래 목록(실행 중)과 이 점들이 무슨 관계인지 읽을 수 없다.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeCanvasContext } from '../../test/fakeCanvas';
import { TrafficChart } from './TrafficChart';
import type { SXLog } from '../xlog/types/xlog';
import type { ActiveService } from '../xlog/types/object';

let ctx: FakeCanvasContext;
const realGetContext = HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function () {
    return ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  // jsdom 의 캔버스는 크기가 0이라 아무것도 그리지 않는다. 폭·높이를 넣어 준다.
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { value: 400, configurable: true });
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { value: 100, configurable: true });
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

function done(elapsed: number, o: Partial<SXLog> = {}): SXLog {
  return {
    txid: 't1',
    gxid: '0',
    caller: '0',
    endTime: Date.now(),
    elapsed,
    objHash: 1,
    service: 7,
    error: 0,
    xType: 0,
    cpu: 0,
    sqlCount: 0,
    sqlTime: 0,
    apiCallCount: 0,
    apiCallTime: 0,
    ipAddr: '',
    allocKBytes: 0,
    threadNameHash: 0,
    ...o,
  };
}

function live(elapsed: number): ActiveService {
  return {
    obj_hash: 1,
    id: 1,
    name: 'exec-1',
    service: '/shop/checkout<POST>',
    stat: 'RUNNABLE',
    elapsed,
    cpu: 0,
    ip: '',
    login: '',
    sql: '',
    subcall: '',
    txid: 'a',
  };
}

function draw(o: { done?: SXLog[]; live?: ActiveService[] } = {}) {
  ctx = new FakeCanvasContext();
  const onPickDone = vi.fn();
  const onPickLive = vi.fn();
  render(
    <TrafficChart
      done={o.done ?? []}
      live={o.live ?? []}
      picked={new Set<number>()}
      windowMs={60_000}
      onPickDone={onPickDone}
      onPickLive={onPickLive}
    />,
  );
  return { onPickDone, onPickLive };
}

/** 한 프레임 그릴 때까지 기다린다 — 그리기는 requestAnimationFrame 위에 있다 */
const drawn = () => waitFor(() => expect(ctx.ops.some(o => o.op === 'arc')).toBe(true));

describe('실시간 트래픽 차트', () => {
  it('끝난 점은 채우고 실행 중인 점은 테두리로 그린다', async () => {
    draw({ done: [done(200)], live: [live(5_000)] });
    await drawn();

    // 같은 모양으로 그리면 «벌써 끝났다» 로 읽힌다.
    expect(ctx.ops.some(o => o.op === 'fill')).toBe(true);
    expect(ctx.ops.some(o => o.op === 'stroke')).toBe(true);
  });

  it('실패한 트랜잭션은 에러색으로 칠한다', async () => {
    draw({ done: [done(200, { error: 9 })] });
    await drawn();

    const fills = ctx.ops.filter(o => o.op === 'fill').map(o => o.fillStyle);
    expect(fills).toContain('#ff4d4f');
  });

  it('무엇이 몇 건인지 글자로도 적는다', async () => {
    // 점만으로는 «몇 건인가» 를 못 읽는다. 목록이 빈 순간을 설명하는 것이 이 차트의 일이다.
    draw({ done: [done(200), done(300)], live: [live(1_000)] });
    await waitFor(() => expect(screen.getByText(/끝난 것/).textContent).toContain('2'));
    expect(screen.getByText(/실행 중/).textContent).toContain('1');
  });

  it('실행 중인 점을 누르면 그 트랜잭션을 연다', async () => {
    const { onPickLive } = draw({ live: [live(30_000)] });
    await drawn();

    const canvas = document.querySelector('canvas')!;
    // 실행 중인 점은 오른쪽 끝(x=폭)·세로는 30초/상한 50초 자리다.
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 400, height: 100, right: 400, bottom: 100, x: 0, y: 0, toJSON: () => {},
    });
    fireEvent.click(canvas, { clientX: 397, clientY: 40 });
    expect(onPickLive).toHaveBeenCalled();
  });

  it('빈 자리를 누르면 아무것도 열지 않는다', async () => {
    const { onPickDone, onPickLive } = draw({ done: [done(200)] });
    await drawn();

    const canvas = document.querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 400, height: 100, right: 400, bottom: 100, x: 0, y: 0, toJSON: () => {},
    });
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    expect(onPickDone).not.toHaveBeenCalled();
    expect(onPickLive).not.toHaveBeenCalled();
  });
});
