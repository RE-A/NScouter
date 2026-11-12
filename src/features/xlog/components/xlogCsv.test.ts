import { describe, expect, it } from 'vitest';
import type { SXLog } from '../types/xlog';
import { errorLine, localStamp, xlogCsv, XLOG_CSV_HEAD } from './xlogCsv';

const x = (over: Partial<SXLog> = {}): SXLog => ({
  txid: '123', gxid: '0', caller: '0', endTime: new Date(2026, 10, 12, 9, 5, 7, 42).getTime(), elapsed: 1500, objHash: 1,
  service: 10, error: 0, xType: 0, cpu: 3, sqlCount: 2, sqlTime: 40, apiCallCount: 1, apiCallTime: 20, ipAddr: '10.0.0.1',
  allocKBytes: 0, threadNameHash: 0, ...over,
});
const names = { server: () => '/h/shop-1', service: () => '/order,list', error: () => 'java.lang.IllegalStateException: "bad"' };

describe('xlogCsv', () => {
  it('머리글 + 행마다 한 줄, 에러 행만 에러 메시지 — 쉼표·따옴표는 감싼다', () => {
    const csv = xlogCsv([x(), x({ txid: '9', error: 77 })], names);
    const lines = csv.split('\r\n');
    expect(lines[0].split(',').length).toBe(XLOG_CSV_HEAD.length);
    expect(lines[1]).toBe('2026-11-12 09:05:07.042,/h/shop-1,"/order,list",10.0.0.1,1500,0,,2,40,1,20,3,123,0');
    expect(lines[2]).toContain(',1,"java.lang.IllegalStateException: ""bad""",');
  });

  it('시각은 밀리초까지 0 을 채운다', () => {
    expect(localStamp(new Date(2026, 0, 2, 3, 4, 5, 6).getTime())).toBe('2026-01-02 03:04:05.006');
  });

  it('에러 한 줄 — 스택이면 첫 줄만', () => {
    expect(errorLine('\n  java.sql.SQLException: timeout\n\tat x.y(Z.java:1)')).toBe('java.sql.SQLException: timeout');
    expect(errorLine(undefined)).toBe('');
  });
});
