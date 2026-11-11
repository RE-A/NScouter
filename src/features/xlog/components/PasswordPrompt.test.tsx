// 함께 연결할 때 비밀번호를 몰아서 묻는 창
//
// 지키려는 것:
//   · 비밀번호를 기억하지 않은 서버만 묻는다
//   · 다 채워야 연결할 수 있고, 넘길 때는 **처음 순서 그대로**다 (앞의 것이 주 콜렉터)
//   · «기억» 을 켰는지 함께 넘긴다

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PasswordPrompt } from './PasswordPrompt';
import type { ServerProfile } from '../api/scouterApi';

const p = (name: string, pass = ''): ServerProfile => ({ name, host: `${name}.local`, port: 6100, user: 'admin', pass });

describe('PasswordPrompt', () => {
  it('비밀번호가 빈 서버만 묻고, 다 채우면 순서 그대로 넘긴다', () => {
    const onSubmit = vi.fn();
    render(<PasswordPrompt profiles={[p('A', 'saved'), p('B'), p('C')]} onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText('A 비밀번호')).toBeNull();
    const go = screen.getByRole('button', { name: '함께 연결' }) as HTMLButtonElement;

    fireEvent.change(screen.getByLabelText('B 비밀번호'), { target: { value: 'b' } });
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('C 비밀번호'), { target: { value: 'c' } });
    expect(go.disabled).toBe(false);

    fireEvent.click(go);
    expect(onSubmit).toHaveBeenCalledWith([p('A', 'saved'), p('B', 'b'), p('C', 'c')], false);
  });

  it('«비밀번호 기억» 을 켜면 함께 넘긴다', () => {
    const onSubmit = vi.fn();
    render(<PasswordPrompt profiles={[p('A'), p('B', 'x')]} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('A 비밀번호'), { target: { value: 'a' } });
    fireEvent.click(screen.getByLabelText('비밀번호 기억'));
    fireEvent.click(screen.getByRole('button', { name: '함께 연결' }));
    expect(onSubmit).toHaveBeenCalledWith([p('A', 'a'), p('B', 'x')], true);
  });

  it('취소', () => {
    const onCancel = vi.fn();
    render(<PasswordPrompt profiles={[p('A'), p('B', 'x')]} onSubmit={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
