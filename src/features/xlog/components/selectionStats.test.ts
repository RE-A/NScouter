// 선택 구간 요약
//
// 여기서 지키려는 것:
//   · 고른 것이 없으면 **수를 만들어 내지 않는다** — 평균 0 은 «빨랐다» 로 읽힌다
//   · 축을 따라간다 — 점 높이가 SQL Time 인데 요약이 Elapsed 를 말하면 안 된다
//   · 0 으로 나누지 않는다 — «무한 TPS» 를 적을 수는 없다

import { describe, expect, it } from 'vitest';
import { formatSpan, selectionStats, selectionTps } from './selectionStats';
import type { SXLog } from '../types/xlog';

const T = 1_700_000_000_000;

function x(over: Partial<SXLog> = {}): SXLog {
  return {
    txid: 't', gxid: '0', caller: '0',
    endTime: T, elapsed: 100, objHash: 1, service: 1, error: 0, xType: 0,
    cpu: 5, sqlCount: 0, sqlTime: 0, apiCallCount: 0, apiCallTime: 0,
    ipAddr: '10.0.0.1', allocKBytes: 0, threadNameHash: 0,
    ...over,
  };
}

describe('selectionStats', () => {
  it('비어 있으면 수를 만들어 내지 않는다', () => {
    // 평균 0·최대 0 은 «빨랐다» 로 읽히는데, «고른 것이 없다» 와 정반대의 말이다.
    const s = selectionStats([], 'elapsed');
    expect(s).toMatchObject({ count: 0, errors: 0, errorRate: null, avg: null, max: null });
  });

  it('건수·평균·최대를 낸다', () => {
    const s = selectionStats(
      [x({ elapsed: 100 }), x({ elapsed: 200 }), x({ elapsed: 900 })],
      'elapsed',
    );
    expect(s.count).toBe(3);
    // elapsed 축은 초 단위로 뽑는다 (Y_AXIS_CONFIGS)
    expect(s.avg).toBeCloseTo(0.4);
    expect(s.max).toBeCloseTo(0.9);
  });

  it('축을 따라간다', () => {
    // 3초를 기다렸지만 SQL 은 한 건도 안 썼다. SQL Time 축에서는 0 이 맞다.
    const rows = [x({ elapsed: 3_004, sqlTime: 0 })];
    expect(selectionStats(rows, 'elapsed').max).toBeCloseTo(3.004);
    expect(selectionStats(rows, 'sqlTime').max).toBe(0);
    expect(selectionStats(rows, 'cpu').max).toBe(5);
  });

  it('에러는 건수와 비율을 함께 준다', () => {
    // 7건이 많은지는 100번 중 7번일 때만 답할 수 있다.
    const s = selectionStats([x({ error: 1 }), x({ error: 0 }), x({ error: 0 }), x({ error: 0 })], 'elapsed');
    expect(s.errors).toBe(1);
    expect(s.errorRate).toBeCloseTo(0.25);
  });

  it('시간 폭은 **실제로 들어온 것들의** 폭이다', () => {
    // 빈 구간을 넓게 끌어도 트랜잭션은 한순간에 몰려 있을 수 있다.
    const s = selectionStats([x({ endTime: T }), x({ endTime: T + 5_000 })], 'elapsed');
    expect(s.spanMs).toBe(5_000);
  });

  it('한 건이면 폭이 0 이다', () => {
    expect(selectionStats([x()], 'elapsed').spanMs).toBe(0);
  });

  it('축 값이 NaN 인 건은 합계를 오염시키지 않는다', () => {
    // 하나만 섞여도 평균이 통째로 NaN 이 되어 «—» 도 아닌 것이 화면에 뜬다.
    const s = selectionStats([x({ elapsed: NaN }), x({ elapsed: 200 })], 'elapsed');
    expect(Number.isFinite(s.avg ?? NaN)).toBe(true);
    expect(s.max).toBeCloseTo(0.2);
  });
});

