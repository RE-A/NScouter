// 넓은 구간 찾기 창의 계약
//
// 여기서 지키려는 것:
//   · 모두 모으는 상한을 먼저 말한다 (찾고 나서 알려주면 이미 «없다» 로 읽은 뒤다)
//   · 대소문자를 가리지 않는다고 적어 둔다
//   · 시작이 끝보다 뒤면 찾지 않는다
//   · 넘기는 값이 조건 그대로다 — 여기서 어긋나면 엉뚱한 걸 찾아 온다

import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WideSearchDialog, type WideSearchValues } from './WideSearchDialog';
import type { AgentObject } from '../types/xlog';

const AGENTS: AgentObject[] = [
  { obj_hash: 11, obj_name: '/host/shop-app' } as AgentObject,
  { obj_hash: 22, obj_name: '/host/order-app' } as AgentObject,
];

afterEach(() => vi.clearAllMocks());

function open(onSearch = vi.fn()) {
  render(
    <WideSearchDialog
      agents={AGENTS}
      running={false}
      progress={null}
      onCancel={vi.fn()}
      cap={300_000}
      onSearch={onSearch}
      onClose={vi.fn()}
    />,
  );
  return onSearch;
}

describe('WideSearchDialog — 안내', () => {
  it('모두 모으는 상한을 먼저 적는다', () => {
    open();
    expect(screen.getByText('300,000')).toBeTruthy();
  });

  it('대소문자를 가리지 않는다고 적어 둔다', () => {
    open();
    expect(screen.getByText(/대소문자는 가리지 않습니다/)).toBeTruthy();
  });
});

describe('WideSearchDialog — 구간', () => {
  it('시작이 끝보다 뒤면 찾지 않는다', () => {
    const onSearch = open();

    const inputs = document.querySelectorAll('input[type="datetime-local"]');
    fireEvent.change(inputs[0], { target: { value: '2026-08-29T18:00' } });
    fireEvent.change(inputs[1], { target: { value: '2026-08-29T17:00' } });

    expect(screen.getByText(/시작이 끝보다 앞서야 합니다/)).toBeTruthy();
    fireEvent.click(screen.getByText('찾기'));
    expect(onSearch).not.toHaveBeenCalled();
  });
});

describe('WideSearchDialog — 넘기는 값', () => {
  it('친 조건을 그대로 넘긴다', () => {
    const onSearch = open();

    fireEvent.change(screen.getByPlaceholderText('/order/orders'), {
      target: { value: '/order/' },
    });
    fireEvent.change(screen.getByPlaceholderText('10.89.'), { target: { value: '10.89.2.6' } });
    fireEvent.change(document.querySelector('select')!, { target: { value: '22' } });

    fireEvent.click(screen.getByText('찾기'));

    expect(onSearch).toHaveBeenCalledTimes(1);
    const v = onSearch.mock.calls[0][0] as WideSearchValues;
    expect(v.service).toBe('/order/');
    expect(v.ip).toBe('10.89.2.6');
    expect(v.objHash).toBe(22);
    // 안 친 것은 빈 문자열이다. Rust 가 이걸 보고 조건에서 뺀다(= 안 가린다)
    expect(v.login).toBe('');
    expect(v.text1).toBe('');
    expect(v.stime).toBeLessThan(v.etime);
  });

  it('자유 필드는 접혀 있다가 펼치면 나온다', () => {
    open();
    // 안 쓰는 곳이 대부분이라 기본은 접힘
    expect(screen.queryByText('text1')).toBeNull();

    act(() => {
      fireEvent.click(screen.getByText(/앱 자유 필드/));
    });
    expect(screen.getByText('text1')).toBeTruthy();
  });

  it('찾는 중에는 다시 못 누른다', () => {
    const onSearch = vi.fn();
    render(
      <WideSearchDialog
        agents={AGENTS}
        running
        progress={{ found: 0, done: 0, requests: 1 }}
        onCancel={vi.fn()}
        cap={300_000}
        onSearch={onSearch}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText(/찾는 중/));
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('찾는 동안 모은 수와 진행을 보이고, 멈추기를 누를 수 있다', () => {
    const onCancel = vi.fn();
    render(
      <WideSearchDialog
        agents={AGENTS}
        running
        progress={{ found: 1234, done: 0.42, requests: 7 }}
        onCancel={onCancel}
        cap={300_000}
        onSearch={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('1,234');
    expect(status.textContent).toContain('42%');
    fireEvent.click(screen.getByRole('button', { name: '멈추기' }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('WideSearchDialog — 오류', () => {
  it('찾다가 난 오류를 창에 띄운다 — 말없이 끝나지 않게', () => {
    render(
      <WideSearchDialog
        agents={AGENTS}
        running={false}
        progress={null}
        error="트랜잭션 찾기: 시간 초과"
        onCancel={vi.fn()}
        cap={300_000}
        onSearch={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('시간 초과');
  });
});
