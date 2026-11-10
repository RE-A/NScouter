// 콜렉터 설정 단추 — 콜렉터가 여럿이면 **어느 콜렉터인지 먼저 고른다**
//
// 콜렉터 설정은 콜렉터마다 파일이 하나라 합칠 수 없다. 고르지 않고 열면 주 콜렉터 것만 고칠 수 있고,
// 창을 연 뒤에 바꾸게 하면 고치던 것이 조용히 날아간다.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CollectorConfigButton } from './CollectorConfigButton';
import type { CollectorStatus } from '../api/scouterApi';

const c = (name: string, connected = true): CollectorStatus => ({
  name,
  host: `${name}.local`,
  port: 6100,
  server_id: `SID-${name}`,
  connected,
  error: connected ? null : '연결 실패',
});

describe('CollectorConfigButton', () => {
  it('콜렉터가 하나면 바로 연다 — 주 콜렉터', () => {
    const onOpen = vi.fn();
    render(<CollectorConfigButton collectors={[c('운영')]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: '콜렉터 설정' }));
    expect(onOpen).toHaveBeenCalledWith(undefined);
  });

  it('여럿이면 목록에서 고른 콜렉터로 연다', () => {
    const onOpen = vi.fn();
    render(<CollectorConfigButton collectors={[c('운영'), c('QA')]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /콜렉터 설정/ }));
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: /QA/ }));
    expect(onOpen).toHaveBeenCalledWith('QA');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('못 붙은 콜렉터는 고를 수 없다', () => {
    render(<CollectorConfigButton collectors={[c('운영'), c('QA', false)]} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /콜렉터 설정/ }));
    expect((screen.getByRole('menuitem', { name: /QA/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
