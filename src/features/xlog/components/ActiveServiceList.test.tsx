// 액티브 서비스 목록 (Counter 탭) — **종류가 여럿이어도 빠지지 않는가.**
//
// 커스텀 종류(`monitoring_group_type`)를 쓰면 WAS 가 시스템마다 다른 종류다.
// 첫 종류 하나만 물으면 나머지 시스템의 실행 중 트랜잭션이 이 목록에서 통째로 빠졌다.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveServiceList } from './ActiveServiceList';
import type { ActiveService } from '../types/object';

const api = vi.hoisted(() => ({ getTypeActiveServices: vi.fn() }));
vi.mock('../api/scouterApi', () => api);
vi.mock('./ThreadDetailDialog', () => ({ ThreadDetailDialog: () => null }));

afterEach(() => vi.clearAllMocks());

function row(obj_hash: number, service: string, elapsed: number): ActiveService {
  return {
    obj_hash,
    id: obj_hash,
    name: `exec-${obj_hash}`,
    service,
    stat: 'RUNNABLE',
    elapsed,
    cpu: 0,
    ip: '',
    login: '',
    sql: '',
    subcall: '',
    txid: `t${obj_hash}`,
  };
}

describe('ActiveServiceList — 종류가 여럿', () => {
  it('종류마다 묻고 합쳐 느린 것부터 놓는다', async () => {
    api.getTypeActiveServices.mockImplementation((type: string) =>
      Promise.resolve({
        rows: type === 'ORDER-JVM' ? [row(1, '/order/slow', 900)] : [row(2, '/pay/slower', 4_000)],
        incomplete: [],
        answered: [],
      }),
    );
    render(<ActiveServiceList objTypes={['ORDER-JVM', 'PAY-JVM']} agentMap={new Map()} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));

    await waitFor(() => expect(screen.getByText('/order/slow')).toBeTruthy());
    expect(api.getTypeActiveServices).toHaveBeenCalledWith('ORDER-JVM');
    expect(api.getTypeActiveServices).toHaveBeenCalledWith('PAY-JVM');

    const services = screen.getAllByTitle(/^\/(order|pay)\//).map(e => e.textContent);
    expect(services).toEqual(['/pay/slower', '/order/slow']);
  });

  it('접혀 있으면 묻지 않는다 — 에이전트에 부담을 주는 요청이다', () => {
    render(<ActiveServiceList objTypes={['ORDER-JVM', 'PAY-JVM']} agentMap={new Map()} />);
    expect(api.getTypeActiveServices).not.toHaveBeenCalled();
  });
});
