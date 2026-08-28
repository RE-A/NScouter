// SQL 스텝이 값을 어떻게 보여 주는가
//
// 덮는 구간: 스텝 데이터 → bindSql → DOM 문구
// 여기서 지키려는 것은 **아귀가 안 맞을 때 조용히 넘어가지 않는 것**이다.
// 실환경에서 `{ CALL SP_USER_CHK(?, … 12개) }` 에 값이 7개만 온 적이 있다 (F-52).
// 프로시저 OUT 파라미터는 에이전트가 기록하지 않아 애초에 채울 값이 없다 —
// 그때 채운 문장만 보여 주면 무엇이 빠졌는지 확인할 방법이 없다.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
