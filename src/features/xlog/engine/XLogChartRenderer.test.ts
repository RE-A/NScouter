// 그리기 파이프라인
//
// 여기서 보려는 것은 «예쁘게 나왔나» 가 아니라 **화면이 사실을 말하는가** 다.
//   - 창 안에 있는 것만 그리는가
//   - 겹쳐서 못 그린 것도 «있다» 고 세는가 (버퍼 크기가 아니라 창 안의 건수)
//   - 축 위로 넘친 것을 조용히 버리지 않는가
//   - 그린 뒤에 그 자리를 되물으면 그 트랜잭션이 나오는가
//
// jsdom 에는 2D 컨텍스트가 없으므로 **그리라고 시킨 것을 받아 적어** 확인한다.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { XLogChartRenderer } from './XLogChartRenderer';
import type { SelectionRect } from './XLogChartRenderer';
import type { TimeWindow } from './CoordinateMapper';
import {
  buildLayout,
  DEFAULT_CHART_CONFIG,
  DEFAULT_FILTER,
} from '../types/xlog';
import type { SXLog, XLogChartConfig, XLogFilterState } from '../types/xlog';
import {
  installFakeOffscreenCanvas,
  makeFakeCanvas,
  opsOf,
  textsOf,
} from '../../../test/fakeCanvas';
import type { FakeCanvasContext } from '../../../test/fakeCanvas';

const W = 1000;
const H = 400;
const LAYOUT = buildLayout(W, H);

const START = 1_700_000_000_000;
const SPAN = 60_000;
const WINDOW: TimeWindow = { start: START, end: START + SPAN };

let uninstall: () => void;

beforeAll(() => {
  uninstall = installFakeOffscreenCanvas();
});

afterAll(() => {
  uninstall();
});

function xlog(over: Partial<SXLog> = {}): SXLog {
  return {
    txid: 'tx',
    gxid: '0',
    caller: '0',
    endTime: START + SPAN / 2,
    elapsed: 4_500,
    objHash: 1,
    service: 100,
    error: 0,
    xType: 0,
    cpu: 0,
    sqlCount: 0,
    sqlTime: 0,
    apiCallCount: 0,
    apiCallTime: 0,
    ipAddr: '10.0.0.1',
    allocKBytes: 0,
    threadNameHash: 0,
    ...over,
  };
}

/** 렌더러가 쓰는 것과 **같은 셈**으로 자리를 구한다 */
function expectedX(time: number): number {
  return LAYOUT.plotAreaX + ((time - START) / SPAN) * LAYOUT.plotAreaWidth;
}
function expectedY(valueSec: number, yMax = DEFAULT_CHART_CONFIG.yMax): number {
  return LAYOUT.plotAreaY + LAYOUT.plotAreaHeight - (valueSec / yMax) * LAYOUT.plotAreaHeight;
}

/** 화면 왼쪽 위에 적히는 «N dots» */
function dotsLabel(ctx: FakeCanvasContext): string | undefined {
  return textsOf(ctx).find(t => t.endsWith('dots'));
}

interface Harness {
  renderer: XLogChartRenderer;
  ctx: FakeCanvasContext;
}

function setup(config: Partial<XLogChartConfig> = {}): Harness {
  const { canvas, ctx } = makeFakeCanvas(W, H);
  const renderer = new XLogChartRenderer(canvas, { ...DEFAULT_CHART_CONFIG, ...config });
  return { renderer, ctx };
}

function draw(
  h: Harness,
  data: SXLog[],
  opts: { filter?: XLogFilterState; selection?: SelectionRect | null } = {},
): void {
  h.renderer.render(
    data,
    opts.filter ?? DEFAULT_FILTER,
    WINDOW,
    opts.selection ?? null,
  );
}

