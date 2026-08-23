// 분산 트랜잭션 트리 (순수 로직)
//
// 요청 하나가 여러 앱을 거치면 XLog 도 앱마다 따로 남는다.
// 목록에서는 남남으로 보이지만 `gxid` 가 같으면 한 요청이고,
// `caller` 가 부모의 `txid` 다. 그 관계를 트리로 세운다.
//
// **txid 는 string 이다.** i64 전 범위를 쓰므로 숫자로 바꾸면 하위 비트가 날아가
// 다른 트랜잭션을 가리킨다. 여기서는 끝까지 문자열로만 다룬다.

import type { SXLog } from '../types/xlog';

export interface TraceNode {
  xlog: SXLog;
  children: TraceNode[];
  /** 뿌리가 0 */
  depth: number;
}

/** 시작 시각. 끝 시각이 아니라 이걸로 정렬해야 호출 순서가 보인다. */
function startTime(x: SXLog): number {
  return x.endTime - x.elapsed;
}

function byStart(a: TraceNode, b: TraceNode): number {
  const d = startTime(a.xlog) - startTime(b.xlog);
  // 시작이 같으면 txid 로 갈라 순서를 고정한다 — 다시 그릴 때마다 뒤바뀌면 못 읽는다.
  return d !== 0 ? d : a.xlog.txid.localeCompare(b.xlog.txid);
}

/**
 * caller 로 부모를 찾아 트리를 세운다.
 *
 * 부모가 목록에 없는 XLog 는 **버리지 않고** 뿌리로 올린다.
 * 부모 쪽이 아직 콜렉터에 안 들어왔거나 샘플링에서 빠지는 일이 실제로 있는데,
 * 그때 자식을 버리면 화면이 통째로 비어 원인을 알 수 없다.
 */
export function buildCallTree(xlogs: readonly SXLog[]): TraceNode[] {
  const nodes = new Map<string, TraceNode>();
  for (const x of xlogs) {
    // 중복이 섞여 오면 같은 노드를 두 번 그리게 된다.
    if (!nodes.has(x.txid)) nodes.set(x.txid, { xlog: x, children: [], depth: 0 });
  }

  const roots: TraceNode[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(node.xlog.caller);
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  // A→B→A 같은 순환이 있으면 어느 노드도 뿌리가 되지 못해 트리가 통째로 사라진다.
  // 잘못된 데이터로 화면이 비는 것보다 아무 곳이나 끊어 보여 주는 편이 낫다.
  if (roots.length === 0 && nodes.size > 0) {
    const [first] = nodes.values();
    const parent = nodes.get(first.xlog.caller);
    if (parent) parent.children = parent.children.filter(c => c !== first);
    roots.push(first);
  }

  // 순환이 남아 있어도 같은 노드를 두 번 밟지 않는다.
  const seen = new Set<string>();
  const assign = (node: TraceNode, depth: number): void => {
    if (seen.has(node.xlog.txid)) {
      node.children = [];
      return;
    }
    seen.add(node.xlog.txid);
    node.depth = depth;
    node.children.sort(byStart);
    for (const c of node.children) assign(c, depth + 1);
  };

  roots.sort(byStart);
  for (const r of roots) assign(r, 0);
  return roots;
}

/** 깊이 우선으로 펼친다 — 목록으로 그릴 때 쓴다 */
export function flattenTree(roots: readonly TraceNode[]): TraceNode[] {
  const out: TraceNode[] = [];
  const walk = (node: TraceNode): void => {
    out.push(node);
    for (const c of node.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

export interface TraceSpan {
  /** 가장 이른 시작 시각 (epoch ms) */
  start: number;
  /** 전체 길이 (ms) */
  total: number;
}

/**
 * 트리 전체가 차지하는 시간축.
 *
 * **뿌리의 elapsed 를 축으로 삼으면 안 된다.** 앱마다 시계가 조금씩 달라
 * 자식이 부모보다 늦게 끝나는 일이 실제로 있고, 그러면 막대가 화면 밖으로 나간다.
 */
export function traceSpan(roots: readonly TraceNode[]): TraceSpan {
  const all = flattenTree(roots);
  if (all.length === 0) return { start: 0, total: 0 };

  let min = Infinity;
  let max = -Infinity;
  for (const { xlog } of all) {
    min = Math.min(min, startTime(xlog));
    max = Math.max(max, xlog.endTime);
  }
  // 즉시 끝난 트랜잭션만 있으면 길이가 0이 된다. 비율 계산이 0으로 나눈다.
  return { start: min, total: Math.max(1, max - min) };
}

/**
 * 자기가 쓴 시간 — elapsed 에서 자식들이 쓴 시간을 뺀 값.
 *
 * 부모의 elapsed 는 자식을 기다린 시간을 품고 있어 그대로는 범인을 못 가린다.
 * 어느 앱이 실제로 느린지는 이 값이 말해 준다.
 */
export function selfTime(node: TraceNode): number {
  const childSum = node.children.reduce((sum, c) => sum + c.xlog.elapsed, 0);
  // 앱마다 시계가 조금씩 달라 자식 합이 부모를 넘을 수 있다. 막대가 음수면 화면이 깨진다.
  return Math.max(0, node.xlog.elapsed - childSum);
}
