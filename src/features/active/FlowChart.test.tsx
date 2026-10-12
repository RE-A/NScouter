// 흐르는 트래픽 — **점이 들어오고, 머물고, 나가는가.**
//
// 이 그림의 쓸모는 «지금 무엇이 돌고 있는가» 와 «들어오는 만큼 빠지는가» 를 눈으로
// 보이는 데 있다. 조회는 2초에 한 번인데 그 사이 점이 멈춰 있으면 끊긴 것처럼 보인다.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeCanvasContext } from '../../test/fakeCanvas';
import { FlowChart } from './FlowChart';
import { holdX } from './flowModel';
import { rowKey } from './activeModel';
import type { ActiveService } from '../xlog/types/object';

let ctx: FakeCanvasContext;
const realGetContext = HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function () {
    return ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { value: 400, configurable: true });
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { value: 100, configurable: true });
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

function row(id: number, elapsed: number): ActiveService {
  return {
    obj_hash: 1, id, name: `exec-${id}`, service: `/shop/${id}`, stat: 'RUNNABLE',
    elapsed, cpu: 0, ip: '', login: '', sql: '', subcall: '', txid: `tx${id}`,
  };
}

function draw(live: ActiveService[], tps: number | null = null) {
  ctx = new FakeCanvasContext();
  const onPickLive = vi.fn();
  const view = render(
    <FlowChart live={live} polledAt={Date.now()} tps={tps} onPickLive={onPickLive} />,
  );
  const rerender = (next: ActiveService[]) =>
    view.rerender(
      <FlowChart live={next} polledAt={Date.now()} tps={tps} onPickLive={onPickLive} />,
    );
  return { onPickLive, rerender };
}

const painted = () => waitFor(() => expect(ctx.ops.some(o => o.op === 'arc')).toBe(true));
const head = () =>
  within(screen.getByRole('region', { name: '실시간 트래픽' })).getByText(/돌고 있음/).textContent;

describe('흐르는 트래픽', () => {
  it('돌고 있는 것을 점으로 그린다', async () => {
    draw([row(1, 1_000), row(2, 5_000)]);
    await painted();
    expect(ctx.ops.filter(o => o.op === 'arc').length).toBeGreaterThanOrEqual(2);
  });

  it('조회가 그대로여도 계속 다시 그린다 — 그래야 점이 움직인다', async () => {
    draw([row(1, 1_000)]);
    await painted();
    const first = ctx.ops.length;
    await waitFor(() => expect(ctx.ops.length).toBeGreaterThan(first), { timeout: 2_000 });
  });

  it('사라진 트랜잭션도 한동안 남는다 — 오른쪽으로 빠져나가는 중이다', async () => {
    const { rerender } = draw([row(1, 1_000)]);
    await painted();

    rerender([]); // 끝났다
    await waitFor(() => expect(head()).toMatch(/돌고 있음 0/));
    // 돌고 있는 수는 0 이지만 점은 아직 그려진다(나가는 중).
    const before = ctx.ops.filter(o => o.op === 'arc').length;
    await waitFor(() => expect(ctx.ops.filter(o => o.op === 'arc').length).toBeGreaterThan(before));
  });

  it('돌고 있는 수와 TPS 를 글자로도 적는다', async () => {
    draw([row(1, 1_000), row(2, 2_000)], 12.5);
    await waitFor(() => expect(head()).toMatch(/돌고 있음 2/));
    expect(head()).toContain('12.5');
  });

  it('TPS 를 아직 못 받았으면 «—» 다 — 0 은 «일이 없다» 로 읽힌다', async () => {
    draw([row(1, 1_000)]);
    await waitFor(() => expect(head()).toContain('—'));
  });

  it('아직 한 번도 조회하지 않았으면 점이 없다', async () => {
    ctx = new FakeCanvasContext();
    render(<FlowChart live={[row(1, 1_000)]} polledAt={null} tps={null} onPickLive={vi.fn()} />);
    // 눈금은 그리되 점은 그리지 않는다 — 얼마나 자랐는지 모르는 것을 지어내지 않는다.
    await waitFor(() => expect(ctx.ops.some(o => o.op === 'stroke')).toBe(true));
    expect(ctx.ops.some(o => o.op === 'arc')).toBe(false);
  });

  it('점을 누르면 그 트랜잭션을 연다', async () => {
    const { onPickLive } = draw([row(1, 1_500)]);
    await painted();

    const canvas = document.querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 400, height: 100, right: 400, bottom: 100, x: 0, y: 0, toJSON: () => {},
    });

    // 머무는 자리는 키로 정해진다. 들어오는 중에는 아직 거기가 아니므로,
    // 제자리에 설 때까지 눌러 본다 — 들어오기는 650ms 다.
    const x = holdX(rowKey(row(1, 1_500))) * 400;
    await waitFor(
      () => {
        fireEvent.click(canvas, { clientX: x, clientY: (1 - 1_500 / 3_000) * 100 });
        expect(onPickLive).toHaveBeenCalled();
      },
      { timeout: 2_000 },
    );
  });

  it('빈 자리를 누르면 아무것도 열지 않는다', async () => {
    const { onPickLive } = draw([row(1, 1_000)]);
    await painted();

    const canvas = document.querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 400, height: 100, right: 400, bottom: 100, x: 0, y: 0, toJSON: () => {},
    });
    // 오른쪽 위 구석 — 머무는 자리(가로 38~62%)에서 멀다.
    fireEvent.click(canvas, { clientX: 395, clientY: 3 });
    expect(onPickLive).not.toHaveBeenCalled();
  });
});
