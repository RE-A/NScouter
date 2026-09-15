// Active 탭 — **화면이 거짓말을 하지 않는가.**
//
// 계산은 `activeModel.test.ts` 가 본다. 여기서 보는 것은 그 계산이 화면에 어떻게
// 놓이는가다. 특히 «걸러낸 뒤의 수를 전체인 줄 알게 하지 않는가» — 장애 중에
// 필터를 걸어 둔 채 «두 건뿐이네» 로 읽으면 그대로 넘어간다.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveTab } from './ActiveTab';
import type { ActiveService } from '../xlog/types/object';

const api = vi.hoisted(() => ({ getTypeActiveServices: vi.fn() }));
vi.mock('../xlog/api/scouterApi', () => api);
// 스택 창은 따로 검증된다. 여기서는 열렸는지만 본다.
vi.mock('../xlog/components/ThreadDetailDialog', () => ({
  ThreadDetailDialog: ({ service }: { service: string }) => <div>상세:{service}</div>,
}));

function row(o: Partial<ActiveService> = {}): ActiveService {
  return {
    obj_hash: 1,
    id: 10,
    name: 'exec-1',
    service: '/shop/list<GET>',
    stat: 'RUNNABLE',
    elapsed: 100,
    cpu: 10,
    ip: '10.0.0.1',
    login: '',
    sql: '',
    subcall: '',
    txid: 'tx1',
    ...o,
  };
}

const SLOW_SQL = 'select * from stock where product_id=?';

const ROWS: ActiveService[] = [
  row({ id: 1, txid: 'a', service: '/shop/checkout<POST>', elapsed: 12_400, sql: SLOW_SQL }),
  row({ id: 2, txid: 'b', service: '/shop/cart<GET>', elapsed: 4_100, sql: SLOW_SQL }),
  row({ id: 3, txid: 'c', service: '/shop/home<GET>', elapsed: 1_500, subcall: '/order/api' }),
  row({ id: 4, txid: 'd', service: '/shop/ping<GET>', elapsed: 40, obj_hash: 2 }),
];

const AGENTS = new Map([
  [1, '/h/shop-app'],
  [2, '/h/order-app'],
]);

beforeEach(() => api.getTypeActiveServices.mockResolvedValue({ rows: ROWS, incomplete: [] }));
afterEach(() => vi.clearAllMocks());

function draw(picked: number[] = []) {
  render(
    <ActiveTab
      enabled
      javaeeType="tomcat"
      picked={new Set(picked)}
      agentMap={AGENTS}
    />,
  );
}

/** 세 영역을 이름으로 가른다. 같은 글자가 게이지와 목록에 동시에 뜬다 */
const gauge = () => within(screen.getByRole('region', { name: '액티브 현황' }));
const waiting = () => within(screen.getByRole('complementary', { name: '무엇을 기다리나' }));
const txns = () => within(screen.getByRole('region', { name: '실행 중인 트랜잭션' }));

describe('ActiveTab — 게이지', () => {
  it('건수와 단계별 분포를 적는다', async () => {
    draw();
    // 4건 중 3초 이상 2건(12.4초·4.1초), 1~3초 1건, 1초 미만 1건
    await screen.findAllByText('12.4초');
    expect(gauge().getByText('4')).toBeTruthy();
    expect(gauge().getByText('3초 이상')).toBeTruthy();
  });

  it('가장 오래된 것을 따로 세운다 — 단계 막대가 말해 주지 않는 깊이', async () => {
    draw();
    await screen.findAllByText('12.4초');
    expect(gauge().getByText('12.4초')).toBeTruthy();
    expect(gauge().getByText('/shop/checkout<POST>')).toBeTruthy();
  });

  it('한가하면 «없음» 이라고 말한다', async () => {
    api.getTypeActiveServices.mockResolvedValue({ rows: [], incomplete: [] });
    draw();
    await waitFor(() => expect(gauge().getByText('없음')).toBeTruthy());
  });
});

