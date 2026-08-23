// 서비스 흐름 트리 (순수 로직)
//
// 호출 트리(callTree)가 "어느 앱이 느린가" 에 답한다면, 이건 한 단계 더 내려가
// **그 앱이 무엇을 불렀나** 를 보여준다. XLog(앱)와 프로파일(SQL·API 호출)을 엮는다.
//
// 잇는 규칙은 ASIS XLogFlowView.stepToElement 와 같다:
//   ApiCall·ThreadCall 스텝의 `txid` 가 다른 XLog 를 가리키면 **그 서비스를 붙인다.**
//   가리키는 XLog 가 없으면 호출 자체를 잎으로 남긴다.
//
// 같은 대상은 하나로 접고 횟수·시간을 누적한다 (ASIS DependencyElement.addChild).
// 같은 SQL 50개가 잎 50개로 흩어지면 N+1 이 오히려 안 보인다.

import type { SXLog } from '../types/xlog';
import type { ProfileStep } from '../types/profile';

export type FlowKind = 'user' | 'service' | 'sql' | 'apicall' | 'thread';

export interface FlowNode {
  /** 병합 기준. 같은 key 는 한 노드다 */
  key: string;
  kind: FlowKind;
  name: string;
  /** 어느 앱인가. service 노드에만 있다 */
  agent?: string;
  /** 합산 소요 (ms) */
  elapsed: number;
  /** 접힌 횟수 */
  count: number;
  error: boolean;
  children: FlowNode[];
  /** 뿌리가 0. flattenFlow 가 매긴다 */
  depth: number;
  /** service 노드에만. 클릭으로 그 트랜잭션을 열 때 쓴다 */
  xlog?: SXLog;
}

export interface FlowInput {
  /** 같은 gxid 의 XLog 들 */
  services: readonly SXLog[];
  /** txid → 그 트랜잭션의 프로파일 스텝 */
  profiles: ReadonlyMap<string, readonly ProfileStep[]>;
  /** hash → 텍스트 (service / sql / apicall 공용) */
  texts: Record<number, string>;
  agentMap: ReadonlyMap<number, string>;
}

export interface FlowFilter {
  showSql: boolean;
  showApiCall: boolean;
}

function node(key: string, kind: FlowKind, name: string, elapsed: number, error: boolean): FlowNode {
  return { key, kind, name, elapsed, count: 1, error, children: [], depth: 0 };
}

/** 같은 대상이면 접고 누적한다. ASIS DependencyElement.addChild 와 같은 규칙 */
function addChild(parent: FlowNode, child: FlowNode): void {
  const found = parent.children.find(c => c.key === child.key);
  if (!found) {
    parent.children.push(child);
    return;
  }
  // 서비스 노드는 실체가 하나뿐이라 누적하면 시간이 부풀려진다.
  if (found.kind === 'service') return;

  found.count += child.count;
  found.elapsed += child.elapsed;
  // 하나라도 실패했으면 접힌 노드도 실패다 — 성공 건수에 묻히면 안 된다.
  found.error = found.error || child.error;
}

