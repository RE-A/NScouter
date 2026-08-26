// 상세 패널이 읽는 텍스트
//
// 에러 해시는 두 군데서 온다: **프로파일 스텝**(실패한 SQL/API)과 **XLog 자체**.
// 스텝에서만 모으면, 서비스 계층에서 난 예외처럼 실패한 스텝이 없는 트랜잭션은
// 화면에 `[0x1a2b3c]` 만 남는다 — "에러라는데 에러가 안 보인다" 가 이것이다.

import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useXLogDetail } from './useXLogDetail';
import type { SXLog } from '../types/xlog';

vi.mock('../api/scouterApi', () => ({
  getXLogFullProfile: vi.fn(),
  resolveTexts: vi.fn(),
}));

const { getXLogFullProfile, resolveTexts } = await import('../api/scouterApi');

function xlog(over: Partial<SXLog> = {}): SXLog {
  return {
    txid: 'T1',
    caller: '0',
    gxid: '0',
    endTime: 1_700_000_000_000,
    elapsed: 30,
    objHash: 1,
    service: 11,
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
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(getXLogFullProfile).mockReset();
  vi.mocked(resolveTexts).mockReset();
  // 실패한 스텝이 없는 프로파일 — 서비스 계층에서 난 예외가 이렇다
  vi.mocked(getXLogFullProfile).mockResolvedValue({
    txid: 'T1',
    obj_hash: 1,
    steps: [
      { kind: 'Message', parent: -1, index: 0, start_time: 0, start_cpu: 0, message: 'start', hash: 0 },
    ],
  });
  vi.mocked(resolveTexts).mockImplementation(async (type: string, hashes: number[]) => {
    const out: Record<string, string> = {};
    for (const h of hashes) {
      if (type === 'error') out[String(h)] = 'java.lang.NullPointerException: 의도적';
      if (type === 'service') out[String(h)] = '/shop/lab/error';
    }
    return out;
  });
});

describe('useXLogDetail', () => {
  it('실패한 스텝이 없어도 XLog 의 에러 텍스트를 가져온다', async () => {
    const { result } = renderHook(() => useXLogDetail());

    await act(async () => {
      await result.current.fetchDetail(xlog({ error: 900_001 }));
    });
    await waitFor(() => expect(result.current.state.isLoading).toBe(false));

    // 이걸 안 부르면 화면에는 [0xdbba1] 같은 해시가 그대로 남는다
    expect(result.current.state.texts[900_001]).toContain('NullPointerException');
  });

  it('에러가 없으면 에러 사전을 부르지 않는다', async () => {
    const { result } = renderHook(() => useXLogDetail());

    await act(async () => {
      await result.current.fetchDetail(xlog({ error: 0 }));
    });
    await waitFor(() => expect(result.current.state.isLoading).toBe(false));

    const errorCalls = vi
      .mocked(resolveTexts)
      .mock.calls.filter(([type, hashes]) => type === 'error' && hashes.length > 0);
    expect(errorCalls).toHaveLength(0);
  });
});
