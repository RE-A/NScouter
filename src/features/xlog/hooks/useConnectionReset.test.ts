// 접속이 바뀌면 XLog 를 버린다 — **이전 서버의 점이 새 서버 화면에 섞이지 않게.**

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConnectionReset } from './useConnectionReset';

function mount(connected: boolean, epoch: number) {
  const reset = vi.fn();
  const reconnected = vi.fn();
  const hook = renderHook(
    ({ c, e }) => useConnectionReset(c, e, reset, reconnected),
    { initialProps: { c: connected, e: epoch } },
  );
  return { reset, reconnected, rerender: (c: boolean, e: number) => hook.rerender({ c, e }) };
}

describe('useConnectionReset', () => {
  it('처음 붙어 있을 때는 아무것도 버리지 않는다', () => {
    const { reset, reconnected } = mount(true, 1);
    expect(reset).not.toHaveBeenCalled();
    expect(reconnected).not.toHaveBeenCalled();
  });

  it('끊기는 순간 버린다 — 전환하는 동안 이전 점이 남아 보이지 않게', () => {
    const { reset, rerender } = mount(true, 1);
    rerender(false, 1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('다시 붙으면 버리고 새 접속에서 다시 받게 한다', () => {
    const { reset, reconnected, rerender } = mount(true, 1);
    rerender(false, 1);
    rerender(true, 2);
    expect(reset).toHaveBeenCalledTimes(2);
    expect(reconnected).toHaveBeenCalledTimes(1);
  });

  it('끊김과 재연결이 한 번에 묶여 끊김을 못 봐도 번호로 알아챈다', () => {
    // 전환이 빠르면 connected 가 false 인 렌더가 없을 수 있다. 번호가 바뀌었으면 다른 접속이다.
    const { reset, reconnected, rerender } = mount(true, 1);
    rerender(true, 2);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(reconnected).toHaveBeenCalledTimes(1);
  });

  it('같은 접속에서 다시 그려질 뿐이면 버리지 않는다', () => {
    // 렌더마다 비우면 스트림이 받아 둔 것이 계속 사라진다.
    const { reset, rerender } = mount(true, 1);
    rerender(true, 1);
    rerender(true, 1);
    expect(reset).not.toHaveBeenCalled();
  });
});