export function buildFlowTree(input: FlowInput, filter: FlowFilter): FlowNode[] {
  const { services, profiles, texts, agentMap } = input;
  if (services.length === 0) return [];

  const text = (hash: number) => texts[hash] ?? `0x${(hash >>> 0).toString(16)}`;

  // 1) XLog 하나당 서비스 노드 하나
  const serviceNodes = new Map<string, FlowNode>();
  for (const x of services) {
    if (serviceNodes.has(x.txid)) continue;
    const n = node(`service:${x.txid}`, 'service', text(x.service), x.elapsed, x.error !== 0);
    n.agent = agentMap.get(x.objHash) ?? `0x${(x.objHash >>> 0).toString(16)}`;
    n.xlog = x;
    serviceNodes.set(x.txid, n);
  }

  // 2) 프로파일을 훑어 잎을 달고, 호출 스텝의 txid 로 서비스끼리 잇는다
  const linked = new Set<string>(); // 부모가 생긴 서비스 txid

  // ApiCall 과 ThreadCall 은 잇는 규칙이 같다 (ASIS XLogFlowView 의 APICALL /
  // THREAD_CALL_POSSIBLE 분기). txid 가 아는 서비스면 **그 서비스**를 잇고,
  // 모르면 호출 자체를 잎으로 남긴다.
  const linkOrLeaf = (parent: FlowNode, txid: string, leaf: () => FlowNode | null): void => {
    const called = txid !== '0' ? serviceNodes.get(txid) : undefined;
    if (called && called !== parent && !linked.has(txid)) {
      // 필터는 **잎**을 줄이는 것이지 흐름 자체를 끊는 게 아니다.
      // API 호출을 꺼도 이어진 앱은 남아야 한다.
      linked.add(txid);
      addChild(parent, called);
      return;
    }
    if (called) return;

    const n = leaf();
    if (n) addChild(parent, n);
  };

  for (const x of services) {
    const parent = serviceNodes.get(x.txid);
    const steps = profiles.get(x.txid);
    if (!parent || !steps) continue;

    for (const step of steps) {
      if (step.kind === 'Sql') {
        if (!filter.showSql) continue;
        addChild(
          parent,
          node(`sql:${step.hash}`, 'sql', text(step.hash), step.elapsed, step.error !== 0),
        );
        continue;
      }

      if (step.kind === 'ApiCall') {
        linkOrLeaf(parent, step.txid, () =>
          filter.showApiCall
            ? node(
                `api:${step.hash}`,
                'apicall',
                step.address || text(step.hash),
                step.elapsed,
                step.error !== 0,
              )
            : null,
        );
        continue;
      }

      if (step.kind === 'ThreadCall') {
        // 넘어가지 않았으면 스텝 자체를 버린다 — 이 트랜잭션 안에서 이미 끝났고
        // 흐름에 갈라질 갈래가 없다 (ASIS 도 threaded==0 이면 break).
        if (!step.threaded) continue;
        // 이름은 apicall 사전에 있다. 잎이 되는 건 넘어간 트랜잭션이 아직
        // 그룹에 없을 때뿐이고, 그때도 **뭘 불렀는지는 보여야 한다.**
        linkOrLeaf(parent, step.txid, () =>
          filter.showApiCall
            ? node(`thread:${step.hash}`, 'thread', text(step.hash), step.elapsed, false)
            : null,
        );
      }
    }
  }

  // 3) 아직 부모가 없는 자식은 caller 로 붙인다.
  //    프로파일 조회가 실패하거나 샘플링에서 빠지면 ApiCall 스텝이 없다.
  //    그렇다고 버리면 **호출된 앱이 화면에서 사라진다.**
  for (const x of services) {
    if (linked.has(x.txid)) continue;
    const self = serviceNodes.get(x.txid);
    const parent = serviceNodes.get(x.caller);
    if (!self || !parent || parent === self) continue;
    linked.add(x.txid);
    addChild(parent, self);
  }

  // 4) 부모가 없는 서비스는 요청이 들어온 지점(IP)에 매단다
  const roots: FlowNode[] = [];
  const userNodes = new Map<string, FlowNode>();
  for (const x of services) {
    if (linked.has(x.txid)) continue;
    const self = serviceNodes.get(x.txid);
    if (!self) continue;

    const ip = x.ipAddr || '???.???.???.???';
    let user = userNodes.get(ip);
    if (!user) {
      user = node(`user:${ip}`, 'user', ip, 0, false);
      userNodes.set(ip, user);
      roots.push(user);
    }
    addChild(user, self);
  }

  // 서로가 서로를 부르면(A→B→A) 어느 쪽도 뿌리가 못 돼 트리가 통째로 사라진다.
  // 잘못된 데이터로 화면이 비는 것보다 아무 곳이나 끊어 보여 주는 편이 낫다.
  if (roots.length === 0) {
    const [first] = services;
    const self = serviceNodes.get(first.txid);
    if (self) {
      for (const n of serviceNodes.values()) {
        n.children = n.children.filter(c => c !== self);
      }
      const user = node(`user:${first.ipAddr}`, 'user', first.ipAddr, 0, false);
      user.children.push(self);
      roots.push(user);
    }
  }

  return roots;
}

/** 깊이 우선으로 펼치며 깊이를 매긴다. 순환이 남아 있어도 한 번씩만 밟는다 */
export function flattenFlow(roots: readonly FlowNode[]): FlowNode[] {
  const out: FlowNode[] = [];
  const seen = new Set<string>();

  const walk = (n: FlowNode, depth: number): void => {
    if (seen.has(n.key)) return;
    seen.add(n.key);
    n.depth = depth;
    out.push(n);
    for (const c of n.children) walk(c, depth + 1);
  };

  for (const r of roots) walk(r, 0);
  return out;
}
