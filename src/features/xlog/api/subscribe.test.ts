import { describe, expect, it, vi } from 'vitest';
import { subscribe } from './subscribe';

describe('subscribe', () => {
  it('정리 함수가 모든 구독을 해지한다', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const off = subscribe(Promise.resolve(a), Promise.resolve(b));

    await Promise.resolve();
    off();

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('구독이 붙기 전에 정리해도 리스너가 남지 않는다', async () => {
    // 이게 이 모듈이 존재하는 이유다. 순진하게 짜면 여기서 리스너가 새고
    // 다음 마운트가 하나를 더 걸어 이벤트가 두 번 처리된다.
    const unlisten = vi.fn();
    let resolve!: (fn: () => void) => void;
    const pending = new Promise<() => void>(r => { resolve = r; });

    const off = subscribe(pending);
    off();

    resolve(unlisten);
    await Promise.resolve();
    await Promise.resolve();

    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('두 번 정리해도 해지는 한 번만 한다', async () => {
    const unlisten = vi.fn();
    const off = subscribe(Promise.resolve(unlisten));

    await Promise.resolve();
    off();
    off();

    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('구독 하나가 실패해도 나머지는 정리된다', async () => {
    const ok = vi.fn();
    const off = subscribe(Promise.reject(new Error('실패')), Promise.resolve(ok));

    await Promise.resolve();
    await Promise.resolve();
    off();

    expect(ok).toHaveBeenCalledOnce();
  });
});
