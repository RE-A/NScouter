// 프로파일 전문의 계약
//
// 여기서 지키려는 것:
//   · 보고서에 붙일 수 있는 **한 덩어리 글자**다 — 화면 없이도 뜻이 통해야 한다
//   · T-GAP 은 앞 스텝과의 **간격**이다. 누적을 적으면 사람이 빼야 한다
//   · 여러 줄짜리 본문(SQL·에러)도 표 안에 머문다
//   · 스텝 내용은 `stepSearch` 와 같은 자리를 읽는다 — 검색에 걸린 낱말이 전문에 있어야 한다

import { describe, expect, it } from 'vitest';
import { profileFullText, stepContents } from './profileFullText';
import type { ProfileStep } from '../types/profile';
import type { SXLog } from '../types/xlog';

const XLOG: SXLog = {
  txid: 'x1a2b3c4',
  gxid: '0',
  caller: '0',
  // 2026-01-02 03:04:05.678 (로컬). elapsed 를 빼면 시작 시각이다
  endTime: new Date(2026, 0, 2, 3, 4, 5, 678).getTime(),
  elapsed: 1284,
  objHash: -1585387669,
  service: 11,
  error: 0,
  xType: 0,
  cpu: 240,
  sqlCount: 2,
  sqlTime: 300,
  apiCallCount: 0,
  apiCallTime: 0,
  ipAddr: '10.89.1.22',
  allocKBytes: 512,
  threadNameHash: 0,
};

const TEXTS: Record<number, string> = {
  11: '/order/submit',
  21: 'OrderService.submit()',
  31: 'select * from orders where id = ?',
  41: 'java.sql.SQLException: timeout',
};

function base(steps: ProfileStep[], depths: number[], xlog: Partial<SXLog> = {}): string {
  return profileFullText({
    xlog: { ...XLOG, ...xlog },
    steps,
    texts: TEXTS,
    objName: 'PRD-ORD-01',
    serviceName: '/order/submit',
    depths,
  });
}

const METHOD: ProfileStep = {
  kind: 'Method', parent: -1, index: 0, start_time: 6, start_cpu: 2, hash: 21,
  elapsed: 1200, cputime: 0,
};
const SQL: ProfileStep = {
  kind: 'Sql', parent: 0, index: 1, start_time: 81, start_cpu: 14, hash: 31,
  param: '[1004]', elapsed: 190, error: 0, updated: 3,
};

describe('머리말', () => {
  it('ASIS 의 ► 표시와 순서를 따른다', () => {
    const out = base([], []).split('\n');
    expect(out[0]).toBe('► txid    = x1a2b3c4');
    expect(out[1]).toBe('► objName = PRD-ORD-01');
    expect(out[2]).toBe('► endtime = 20260102 03:04:05.678');
    expect(out[3]).toBe('► elapsed = 1,284 ms');
    expect(out[4]).toBe('► service = /order/submit');
  });

  it('에러가 없으면 에러 줄을 적지 않는다 — 빈 칸은 «못 받았다» 로 읽힌다', () => {
    expect(base([], [])).not.toContain('► error');
  });

  it('에러가 있으면 글자로 푼다', () => {
    expect(base([], [], { error: 41 })).toContain('► error   = java.sql.SQLException: timeout');
  });

  it('SQL 이 없었던 트랜잭션에는 sqlCount 줄이 없다', () => {
    expect(base([], [], { sqlCount: 0 })).not.toContain('sqlCount');
  });
});

describe('스텝 표', () => {
  it('프로파일이 없으면 비었다고 말한다 — 빈 표는 고장으로 읽힌다', () => {
    expect(base([], [])).toContain('( 수집된 프로파일이 없습니다 )');
  });

  it('첫 줄은 트랜잭션 시작이고 시각이 endTime - elapsed 다', () => {
    // 03:04:05.678 - 1284ms = 03:04:04.394
    expect(base([METHOD], [0])).toContain('[***] 03:04:04.394');
  });

  it('T-GAP 은 누적이 아니라 **앞 스텝과의 간격**이다', () => {
    const line = base([METHOD, SQL], [0, 1])
      .split('\n')
      .find(l => l.startsWith('[002]'));
    // SQL 의 start_time 81, 앞 스텝 6 → 간격 75 (누적 81 이 아니다)
    expect(line).toMatch(/\s75\s/);
    expect(line).not.toMatch(/\s81\s/);
  });

  it('깊이만큼 들여쓴다 — 어느 호출 밑인지가 표에서 보여야 한다', () => {
    const line = base([METHOD, SQL], [0, 1])
      .split('\n')
      .find(l => l.startsWith('[002]'));
    expect(line).toContain('  select * from orders');
  });

  it('여러 줄 본문도 표 안에 머문다 — 왼쪽 끝으로 튀면 어느 스텝인지 모른다', () => {
    const lines = base([SQL], [0]).split('\n');
    const param = lines.find(l => l.includes('[param]'));
    expect(param).toBeDefined();
    expect(param?.startsWith(' ')).toBe(true);
  });

  it('맨 끝에 스텝 수와 총 시간을 적는다', () => {
    expect(base([METHOD, SQL], [0, 1])).toContain('총 2개 스텝 · 1,284 ms');
  });
});

describe('스텝 내용', () => {
  it('SQL 은 영향 행 수와 바인딩 값을 같이 적는다', () => {
    const out = stepContents(SQL, TEXTS);
    expect(out).toContain('select * from orders where id = ?');
    expect(out).toContain('(3 rows)');
    expect(out).toContain('[param] [1004]');
  });

  it('SQL 에러는 따로 줄을 잡는다', () => {
    const out = stepContents({ ...SQL, error: 41 } as ProfileStep, TEXTS);
    expect(out).toContain('[error] java.sql.SQLException: timeout');
  });

  it('ApiCall 은 주소를 화살표로 잇는다', () => {
    const out = stepContents(
      { kind: 'ApiCall', parent: -1, index: 0, start_time: 0, start_cpu: 0, hash: 21,
        elapsed: 10, error: 0, txid: '0', address: '10.0.0.9:8080' },
      TEXTS,
    );
    expect(out).toBe('OrderService.submit() → 10.0.0.9:8080');
  });

  it('넘어가지 않은 ThreadCall 을 «넘어갔다» 로 적지 않는다', () => {
    const notThreaded = stepContents(
      { kind: 'ThreadCall', parent: -1, index: 0, start_time: 0, start_cpu: 0,
        txid: '0', hash: 21, elapsed: 0, threaded: false },
      TEXTS,
    );
    expect(notThreaded).toContain('(not threaded)');
    expect(notThreaded).not.toContain('→ thread');
  });

  it('Message 는 해시가 0 이면 본문을 그대로 쓴다', () => {
    const out = stepContents(
      { kind: 'Message', parent: -1, index: 0, start_time: 0, start_cpu: 0,
        message: '캐시 적중', hash: 0 },
      TEXTS,
    );
    expect(out).toBe('캐시 적중');
  });

  it('모르는 해시는 숨기지 않고 #해시로 드러낸다', () => {
    const out = stepContents({ ...METHOD, hash: 999 } as ProfileStep, TEXTS);
    expect(out).toBe('#999');
  });
});
