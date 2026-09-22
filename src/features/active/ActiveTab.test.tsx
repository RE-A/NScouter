// Active 탭 — **화면이 거짓말을 하지 않는가.**
//
// 계산은 `activeModel.test.ts` 가 본다. 여기서 보는 것은 그 계산이 화면에 어떻게
// 놓이는가다. 특히 «걸러낸 뒤의 수를 전체인 줄 알게 하지 않는가» — 장애 중에
// 필터를 걸어 둔 채 «두 건뿐이네» 로 읽으면 그대로 넘어간다.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveTab } from './ActiveTab';
import type { ActiveService } from '../xlog/types/object';

const api = vi.hoisted(() => ({
  getTypeActiveServices: vi.fn(),
  // 풀 값은 이미 도는 카운터 스트림에서 줍는다. 여기서는 흘려보내기만 한다.
  onCounterData: vi.fn(() => Promise.resolve(() => {})),
  getThreadDetail: vi.fn(() => Promise.resolve(null)),
}));
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
  [91, '/h/shop-app/HikariPool-1'],
]);

/** 콜렉터 응답 한 벌. `answered` 를 안 넣으면 실제 응답과 모양이 달라진다 */
function reply(rows: ActiveService[], o: { incomplete?: number[]; answered?: number[] } = {}) {
  return {
    rows,
    incomplete: o.incomplete ?? [],
    answered: o.answered ?? [...new Set(rows.map(r => r.obj_hash))],
  };
}

beforeEach(() => api.getTypeActiveServices.mockResolvedValue(reply(ROWS)));
afterEach(() => vi.clearAllMocks());

function draw(
  picked: number[] = [],
  poolHashes: number[] = [],
  javaeeTypes: string[] = ['tomcat'],
  expectedHashes: number[] = [1, 2],
) {
  render(
    <ActiveTab
      enabled
      javaeeTypes={javaeeTypes}
      picked={new Set(picked)}
      expectedHashes={expectedHashes}
      agentMap={AGENTS}
      poolHashes={poolHashes}
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
    api.getTypeActiveServices.mockResolvedValue(reply([]));
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

  it('쿼리의 «상세» 를 누르면 쿼리 창이 열리고, 스택 창은 열리지 않는다', async () => {
    // 줄 클릭까지 번지면 창이 둘 뜬다.
    draw();
    await screen.findAllByText('12.4초');
    fireEvent.click(txns().getAllByTitle('쿼리 상세 보기')[0]);
    expect(await screen.findByRole('dialog', { name: '쿼리 상세' })).toBeTruthy();
    expect(screen.queryByText(/^상세:/)).toBeNull();
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

  it('연결을 못 얻은 서버는 이름과 이유를 말한다', async () => {
    // 수만 적으면 어느 서버를 믿고 봐야 할지 모르고, 이유를 안 적으면 어디를 고칠지 모른다.
    api.getTypeActiveServices.mockResolvedValue(reply(ROWS, { incomplete: [2] }));
    draw();
    expect(await screen.findByText(/연결을 못 얻어 못 물어본 서버: \/h\/order-app/)).toBeTruthy();
  });

  it('콜렉터가 묻지도 않은 서버를 따로 말한다 — 이유가 다르면 고칠 곳도 다르다', async () => {
    // 하트비트가 끊긴 것으로 보이면 빈 팩조차 안 온다. 앞 판에서 이 경우를 놓쳤다.
    api.getTypeActiveServices.mockResolvedValue(
      reply(ROWS.filter(r => r.obj_hash !== 2), { answered: [1] }),
    );
    draw();
    expect(await screen.findByText(/콜렉터가 비활성으로 보는 서버: \/h\/order-app/)).toBeTruthy();
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

describe('ActiveTab — 커넥션 풀 줄', () => {
  const pool = () => within(screen.getByRole('region', { name: '커넥션 풀' }));

  it('풀을 안 골랐으면 왜 비었는지 말한다 — 줄을 숨기지 않는다', async () => {
    // 숨기면 «이 앱은 커넥션 풀을 못 본다» 로 읽힌다. 값이 안 오는 이유는 둘 뿐이고,
    // 그중 하나(안 고름)는 사용자가 바로 고칠 수 있다.
    draw();
    await screen.findAllByText('12.4초');
    expect(pool().getByText(/왼쪽에서 커넥션 풀을 함께 골라야/)).toBeTruthy();
  });

  it('고른 풀은 값이 오기 전에도 줄에 남는다', async () => {
    // 사라지면 «풀이 없다» 로 읽힌다.
    draw([1], [91]);
    await screen.findAllByText('12.4초');
    expect(pool().getByText(/HikariPool-1/)).toBeTruthy();
    // 상한을 모르면 0% 가 아니라 «—» 다. 0% 는 «여유롭다» 로 읽힌다.
    expect(pool().getByText('—')).toBeTruthy();
  });

  it('부모 WAS 를 같이 적는다 — 풀 이름만으로는 어느 서버 것인지 모른다', async () => {
    draw([1], [91]);
    await screen.findAllByText('12.4초');
    expect(pool().getByText('shop-app · HikariPool-1')).toBeTruthy();
  });
});

describe('ActiveTab — 떴다 사라졌다 하지 않게', () => {
  it('타입이 여럿이면 전부 묻는다 — 첫 타입만 물으면 나머지 서비스가 영영 안 뜬다', async () => {
    api.getTypeActiveServices.mockImplementation((type: string) =>
      Promise.resolve(
        type === 'java'
          ? reply([row({ obj_hash: 2, id: 9, txid: 'j', service: '/batch/run<GET>', elapsed: 2_000 })])
          : reply(ROWS.slice(0, 1)),
      ),
    );
    draw([], [], ['tomcat', 'java']);
    await screen.findAllByText('12.4초');
    expect(api.getTypeActiveServices).toHaveBeenCalledWith('tomcat');
    expect(api.getTypeActiveServices).toHaveBeenCalledWith('java');
    await waitFor(() => expect(txns().getByText('/batch/run<GET>')).toBeTruthy());
  });

  it('빈 팩이 온 서버의 행을 지우지 않고 «지난 값» 으로 남긴다', async () => {
    // 지우면 «끝났다» 로 읽힌다. 실제로는 콜렉터가 그 서버에 못 물어본 것이다.
    api.getTypeActiveServices
      .mockResolvedValueOnce(reply(ROWS))
      .mockResolvedValue(reply(ROWS.filter(r => r.obj_hash !== 2), { incomplete: [2] }));
    draw();
    await screen.findAllByText('12.4초');
    fireEvent.click(screen.getByRole('button', { name: '지금 받기' }));
    await waitFor(() => expect(txns().getByText('지난 값')).toBeTruthy());
    expect(txns().getByText('/shop/ping<GET>')).toBeTruthy();
  });

  it('**팩이 아예 안 온 서버도** «지난 값» 으로 남긴다 — 여기서 여전히 깜빡였다', async () => {
    // 콜렉터가 비활성으로 보면 빈 팩도 안 온다. 앞 판은 이 경우를 그냥 지워서
    // «고쳤는데 여전히 사라졌다 보였다» 가 됐다.
    api.getTypeActiveServices
      .mockResolvedValueOnce(reply(ROWS))
      .mockResolvedValue(reply(ROWS.filter(r => r.obj_hash !== 2), { answered: [1] }));
    draw();
    await screen.findAllByText('12.4초');
    fireEvent.click(screen.getByRole('button', { name: '지금 받기' }));
    await waitFor(() => expect(txns().getByText('지난 값')).toBeTruthy());
    expect(txns().getByText('/shop/ping<GET>')).toBeTruthy();
  });
});
