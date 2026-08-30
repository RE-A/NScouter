// 상세 탭 계약
//
// 여기서 지키려는 것:
//   · 같은 트랜잭션을 두 번 열어도 탭이 두 개 생기지 않는다
//   · 닫으면 **이웃**으로 옮긴다 (매번 첫 탭으로 튀지 않는다)
//   · 넘치면 지금 보는 것을 빼고 가장 오래 안 본 것을 닫는다
//   · 닫은 뒤에 도착한 응답이 탭을 되살리지 않는다

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useXLogDetailTabs, MAX_DETAIL_TABS } from './useXLogDetailTabs';
import type { SXLog } from '../types/xlog';

const loaded = vi.hoisted(() => ({
  /** txid → 이 프로미스가 풀릴 때까지 로딩이 끝나지 않는다 */
  gates: new Map<string, () => void>(),
  hold: false,
}));

vi.mock('./useXLogDetail', () => ({
  loadXLogDetail: (xlog: SXLog) =>
    loaded.hold
      ? new Promise(resolve => {
          loaded.gates.set(xlog.txid, () =>
            resolve({ profile: { steps: [] }, texts: { 7: 'svc' } }),
          );
        })
      : Promise.resolve({ profile: { steps: [] }, texts: { 7: 'svc' } }),
}));

vi.mock('./useTextResolver', () => ({
  useTextResolver: () => ({
    resolve: () => Promise.resolve({}),
    getCached: () => undefined,
  }),
}));

const xlog = (txid: string): SXLog =>
  ({ txid, service: 7, endTime: 1_700_000_000_000, objHash: 1, error: 0 }) as unknown as SXLog;

beforeEach(() => {
  loaded.gates.clear();
  loaded.hold = false;
});
afterEach(() => vi.clearAllMocks());

describe('useXLogDetailTabs', () => {
  it('연 트랜잭션이 탭이 되고 그 탭이 활성이다', async () => {
    const { result } = renderHook(() => useXLogDetailTabs());
    act(() => result.current.open(xlog('a')));
    await waitFor(() => expect(result.current.tabs[0].state.isLoading).toBe(false));

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeKey).toBe('a');
    expect(result.current.active?.profile).not.toBeNull();
  });

  it('같은 트랜잭션을 다시 열면 탭이 늘지 않고 그리로 옮긴다', async () => {
    const { result } = renderHook(() => useXLogDetailTabs());
    act(() => result.current.open(xlog('a')));
    act(() => result.current.open(xlog('b')));
    await waitFor(() => expect(result.current.tabs).toHaveLength(2));

    act(() => result.current.open(xlog('a')));
    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.activeKey).toBe('a');
  });

  it('가운데 탭을 닫으면 **이웃**으로 옮긴다', async () => {
    const { result } = renderHook(() => useXLogDetailTabs());
    act(() => result.current.open(xlog('a')));
    act(() => result.current.open(xlog('b')));
    act(() => result.current.open(xlog('c')));
    await waitFor(() => expect(result.current.tabs).toHaveLength(3));

    act(() => result.current.activate('b'));
    act(() => result.current.closeActive());
    // 첫 탭(a)으로 튀지 않는다
    expect(result.current.activeKey).toBe('c');
    expect(result.current.tabs.map(t => t.key)).toEqual(['a', 'c']);
  });

  it('마지막 탭을 닫으면 앞 탭으로 옮긴다', async () => {
    const { result } = renderHook(() => useXLogDetailTabs());
    act(() => result.current.open(xlog('a')));
    act(() => result.current.open(xlog('b')));
    await waitFor(() => expect(result.current.tabs).toHaveLength(2));

    act(() => result.current.closeActive());
    expect(result.current.activeKey).toBe('a');
  });

  it('안 보고 있는 탭을 닫아도 보던 탭은 그대로다', async () => {
    const { result } = renderHook(() => useXLogDetailTabs());
    act(() => result.current.open(xlog('a')));
    act(() => result.current.open(xlog('b')));
    await waitFor(() => expect(result.current.tabs).toHaveLength(2));

    act(() => result.current.close('a'));
    expect(result.current.activeKey).toBe('b');
  });

  it('다 닫으면 보여 줄 것이 없다', async () => {
    const { result } = renderHook(() => useXLogDetailTabs());
    act(() => result.current.open(xlog('a')));
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));

    act(() => result.current.closeAll());
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeKey).toBeNull();
    expect(result.current.active).toBeNull();
  });

  it('순환은 끝에서 처음으로 돈다', async () => {
    const { result } = renderHook(() => useXLogDetailTabs());
    act(() => result.current.open(xlog('a')));
    act(() => result.current.open(xlog('b')));
    await waitFor(() => expect(result.current.tabs).toHaveLength(2));

    // 지금 b(마지막). 다음은 처음으로 돈다
    act(() => result.current.cycle(1));
    expect(result.current.activeKey).toBe('a');
    // 뒤로 가면 다시 마지막
    act(() => result.current.cycle(-1));
    expect(result.current.activeKey).toBe('b');
  });

  it(`${MAX_DETAIL_TABS}개가 차면 가장 오래 안 본 탭을 닫는다`, async () => {
    const { result } = renderHook(() => useXLogDetailTabs());
    for (let i = 0; i < MAX_DETAIL_TABS; i++) {
      act(() => result.current.open(xlog(`t${i}`)));
    }
    await waitFor(() => expect(result.current.tabs).toHaveLength(MAX_DETAIL_TABS));
    // 로딩 응답이 전부 도착한 뒤에 재다. 안 그러면 늦게 온 응답이 act 밖에서 상태를 건드린다.
    await act(async () => { await Promise.resolve(); });

    // t0 를 다시 보면 t1 이 가장 오래된 것이 된다
    act(() => result.current.activate('t0'));
    act(() => result.current.open(xlog('new')));

    const keys = result.current.tabs.map(t => t.key);
    expect(keys).toHaveLength(MAX_DETAIL_TABS);
    expect(keys).toContain('t0'); // 방금 봤다
    expect(keys).toContain('new');
    expect(keys).not.toContain('t1'); // 가장 오래 안 봤다
  });

  it('지금 보고 있는 탭은 자리가 없어도 닫지 않는다', async () => {
    const { result } = renderHook(() => useXLogDetailTabs());
    for (let i = 0; i < MAX_DETAIL_TABS; i++) {
      act(() => result.current.open(xlog(`t${i}`)));
    }
    await waitFor(() => expect(result.current.tabs).toHaveLength(MAX_DETAIL_TABS));
    // 로딩 응답이 전부 도착한 뒤에 재다. 안 그러면 늦게 온 응답이 act 밖에서 상태를 건드린다.
    await act(async () => { await Promise.resolve(); });

    // 마지막에 연 것이 활성이다. 새로 열어도 그건 남아야 한다
    const active = result.current.activeKey;
    act(() => result.current.open(xlog('new')));
    expect(result.current.tabs.map(t => t.key)).toContain(active);
  });

  it('닫은 뒤에 응답이 와도 탭이 되살아나지 않는다', async () => {
    loaded.hold = true;
    const { result } = renderHook(() => useXLogDetailTabs());
    act(() => result.current.open(xlog('slow')));
    expect(result.current.tabs).toHaveLength(1);

    act(() => result.current.close('slow'));
    expect(result.current.tabs).toHaveLength(0);

    // 이제야 응답이 도착한다
    await act(async () => {
      loaded.gates.get('slow')?.();
      await Promise.resolve();
    });
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeKey).toBeNull();
  });
});

