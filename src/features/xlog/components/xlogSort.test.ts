// 트랜잭션 목록 정렬 — **누른 대로 서는가, 그리고 흔들리지 않는가.**

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SORT,
  nextSort,
  sortMark,
  sortXLogs,
  type SortNames,
  type SortState,
} from './xlogSort';
import type { SXLog } from '../types/xlog';

function x(o: Partial<SXLog>): SXLog {
  return {
    txid: 't',
    gxid: '0',
    caller: '0',
    endTime: 0,
    elapsed: 0,
    objHash: 1,
    service: 1,
    error: 0,
    xType: 0,
    cpu: 0,
    sqlCount: 0,
    sqlTime: 0,
    apiCallCount: 0,
    apiCallTime: 0,
    ipAddr: '',
    allocKBytes: 0,
    threadNameHash: 0,
    ...o,
  };
}

const NAMES: SortNames = {
  server: h => ({ 1: '/a/was-1', 2: '/a/was-2' })[h] ?? `#${h}`,
  url: h => ({ 10: '/order', 20: '/shop' })[h] ?? `#${h}`,
  yValue: r => r.sqlTime,
};

const sorted = (rows: SXLog[], state: SortState) =>
  sortXLogs(rows, state, NAMES).map(r => r.txid);

describe('기본 순서', () => {
  it('최신이 위다 — 실시간과 과거가 같다', () => {
    // 모드를 오갈 때마다 목록이 뒤집히면 읽던 자리를 잃는다.
    expect(DEFAULT_SORT).toEqual({ key: 'time', dir: 'desc' });
  });
});

describe('열 누르기', () => {
  it('같은 열을 다시 누르면 뒤집는다', () => {
    expect(nextSort({ key: 'time', dir: 'desc' }, 'time')).toEqual({ key: 'time', dir: 'asc' });
  });

  it('수는 큰 것 먼저, 글자는 사전순으로 시작한다', () => {
    // 반대로 두면 누를 때마다 한 번 더 눌러야 원하는 것이 나온다.
    expect(nextSort(DEFAULT_SORT, 'elapsed').dir).toBe('desc');
    expect(nextSort(DEFAULT_SORT, 'server').dir).toBe('asc');
    expect(nextSort(DEFAULT_SORT, 'url').dir).toBe('asc');
    expect(nextSort(DEFAULT_SORT, 'ip').dir).toBe('asc');
  });

  it('정렬 중인 열에만 화살표를 단다', () => {
    const s: SortState = { key: 'elapsed', dir: 'desc' };
    expect(sortMark(s, 'elapsed')).toBe('▼');
    expect(sortMark({ ...s, dir: 'asc' }, 'elapsed')).toBe('▲');
    expect(sortMark(s, 'time')).toBe('');
  });
});

describe('정렬', () => {
  const rows = [
    x({ txid: 'a', endTime: 300, elapsed: 10, objHash: 2, service: 20, ipAddr: '10.0.0.9' }),
    x({ txid: 'b', endTime: 100, elapsed: 90, objHash: 1, service: 10, ipAddr: '10.0.0.1' }),
    x({ txid: 'c', endTime: 200, elapsed: 50, objHash: 1, service: 20, ipAddr: '10.0.0.5' }),
  ];

  it('시간', () => {
    expect(sorted(rows, { key: 'time', dir: 'desc' })).toEqual(['a', 'c', 'b']);
    expect(sorted(rows, { key: 'time', dir: 'asc' })).toEqual(['b', 'c', 'a']);
  });

  it('소요시간', () => {
    expect(sorted(rows, { key: 'elapsed', dir: 'desc' })).toEqual(['b', 'c', 'a']);
  });

  it('서버·URL·IP 는 화면에 뜨는 글자로 견준다', () => {
    // 해시로 견주면 목록에 보이는 순서와 달라 «정렬이 안 된다» 로 읽힌다.
    expect(sorted(rows, { key: 'server', dir: 'asc' })).toEqual(['c', 'b', 'a']);
    expect(sorted(rows, { key: 'url', dir: 'asc' })).toEqual(['b', 'a', 'c']);
    expect(sorted(rows, { key: 'ip', dir: 'asc' })).toEqual(['b', 'c', 'a']);
  });

  it('차트 Y축 값으로도 선다', () => {
    const ys = [x({ txid: 'p', sqlTime: 5 }), x({ txid: 'q', sqlTime: 80 })];
    expect(sorted(ys, { key: 'y', dir: 'desc' })).toEqual(['q', 'p']);
  });

  it('같은 값끼리는 시간 역순으로 고정한다 — 갱신마다 줄이 춤추면 못 읽는다', () => {
    const same = [
      x({ txid: 'old', endTime: 100, objHash: 1 }),
      x({ txid: 'new', endTime: 500, objHash: 1 }),
      x({ txid: 'mid', endTime: 300, objHash: 1 }),
    ];
    expect(sorted(same, { key: 'server', dir: 'asc' })).toEqual(['new', 'mid', 'old']);
    expect(sorted(same, { key: 'server', dir: 'desc' })).toEqual(['new', 'mid', 'old']);
  });

  it('원본을 건드리지 않는다', () => {
    const before = rows.map(r => r.txid);
    sortXLogs(rows, { key: 'elapsed', dir: 'asc' }, NAMES);
    expect(rows.map(r => r.txid)).toEqual(before);
  });
});
