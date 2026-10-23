// 카운터 구역 접기의 기본값 계약
//
//   · 서비스로 안 묶으면 개별이 기본이고 서비스별은 고를 수 없다
//   · 서비스로 묶으면 서비스별이 기본이다
//   · 묶기를 바꾸면 그 묶기의 기본으로 돌아간다 (골라 둔 것보다 앞선다)
//   · 묶기가 그대로면 골라 둔 것을 지킨다

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSectionFold } from './useSectionFold';

describe('useSectionFold', () => {
  it('서비스로 안 묶으면 개별이 기본이고 서비스별 버튼이 없다', () => {
    const { result } = renderHook(() => useSectionFold(false));
    expect(result.current.fold).toBe('each');
    expect(result.current.choices).toEqual(['each', 'total']);
  });

  it('서비스로 묶으면 서비스별이 기본이다', () => {
    const { result } = renderHook(() => useSectionFold(true));
    expect(result.current.fold).toBe('service');
    expect(result.current.choices).toContain('service');
  });

  it('묶기를 서비스로 바꾸면 서비스별로, 풀면 개별로 돌아간다', () => {
    const { result, rerender } = renderHook(({ by }) => useSectionFold(by), { initialProps: { by: false } });
    act(() => result.current.setFold('total'));
    rerender({ by: true });
    expect(result.current.fold).toBe('service');
    rerender({ by: false });
    // 서비스별이 남으면 고를 버튼도 없는 상태가 된다
    expect(result.current.fold).toBe('each');
  });

  it('묶기가 그대로면 골라 둔 것을 지킨다', () => {
    const { result, rerender } = renderHook(({ by }) => useSectionFold(by), { initialProps: { by: true } });
    act(() => result.current.setFold('total'));
    rerender({ by: true });
    expect(result.current.fold).toBe('total');
  });
});