describe('useXLogDetailTabs — 저장본', () => {
  const saved = (txid: string, savedAt = 1) =>
    ({
      format: 'nscouter-profile',
      version: 1,
      saved_at: savedAt,
      service: '/shop/order',
      txid,
      end_time: 1_700_000_000_000,
      xlog: xlog(txid),
      profile: { txid, obj_hash: 1, steps: [] },
      texts: { 7: '/shop/order' },
    }) as unknown as Parameters<
      ReturnType<typeof useXLogDetailTabs>['openSaved']
    >[0];

  it('조회하지 않고 파일 내용 그대로 연다', async () => {
    // 저장본은 콜렉터에서 이미 밀려났을 수 있다. 다시 물으면 빈 화면이 된다.
    const { result } = renderHook(() => useXLogDetailTabs());
    act(() => result.current.openSaved(saved('z1')));

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.active?.isLoading).toBe(false);
    expect(result.current.active?.profile).toBeTruthy();
    expect(result.current.active?.texts[7]).toBe('/shop/order');
  });

  it('같은 트랜잭션이 실시간으로 열려 있어도 덮어쓰지 않는다', async () => {
    const { result } = renderHook(() => useXLogDetailTabs());
    act(() => result.current.open(xlog('z1')));
    await waitFor(() => expect(result.current.active?.isLoading).toBe(false));

    act(() => result.current.openSaved(saved('z1')));

    expect(result.current.tabs).toHaveLength(2);
  });

  it('같은 저장본을 두 번 열면 탭이 늘지 않는다', () => {
    const { result } = renderHook(() => useXLogDetailTabs());
    act(() => result.current.openSaved(saved('z1', 5)));
    act(() => result.current.openSaved(saved('z1', 5)));

    expect(result.current.tabs).toHaveLength(1);
  });
});
