// 서비스 흐름 트리
//
// 호출 트리(callTree)가 "어느 앱이" 라면 이건 "그 앱이 무엇을 불렀나" 까지 내려간다.
// XLog(앱) 과 프로파일(그 앱의 SQL·API 호출)을 하나의 그래프로 엮는다.

import { describe, it, expect } from 'vitest';
import { buildFlowTree, flattenFlow, type FlowInput } from './flowTree';
import type { SXLog } from '../types/xlog';
import type { ProfileStep } from '../types/profile';

const stepBase = { parent: -1, index: 0, start_time: 0, start_cpu: 0 };

function xlog(txid: string, caller: string, opts: Partial<SXLog> = {}): SXLog {
  return {
    txid,
    caller,
    gxid: 'G',
    endTime: 1_000,
    elapsed: 100,
    objHash: 10,
    service: 1,
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
    ...opts,
  };
}

function sql(hash: number, elapsed: number): ProfileStep {
  return { kind: 'Sql', ...stepBase, hash, elapsed, error: 0, param: '', updated: 0 };
}

function apicall(hash: number, elapsed: number, txid = '0'): ProfileStep {
  return { kind: 'ApiCall', ...stepBase, hash, elapsed, error: 0, txid, address: '' };
}

function threadcall(hash: number, elapsed: number, txid: string, threaded = true): ProfileStep {
  return { kind: 'ThreadCall', ...stepBase, hash, elapsed, txid, threaded };
}

const TEXTS: Record<number, string> = {
  1: '/order/orders',
  2: '/shop/api/products',
  10: 'select * from product',
  20: 'GET http://shop-app/api',
};

const AGENTS = new Map([
  [10, 'order-app'],
  [20, 'shop-app'],
]);

function input(over: Partial<FlowInput> = {}): FlowInput {
  return {
    services: [],
    profiles: new Map(),
    texts: TEXTS,
    agentMap: AGENTS,
    ...over,
  };
}

const ALL = { showSql: true, showApiCall: true };

