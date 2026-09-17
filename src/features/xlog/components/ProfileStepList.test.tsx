// SQL 스텝이 값을 어떻게 보여 주는가
//
// 덮는 구간: 스텝 데이터 → bindSql → DOM 문구
// 여기서 지키려는 것은 **아귀가 안 맞을 때 조용히 넘어가지 않는 것**이다.
// 실환경에서 `{ CALL SP_USER_CHK(?, … 12개) }` 에 값이 7개만 온 적이 있다 (F-52).
// 프로시저 OUT 파라미터는 에이전트가 기록하지 않아 애초에 채울 값이 없다 —
// 그때 채운 문장만 보여 주면 무엇이 빠졌는지 확인할 방법이 없다.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProfileStepList } from './ProfileStepList';
import type { ProfileStep } from '../types/profile';

const sqlStep = (hash: number, param: string): ProfileStep => ({
  kind: 'Sql',
  parent: -1,
  index: 0,
  start_time: 3,
  start_cpu: 0,
  hash,
  param,
  elapsed: 5,
  error: 0,
  updated: 0,
});

describe('ProfileStepList — SQL 값 채우기', () => {
  it('리터럴과 바인딩이 섞여도 ? 자리에 바인딩 값이 들어간다', () => {
    // F-51 실측 모양: 리터럴 4개 뒤에 바인딩 2개
    const sql =
      "select p.id from product p where p.category = '@{1}'" +
      ' and p.price between @{2} and @{3} and p.id > ? and p.name <> ?' +
      ' order by p.id limit @{4}';
    render(
      <ProfileStepList
        steps={[sqlStep(11, "'book',100,90000,5,30,'zzz'")]}
        texts={{ 11: sql }}
        totalElapsed={7}
      />,
    );

    expect(
      screen.getByText(/p\.id > 30 and p\.name <> 'zzz'/),
    ).toBeTruthy();
    // 아귀가 맞으면 경고도, 원본 값 줄도 없다
    expect(screen.queryByText(/개만 채웠습니다/)).toBeNull();
    expect(screen.queryByText(/쓰이지 않은 값/)).toBeNull();
  });

  it('자리보다 값이 적으면 경고와 원본 값이 함께 나온다', () => {
    // 프로시저 호출: 자리 5개에 값 3개 (뒤 2개는 OUT 파라미터라 기록되지 않는다)
    const sql = '{ CALL SP_USER_CHK(?, ?, ?, ?, ?) }';
    render(
      <ProfileStepList
        steps={[sqlStep(33, "'WMMOB','USEREXECUTE','ko'")]}
        texts={{ 33: sql }}
        totalElapsed={7}
      />,
    );

    // 앞 3개는 채우고 뒤 2개는 그대로 둔다 — 빈칸으로 채우면 조용히 틀린 문장이 된다
    expect(
      screen.getByText(/'WMMOB', 'USEREXECUTE', 'ko', \?, \?/),
    ).toBeTruthy();
    expect(screen.getByText(/자리/)).toBeTruthy();
    expect(screen.getByText(/개만 채웠습니다/)).toBeTruthy();
    // **원본 값 줄이 같이 나와야 한다.** 채운 문장만으로는 무엇이 왔는지 확인할 수 없다.
    expect(screen.getByText(/바인딩/)).toBeTruthy();
  });

  it('에이전트가 못 얻은 SQL 은 문장인 척하지 않는다', () => {
    // F-53: 자동 생성 키를 쓰는 INSERT 는 에이전트가 텍스트 자리에 «unknown» 을
    // 그대로 넣어 보낸다. 그대로 뿌리면 그런 쿼리를 실행한 것으로 읽힌다.
    render(
      <ProfileStepList
        steps={[sqlStep(55, '')]}
        texts={{ 55: 'unknown' }}
        totalElapsed={7}
      />,
    );
    expect(screen.getByText(/에이전트가 SQL 문장을 받지 못했습니다/)).toBeTruthy();
    // 「unknown」 이라는 말 자체는 본문으로 나오지 않는다
    expect(screen.queryByText('unknown')).toBeNull();
  });

  it('값이 남으면 버리지 않고 알려준다', () => {
    render(
      <ProfileStepList
        steps={[sqlStep(44, "'a','b','c'")]}
        texts={{ 44: 'select * from t where x = ?' }}
        totalElapsed={7}
      />,
    );
    expect(screen.getByText(/쓰이지 않은 값/)).toBeTruthy();
    expect(screen.getByText(/바인딩/)).toBeTruthy();
  });
});

