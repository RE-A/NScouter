// 쿼리 상세 — **남의 값을 이 문장에 붙이지 않는가.**
//
// 바인드 값은 여는 순간 그 트랜잭션에 물어서 받는다. 그 사이에 끝났거나 다음 쿼리로
// 넘어갔으면 받은 값은 이 문장의 것이 아니다. 그걸 붙여 «채운 문장» 을 만들면
// 말은 되지만 틀린 SQL 이 되고, 복사해 DB 에 붙이면 사고다.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryDetailDialog } from './QueryDetailDialog';
import type { ActiveService } from '../xlog/types/object';

const api = vi.hoisted(() => ({ getThreadDetail: vi.fn() }));
vi.mock('../xlog/api/scouterApi', () => api);

afterEach(() => vi.clearAllMocks());

const SQL = 'select id from stock where product_id=? and warehouse=?';

function row(o: Partial<ActiveService> = {}): ActiveService {
  return {
    obj_hash: 1,
    id: 10,
    name: 'exec-1',
    service: '/shop/checkout<POST>',
    stat: 'RUNNABLE',
    elapsed: 4_000,
    cpu: 10,
    ip: '',
    login: '',
    sql: SQL,
    subcall: '',
    txid: 'tx1',
    ...o,
  };
}

function detail(sql: string, bind: string) {
  return { sql, sql_bind_var: bind, subcall: '' };
}

function draw(opened: ActiveService, rows: ActiveService[] = [opened]) {
  const onOpenStack = vi.fn();
  render(
    <QueryDetailDialog
      row={opened}
      rows={rows}
      serverName={h => `/h/app-${h}`}
      onOpenStack={onOpenStack}
      onClose={() => {}}
    />,
  );
  return { onOpenStack };
}

describe('QueryDetailDialog', () => {
  it('그 트랜잭션에 물어 바인드 값을 채운 문장을 보여준다', async () => {
    api.getThreadDetail.mockResolvedValue(detail(SQL, '42,A'));
    draw(row());
    expect(api.getThreadDetail).toHaveBeenCalledWith(1, 10, 'tx1');
    await waitFor(() => expect(screen.getByText(/바인드: 42,A/)).toBeTruthy());
    expect(screen.getByText(/product_id=42/)).toBeTruthy();
  });

  it('채우기를 끄면 자리표시자 그대로 본다', async () => {
    api.getThreadDetail.mockResolvedValue(detail(SQL, '42,A'));
    draw(row());
    await screen.findByText(/바인드: 42,A/);
    fireEvent.click(screen.getByLabelText('값 채워 보기'));
    expect(screen.getByText(/product_id=\?/)).toBeTruthy();
  });

  it('여는 사이에 다음 쿼리로 넘어갔으면 그 값을 붙이지 않는다', async () => {
    // 받은 값은 다른 문장의 것이다. 붙이면 말은 되지만 틀린 SQL 이 된다.
    api.getThreadDetail.mockResolvedValue(detail('update stock set qty=?', '7'));
    draw(row());
    expect(await screen.findByText(/다음 쿼리로 넘어가/)).toBeTruthy();
    expect(screen.queryByText(/바인드:/)).toBeNull();
    expect(screen.getByText(/product_id=\?/)).toBeTruthy();
  });

  it('이미 끝났으면 오류가 아니라 끝났다고 말한다', async () => {
    api.getThreadDetail.mockResolvedValue(null);
    draw(row());
    expect(await screen.findByText(/이미 끝난 트랜잭션이라/)).toBeTruthy();
  });

  it('값이 잘릴 수 있음을 알린다 — 복사해 실행하기 전에 알아야 한다', async () => {
    api.getThreadDetail.mockResolvedValue(detail(SQL, '42,A'));
    draw(row());
    expect(await screen.findByText(/trace_sql_parameter_max_length/)).toBeTruthy();
  });

  it('같은 쿼리에 매달린 트랜잭션을 늘어놓고, 누르면 그 스택을 연다', async () => {
    api.getThreadDetail.mockResolvedValue(detail(SQL, '42,A'));
    const other = row({ id: 11, txid: 'tx2', service: '/shop/cart<GET>', elapsed: 9_000 });
    const unrelated = row({ id: 12, txid: 'tx3', service: '/shop/home<GET>', sql: 'select 1' });
    const { onOpenStack } = draw(row(), [row(), other, unrelated]);

    await screen.findByText(/바인드:/);
    expect(screen.getByText('/shop/cart<GET>')).toBeTruthy();
    expect(screen.queryByText('/shop/home<GET>')).toBeNull();

    fireEvent.click(screen.getByText('/shop/cart<GET>'));
    expect(onOpenStack).toHaveBeenCalledWith(other);
  });

  it('외부 호출은 바인드 값을 묻지 않는다', () => {
    draw(row({ sql: '', subcall: '/order/api/summary' }));
    expect(api.getThreadDetail).not.toHaveBeenCalled();
    expect(screen.getByText('/order/api/summary')).toBeTruthy();
  });
});