describe('ActiveTab — 리소스로 접기', () => {
  it('같은 쿼리에 매달린 것을 한 줄로 묶는다', async () => {
    // 이 화면을 만든 이유다. 목록만 보면 «느린 게 두 건», 접으면 «이 쿼리 하나에 두 건».
    draw();
    await screen.findAllByText('12.4초');
    const chip = waiting().getByRole('button', { name: new RegExp('select') });
    expect(within(chip).getByText('2건')).toBeTruthy();
  });

  it('묶음을 고르면 목록만 줄고, 전체 수는 그대로 보인다', async () => {
    // **필터를 걸어 둔 채 «두 건뿐이네» 로 읽으면 안 된다.**
    draw();
    await screen.findAllByText('12.4초');
    fireEvent.click(waiting().getByRole('button', { name: new RegExp('select') }));
    await waitFor(() => expect(txns().getByText('2 / 4건')).toBeTruthy());
    expect(txns().queryByText('/shop/ping<GET>')).toBeNull();
  });

  it('고른 묶음을 다시 누르면 전체로 돌아온다', async () => {
    draw();
    await screen.findAllByText('12.4초');
    const chip = waiting().getByRole('button', { name: new RegExp('select') });
    fireEvent.click(chip);
    fireEvent.click(chip);
    await waitFor(() => expect(txns().getByText('/shop/ping<GET>')).toBeTruthy());
  });
});

describe('ActiveTab — 목록', () => {
  it('느린 것부터 놓는다', async () => {
    draw();
    await screen.findAllByText('12.4초');
    const names = txns().getAllByTitle(/^\/shop\//).map(e => e.textContent);
    expect(names.slice(0, 2)).toEqual(['/shop/checkout<POST>', '/shop/cart<GET>']);
  });

  it('무엇을 붙들고 있는지 종류까지 적는다', async () => {
    draw();
    await screen.findAllByText('12.4초');
    expect(txns().getAllByText('SQL').length).toBe(2);
    expect(txns().getByText('API')).toBeTruthy();
  });

  it('기다리는 대상이 없으면 그렇다고 적는다 — 빈칸으로 두지 않는다', async () => {
    draw();
    expect(await screen.findByText('기다리는 대상 없음 — 제 코드 실행 중')).toBeTruthy();
  });

  it('찾으면 서비스·쿼리를 가로질러 줄인다', async () => {
    draw();
    await screen.findAllByText('12.4초');
    fireEvent.change(screen.getByPlaceholderText('서비스·쿼리·호출·스레드·IP 로 찾기'), {
      target: { value: 'order' },
    });
    // 외부 호출 대상이 /order/api 인 줄만 남는다
    await waitFor(() => expect(txns().getByText('1 / 4건')).toBeTruthy());
  });

  it('줄을 누르면 스택 창이 열린다', async () => {
    draw();
    await screen.findAllByText('12.4초');
    fireEvent.click(txns().getByText('/shop/checkout<POST>'));
    expect(screen.getByText('상세:/shop/checkout<POST>')).toBeTruthy();
  });
});

describe('ActiveTab — 정직하게 말하기', () => {
  it('고른 서버의 것만 보여준다', async () => {
    draw([1]);
    await screen.findAllByText('12.4초');
    expect(txns().queryByText('/shop/ping<GET>')).toBeNull();
  });

  it('응답하지 않은 서버가 있으면 말한다 — 조용히 적게 보여주지 않는다', async () => {
    api.getTypeActiveServices.mockResolvedValue({ rows: ROWS, incomplete: [7, 8] });
    draw();
    expect(await screen.findByText(/응답하지 않아 목록에 빠져 있습니다/)).toBeTruthy();
  });

  it('이 화면이 못 보여주는 것을 화면에 적어 둔다', async () => {
    draw();
    expect(await screen.findByText(/순간 스냅샷입니다/)).toBeTruthy();
  });

  it('언제 받은 것인지 적는다', async () => {
    draw();
    expect(await screen.findByText(/마지막 갱신/)).toBeTruthy();
  });

  it('갱신을 멈출 수 있다', async () => {
    // 에이전트에 부담이 가는 요청이라 끌 수 있어야 한다.
    draw();
    await screen.findAllByText('12.4초');
    const off = screen.getByRole('button', { name: '멈춤' });
    fireEvent.click(off);
    expect(off.getAttribute('aria-pressed')).toBe('true');
  });
});
