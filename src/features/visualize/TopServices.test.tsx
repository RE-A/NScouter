// 서비스 순위 — 순위와 막대가 같은 것을 말하는가.
//
// 정렬 기준을 바꾸면 **막대 길이도 그 기준을 그려야 한다.** 순위는 평균으로 매기고
// 막대는 합계로 그리면, 맨 위 줄의 막대가 제일 짧은 화면이 나온다.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TopServices } from './TopServices';
import type { ServiceRow } from './useRangeInsight';

const rows: ServiceRow[] = [
  // 많이 불리지만 한 번은 싸다
  { id: 1, name: '/shop/list', count: 1_000, error: 0, elapsed: 50_000, cpu: null, mem: null },
  // 드물지만 한 방이 비싸다
  { id: 2, name: '/shop/report', count: 10, error: 0, elapsed: 40_000, cpu: null, mem: null },
  { id: 3, name: '/shop/login', count: 100, error: 7, elapsed: 3_000, cpu: null, mem: null },
];

describe('TopServices', () => {
  it('합계 기준이 기본이다 — «시간을 어디서 썼나»', () => {
    render(<TopServices rows={rows} loading={false} wholeType={false} />);
    const names = screen.getAllByText(/^\/shop\//).map(e => e.textContent);
    expect(names[0]).toBe('/shop/list');
  });

  it('평균으로 바꾸면 한 방이 비싼 것이 위로 온다', () => {
    render(<TopServices rows={rows} loading={false} wholeType={false} />);
    fireEvent.click(screen.getByRole('button', { name: '평균' }));
    const names = screen.getAllByText(/^\/shop\//).map(e => e.textContent);
    expect(names[0]).toBe('/shop/report'); // 4,000ms/회
  });

  it('에러가 있는 줄은 비율까지 적는다', () => {
    // 7건이 «많은가» 는 100번 중 7번일 때만 답할 수 있다.
    render(<TopServices rows={rows} loading={false} wholeType={false} />);
    expect(screen.getByText(/7 \(7\.0%\)/)).toBeTruthy();
  });

  it('타입 전체를 센 것이면 그렇게 적는다', () => {
    // 말하지 않으면 안 고른 서버의 호출까지 «내가 고른 것» 으로 읽힌다.
    const { unmount } = render(<TopServices rows={rows} loading={false} wholeType />);
    expect(screen.getByText(/타입 전체/)).toBeTruthy();
    unmount();

    render(<TopServices rows={rows} loading={false} wholeType={false} />);
    expect(screen.queryByText(/타입 전체/)).toBeNull();
  });

  it('한 줄도 없으면 «받는 중» 과 «없다» 를 가른다', () => {
    const { unmount } = render(<TopServices rows={[]} loading wholeType={false} />);
    expect(screen.getByText('받는 중…')).toBeTruthy();
    unmount();

    render(<TopServices rows={[]} loading={false} wholeType={false} />);
    expect(screen.getByText('이 구간에 서비스 호출이 없습니다')).toBeTruthy();
  });
});
