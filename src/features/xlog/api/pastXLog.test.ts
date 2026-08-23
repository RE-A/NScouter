// 과거 XLog 페이지 반복
//
// 서버 계약(F-28) 때문에 세 가지가 동시에 필요하다:
//   - 페이지 경계에서 같은 시각의 트랜잭션이 **다시 온다** → 중복 제거
//   - 커서가 전진하지 않으면 같은 페이지가 계속 온다 → 정체 감지
//   - hasMore 가 계속 true 면 영원히 돈다 → 상한
// 셋 다 없으면 앱이 멈추거나 데이터가 중복된다.

import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPastXLogs, MAX_PAGES, PAGE_COUNT } from './pastXLog';
import type { XLogPack } from '../types/xlog';

/** txid 만 다른 최소 XLogPack */
const xlog = (txid: string): XLogPack =>
  ({ txid, end_time: 0, obj_hash: 1, service: 0, elapsed: 0, error: 0 }) as unknown as XLogPack;

const page = (txids: string[], hasMore: boolean, lastTime: number) => ({
  xlogs: txids.map(xlog),
  cursor: { has_more: hasMore, last_txid: 0, last_xlog_time: lastTime },
});

const QUERY = { objHashes: [1], date: '20260816', stime: 0, etime: 1000 };

/** 수집된 (행, 진행상황) */
async function run(signal?: AbortSignal) {
  const rows: string[] = [];
  const progress: Array<{ pages: number; loaded: number; done: boolean; truncated: boolean }> = [];
  await loadPastXLogs(
    QUERY,
    (r, p) => {
      rows.push(...r.map(x => x.txid));
      progress.push(p);
    },
    signal,
  );
  return { rows, progress, last: progress[progress.length - 1] };
}

beforeEach(() => vi.mocked(invoke).mockReset());

describe('loadPastXLogs', () => {
  it('한 페이지로 끝나면 한 번만 부른다', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(page(['a', 'b'], false, 10));
    const { rows, last } = await run();
    expect(rows).toEqual(['a', 'b']);
    expect(last.done).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('hasMore 면 커서를 넘겨 이어서 부른다', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(page(['a', 'b'], true, 10))
      .mockResolvedValueOnce(page(['c'], false, 20));
    const { rows, last } = await run();
    expect(rows).toEqual(['a', 'b', 'c']);
    expect(last.pages).toBe(2);
    expect(last.loaded).toBe(3);

    // 2회차 요청에 1회차 커서가 실려야 한다.
    const second = vi.mocked(invoke).mock.calls[1][1] as { cursor: { last_xlog_time: number } };
    expect(second.cursor.last_xlog_time).toBe(10);
  });

  // 이게 F-28 의 핵심이다. 경계 시각이 같은 건이 다시 온다.
  it('페이지 경계에서 다시 온 txid 를 거른다', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(page(['a', 'b', 'c'], true, 10))
      .mockResolvedValueOnce(page(['b', 'c', 'd'], false, 20));
    const { rows, last } = await run();
    expect(rows).toEqual(['a', 'b', 'c', 'd']);
    expect(last.loaded).toBe(4);
  });

  // 커서가 그대로면 다음 페이지도 같은 내용이다 — 돌면 앱이 멈춘다.
  it('커서가 전진하지 않으면 멈춘다', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(page(['a'], true, 10))
      .mockResolvedValueOnce(page(['b'], true, 10)); // 같은 시각
    const { last } = await run();
    expect(last.done).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  // 서버가 hasMore 를 계속 주면 영원히 돈다.
  it('상한에 걸리면 멈추고 잘렸다고 알린다', async () => {
    let t = 0;
    vi.mocked(invoke).mockImplementation(async () => page(['x' + t], true, ++t));
    const { last } = await run();
    expect(last.truncated).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(MAX_PAGES);
  });

  // 사용자가 구간을 바꾸면 이전 조회 결과가 섞이면 안 된다.
  it('중단 신호가 오면 더 부르지 않는다', async () => {
    const ac = new AbortController();
    vi.mocked(invoke).mockImplementation(async () => {
      ac.abort();
      return page(['a'], true, 1);
    });
    await run(ac.signal);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('첫 요청에는 커서가 없다', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(page([], false, 0));
    await run();
    const first = vi.mocked(invoke).mock.calls[0][1] as { cursor: unknown; pageCount: number };
    expect(first.cursor).toBeNull();
    expect(first.pageCount).toBe(PAGE_COUNT);
  });
});
