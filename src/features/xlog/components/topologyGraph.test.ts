import { describe, expect, it } from 'vitest';
import {
  avgElapsed,
  buildGraph,
  edgeGrade,
  edgeTone,
  edgeWidth,
  errorRate,
  EXTERNAL_HASH,
} from './topologyGraph';
import type { InteractionRow } from '../types/interaction';

const SHOP = -1585387669;
const ORDER = 16367847;
const SHOPDB = -662702541;
const AGENTS = [SHOP, ORDER];

const row = (over: Partial<InteractionRow>): InteractionRow => ({
  time: 0,
  obj_name: 'shop-app',
  interaction_type: 'INTR_API_INCOMING',
  from_hash: ORDER,
  to_hash: SHOP,
  period: 30,
  count: 10,
  error_count: 0,
  total_elapsed: 100,
  ...over,
});

describe('buildGraph', () => {
  it('같은 쌍의 행을 하나의 간선으로 합친다', () => {
    // 콜렉터는 30초 구간마다 행을 준다. 안 합치면 같은 화살표가 여러 개 그려진다.
    const g = buildGraph(
      [row({ count: 10, total_elapsed: 100 }), row({ count: 5, total_elapsed: 50 })],
      AGENTS,
    );
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].count).toBe(15);
    expect(g.edges[0].elapsed).toBe(150);
  });

  it('해시 0은 외부 유입 층에 놓는다', () => {
    const g = buildGraph([row({ from_hash: EXTERNAL_HASH, to_hash: SHOP })], AGENTS);
    expect(g.nodes.find(n => n.hash === EXTERNAL_HASH)?.layer).toBe('inbound');
  });

  it('에이전트가 아닌 대상은 자원 층이다', () => {
    const g = buildGraph([row({ from_hash: SHOP, to_hash: SHOPDB })], AGENTS);
    expect(g.nodes.find(n => n.hash === SHOPDB)?.layer).toBe('resource');
    expect(g.nodes.find(n => n.hash === SHOP)?.layer).toBe('agent');
  });

  it('부르기도 하고 불리기도 하는 에이전트는 자원으로 밀리지 않는다', () => {
    // shop-app 은 order-app 에게 불리고 DB 를 부른다. 먼저 본 방향으로 층을 굳히면
    // 우리 앱이 자원 칸에 놓여 그림이 뒤집힌다.
    const g = buildGraph(
      [
        row({ from_hash: SHOP, to_hash: SHOPDB }),
        row({ from_hash: ORDER, to_hash: SHOP }),
      ],
      AGENTS,
    );
    expect(g.nodes.find(n => n.hash === SHOP)?.layer).toBe('agent');
  });

  it('자기 자신을 부르는 행은 버린다', () => {
    const g = buildGraph([row({ from_hash: SHOP, to_hash: SHOP })], AGENTS);
    expect(g.edges).toEqual([]);
  });

  it('노드의 호출 수는 드나든 것을 모두 센다', () => {
    const g = buildGraph(
      [
        row({ from_hash: EXTERNAL_HASH, to_hash: SHOP, count: 100 }),
        row({ from_hash: SHOP, to_hash: SHOPDB, count: 40 }),
      ],
      AGENTS,
    );
    expect(g.nodes.find(n => n.hash === SHOP)?.calls).toBe(140);
  });

  it('간선은 호출이 많은 순이다', () => {
    const g = buildGraph(
      [
        row({ from_hash: SHOP, to_hash: SHOPDB, count: 5 }),
        row({ from_hash: EXTERNAL_HASH, to_hash: SHOP, count: 90 }),
      ],
      AGENTS,
    );
    expect(g.edges[0].count).toBe(90);
  });

  it('에러 수를 간선과 노드 양쪽에 싣는다', () => {
    const g = buildGraph([row({ count: 10, error_count: 3 })], AGENTS);
    expect(g.edges[0].errors).toBe(3);
    expect(g.nodes.find(n => n.hash === SHOP)?.errors).toBe(3);
  });

  it('행이 없으면 빈 그래프다', () => {
    expect(buildGraph([], AGENTS)).toEqual({ nodes: [], edges: [] });
  });
});

describe('edgeWidth', () => {
  it('가장 굵은 간선도 상한을 넘지 않는다', () => {
    expect(edgeWidth(10_000, 10_000)).toBeCloseTo(6, 1);
  });

  it('호출이 1000배 적어도 선이 사라지지 않는다', () => {
    // 선형으로 하면 0.006px 이 되어 안 보인다. 안 보이는 간선은 없는 간선과 같다.
    expect(edgeWidth(10, 10_000)).toBeGreaterThan(1.5);
  });

  it('0이나 음수에도 최소 굵기를 준다', () => {
    expect(edgeWidth(0, 100)).toBe(1);
    expect(edgeWidth(5, 0)).toBe(1);
  });
});

describe('edgeTone', () => {
  it('에러가 하나라도 있으면 error 다', () => {
    const g = buildGraph([row({ error_count: 1 })], AGENTS);
    expect(edgeTone(g.edges[0])).toBe('error');
  });

  it('에러가 없으면 normal 이다', () => {
    const g = buildGraph([row({ error_count: 0 })], AGENTS);
    expect(edgeTone(g.edges[0])).toBe('normal');
  });
});

describe('avgElapsed · errorRate', () => {
  it('노드에 걸린 시간을 호출 수로 나눈다', () => {
    // 호출 수만 보면 «많이 불리는 곳» 밖에 못 찾는다. 지도에서 정작 찾고 싶은 것은
    // «적게 불리는데 한 번이 비싼 곳» 이다.
    const g = buildGraph([row({ from_hash: SHOP, to_hash: SHOPDB, count: 4, total_elapsed: 1_000 })], AGENTS);
    const db = g.nodes.find(n => n.hash === SHOPDB)!;
    expect(avgElapsed(db)).toBe(250);
  });

  it('셀 것이 없으면 0 이 아니라 null 이다', () => {
    // 0 을 적으면 «순식간에 끝났다» 로 읽힌다.
    expect(avgElapsed({ calls: 0, elapsed: 0 })).toBeNull();
    expect(errorRate({ calls: 0, errors: 0 })).toBeNull();
  });

  it('간선에도 같은 규칙을 쓴다', () => {
    const g = buildGraph([row({ count: 10, total_elapsed: 5_000, error_count: 2 })], AGENTS);
    expect(avgElapsed(g.edges[0])).toBe(500);
    expect(errorRate(g.edges[0])).toBeCloseTo(0.2);
  });
});

describe('edgeGrade', () => {
  it('실패가 느림을 이긴다', () => {
    // 둘 다면 빨간 쪽이 급한 이야기다.
    const g = buildGraph([row({ count: 10, total_elapsed: 50_000, error_count: 1 })], AGENTS);
    expect(edgeGrade(g.edges[0])).toBe('danger');
  });

  it('느림의 경계는 durationTone 과 같은 자다', () => {
    // 화면마다 자가 다르면 주황색이 화면을 옮길 때마다 다른 뜻이 된다.
    const slow = buildGraph([row({ count: 10, total_elapsed: 3_000 })], AGENTS);
    const fast = buildGraph([row({ count: 10, total_elapsed: 2_990 })], AGENTS);
    expect(edgeGrade(slow.edges[0])).toBe('warn'); // 평균 300ms
    expect(edgeGrade(fast.edges[0])).toBe('ok'); // 평균 299ms
  });
});
