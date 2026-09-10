// 선택 요약이 화면에 무엇을 적는가.
//
// 값 계산은 `selectionStats.test.ts` 가 맡는다. 여기서 지키는 것은 표기다:
//   · 0 인 것을 적어 자리를 죽이지 않는다
//   · 어느 축을 보고 있는지 말한다 — 없으면 «평균 12» 가 무엇의 12 인지 알 수 없다
//   · ms 를 재는 자를 건수 축에 대지 않는다

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SelectionSummary } from './SelectionSummary';
import { selectionStats } from './selectionStats';
import type { SXLog, YAxisMode } from '../types/xlog';

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

function draw(rows: SXLog[], mode: YAxisMode = 'elapsed') {
  return render(<SelectionSummary stats={selectionStats(rows, mode)} />);
}

describe('SelectionSummary', () => {
  it('고른 것이 없으면 아무것도 그리지 않는다', () => {
    const { container } = draw([]);
    expect(container.firstChild).toBeNull();
  });

  it('평균과 최대를 축의 단위로 적는다', () => {
    // elapsed 축은 초로 뽑고 ms 로 적는다 — 목록의 Elapsed 와 같은 단위여야 견준다.
    draw([x({ elapsed: 100 }), x({ elapsed: 900 })]);
    expect(screen.getByText('500ms')).toBeTruthy();
    expect(screen.getByText('900ms')).toBeTruthy();
  });

  it('어느 축을 보고 있는지 적는다', () => {
    // 없으면 «평균 12» 가 무엇의 12 인지 알 수 없다.
    draw([x({ sqlCount: 12 })], 'sqlCount');
    expect(screen.getByText('SQL Count')).toBeTruthy();
    // 한 건뿐이라 평균과 최대가 같은 수다.
    expect(screen.getAllByText('12')).toHaveLength(2);
  });

  it('에러가 없으면 에러 칸을 만들지 않는다', () => {
    draw([x({ error: 0 })]);
    expect(screen.queryByText('에러')).toBeNull();
  });

  it('에러가 있으면 건수와 비율을 함께 적는다', () => {
    // 1건이 많은지는 4번 중 1번일 때만 답할 수 있다.
    draw([x({ error: 1 }), x(), x(), x()]);
    expect(screen.getByText('1 (25%)')).toBeTruthy();
  });

  it('한 건이면 폭도 TPS 도 적지 않는다', () => {
    // 0 으로 나눈 수를 «무한 TPS» 로 적을 수는 없다.
    draw([x()]);
    expect(screen.queryByText('폭')).toBeNull();
    expect(screen.queryByText('TPS')).toBeNull();
  });

  it('폭이 넉넉하면 TPS 를 적는다', () => {
    draw(Array.from({ length: 20 }, (_, i) => x({ endTime: T + i * 500 })));
    expect(screen.getByText('폭')).toBeTruthy();
    expect(screen.getByText('TPS')).toBeTruthy();
  });

  it('ms 를 재는 자를 건수 축에 대지 않는다', () => {
    // durationTone 의 경계(300ms·1초)를 «SQL 12건» 에 대면 12건이 «빠르다» 가 된다.
    const { container } = draw([x({ sqlCount: 12 })], 'sqlCount');
    expect(container.querySelectorAll('.text-warn')).toHaveLength(0);
  });

  it('느린 구간은 소요시간 축에서 색이 붙는다', () => {
    const { container } = draw([x({ elapsed: 4_000 })], 'elapsed');
    expect(container.querySelectorAll('.text-warn').length).toBeGreaterThan(0);
  });
});

describe('SelectionSummary — 시간이 어디로 갔나', () => {
  it('축을 바꾸지 않고도 SQL·API 를 함께 적는다', () => {
    // 점 하나에 높이가 하나뿐이라 두 축을 동시에 세울 수 없다.
    // 대신 고른 뒤에 한자리에서 답한다.
    // 셋을 일부러 다 다르게 둔다 — 같으면 어느 칸을 읽었는지 알 수 없다.
    draw([x({ elapsed: 1_000, sqlTime: 600, apiCallTime: 300 })]);
    expect(screen.getByText('내역')).toBeTruthy();
    expect(screen.getByText('600ms')).toBeTruthy(); // SQL
    expect(screen.getByText('300ms')).toBeTruthy(); // API
    expect(screen.getByText('100ms')).toBeTruthy(); // 그 외
  });

  it('SQL 건수 축을 보고 있어도 내역은 나온다', () => {
    // «그 시간이 어디로 갔나» 는 축과 무관한 질문이다.
    draw([x({ elapsed: 1_000, sqlTime: 600, sqlCount: 3 })], 'sqlCount');
    expect(screen.getByText('내역')).toBeTruthy();
  });

  it('겹쳐 돌면 «나머지» 를 적지 않는다', () => {
    // 0 으로 눌린 값이라 «남는 시간이 없다» 로 읽히는데, 실제로는 더할 수 없는 것뿐이다.
    draw([x({ elapsed: 1_000, sqlTime: 900, apiCallTime: 800 })]);
    expect(screen.getByText('겹침')).toBeTruthy();
    expect(screen.queryByText('그 외')).toBeNull();
  });

  it('겹치지 않으면 나머지를 적는다', () => {
    draw([x({ elapsed: 1_000, sqlTime: 600, apiCallTime: 300 })]);
    expect(screen.getByText('그 외')).toBeTruthy();
    expect(screen.queryByText('겹침')).toBeNull();
  });

  it('잰 시간이 없으면 내역을 붙이지 않는다', () => {
    // 0 뿐인 줄은 자리만 먹는다.
    draw([x({ elapsed: 0, sqlTime: 0, apiCallTime: 0 })]);
    expect(screen.queryByText('내역')).toBeNull();
  });

  it('SQL 도 API 도 없으면 붙이지 않는다', () => {
    // 그때 내역은 «SQL 0 · API 0 · 그 외 500ms» 인데, 그 500 은 바로 왼쪽의
    // 평균과 같은 수다 — 나눈 것이 아니라 되풀이한 것이다.
    draw([x({ elapsed: 500, sqlTime: 0, apiCallTime: 0 })]);
    expect(screen.queryByText('내역')).toBeNull();
  });
});