describe('selectionTps', () => {
  it('폭이 있으면 초당 건수를 낸다', () => {
    const s = selectionStats(
      Array.from({ length: 20 }, (_, i) => x({ endTime: T + i * 500 })),
      'elapsed',
    );
    // 20건이 9.5초에 걸쳐 있다
    expect(selectionTps(s)).toBeCloseTo(20 / 9.5);
  });

  it('폭이 없으면 말하지 않는다', () => {
    // 0 으로 나눈 Infinity 를 «무한 TPS» 로 적을 수는 없다.
    expect(selectionTps(selectionStats([x()], 'elapsed'))).toBeNull();
    expect(selectionTps(selectionStats([], 'elapsed'))).toBeNull();
  });

  it('1초도 안 되는 폭이면 말하지 않는다', () => {
    // 두 건을 0.1초 폭으로 고르면 «20 TPS» 가 나오는데, 그건 고른 방식이 만든 수다.
    const s = selectionStats([x({ endTime: T }), x({ endTime: T + 100 })], 'elapsed');
    expect(selectionTps(s)).toBeNull();
  });
});

describe('formatSpan', () => {
  it('자릿수가 길어지기 전에 단위를 올린다', () => {
    // `184,000ms` 는 자릿수를 세어야 읽힌다.
    expect(formatSpan(400)).toBe('400ms');
    expect(formatSpan(2_500)).toBe('2.5초');
    expect(formatSpan(45_000)).toBe('45초');
    expect(formatSpan(184_000)).toBe('3.1분');
  });
});

describe('selectionStats — 시간이 어디로 갔나', () => {
  it('축을 바꾸지 않고도 SQL·API 를 함께 본다', () => {
    // 점 하나에 높이가 하나뿐이라 Elapsed 와 SQL Time 을 동시에 세울 수 없다.
    // 대신 고른 뒤에 한자리에서 답한다 — «그 1,240 이 SQL 이었나 API 였나».
    const b = selectionStats(
      [x({ elapsed: 1_000, sqlTime: 600, apiCallTime: 200 })],
      'elapsed',
    ).breakdown;
    expect(b).toMatchObject({ totalMs: 1_000, sqlMs: 600, apiMs: 200, restMs: 200, overlapped: false });
  });

  it('축이 무엇이든 내역은 소요시간 기준이다', () => {
    // SQL 건수 축을 보고 있어도 «그 시간이 어디로 갔나» 는 같은 질문이다.
    const b = selectionStats([x({ elapsed: 500, sqlTime: 400 })], 'sqlCount').breakdown;
    expect(b.totalMs).toBe(500);
    expect(b.sqlMs).toBe(400);
  });

  it('한 건 평균이다 — 합계가 아니다', () => {
    // 200건을 고르면 합계는 몇 분이 되어 «한 번이 얼마나 비싼가» 를 못 읽는다.
    const b = selectionStats(
      [x({ elapsed: 1_000, sqlTime: 800 }), x({ elapsed: 3_000, sqlTime: 400 })],
      'elapsed',
    ).breakdown;
    expect(b.totalMs).toBe(2_000);
    expect(b.sqlMs).toBe(600);
  });

  it('겹쳐 돌아 합이 넘으면 그렇다고 말한다', () => {
    // 비동기로 SQL·API 가 같이 돌면 둘의 합이 전체를 넘는다. 그때 «나머지 0» 은
    // «남는 시간이 없다» 로 읽히는데, 실제로는 더할 수 없는 것뿐이다.
    const b = selectionStats(
      [x({ elapsed: 1_000, sqlTime: 900, apiCallTime: 800 })],
      'elapsed',
    ).breakdown;
    expect(b.restMs).toBe(0);
    expect(b.overlapped).toBe(true);
  });

  it('고른 것이 없으면 내역도 0 이다', () => {
    expect(selectionStats([], 'elapsed').breakdown).toMatchObject({ totalMs: 0, overlapped: false });
  });
});
