// Active 탭 계산 — **범인을 잘못 지목하지 않는가.**
//
// 이 화면은 장애 중에 «이 쿼리 때문이다» 를 말하려고 연다. 묶음 정렬이나
// 추적이 어긋나면 틀린 말을 자신 있게 하게 된다. 그 자리만 본다.

import { describe, expect, it } from 'vitest';
import {
  advanceHolds,
  elapsedPct,
  formatElapsed,
  groupByResource,
  heldMs,
  matchesRow,
  NO_RESOURCE_KEY,
  resourceOf,
  rowKey,
  sortRows,
  stepCounts,
  stepOf,
  type Hold,
} from './activeModel';
import type { ActiveService } from '../xlog/types/object';

function row(o: Partial<ActiveService> = {}): ActiveService {
  return {
    obj_hash: 1,
    id: 10,
    name: 'http-nio-8081-exec-1',
    service: '/shop/lab/dashboard<GET>',
    stat: 'RUNNABLE',
    elapsed: 100,
    cpu: 50,
    ip: '10.0.0.1',
    login: '',
    sql: '',
    subcall: '',
    txid: 'tx1',
    ...o,
  };
}

describe('경과 단계', () => {
  it('기존 액티브 막대와 같은 경계다', () => {
    // 1초·3초. 여기서 어긋나면 같은 화면의 두 숫자가 다른 말을 한다.
    expect(stepOf(999)).toBe(1);
    expect(stepOf(1_000)).toBe(2);
    expect(stepOf(2_999)).toBe(2);
    expect(stepOf(3_000)).toBe(3);
  });

  it('가장 오래된 것을 따로 센다', () => {
    // 3단계는 3초와 60초를 같이 담는다. 건수만으로는 장애의 크기가 안 보인다.
    const c = stepCounts([row({ elapsed: 500 }), row({ elapsed: 4_000 }), row({ elapsed: 62_000 })]);
    expect(c).toMatchObject({ step1: 1, step2: 0, step3: 2, total: 3, maxElapsed: 62_000 });
  });

  it('비어 있어도 숫자를 돌려준다', () => {
    expect(stepCounts([])).toMatchObject({ total: 0, maxElapsed: 0 });
  });
});

