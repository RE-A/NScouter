// 다시 그리기 신호
//
// **필터가 바뀌면 데이터가 그대로여도 그림은 달라진다.**
// 그런데 루프는 «스토어가 더러울 때»만 다시 그렸다. 실시간은 500ms 마다 새 XLog 가
// 들어와 저절로 더러워지므로 필터가 곧바로 먹은 것처럼 보이지만,
// **과거 구간은 다 받고 나면 영원히 깨끗하다** — 필터를 어떻게 바꿔도 화면이 그대로다.

import { act, render } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { XLogDataStore } from '../store/XLogDataStore';
import { XLogChartRenderer } from '../engine/XLogChartRenderer';
import { useXLogCanvas } from './useXLogCanvas';
import { DEFAULT_CHART_CONFIG, DEFAULT_FILTER } from '../types/xlog';
import type { SXLog, XLogChartConfig, XLogFilterState } from '../types/xlog';

/**
 * 렌더러는 **진짜를 쓰되 그리기만 가로챈다** — jsdom 에는 2D 컨텍스트가 없다.
 * 여기서 보려는 건 «몇 번, 어떤 필터로 그렸나» 뿐이다.
 */
const renderSpy = vi.spyOn(XLogChartRenderer.prototype, 'render').mockImplementation(() => {});

beforeAll(() => {
  // jsdom 에는 2D 컨텍스트가 없다 — 없다고 답하게 둔다.
  // 그리기는 위에서 가로챘으므로 컨텍스트를 쓰는 코드는 돌지 않는다.
  HTMLCanvasElement.prototype.getContext = () => null;

  // 관찰자도 jsdom 에는 없다. 크기는 우리가 직접 넣어 준다.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

function xlog(over: Partial<SXLog> = {}): SXLog {
  return {
    txid: '1', gxid: '0', caller: '0',
    endTime: 1_000_000, elapsed: 1000,
    objHash: 1, service: 1, error: 0, xType: 0,
    cpu: 0, sqlCount: 0, sqlTime: 0, apiCallCount: 0, apiCallTime: 0,
    ipAddr: '10.0.0.1', allocKBytes: 0, threadNameHash: 0,
    ...over,
  };
}

/** rAF 한 바퀴를 실제로 돌린다 */
async function frame(): Promise<void> {
  await act(async () => {
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    await new Promise<void>(r => requestAnimationFrame(() => r()));
  });
}

interface Props {
  filter: XLogFilterState;
  config: XLogChartConfig;
}

/** 과거 구간: 고정 창 + 더는 들어오지 않는 스토어 */
const PAST_WINDOW = { start: 1_000_000 - 60_000, end: 1_000_000 };

/**
 * 훅이 만든 ref 에 캔버스가 **마운트 시점에** 물려 있어야 한다.
 * 나중에 손으로 넣으면 렌더러 초기화 이펙트가 이미 빈손으로 지나간 뒤다.
 */
function Harness({ store, filter, config }: Props & { store: XLogDataStore }) {
  const { canvasRef } = useXLogCanvas(store, config, filter, true, PAST_WINDOW);
  return (
    <div>
      <canvas ref={canvasRef} />
    </div>
  );
}

function setup() {
  const store = new XLogDataStore();
  store.add(xlog());
  const view = render(
    <Harness store={store} filter={DEFAULT_FILTER} config={DEFAULT_CHART_CONFIG} />,
  );
  const rerender = (p: Props) =>
    view.rerender(<Harness store={store} filter={p.filter} config={p.config} />);
  return { rerender };
}

describe('과거 구간 — 데이터가 멈춰 있어도 다시 그린다', () => {
  it('필터가 바뀌면 다시 그린다', async () => {
    const { rerender } = setup();
    await frame();
    // 여기까지 한 번도 안 그렸다면 이 시험은 아무것도 못 본다
    expect(renderSpy).toHaveBeenCalled();
    renderSpy.mockClear();

    rerender({ filter: { ...DEFAULT_FILTER, errorOnly: true }, config: DEFAULT_CHART_CONFIG });
    await frame();

    expect(renderSpy).toHaveBeenCalled();
    // 새 필터로 그려야 한다 — 옛 필터로 한 번 더 그리는 건 안 그린 것과 같다
    const used = renderSpy.mock.calls[renderSpy.mock.calls.length - 1][1] as XLogFilterState;
    expect(used.errorOnly).toBe(true);
  });

  it('Y축 기준이 바뀌면 다시 그린다', async () => {
    const { rerender } = setup();
    await frame();
    renderSpy.mockClear();

    rerender({ filter: DEFAULT_FILTER, config: { ...DEFAULT_CHART_CONFIG, yAxisMode: 'sqlTime' } });
    await frame();

    expect(renderSpy).toHaveBeenCalled();
  });
});