describe('XLogChartRenderer — 단계 순서', () => {
  let h: Harness;
  beforeEach(() => {
    h = setup();
  });

  it('맨 처음 캔버스 전체를 배경색으로 덮는다', () => {
    draw(h, []);
    const first = h.ctx.ops[0];
    expect(first.op).toBe('fillRect');
    expect(first.args).toEqual([0, 0, W, H]);
    expect(first.fillStyle).toBe(DEFAULT_CHART_CONFIG.backgroundColor);
  });

  it('그림 영역 테두리를 두른다', () => {
    draw(h, []);
    const border = opsOf(h.ctx, 'strokeRect');
    expect(border).toHaveLength(1);
    expect(border[0].args).toEqual([
      LAYOUT.plotAreaX,
      LAYOUT.plotAreaY,
      LAYOUT.plotAreaWidth,
      LAYOUT.plotAreaHeight,
    ]);
  });

  it('Y축 눈금과 X축 눈금을 모두 적는다', () => {
    draw(h, []);
    const texts = textsOf(h.ctx);
    // Y축은 0 부터 시작한다
    expect(texts).toContain('0');
    // X축은 시:분:초 꼴
    expect(texts.some(t => /^\d{2}:\d{2}(:\d{2})?$/.test(t))).toBe(true);
  });

  it('축 이름을 오른쪽 위에 적는다', () => {
    draw(h, []);
    const label = opsOf(h.ctx, 'fillText').find(o => o.args[0] === 'Elapsed(sec)');
    expect(label).toBeDefined();
    expect(label?.textAlign).toBe('right');
  });

  it('updateConfig 로 축을 바꾸면 그 이름을 적는다', () => {
    h.renderer.updateConfig({ ...DEFAULT_CHART_CONFIG, yAxisMode: 'sqlCount' });
    draw(h, []);
    expect(textsOf(h.ctx)).toContain('SQL Count');
  });

  it('무시 영역은 켰을 때만 그린다', () => {
    const off = setup();
    draw(off, []);
    const offFills = opsOf(off.ctx, 'fillRect').length;

    const on = setup({ showIgnoreArea: true, ignoreThresholdMs: 3_000 });
    draw(on, []);
    const onFills = opsOf(on.ctx, 'fillRect');

    expect(onFills.length).toBe(offFills + 1);
    // 0 초부터 3 초까지 — 바닥에서 임계값까지
    const band = onFills[1];
    expect(band.args[1]).toBeCloseTo(expectedY(3), 6);
    expect(band.args[3]).toBeCloseTo(expectedY(0) - expectedY(3), 6);
  });
});

describe('XLogChartRenderer — 점 찍기', () => {
  it('창 안의 점을 제자리에 찍는다', () => {
    const h = setup();
    draw(h, [xlog()]);

    const dots = opsOf(h.ctx, 'drawImage');
    expect(dots).toHaveLength(1);
    // drawImage 는 좌상단 기준 — 5px 점이므로 중심에서 2px 씩 뺀다
    expect(dots[0].args[1]).toBeCloseTo(expectedX(START + SPAN / 2) - 2, 6);
    expect(dots[0].args[2]).toBeCloseTo(expectedY(4.5) - 2, 6);
    expect(dotsLabel(h.ctx)).toBe('1 dots');
  });

  it('창 밖의 점은 그리지도 세지도 않는다', () => {
    const h = setup();
    draw(h, [
      xlog({ txid: 'before', endTime: START - 1_000 }),
      xlog({ txid: 'after', endTime: START + SPAN + 1_000 }),
    ]);

    expect(opsOf(h.ctx, 'drawImage')).toHaveLength(0);
    expect(dotsLabel(h.ctx)).toBe('0 dots');
  });

  it('겹쳐서 못 그린 것도 **창 안에 있으므로** 센다', () => {
    const h = setup();
    // 같은 시각·같은 소요 — 픽셀이 완전히 겹친다
    draw(h, [xlog({ txid: 'a' }), xlog({ txid: 'b' })]);

    expect(opsOf(h.ctx, 'drawImage')).toHaveLength(1);
    expect(dotsLabel(h.ctx)).toBe('2 dots');
  });

  it('필터에 걸린 것은 세지 않는다', () => {
    const h = setup();
    const filter: XLogFilterState = { ...DEFAULT_FILTER, errorOnly: true };
    draw(h, [xlog({ txid: 'ok', error: 0 }), xlog({ txid: 'bad', error: 1, elapsed: 1_000 })], {
      filter,
    });

    expect(dotsLabel(h.ctx)).toBe('1 dots');
  });

  it('세 자리 넘는 건수는 천 단위로 끊어 적는다', () => {
    const h = setup();
    // 시각을 흩어 겹치지 않게 둔다
    const data = Array.from({ length: 1_200 }, (_, i) =>
      xlog({ txid: String(i), endTime: START + (i % SPAN) }),
    );
    draw(h, data);
    expect(dotsLabel(h.ctx)).toBe('1,200 dots');
  });
});

