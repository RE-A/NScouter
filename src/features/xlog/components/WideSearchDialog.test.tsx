// 넓은 구간 찾기 창의 계약
//
// 여기서 지키려는 것:
//   · **상한을 물어보기 전에는 숫자를 지어내지 않는다** (창이 거짓말하면 «없다» 로 읽힌다)
//   · 서버가 상한을 안 알려주면 «기본값으로 본다» 고 밝힌다
//   · 시작이 끝보다 뒤면 찾지 않는다
//   · 넘기는 값이 조건 그대로다 — 여기서 어긋나면 엉뚱한 걸 찾아 온다

import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WideSearchDialog, type WideSearchValues } from './WideSearchDialog';
import type { AgentObject } from '../types/xlog';

const api = vi.hoisted(() => ({
  max: { max: 500, known: false } as { max: number; known: boolean },
  /** 풀리지 않는 프로미스로 «아직 안 물어본» 상태를 붙잡는다 */
  hold: false,
}));

vi.mock('../api/scouterApi', () => ({
  getSearchMax: () =>
    api.hold ? new Promise(() => {}) : Promise.resolve(api.max),
}));

const AGENTS: AgentObject[] = [
  { obj_hash: 11, obj_name: '/host/shop-app' } as AgentObject,
  { obj_hash: 22, obj_name: '/host/order-app' } as AgentObject,
];

beforeEach(() => {
  api.max = { max: 500, known: false };
  api.hold = false;
});
afterEach(() => vi.clearAllMocks());

function open(onSearch = vi.fn()) {
  render(
    <WideSearchDialog agents={AGENTS} running={false} onSearch={onSearch} onClose={vi.fn()} />,
  );
  return onSearch;
}

describe('WideSearchDialog — 상한 표시', () => {
  it('**물어보기 전에는 숫자를 안 적는다**', () => {
    api.hold = true;
    open();
    expect(screen.getByText(/상한을 확인하는 중입니다/)).toBeTruthy();
    // 500 을 지어내면 서버가 상한을 올려 뒀을 때 창이 거짓말을 한다
    expect(screen.queryByText('500')).toBeNull();
  });

  it('서버가 알려준 상한을 그대로 적는다', async () => {
    api.max = { max: 2000, known: true };
    open();
    await waitFor(() => expect(screen.getByText('2,000')).toBeTruthy());
    // 실제로 읽었으므로 «기본값으로 본다» 는 붙지 않는다
    expect(screen.queryByText(/기본값으로 봅니다/)).toBeNull();
  });

  it('설정에 없으면 기본값이라고 밝힌다', async () => {
    api.max = { max: 500, known: false };
    open();
    await waitFor(() => expect(screen.getByText('500')).toBeTruthy());
    expect(screen.getByText(/기본값으로 봅니다/)).toBeTruthy();
  });
});

describe('WideSearchDialog — 구간', () => {
  it('시작이 끝보다 뒤면 찾지 않는다', async () => {
    const onSearch = open();
    await waitFor(() => expect(screen.getByText('500')).toBeTruthy());

    const inputs = document.querySelectorAll('input[type="datetime-local"]');
    fireEvent.change(inputs[0], { target: { value: '2026-08-29T18:00' } });
    fireEvent.change(inputs[1], { target: { value: '2026-08-29T17:00' } });

    expect(screen.getByText(/시작이 끝보다 앞서야 합니다/)).toBeTruthy();
    fireEvent.click(screen.getByText('찾기'));
    expect(onSearch).not.toHaveBeenCalled();
  });
});

describe('WideSearchDialog — 넘기는 값', () => {
  it('친 조건을 그대로 넘긴다', async () => {
    const onSearch = open();
    await waitFor(() => expect(screen.getByText('500')).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText('/order/orders'), {
      target: { value: '/order/' },
    });
    fireEvent.change(screen.getByPlaceholderText('10.89.'), { target: { value: '10.89.2.6' } });
    // 오브젝트는 **하나만** 고를 수 있다 — 서버가 int 하나를 받는다
    fireEvent.change(document.querySelector('select')!, { target: { value: '22' } });

    fireEvent.click(screen.getByText('찾기'));

    expect(onSearch).toHaveBeenCalledTimes(1);
    const v = onSearch.mock.calls[0][0] as WideSearchValues;
    expect(v.service).toBe('/order/');
    expect(v.ip).toBe('10.89.2.6');
    expect(v.objHash).toBe(22);
    // 안 친 것은 빈 문자열이다. Rust 가 이걸 보고 요청에서 뺀다(= 안 가린다)
    expect(v.login).toBe('');
    expect(v.text1).toBe('');
    expect(v.stime).toBeLessThan(v.etime);
  });

  it('자유 필드는 접혀 있다가 펼치면 나온다', async () => {
    open();
    await waitFor(() => expect(screen.getByText('500')).toBeTruthy());
    // 안 쓰는 곳이 대부분이라 기본은 접힘
    expect(screen.queryByText('text1')).toBeNull();

    act(() => {
      fireEvent.click(screen.getByText(/앱 자유 필드/));
    });
    expect(screen.getByText('text1')).toBeTruthy();
  });

  it('찾는 중에는 다시 못 누른다', async () => {
    const onSearch = vi.fn();
    render(
      <WideSearchDialog agents={AGENTS} running onSearch={onSearch} onClose={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText('500')).toBeTruthy());
    fireEvent.click(screen.getByText(/찾는 중/));
    expect(onSearch).not.toHaveBeenCalled();
  });
});
