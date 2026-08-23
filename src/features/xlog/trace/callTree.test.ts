// 분산 트랜잭션 트리 구성
//
// 같은 gxid 의 XLog 들은 서로 부모/자식 관계다. `caller` 가 부모의 `txid` 다.
// 목록으로는 남남으로 보이는 것들이 사실 한 요청이라는 걸 이 트리가 보여준다.

import { describe, it, expect } from 'vitest';
import { buildCallTree, flattenTree, selfTime, traceSpan } from './callTree';
import type { SXLog } from '../types/xlog';

/** 트리 구성에 필요한 필드만 채운다 */
function xlog(txid: string, caller: string, opts: Partial<SXLog> = {}): SXLog {
  return {
    txid,
    caller,
    gxid: 'G',
    endTime: 1_000_000,
    elapsed: 10,
    objHash: 1,
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

describe('buildCallTree', () => {
  it('caller 로 부모를 찾아 잇는다', () => {
    const roots = buildCallTree([xlog('B', 'A'), xlog('A', '0')]);

    expect(roots).toHaveLength(1);
    expect(roots[0].xlog.txid).toBe('A');
    expect(roots[0].children.map(c => c.xlog.txid)).toEqual(['B']);
  });

  it('caller 가 목록에 없으면 그 자체가 뿌리다', () => {
    // 부모 앱의 XLog 가 아직 콜렉터에 안 들어왔거나 샘플링에서 빠질 수 있다.
    // 이때 자식을 버리면 **화면이 통째로 비어** 원인을 알 수 없게 된다.
    const roots = buildCallTree([xlog('B', 'MISSING')]);

    expect(roots.map(r => r.xlog.txid)).toEqual(['B']);
  });

  it('깊이를 매긴다', () => {
    const roots = buildCallTree([xlog('A', '0'), xlog('B', 'A'), xlog('C', 'B')]);

    expect(roots[0].depth).toBe(0);
    expect(roots[0].children[0].depth).toBe(1);
    expect(roots[0].children[0].children[0].depth).toBe(2);
  });

  it('형제는 시작 시각 순이다', () => {
    // endTime 이 아니라 **시작**(endTime - elapsed) 순이어야 호출 순서가 보인다.
    // 늦게 시작해 먼저 끝난 호출이 위로 올라오면 흐름이 거꾸로 읽힌다.
    const late = xlog('LATE', 'A', { endTime: 1_000_100, elapsed: 10 }); // 시작 1_000_090
    const early = xlog('EARLY', 'A', { endTime: 1_000_200, elapsed: 150 }); // 시작 1_000_050

    const roots = buildCallTree([xlog('A', '0'), late, early]);

    expect(roots[0].children.map(c => c.xlog.txid)).toEqual(['EARLY', 'LATE']);
  });

  it('같은 txid 가 두 번 오면 하나만 남긴다', () => {
    // 콜렉터 응답에 중복이 섞이면 같은 노드가 두 번 그려진다.
    const roots = buildCallTree([xlog('A', '0'), xlog('A', '0')]);

    expect(roots).toHaveLength(1);
  });

  it('순환이 있어도 멈춘다', () => {
    // A→B→A. 잘못된 데이터로 화면이 멈추면 안 된다.
    const roots = buildCallTree([xlog('A', 'B'), xlog('B', 'A')]);

    const ids = flattenTree(roots).map(n => n.xlog.txid);
    expect(ids).toHaveLength(2);
    expect(new Set(ids)).toEqual(new Set(['A', 'B']));
  });

  it('뿌리가 여럿이면 시작이 이른 쪽이 먼저다', () => {
    const roots = buildCallTree([
      xlog('LATE', '0', { endTime: 2_000, elapsed: 10 }),
      xlog('EARLY', '0', { endTime: 1_000, elapsed: 10 }),
    ]);

    expect(roots.map(r => r.xlog.txid)).toEqual(['EARLY', 'LATE']);
  });

  it('빈 목록은 빈 트리다', () => {
    expect(buildCallTree([])).toEqual([]);
  });
});

describe('flattenTree', () => {
  it('깊이 우선으로 펼친다', () => {
    const roots = buildCallTree([
      xlog('A', '0'),
      xlog('B', 'A', { endTime: 1_000 }),
      xlog('C', 'B'),
      xlog('D', 'A', { endTime: 2_000 }),
    ]);

    expect(flattenTree(roots).map(n => n.xlog.txid)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('selfTime', () => {
  it('자식이 쓴 시간을 뺀 나머지다', () => {
    // 이걸 봐야 **어느 앱이** 느린지 알 수 있다.
    // 부모의 elapsed 는 자식 대기 시간을 품고 있어 그대로는 범인을 못 가린다.
    const roots = buildCallTree([
      xlog('A', '0', { elapsed: 100 }),
      xlog('B', 'A', { elapsed: 70 }),
    ]);

    expect(selfTime(roots[0])).toBe(30);
  });

  it('자식이 없으면 elapsed 그대로다', () => {
    const roots = buildCallTree([xlog('A', '0', { elapsed: 100 })]);
    expect(selfTime(roots[0])).toBe(100);
  });

  it('음수는 0으로 자른다', () => {
    // 앱마다 시계가 조금씩 다르면 자식 합이 부모를 넘을 수 있다.
    // 막대 길이가 음수가 되면 화면이 깨진다.
    const roots = buildCallTree([
      xlog('A', '0', { elapsed: 50 }),
      xlog('B', 'A', { elapsed: 70 }),
    ]);

    expect(selfTime(roots[0])).toBe(0);
  });
});

describe('traceSpan', () => {
  it('가장 이른 시작부터 가장 늦은 끝까지다', () => {
    const roots = buildCallTree([
      xlog('A', '0', { endTime: 1_200, elapsed: 200 }), // 1_000 ~ 1_200
      xlog('B', 'A', { endTime: 1_300, elapsed: 50 }), // 1_050 ~ 1_300
    ]);

    // 자식이 부모보다 늦게 끝나는 일은 실제로 있다 (앱 간 시계 차이).
    // 부모 elapsed 만 믿고 축을 잡으면 자식 막대가 화면 밖으로 나간다.
    expect(traceSpan(roots)).toEqual({ start: 1_000, total: 300 });
  });

  it('한 건뿐이면 그 트랜잭션이 곧 축이다', () => {
    const roots = buildCallTree([xlog('A', '0', { endTime: 500, elapsed: 120 })]);
    expect(traceSpan(roots)).toEqual({ start: 380, total: 120 });
  });

  it('길이가 0이어도 0으로 나누지 않는다', () => {
    const roots = buildCallTree([xlog('A', '0', { endTime: 500, elapsed: 0 })]);
    expect(traceSpan(roots).total).toBeGreaterThan(0);
  });

  it('빈 트리는 0이다', () => {
    expect(traceSpan([])).toEqual({ start: 0, total: 0 });
  });
});