describe('ProfileStepList — 쿼리 복사', () => {
  it('값이 채워진 문장을 클립보드로 준다', async () => {
    // 이 화면을 여는 이유의 절반은 «이 쿼리를 DB 에 붙여 돌려 보는 것» 이다.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <ProfileStepList
        steps={[sqlStep(7, '126')]}
        texts={{ 7: 'select * from t where id = ?' }}
        totalElapsed={100}
        onOpenThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '복사' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    // 바인딩 값이 채워진 문장이어야 한다 — `?` 를 복사하면 붙여 넣어도 안 돈다
    expect(writeText.mock.calls[0][0]).toContain('select * from t');
    expect(await screen.findByText('복사됨')).toBeTruthy();
  });
});

describe('ProfileStepList — 소요 시간 표기', () => {
  const base = { parent: -1, index: 0, start_time: 0, start_cpu: 0 };

  it('SQL 이 아닌 호출도 0ms 를 적는다', () => {
    // «SQL 말고 다른 호출은 소요시간이 안 나온다» 의 실체는 파싱이 아니라 표기였다.
    // 에이전트는 ms 로 재므로 1ms 미만이 전부 0 으로 오는데, 0 을 빈칸으로 두면
    // 시간을 잰 적이 없는 것처럼 읽힌다.
    const steps: ProfileStep[] = [
      { ...base, kind: 'Method', index: 0, hash: 1, elapsed: 0, cputime: 0 },
      { ...base, kind: 'ApiCall', index: 1, hash: 2, elapsed: 0, error: 0, txid: '0', address: 'http://a/b' },
      { ...base, kind: 'Socket', index: 2, ipaddr: '10.0.0.1', port: 5432, elapsed: 0, error: 0 },
      { ...base, kind: 'ThreadCall', index: 3, hash: 3, elapsed: 0, threaded: false, txid: '0' },
    ];

    render(<ProfileStepList steps={steps} texts={{ 1: 'doWork', 2: 'api', 3: 'thr' }} totalElapsed={10} />);

    expect(screen.getAllByText('0ms')).toHaveLength(4);
  });

  it('메시지 스텝에는 시간을 적지 않는다', () => {
    // 걸린 시간이라는 개념이 없다. 0ms 라고 적으면 «순식간에 끝난 작업» 으로 읽힌다.
    const steps: ProfileStep[] = [
      { ...base, kind: 'Message', message: 'cache miss', hash: 0 },
    ];
    render(<ProfileStepList steps={steps} texts={{}} totalElapsed={10} />);

    expect(screen.getByText('cache miss')).toBeTruthy();
    expect(screen.queryByText('0ms')).toBeNull();
  });
});

describe('ProfileStepList — 긴 문장 펼치기', () => {
  /** jsdom 은 레이아웃이 없어 넘침을 못 잰다. 넘친 것처럼 만든다 */
  function overflowing() {
    const sh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    const ch = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 400 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 40 });
    return () => {
      if (sh) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', sh);
      if (ch) Object.defineProperty(HTMLElement.prototype, 'clientHeight', ch);
    };
  }

  function drawLong() {
    render(
      <ProfileStepList
        steps={[sqlStep(21, '')]}
        texts={{ 21: 'select ' + Array.from({ length: 40 }, (_, i) => `col_${i}`).join(', ') + ' from big_table' }}
        totalElapsed={7}
      />,
    );
  }

  it('접혀 있으면 «펼치기» 는 아래에 하나뿐이다', () => {
    const restore = overflowing();
    try {
      drawLong();
      expect(screen.getAllByRole('button', { name: /펼치기/ })).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('검색으로 짚은 긴 문장은 펼쳐서 보여준다 — 걸린 글자가 접힘 아래에 숨지 않게', () => {
    // where 절 조건으로 찾는 일이 흔한데, 그건 대개 세 줄 접힘 아래에 있다.
    const restore = overflowing();
    try {
      render(
        <ProfileStepList
          steps={[sqlStep(21, '')]}
          texts={{ 21: 'select ' + Array.from({ length: 40 }, (_, i) => `col_${i}`).join(', ') + ' from big_table' }}
          totalElapsed={7}
          highlightIndex={0}
        />,
      );
      expect(screen.getAllByRole('button', { name: '접기' }).length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it('펼치면 위에도 «접기» 가 생긴다 — 맨 밑까지 내려가지 않아도 접힌다', () => {
    const restore = overflowing();
    try {
      drawLong();
      fireEvent.click(screen.getByRole('button', { name: /펼치기/ }));
      const closers = screen.getAllByRole('button', { name: '접기' });
      expect(closers.map(b => b.getAttribute('data-where'))).toEqual(['top', 'bottom']);

      fireEvent.click(closers[0]);
      expect(screen.queryAllByRole('button', { name: '접기' })).toHaveLength(0);
      expect(screen.getByRole('button', { name: /펼치기/ })).toBeTruthy();
    } finally {
      restore();
    }
  });
});