describe('무엇을 붙들고 있나', () => {
  it('쿼리가 있으면 쿼리다', () => {
    const r = resourceOf(row({ sql: 'select 1' }));
    expect(r).toMatchObject({ kind: 'sql', label: 'select 1' });
  });

  it('쿼리와 외부 호출이 같이 오면 쿼리를 먼저 본다', () => {
    // 둘 다 찬 채로 오는 경우가 있다. 합쳐서 «기타» 로 몰면 묶음이 쓸모없어진다.
    expect(resourceOf(row({ sql: 'select 1', subcall: '/order/api' })).kind).toBe('sql');
  });

  it('둘 다 없으면 제 코드를 도는 묶음이다 — «없음» 이 아니다', () => {
    expect(resourceOf(row()).key).toBe(NO_RESOURCE_KEY);
  });

  it('같은 문장은 한 묶음이다', () => {
    // 바인드 값이 안 오므로 문장 단위로만 묶을 수 있다. 그게 곧 «이 쿼리에 N건» 이다.
    const q = 'select * from stock where product_id=?';
    const groups = groupByResource([row({ sql: q }), row({ sql: q, id: 11 })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
  });

  it('건수가 아니라 가장 오래된 것으로 세운다', () => {
    // 1초짜리 100건이 8초짜리 1건을 밀어내면 이 화면을 여는 이유가 사라진다.
    const many = Array.from({ length: 5 }, (_, i) => row({ sql: 'fast', elapsed: 900, id: i }));
    const one = row({ sql: 'slow', elapsed: 8_000, id: 99 });
    expect(groupByResource([...many, one])[0].label).toBe('slow');
  });

  it('같은 조건이면 순서가 흔들리지 않는다', () => {
    // 2초마다 다시 그리는 화면이라 동률에서 순서가 바뀌면 누를 수가 없다.
    const rows = [row({ sql: 'b', elapsed: 100 }), row({ sql: 'a', elapsed: 100, id: 11 })];
    expect(groupByResource(rows).map(g => g.label)).toEqual(['a', 'b']);
    expect(groupByResource([...rows].reverse()).map(g => g.label)).toEqual(['a', 'b']);
  });
});

describe('같은 것을 붙들고 있은 시간', () => {
  it('처음 본 순간은 적지 않는다', () => {
    // 0ms 를 «0초째» 로 적으면 방금 시작한 것처럼 보인다. 사실은 모르는 것이다.
    const holds = advanceHolds(new Map(), [row({ sql: 'q' })], 1_000);
    expect(heldMs(holds, row({ sql: 'q' }), 1_000)).toBeNull();
  });

  it('같은 쿼리를 계속 잡고 있으면 쌓인다', () => {
    const r = row({ sql: 'q' });
    let holds = advanceHolds(new Map(), [r], 1_000);
    holds = advanceHolds(holds, [r], 3_000);
    expect(heldMs(holds, r, 3_000)).toBe(2_000);
  });

  it('다른 쿼리로 넘어가면 다시 센다', () => {
    // **범인을 잘못 지목하지 않기 위한 것이다.** 방금 넘어온 쿼리에 «3초째» 를
    // 붙이면 그 쿼리가 원인인 것처럼 읽힌다.
    let holds = advanceHolds(new Map(), [row({ sql: 'first' })], 1_000);
    const moved = row({ sql: 'second' });
    holds = advanceHolds(holds, [moved], 3_000);
    expect(heldMs(holds, moved, 3_000)).toBeNull();
    expect(heldMs(advanceHolds(holds, [moved], 5_000), moved, 5_000)).toBe(2_000);
  });

  it('끝난 트랜잭션은 표에서 버린다', () => {
    // 하루 종일 켜 두는 화면이다. 안 버리면 표가 무한정 자란다.
    const gone = row({ txid: 'tx1' });
    const holds = advanceHolds(advanceHolds(new Map(), [gone], 1_000), [], 2_000);
    expect(holds.size).toBe(0);
  });

  it('txid 가 없으면 추적하지 않는다', () => {
    // 다음 응답의 어느 행과 같은 것인지 말할 수 없다.
    const anon = row({ txid: null });
    const holds = advanceHolds(new Map(), [anon], 1_000);
    expect(holds.size).toBe(0);
    expect(heldMs(holds, anon, 5_000)).toBeNull();
  });

  it('앞선 추적을 건드리지 않는다', () => {
    const prev = new Map<string, Hold>([['tx1', { resourceKey: 'sql:q', since: 1_000 }]]);
    advanceHolds(prev, [row({ sql: 'other' })], 2_000);
    expect(prev.get('tx1')?.since).toBe(1_000);
  });
});

describe('목록', () => {
  it('느린 것부터 놓는다', () => {
    const rows = sortRows([row({ elapsed: 10 }), row({ elapsed: 900, id: 11 })]);
    expect(rows.map(r => r.elapsed)).toEqual([900, 10]);
  });

  it('같은 경과면 서버·스레드로 고정한다', () => {
    const a = row({ elapsed: 100, obj_hash: 2, id: 1 });
    const b = row({ elapsed: 100, obj_hash: 1, id: 5 });
    expect(sortRows([a, b]).map(r => r.obj_hash)).toEqual([1, 2]);
  });

  it('txid 가 없어도 줄 키가 흔들리지 않는다', () => {
    const anon = row({ txid: null });
    expect(rowKey(anon)).toBe(rowKey({ ...anon }));
  });

  it('한 낱말로 서비스·쿼리·호출·스레드·IP 를 가로지른다', () => {
    // 장애 중에 치는 말은 «order» 하나다.
    expect(matchesRow(row({ service: '/order/x' }), 'ORDER')).toBe(true);
    expect(matchesRow(row({ sql: 'select * from orders' }), 'order')).toBe(true);
    expect(matchesRow(row({ subcall: '/order/api' }), 'order')).toBe(true);
    expect(matchesRow(row({ name: 'order-worker-1' }), 'order')).toBe(true);
    expect(matchesRow(row({ ip: '10.9.9.9' }), '10.9')).toBe(true);
    expect(matchesRow(row(), 'order')).toBe(false);
  });

  it('빈 검색어는 전부 통과시킨다', () => {
    expect(matchesRow(row(), '   ')).toBe(true);
  });
});

describe('막대 비율', () => {
  it('가장 오래된 것이 가득 찬다', () => {
    expect(elapsedPct(8_000, 8_000)).toBe(100);
  });

  it('짧아도 사라지지는 않는다', () => {
    // 0.4초가 8초 옆에서 5% 면 막대가 안 보인다. 있다는 것은 보여야 한다.
    expect(elapsedPct(1, 60_000)).toBe(2);
  });

  it('최댓값이 0이면 0이다 — 나누지 않는다', () => {
    expect(elapsedPct(0, 0)).toBe(0);
  });
});

describe('시간 표기', () => {
  it('1초 미만은 ms 그대로다', () => {
    expect(formatElapsed(832)).toBe('832ms');
  });

  it('초 단위로 올린다', () => {
    expect(formatElapsed(12_400)).toBe('12.4초');
  });

  it('분을 넘기면 분으로 적는다', () => {
    // 5분째 붙들린 것이 «300,000ms» 로 뜨면 자릿수를 세어야 한다.
    expect(formatElapsed(300_000)).toBe('5분 00초');
    expect(formatElapsed(72_000)).toBe('1분 12초');
  });

  it('경계에서 단위가 겹치지 않는다', () => {
    expect(formatElapsed(999)).toBe('999ms');
    expect(formatElapsed(1_000)).toBe('1.0초');
    expect(formatElapsed(59_999)).toBe('60.0초');
    expect(formatElapsed(60_000)).toBe('1분 00초');
  });
});
