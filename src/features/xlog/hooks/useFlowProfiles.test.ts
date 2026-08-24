// 흐름 보기 프로파일 수집
//
// 핵심은 **일부만 실패했을 때**다. 트랜잭션 하나의 프로파일을 못 받았다고
// 흐름 전체를 지우면, 멀쩡히 받은 나머지까지 화면에서 사라진다.

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFlowProfiles } from './useFlowProfiles';
import type { SXLog } from '../types/xlog';

vi.mock('../api/scouterApi', () => ({
  getXLogFullProfile: vi.fn(),
  resolveTexts: vi.fn().mockResolvedValue({}),
}));

const { getXLogFullProfile } = await import('../api/scouterApi');

function xlog(txid: string): SXLog {
  return {
    txid,
    caller: '0',
    gxid: 'G',
    endTime: 1_700_000_000_000,
    elapsed: 10,
    objHash: 1,
    service: 1,
    error: 0,
    xType: 0,
    cpu: 0,
    sqlCount: 0,
    sqlTime: 0,
    apiCallCount: 0,
    apiCallTime: 0,
    ipAddr: '10.0.0.1',
    allocKBytes: 0,
    threadNameHash: 0,
  };
}

const pack = (txid: string) => ({
  txid,
  obj_hash: 1,
  steps: [
    { kind: 'Sql' as const, parent: -1, index: 0, start_time: 0, start_cpu: 0, hash: 7, param: '', elapsed: 1, error: 0, updated: 0 },
  ],
});

beforeEach(() => {
  vi.mocked(getXLogFullProfile).mockReset();
});

describe('useFlowProfiles', () => {
  it('한 건이 실패해도 받은 프로파일은 살린다', async () => {
    vi.mocked(getXLogFullProfile).mockImplementation(async (txid: string) => {
      if (txid === 'B') throw new Error('프로파일 없음');
      return pack(txid);
    });

    const { result } = renderHook(() => useFlowProfiles([xlog('A'), xlog('B')], true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    // 실패를 이유로 A 까지 버리면 안 된다
    expect(result.current.profiles.has('A')).toBe(true);
    expect(result.current.error).toBeNull();
    // 몇 건이 빠졌는지는 화면이 말해줘야 하므로 세어 둔다
    expect(result.current.failed).toBe(1);
  });

  it('전부 실패하면 그때는 오류다', async () => {
    vi.mocked(getXLogFullProfile).mockRejectedValue(new Error('연결 끊김'));

    const { result } = renderHook(() => useFlowProfiles([xlog('A')], true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profiles.size).toBe(0);
    expect(result.current.error).toContain('연결 끊김');
  });

  it('다 받으면 실패는 0 이다', async () => {
    vi.mocked(getXLogFullProfile).mockImplementation(async (txid: string) => pack(txid));

    const { result } = renderHook(() => useFlowProfiles([xlog('A'), xlog('B')], true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profiles.size).toBe(2);
    expect(result.current.failed).toBe(0);
    expect(result.current.error).toBeNull();
  });
});
