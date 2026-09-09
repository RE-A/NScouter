// 토폴로지 — **지도가 무엇을 적고, 눌렀을 때 어디로 가는가.**
//
// jsdom 에는 2D 컨텍스트가 없어 그림을 볼 수 없다. 무엇을 그리라고 시켰는지를
// 받아 적어 확인한다 (`src/test/fakeCanvas.ts`, `StackedTimeline.test.tsx` 와 같은 방식).
// 그래프 계산 자체는 `topologyGraph.test.ts` 가 맡는다 — 여기서는 **화면과 마우스**만 본다.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeCanvasContext, opsOf, textsOf } from '../../../test/fakeCanvas';
import { TopologyPanel } from './TopologyPanel';
import type { InteractionRow } from '../types/interaction';

const SHOP = 11;
const SHOPDB = 77;
const EXTERNAL = 0;

const agentMap = new Map<number, string>([[SHOP, '/h/shop-app']]);

const row = (over: Partial<InteractionRow>): InteractionRow => ({
  time: 0,
  obj_name: 'shop-app',
  interaction_type: 'INTR_DB_CALL',
  from_hash: SHOP,
  to_hash: SHOPDB,
  period: 30,
  count: 10,
  error_count: 0,
  total_elapsed: 2_500,
  ...over,
});

const rows: InteractionRow[] = [
  row({ from_hash: EXTERNAL, to_hash: SHOP, count: 100, total_elapsed: 20_000 }),
  row({ from_hash: SHOP, to_hash: SHOPDB, count: 10, total_elapsed: 2_500, error_count: 1 }),
];

const getInteraction = vi.fn();
vi.mock('../api/scouterApi', () => ({
  getInteraction: (...args: unknown[]) => getInteraction(...args),
}));
vi.mock('../hooks/useTextResolver', () => ({
  useTextResolver: () => ({
    getCached: (_type: string, hash: number) => (hash === SHOPDB ? 'shop-db' : undefined),
    resolve: () => Promise.resolve({}),
  }),
}));

let ctx: FakeCanvasContext;
let restore: (() => void) | null = null;

beforeEach(() => {
  getInteraction.mockResolvedValue(rows);
  ctx = new FakeCanvasContext();
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: (k: string) => unknown };
  const original = proto.getContext;
  proto.getContext = () => ctx;
  // 폭이 0 이면 그릴 자리가 없어 아무것도 안 그린다.
  const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
  restore = () => {
    proto.getContext = original;
    if (offset) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offset);
  };
});

afterEach(() => {
  restore?.();
  restore = null;
  vi.clearAllMocks();
});

/**
 * 패널을 열고 첫 조회가 끝날 때까지 기다린다.
 *
 * 열기 전에는 아무것도 묻지 않는다 — 카운터 탭을 열 때마다 나가면 안 되는 조회다.
 * 접이식 섹션은 **제목 자체가 여는 버튼**이다 (`SectionHeader`).
 */
async function open(onDrill?: (h: number) => void) {
  render(<TopologyPanel objType="tomcat" agentMap={agentMap} enabled onDrill={onDrill} />);
  fireEvent.click(screen.getByRole('button', { name: '토폴로지' }));
  // **«무언가 그렸다» 로는 부족하다.** 층 이름은 데이터가 없어도 그려지므로,
  // 노드 상자가 나와야 조회가 끝난 것이다.
  //
  // 그리고 **두 번째 그리기까지** 기다린다 — 사전 조회가 끝나면 이름이 채워지며
  // 한 번 더 그리는데, 그 갱신을 흘려보내지 않으면 테스트가 끝난 뒤에 상태가 바뀐다.
  // 노드는 층마다 하나씩 셋이라 한 번 그릴 때 상자가 세 개다.
  await waitFor(() => expect(opsOf(ctx, 'roundRect').length).toBeGreaterThanOrEqual(6));
  return document.querySelector('canvas') as HTMLCanvasElement;
}

/**
 * 층 배치는 값이 정해져 있다 — 폭 800, 노드 폭 200.
 * 가운데(애플리케이션) 칸은 x 300~500, 오른쪽(의존 자원) 칸은 580~780 이다.
 * 노드가 층마다 하나씩이라 y 는 셋 다 같다.
 */