describe('buildFlowTree', () => {
  it('시작점은 사용자 IP다', () => {
    // 요청이 어디서 들어왔는지가 흐름의 출발점이다.
    const roots = buildFlowTree(
      input({ services: [xlog('A', '0', { ipAddr: '172.20.0.9' })] }),
      ALL,
    );

    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({ kind: 'user', name: '172.20.0.9' });
    expect(roots[0].children[0]).toMatchObject({ kind: 'service', name: '/order/orders' });
  });

  it('같은 IP에서 온 요청은 한 시작점으로 묶인다', () => {
    const roots = buildFlowTree(
      input({ services: [xlog('A', '0'), xlog('B', '0')] }),
      ALL,
    );

    expect(roots).toHaveLength(1);
    expect(roots[0].children).toHaveLength(2);
  });

  it('SQL 스텝이 서비스의 자식이 된다', () => {
    const roots = buildFlowTree(
      input({
        services: [xlog('A', '0')],
        profiles: new Map([['A', [sql(10, 30)]]]),
      }),
      ALL,
    );

    const service = roots[0].children[0];
    expect(service.children).toHaveLength(1);
    expect(service.children[0]).toMatchObject({
      kind: 'sql',
      name: 'select * from product',
      elapsed: 30,
      count: 1,
    });
  });

  it('같은 SQL 이 반복되면 한 노드로 접고 횟수를 센다', () => {
    // N+1 을 눈에 보이게 하는 지점이다. 50개 잎으로 흩어지면 아무것도 안 보인다.
    const roots = buildFlowTree(
      input({
        services: [xlog('A', '0')],
        profiles: new Map([['A', [sql(10, 3), sql(10, 5), sql(10, 2)]]]),
      }),
      ALL,
    );

    const sqlNode = roots[0].children[0].children[0];
    expect(sqlNode.count).toBe(3);
    expect(sqlNode.elapsed).toBe(10);
  });

  it('ApiCall 의 txid 가 다른 XLog 를 가리키면 그 서비스를 잇는다', () => {
    // 이게 이 화면의 핵심이다 — API 호출 잎이 아니라 **호출된 앱**이 붙는다.
    const roots = buildFlowTree(
      input({
        services: [
          xlog('A', '0', { objHash: 10, service: 1 }),
          xlog('B', 'A', { objHash: 20, service: 2 }),
        ],
        profiles: new Map([['A', [apicall(20, 40, 'B')]]]),
      }),
      ALL,
    );

    const order = roots[0].children[0];
    expect(order.children).toHaveLength(1);
    expect(order.children[0]).toMatchObject({ kind: 'service', name: '/shop/api/products' });
  });

  it('이어진 서비스는 시작점 아래에 또 나오지 않는다', () => {
    // 양쪽에 다 붙으면 같은 앱이 두 번 그려져 흐름이 거짓이 된다.
    const roots = buildFlowTree(
      input({
        services: [xlog('A', '0'), xlog('B', 'A', { service: 2 })],
        profiles: new Map([['A', [apicall(20, 40, 'B')]]]),
      }),
      ALL,
    );

    expect(roots[0].children).toHaveLength(1);
  });

  it('부모 프로파일이 없어도 자식 서비스를 잃지 않는다', () => {
    // 프로파일 조회가 실패하거나 샘플링에서 빠지면 ApiCall 스텝이 없다.
    // 그렇다고 자식을 버리면 **호출된 앱이 화면에서 사라진다.** caller 로 붙인다.
    const roots = buildFlowTree(
      input({ services: [xlog('A', '0'), xlog('B', 'A', { service: 2 })] }),
      ALL,
    );

    const order = roots[0].children[0];
    expect(order.children.map(c => c.name)).toEqual(['/shop/api/products']);
  });

  it('txid 가 목록에 없는 ApiCall 은 잎으로 남는다', () => {
    // 상대 앱에 에이전트가 없으면 XLog 가 없다. 그래도 "무엇을 불렀는지"는 보여야 한다.
    const roots = buildFlowTree(
      input({
        services: [xlog('A', '0')],
        profiles: new Map([['A', [apicall(20, 40, 'MISSING')]]]),
      }),
      ALL,
    );

    expect(roots[0].children[0].children[0]).toMatchObject({
      kind: 'apicall',
      name: 'GET http://shop-app/api',
      elapsed: 40,
    });
  });

  it('SQL 을 끄면 SQL 만 사라진다', () => {
    const roots = buildFlowTree(
      input({
        services: [xlog('A', '0')],
        profiles: new Map([['A', [sql(10, 30), apicall(20, 40)]]]),
      }),
      { showSql: false, showApiCall: true },
    );

    expect(roots[0].children[0].children.map(c => c.kind)).toEqual(['apicall']);
  });

  it('API 호출을 꺼도 이어진 서비스는 남는다', () => {
    // 필터는 **잎**을 줄이는 것이지 흐름 자체를 끊는 게 아니다.
    const roots = buildFlowTree(
      input({
        services: [xlog('A', '0'), xlog('B', 'A', { service: 2 })],
        profiles: new Map([['A', [apicall(20, 40, 'B')]]]),
      }),
      { showSql: true, showApiCall: false },
    );

    expect(roots[0].children[0].children[0].kind).toBe('service');
  });

  it('에러가 난 스텝은 표시가 남는다', () => {
    const failing: ProfileStep = {
      kind: 'Sql',
      ...stepBase,
      hash: 10,
      elapsed: 5,
      error: 777,
      param: '',
      updated: 0,
    };
    const roots = buildFlowTree(
      input({ services: [xlog('A', '0')], profiles: new Map([['A', [sql(10, 3), failing]]]) }),
      ALL,
    );

    // 하나라도 실패했으면 접힌 노드도 실패다 — 성공 3건에 묻히면 안 된다.
    expect(roots[0].children[0].children[0].error).toBe(true);
  });

  it('순환이 있어도 멈춘다', () => {
    const roots = buildFlowTree(
      input({
        services: [xlog('A', 'B'), xlog('B', 'A', { service: 2 })],
        profiles: new Map([
          ['A', [apicall(20, 1, 'B')]],
          ['B', [apicall(20, 1, 'A')]],
        ]),
      }),
      ALL,
    );

    const names = flattenFlow(roots).filter(n => n.kind === 'service');
    expect(names).toHaveLength(2);
  });

  // ── ThreadCall (다른 스레드로 넘어간 작업) ──────────────────────
  //
  // 실측(probe_flow_step_kinds): 넘어간 트랜잭션은 **부모와 같은 gxid 그룹**으로
  // 들어오고 caller 도 부모 txid 다. 그래서 대개 서비스 노드로 이어진다.

  it('넘어간 스레드의 트랜잭션이 그룹에 있으면 그 서비스를 잇는다', () => {
    const roots = buildFlowTree(
      input({
        services: [xlog('A', '0'), xlog('B', 'A', { objHash: 20, service: 2, elapsed: 120 })],
        profiles: new Map([['A', [threadcall(20, 120, 'B')]]]),
      }),
      ALL,
    );

    const a = roots[0].children[0];
    expect(a.children).toHaveLength(1);
    expect(a.children[0]).toMatchObject({ kind: 'service', name: '/shop/api/products' });
    // 시작점 아래에 또 나오면 같은 작업이 두 번 있는 것처럼 보인다
    expect(roots).toHaveLength(1);
    expect(roots[0].children).toHaveLength(1);
  });

  it('넘어가지 않은 ThreadCall 은 아무 노드도 만들지 않는다', () => {
    // threaded=false 면 이 트랜잭션 안에서 끝났다. 갈라진 갈래가 없다.
    const roots = buildFlowTree(
      input({
        services: [xlog('A', '0')],
        profiles: new Map([['A', [threadcall(20, 5, '0', false)]]]),
      }),
      ALL,
    );

    expect(roots[0].children[0].children).toHaveLength(0);
  });

  it('넘어간 트랜잭션이 그룹에 없으면 잎으로 남는다', () => {
    // 샘플링에서 빠졌거나 아직 안 들어왔을 때. 뭘 불렀는지는 보여야 한다.
    const roots = buildFlowTree(
      input({
        services: [xlog('A', '0')],
        profiles: new Map([['A', [threadcall(20, 42, 'ZZZ')]]]),
      }),
      ALL,
    );

    expect(roots[0].children[0].children[0]).toMatchObject({
      kind: 'thread',
      name: 'GET http://shop-app/api',
      elapsed: 42,
    });
  });

  it('같은 곳으로 넘긴 ThreadCall 이 반복되면 접고 횟수를 센다', () => {
    const roots = buildFlowTree(
      input({
        services: [xlog('A', '0')],
        profiles: new Map([['A', [threadcall(20, 10, '0'), threadcall(20, 30, '0')]]]),
      }),
      ALL,
    );

    const leaves = roots[0].children[0].children;
    expect(leaves).toHaveLength(1);
    expect(leaves[0]).toMatchObject({ kind: 'thread', count: 2, elapsed: 40 });
  });

  it('API 호출을 끄면 ThreadCall 잎도 사라지지만 이어진 서비스는 남는다', () => {
    // ASIS 도 DISPATCH 요소를 API 토글로 거른다 (XLogFlowView.filter)
    const roots = buildFlowTree(
      input({
        services: [xlog('A', '0'), xlog('B', 'A', { objHash: 20, service: 2 })],
        profiles: new Map([['A', [threadcall(20, 42, 'ZZZ'), threadcall(20, 120, 'B')]]]),
      }),
      { showSql: true, showApiCall: false },
    );

    const children = roots[0].children[0].children;
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ kind: 'service', name: '/shop/api/products' });
  });

  it('빈 입력은 빈 트리다', () => {
    expect(buildFlowTree(input(), ALL)).toEqual([]);
  });
});

describe('flattenFlow', () => {
  it('깊이 우선으로 펼치고 깊이를 매긴다', () => {
    const roots = buildFlowTree(
      input({
        services: [xlog('A', '0')],
        profiles: new Map([['A', [sql(10, 3)]]]),
      }),
      ALL,
    );

    const flat = flattenFlow(roots);
    expect(flat.map(n => n.kind)).toEqual(['user', 'service', 'sql']);
    expect(flat.map(n => n.depth)).toEqual([0, 1, 2]);
  });
});
