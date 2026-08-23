// 토폴로지 그래프 구성 (순수 로직)
//
// 인터랙션 행은 "누가 누구를 몇 번 불렀나"의 나열이다. 그래프로 만들려면
// **노드가 어느 층에 속하는지**를 정해야 한다.
//
// 힘기반 배치를 쓰지 않는다. 호출 관계는 방향이 있고, 실제로 보고 싶은 건
// **바깥 → 우리 앱 → 자원** 이라는 흐름이다. 층으로 세우면 그 흐름이 바로 읽히고
// 노드가 튀지 않아 매번 같은 그림이 나온다. 힘기반은 흔들려서 비교가 안 된다.

import type { InteractionRow } from '../types/interaction';

/** 노드가 놓이는 층 */
export type NodeLayer = 'inbound' | 'agent' | 'resource';

export interface GraphNode {
  hash: number;
  layer: NodeLayer;
  /** 사전으로 푼 이름. 못 풀면 호출부가 해시를 쓴다 */
  label: string;
  /** 이 노드로 들어오거나 나간 호출 수 */
  calls: number;
  errors: number;
}

export interface GraphEdge {
  from: number;
  to: number;
  /** `INTR_DB_CALL` 등. 여러 종류가 같은 쌍에 걸리면 가장 많은 것을 쓴다 */
  type: string;
  count: number;
  errors: number;
  /** 소요 시간 합(ms) */
  elapsed: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** 외부에서 들어온 호출. 에이전트가 아니므로 해시가 0이다 (F-40) */
export const EXTERNAL_HASH = 0;

/**
 * 같은 쌍의 행을 합친다.
 *
 * 콜렉터는 30초 구간마다 행을 준다. 같은 (from,to) 가 여러 번 나오므로
 * **합치지 않으면 같은 화살표가 여러 개** 그려진다.
 */
export function buildGraph(rows: readonly InteractionRow[], agentHashes: readonly number[]): Graph {
  const isAgent = (h: number) => agentHashes.includes(h);

  const edgeMap = new Map<string, GraphEdge>();
  for (const r of rows) {
    // 자기 자신을 부르는 행은 그래프에서 의미가 없다 — 화살표가 점으로 뭉친다.
    if (r.from_hash === r.to_hash) continue;

    const key = `${r.from_hash}>${r.to_hash}`;
    const prev = edgeMap.get(key);
    if (prev) {
      prev.count += r.count;
      prev.errors += r.error_count;
      prev.elapsed += r.total_elapsed;
      // 종류가 섞이면 더 많이 불린 쪽 이름을 남긴다
      if (r.count > prev.count / 2) prev.type = r.interaction_type;
    } else {
      edgeMap.set(key, {
        from: r.from_hash,
        to: r.to_hash,
        type: r.interaction_type,
        count: r.count,
        errors: r.error_count,
        elapsed: r.total_elapsed,
      });
    }
  }

  const edges = [...edgeMap.values()].sort((a, b) => b.count - a.count);

  const nodeMap = new Map<number, GraphNode>();
  const touch = (hash: number, layer: NodeLayer): GraphNode => {
    let n = nodeMap.get(hash);
    if (!n) {
      n = { hash, layer, label: '', calls: 0, errors: 0 };
      nodeMap.set(hash, n);
    }
    // **에이전트 판정이 언제나 이긴다.** 같은 노드가 부르기도 하고 불리기도 하는데,
    // 먼저 본 방향으로 층을 굳히면 우리 앱이 자원 칸에 놓인다.
    if (layer === 'agent') n.layer = 'agent';
    return n;
  };

  for (const e of edges) {
    const from = touch(e.from, e.from === EXTERNAL_HASH ? 'inbound' : isAgent(e.from) ? 'agent' : 'resource');
    const to = touch(e.to, isAgent(e.to) ? 'agent' : 'resource');
    from.calls += e.count;
    from.errors += e.errors;
    to.calls += e.count;
    to.errors += e.errors;
  }

  // 층 순서대로, 층 안에서는 호출이 많은 것부터. 그래야 굵은 선이 위에 모인다.
  const order: Record<NodeLayer, number> = { inbound: 0, agent: 1, resource: 2 };
  const nodes = [...nodeMap.values()].sort(
    (a, b) => order[a.layer] - order[b.layer] || b.calls - a.calls,
  );

  return { nodes, edges };
}

/**
 * 선 굵기. 호출 수 차이가 1000배라 그대로 쓰면 가는 선이 사라진다.
 *
 * 로그 척도로 눌러 **최소 굵기를 보장**한다 — 안 보이는 간선은 없는 간선과 같다.
 */
export function edgeWidth(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 1;
  const ratio = Math.log10(count + 1) / Math.log10(max + 1);
  return 1 + ratio * 5;
}

/** 에러가 섞인 간선은 눈에 띄어야 한다 */
export function edgeTone(edge: GraphEdge): 'error' | 'normal' {
  return edge.errors > 0 ? 'error' : 'normal';
}
