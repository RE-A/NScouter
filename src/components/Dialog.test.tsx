// 대화창 껍데기의 계약
//
//   · Esc 는 맨 위 창만 닫는다
//   · 가림막은 누른 곳·뗀 곳이 둘 다 가림막일 때만 닫는다 — 안에서 끌다 밖에서 놓아도 안 닫힌다
//   · 열리면 창에 포커스가 간다

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

describe('Dialog', () => {
  it('Esc 는 맨 위 창만 닫는다', () => {
    const under = vi.fn();
    const top = vi.fn();
    render(
      <>
        <Dialog title="아래" onClose={under}>a</Dialog>
        <Dialog title="위" onClose={top}>b</Dialog>
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(top).toHaveBeenCalledTimes(1);
    expect(under).not.toHaveBeenCalled();
  });

  it('가림막을 눌렀다 떼면 닫고, 안에서 끌다 밖에서 놓으면 안 닫는다', () => {
    const onClose = vi.fn();
    render(<Dialog title="창" onClose={onClose}><p>안쪽</p></Dialog>);
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;

    fireEvent.mouseDown(screen.getByText('안쪽'));
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('열리면 창에 포커스가 가고, 발은 줄 때만 그린다', () => {
    render(<Dialog title="창" onClose={vi.fn()} footer={<button>저장</button>}>본문</Dialog>);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    expect(screen.getByRole('button', { name: '저장' })).toBeDefined();
  });
});
