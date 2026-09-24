// 활성 서비스 폴링 — **대상이 바뀌는 순간에 무슨 일이 일어나는가.**
//
// 화면에 보이는 증상은 하나다: «세션이 사라졌다 보였다 한다». 원인은 여럿이고
// 그중 둘은 콜렉터 쪽(빈 팩·팩 없음, `activeModel.test.ts`)이지만, 나머지는 이
// 훅이 대상을 갈아타는 방식에 있다. 여기서는 그 둘을 본다.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useActiveServices } from './useActiveServices';
import type { ActiveService } from '../xlog/types/object';

const api = vi.hoisted(() => ({ getTypeActiveServices: vi.fn() }));
vi.mock('../xlog/api/scouterApi', () => api);

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

function row(objHash: number, service: string): ActiveService {
  return {
    obj_hash: objHash,
    id: 1,
    name: 'exec-1',
    service,
    stat: 'RUNNABLE',
    elapsed: 1_000,
    cpu: 0,
    ip: '',
    login: '',
    sql: '',
    subcall: '',
    txid: `tx${objHash}`,
  };
}

function reply(rows: ActiveService[]) {
  return { rows, incomplete: [], answered: [...new Set(rows.map(r => r.obj_hash))] };
}

describe('대상이 바뀔 때', () => {
  it('앞 요청이 아직 안 왔어도 새 대상을 곧바로 묻는다', async () => {
    // 겹침 방지를 ref 로 두면 사이클을 넘어 «바쁨» 이 남아, 대상이 바뀐 뒤의
    // **첫 조회가 통째로 건너뛰어진다** — 주기가 5초면 5초 동안 옛 화면이다.
    let release: (() => void) | null = null;
    api.getTypeActiveServices.mockImplementationOnce(
      () => new Promise(resolve => { release = () => resolve(reply([])); }),
    );
    api.getTypeActiveServices.mockResolvedValue(reply([row(1, '/new')]));

    const { rerender } = renderHook(
      ({ types }: { types: string[] }) => useActiveServices(types, [1], true, 5_000),
      { initialProps: { types: ['tomcat'] } },
    );
    await waitFor(() => expect(api.getTypeActiveServices).toHaveBeenCalledWith('tomcat'));

    rerender({ types: ['ORDER-JVM'] });
    await waitFor(() => expect(api.getTypeActiveServices).toHaveBeenCalledWith('ORDER-JVM'));

    // 붙잡아 둔 앞 요청은 풀어 준다 — 안 풀면 테스트가 끝난 뒤에도 매달려 있다.
    act(() => release?.());
  });

  it('접속이 바뀌면 이전 서버의 행을 버린다', async () => {
    // 콜렉터를 갈아타도 종류(`tomcat`)가 같으면 이 훅에서는 대상이 그대로다.
    // 그러면 새 응답이 올 때까지 **없는 서버의 트랜잭션**이 화면에 남는다.
    api.getTypeActiveServices.mockResolvedValue(reply([row(1, '/old-server')]));

    const { result, rerender } = renderHook(
      ({ epoch }: { epoch: number }) => useActiveServices(['tomcat'], [1], true, 0, epoch),
      { initialProps: { epoch: 0 } },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    // 새 서버의 응답은 아직 오지 않은 채로 둔다. 그래야 행이 사라진 까닭이
    // «새 응답이 비어 있어서» 가 아니라 **«버렸기 때문»** 임이 드러난다.
    let answer: (() => void) | null = null;
    api.getTypeActiveServices.mockImplementation(
      () => new Promise(resolve => { answer = () => resolve(reply([])); }),
    );
    rerender({ epoch: 1 });

    await waitFor(() => expect(result.current.rows).toHaveLength(0));
    expect(result.current.at).toBeNull(); // 아직 새 값을 받지 않았다

    act(() => answer?.());
    await waitFor(() => expect(result.current.at).not.toBeNull());
  });

  it('여러 종류를 차례로 묻고 합친다', async () => {
    // 한꺼번에 쏘면 에이전트 세션(기본 1개)을 서로 기다리다 빈손이 늘어난다.
    api.getTypeActiveServices.mockImplementation((type: string) =>
      Promise.resolve(reply([row(type === 'tomcat' ? 1 : 2, `/${type}`)])),
    );

    const { result } = renderHook(() =>
      useActiveServices(['tomcat', 'ORDER-JVM'], [1, 2], true, 0),
    );

    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.rows.map(r => r.service).sort()).toEqual(['/ORDER-JVM', '/tomcat']);
  });

  it('탭을 떠나면 묻지 않고 받아 둔 것도 버린다', async () => {
    // 에이전트에 부담을 주는 요청이다. 안 보는 화면 때문에 계속 묻지 않는다.
    api.getTypeActiveServices.mockResolvedValue(reply([row(1, '/shop')]));

    const { result, rerender } = renderHook(
      ({ on }: { on: boolean }) => useActiveServices(['tomcat'], [1], on, 0),
      { initialProps: { on: true } },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    const calls = api.getTypeActiveServices.mock.calls.length;
    rerender({ on: false });

    await waitFor(() => expect(result.current.rows).toHaveLength(0));
    expect(api.getTypeActiveServices.mock.calls.length).toBe(calls);
    expect(result.current.at).toBeNull();
  });
});