const AGENT_AT = { clientX: 350, clientY: 150 };
const RESOURCE_AT = { clientX: 600, clientY: 150 };

describe('TopologyPanel — 지도에 적히는 것', () => {
  it('노드에 호출 수와 평균을 함께 적는다', async () => {
    // 횟수만으로는 «많이 불리는 곳» 밖에 못 찾는다. 찾고 싶은 것은
    // «적게 불리는데 한 번이 비싼 곳» 이다.
    const canvas = await open();
    expect(canvas).toBeTruthy();
    const texts = textsOf(ctx);
    expect(texts).toContain('10 · 250ms'); // shop-db: 2,500ms / 10회
    expect(texts).toContain('100 · 200ms'); // 외부 유입: 20,000ms / 100회
  });

  it('에러는 비율까지 적는다', async () => {
    // 1건이 많은지는 10번 중 1번일 때만 답할 수 있다.
    await open();
    expect(textsOf(ctx)).toContain('err 1 (10%)');
  });

  it('층 이름을 적는다', async () => {
    await open();
    const texts = textsOf(ctx);
    expect(texts).toContain('외부 유입');
    expect(texts).toContain('애플리케이션');
    expect(texts).toContain('의존 자원');
  });
});

describe('TopologyPanel — 마우스', () => {
  it('에이전트 노드를 누르면 그 앱의 트랜잭션으로 간다', async () => {
    // 이상한 칸을 찾아 놓고 서버 목록으로 돌아가 같은 이름을 다시 골라야 하면
    // 지도를 본 보람이 없다.
    const onDrill = vi.fn();
    const canvas = await open(onDrill);
    fireEvent.click(canvas, AGENT_AT);
    expect(onDrill).toHaveBeenCalledWith(SHOP);
  });

  it('자원 노드는 눌러도 아무 일이 없다', async () => {
    // DB 는 우리 에이전트가 아니라 objHash 로 XLog 를 걸 수 없다.
    const onDrill = vi.fn();
    const canvas = await open(onDrill);
    fireEvent.click(canvas, RESOURCE_AT);
    expect(onDrill).not.toHaveBeenCalled();
  });

  it('빈 자리를 눌러도 아무 일이 없다', async () => {
    const onDrill = vi.fn();
    const canvas = await open(onDrill);
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    expect(onDrill).not.toHaveBeenCalled();
  });

  it('노드에 마우스를 올리면 그 값이 뜬다', async () => {
    const canvas = await open();
    fireEvent.mouseMove(canvas, RESOURCE_AT);
    expect(screen.getByText('shop-db')).toBeTruthy();
    expect(screen.getByText(/평균 250ms/)).toBeTruthy();
    expect(screen.getByText(/에러 1 \(10%\)/)).toBeTruthy();
  });

  it('파고들 수 있는 노드에만 그렇다고 적는다', async () => {
    const canvas = await open(vi.fn());
    fireEvent.mouseMove(canvas, AGENT_AT);
    expect(screen.getByText('눌러서 이 앱의 트랜잭션 보기')).toBeTruthy();

    fireEvent.mouseMove(canvas, RESOURCE_AT);
    expect(screen.queryByText('눌러서 이 앱의 트랜잭션 보기')).toBeNull();
  });

  it('짚은 노드에 걸린 간선에만 숫자를 붙인다', async () => {
    // 늘 적으면 선이 열 개만 넘어도 숫자가 겹쳐 아무것도 안 읽힌다.
    const canvas = await open();
    expect(textsOf(ctx)).not.toContain('10 · 250ms · ');

    ctx.ops.length = 0;
    fireEvent.mouseMove(canvas, RESOURCE_AT);
    // 자원 노드에 닿는 간선은 shop-app → shop-db 하나뿐이다.
    expect(textsOf(ctx).filter(s => s === '10 · 250ms').length).toBeGreaterThanOrEqual(1);
  });

  it('마우스가 나가면 값 창도 사라진다', async () => {
    const canvas = await open();
    fireEvent.mouseMove(canvas, RESOURCE_AT);
    expect(screen.getByText('shop-db')).toBeTruthy();

    fireEvent.mouseLeave(canvas);
    expect(screen.queryByText('shop-db')).toBeNull();
  });
});
