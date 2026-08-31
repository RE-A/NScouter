// 서버 갈아타기 드롭다운의 계약
//
// 여기서 지키려는 것:
//   · **어디에 붙는지**가 목록에 늘 보인다 — 이름만으로는 운영과 QA 를 못 가른다
//   · 비밀번호를 저장 안 한 서버는 그렇다고 미리 말한다
//   · 고르면 그 프로필 그대로 넘긴다
//   · 갈아타는 중에는 다시 못 누른다

import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerSwitcher } from './ServerSwitcher';
import type { ServerProfile } from '../api/scouterApi';

const prod: ServerProfile = { name: '운영', host: '10.0.0.1', port: 6100, user: 'admin', pass: 'x' };
const qa: ServerProfile = { name: '', host: '10.0.0.2', port: 6200, user: 'qa', pass: '' };

function open(profiles = [prod, qa], over: Partial<Parameters<typeof ServerSwitcher>[0]> = {}) {
  const onSwitch = vi.fn();
  const onRemove = vi.fn();
  render(
    <ServerSwitcher
      profiles={profiles}
      current="운영"
      busy={false}
      onSwitch={onSwitch}
      onRemove={onRemove}
      {...over}
    />,
  );
  return { onSwitch, onRemove };
}

afterEach(() => vi.clearAllMocks());

describe('ServerSwitcher', () => {
  it('프로필이 없으면 아무것도 안 보인다', () => {
    const { container } = render(
      <ServerSwitcher profiles={[]} current={null} busy={false} onSwitch={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('지금 붙어 있는 이름을 버튼에 적는다', () => {
    open();
    expect(screen.getByText(/운영/)).toBeTruthy();
  });

  it('목록에 host:port 와 계정이 함께 보인다', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /운영/ }));

    expect(screen.getByText(/10\.0\.0\.1:6100 · admin/)).toBeTruthy();
    // 이름이 없는 프로필은 host:port 로 불린다
    expect(screen.getByText('10.0.0.2:6200')).toBeTruthy();
  });

  it('비밀번호를 저장 안 한 서버는 미리 말한다', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /운영/ }));
    expect(screen.getByText(/비밀번호 물음/)).toBeTruthy();
  });

  it('고르면 그 프로필을 그대로 넘긴다', () => {
    const { onSwitch } = open();
    fireEvent.click(screen.getByRole('button', { name: /운영/ }));
    fireEvent.click(screen.getByText('10.0.0.2:6200'));

    expect(onSwitch).toHaveBeenCalledWith(qa);
  });

  it('갈아타는 중에는 다시 못 누른다', () => {
    open([prod, qa], { busy: true });
    const btn = screen.getByRole('button', { name: /바꾸는 중/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('지우기는 목록에서 뺄 프로필을 준다', () => {
    const { onRemove } = open();
    fireEvent.click(screen.getByRole('button', { name: /운영/ }));
    fireEvent.click(screen.getByLabelText('10.0.0.2:6200 지우기'));

    expect(onRemove).toHaveBeenCalledWith(qa);
  });
});