describe('XLogChartRenderer — 축 위로 넘친 점', () => {
  it('버리지 않고 천장에 붙인다', () => {
    const h = setup();
    // 30 초짜리 타임아웃, 축은 9 초
    draw(h, [xlog({ elapsed: 30_000 })]);

    const dots = opsOf(h.ctx, 'drawImage');
    expect(dots).toHaveLength(1);
    expect(dots[0].args[2]).toBeCloseTo(expectedY(9) - 2, 6);
  });

  it('몇 개가 넘쳤는지 말하고 그 줄에 띠를 깐다', () => {
    const h = setup();
    draw(h, [
      xlog({ txid: 'a', elapsed: 30_000, endTime: START + 1_000 }),
      xlog({ txid: 'b', elapsed: 45_000, endTime: START + 2_000 }),
      xlog({ txid: 'c', elapsed: 1_000, endTime: START + 3_000 }),
    ]);

    expect(textsOf(h.ctx)).toContain('▲ 2 (축 위)');
    // 띠는 그림 영역 맨 위에, 점(5px)보다 조금 두껍게
    const band = opsOf(h.ctx, 'fillRect').find(
      o => o.args[1] === LAYOUT.plotAreaY && o.args[3] === 7,
    );
    expect(band).toBeDefined();
    expect(band?.args[2]).toBe(LAYOUT.plotAreaWidth);
  });

  it('넘친 것이 없으면 띠도 문구도 없다', () => {
    const h = setup();
    draw(h, [xlog({ elapsed: 1_000 })]);
    expect(textsOf(h.ctx).some(t => t.includes('축 위'))).toBe(false);
  });

  it('축을 올리면 넘치지 않는다', () => {
    const h = setup({ yMax: 60 });
    draw(h, [xlog({ elapsed: 30_000 })]);

    expect(textsOf(h.ctx).some(t => t.includes('축 위'))).toBe(false);
    const dots = opsOf(h.ctx, 'drawImage');
    expect(dots[0].args[2]).toBeCloseTo(expectedY(30, 60) - 2, 6);
  });
});

describe('XLogChartRenderer — 비었을 때 이유를 말한다', () => {
  it('수신이 끊겼고 그릴 것도 없으면 그 까닭을 한가운데 적는다', () => {
    const h = setup();
    h.renderer.render([], DEFAULT_FILTER, WINDOW, null, {
      kind: 'stale',
      message: '30초째 수신 없음',
      silentForSec: 30,
    });

    const note = opsOf(h.ctx, 'fillText').find(o => o.args[0] === '30초째 수신 없음');
    expect(note).toBeDefined();
    expect(note?.textAlign).toBe('center');
    expect(note?.args[1]).toBe(LAYOUT.plotAreaX + LAYOUT.plotAreaWidth / 2);
  });

  it('그릴 것이 있으면 까닭을 적지 않는다 — 화면이 이미 말하고 있다', () => {
    const h = setup();
    h.renderer.render([xlog()], DEFAULT_FILTER, WINDOW, null, {
      kind: 'stale',
      message: '30초째 수신 없음',
      silentForSec: 30,
    });
    expect(textsOf(h.ctx)).not.toContain('30초째 수신 없음');
  });

  it('수신 중이면 비어 있어도 적지 않는다', () => {
    const h = setup();
    h.renderer.render([], DEFAULT_FILTER, WINDOW, null, { kind: 'live', message: '수신 중' });
    expect(textsOf(h.ctx)).not.toContain('수신 중');
  });
});

