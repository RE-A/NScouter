// 열 → 행 엮기 (F-56)
//
// **여기서 어긋나면 다른 트랜잭션의 값이 섞인다.** 화면에서는 알아챌 방법이 없다 —
// 숫자가 그럴듯하게 나오기 때문이다. 그래서 순서와 길이를 못 박는다.

import { describe, expect, it } from 'vitest';
import { xlogColumnsToSXLogs, type XLogColumns } from './xlog';

const cols = (n: number): XLogColumns => ({
  txid: Array.from({ length: n }, (_, i) => `tx${i}`),
  gxid: Array.from({ length: n }, (_, i) => `gx${i}`),
  caller: Array.from({ length: n }, (_, i) => `ca${i}`),
  end_time: Array.from({ length: n }, (_, i) => 1_700_000_000_000 + i),
  elapsed: Array.from({ length: n }, (_, i) => i * 10),
  obj_hash: Array.from({ length: n }, () => 7),
  service: Array.from({ length: n }, (_, i) => 100 + i),
  error: Array.from({ length: n }, () => 0),
  x_type: Array.from({ length: n }, () => 1),
  cpu: Array.from({ length: n }, (_, i) => i),
  sql_count: Array.from({ length: n }, (_, i) => i * 2),
  sql_time: Array.from({ length: n }, (_, i) => i * 3),
  apicall_count: Array.from({ length: n }, (_, i) => i * 4),
  apicall_time: Array.from({ length: n }, (_, i) => i * 5),
  ipaddr: Array.from({ length: n }, (_, i) => `10.0.0.${i}`),
  kbytes: Array.from({ length: n }, (_, i) => i * 6),
  thread_name_hash: Array.from({ length: n }, (_, i) => 900 + i),
});

describe('xlogColumnsToSXLogs', () => {
  it('열을 행으로 엮는다', () => {
    const rows = xlogColumnsToSXLogs(cols(3));
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual({
      txid: 'tx1',
      gxid: 'gx1',
      caller: 'ca1',
      endTime: 1_700_000_000_001,
      elapsed: 10,
      objHash: 7,
      service: 101,
      error: 0,
      xType: 1,
      cpu: 1,
      sqlCount: 2,
      sqlTime: 3,
      apiCallCount: 4,
      apiCallTime: 5,
      ipAddr: '10.0.0.1',
      allocKBytes: 6,
      threadNameHash: 901,
    });
  });

  it('**순서가 그대로다**', () => {
    // 한 열이라도 밀리면 다른 트랜잭션의 값이 섞인다
    const rows = xlogColumnsToSXLogs(cols(5));
    expect(rows.map(r => r.txid)).toEqual(['tx0', 'tx1', 'tx2', 'tx3', 'tx4']);
    expect(rows.map(r => r.elapsed)).toEqual([0, 10, 20, 30, 40]);
  });

  it('큰 txid 는 문자열 그대로다', () => {
    // JS number 로 담으면 정밀도가 깨진다
    const c = cols(1);
    c.txid[0] = '-4426811361927716372';
    expect(xlogColumnsToSXLogs(c)[0].txid).toBe('-4426811361927716372');
  });

  it('빈 묶음이면 빈 배열이다', () => {
    expect(xlogColumnsToSXLogs(cols(0))).toEqual([]);
  });
});