describe('XLogChartRenderer — 끌어서 고르기', () => {
  const sel: SelectionRect = { x1: 300, y1: 100, x2: 200, y2: 250 };

  it('되짚어 끌어도 사각형은 바로 선다', () => {
    const h = setup();
    draw(h, [], { selection: sel });

    const fills = opsOf(h.ctx, 'fillRect');
    const box = fills[fills.length - 1];
    expect(box.args).toEqual([200, 100, 100, 150]);

    const stroke = opsOf(h.ctx, 'strokeRect');
    expect(stroke[stroke.length - 1].args).toEqual([200, 100, 100, 150]);
  });

  it('한 번도 그리지 않았으면 고를 것이 없다 — 좌표를 모른다', () => {
    const h = setup();
    expect(h.renderer.querySelection(sel, [xlog()])).toEqual([]);
  });

  it('그린 뒤에는 그 사각형 안의 것을 준다', () => {
    const h = setup();
    const inside = xlog({ txid: 'in' });
    const outside = xlog({ txid: 'out', endTime: START + 1_000, elapsed: 100 });
    draw(h, [inside, outside]);

    const x = expectedX(inside.endTime);
    const y = expectedY(4.5);
    const picked = h.renderer.querySelection(
      { x1: x - 20, y1: y - 20, x2: x + 20, y2: y + 20 },
      [inside, outside],
    );

    expect(picked.map(p => p.txid)).toEqual(['in']);
  });
});

describe('XLogChartRenderer — 찍은 자리 되묻기', () => {
  it('그 픽셀을 물으면 그 트랜잭션을 준다', () => {
    const h = setup();
    const data = [xlog({ txid: 'a' })];
    draw(h, data);

    const x = Math.round(expectedX(data[0].endTime));
    const y = Math.round(expectedY(4.5));
    expect(h.renderer.getXLogIndexAt(x, y)).toBe(0);
  });

  it('조금 빗나가도 반경 안이면 골라 준다 — 점은 5px 이라 정확히 못 누른다', () => {
    const h = setup();
    const data = [xlog({ txid: 'a' })];
    draw(h, data);

    const x = Math.round(expectedX(data[0].endTime));
    const y = Math.round(expectedY(4.5));
    expect(h.renderer.queryPoint(x + 3, y - 2, data)?.txid).toBe('a');
    expect(h.renderer.queryPoint(x + 50, y, data)).toBeUndefined();
  });

  it('다시 그리면 지난 프레임의 자리는 지운다', () => {
    const h = setup();
    const data = [xlog({ txid: 'a' })];
    draw(h, data);
    const x = Math.round(expectedX(data[0].endTime));
    const y = Math.round(expectedY(4.5));
    expect(h.renderer.getXLogIndexAt(x, y)).toBe(0);

    draw(h, []);
    expect(h.renderer.getXLogIndexAt(x, y)).toBeUndefined();
  });
});

describe('XLogChartRenderer — 크기 바꾸기', () => {
  it('크기를 바꾸면 그 크기로 그린다', () => {
    const h = setup();
    h.renderer.resize(500, 300);
    draw(h, [xlog()]);

    const bg = h.ctx.ops[0];
    expect(bg.args).toEqual([0, 0, 500, 300]);

    const wide = buildLayout(500, 300);
    const dots = opsOf(h.ctx, 'drawImage');
    expect(dots[0].args[1]).toBeCloseTo(
      wide.plotAreaX + 0.5 * wide.plotAreaWidth - 2,
      6,
    );
  });
});

describe('XLogChartRenderer — 서비스명 필터', () => {
  it('이름 사전을 꽂아 주면 그것으로 거른다', () => {
    const h = setup();
    h.renderer.setServiceNameResolver(hash => (hash === 100 ? '/shop/order' : '/etc'));

    const filter: XLogFilterState = {
      ...DEFAULT_FILTER,
      patterns: [{ field: 'service', text: 'order', exclude: false }],
    };
    draw(h, [xlog({ service: 100 }), xlog({ txid: 'b', service: 200, elapsed: 1_000 })], {
      filter,
    });

    expect(dotsLabel(h.ctx)).toBe('1 dots');
  });
});
