// 판 하나의 오류는 그 판 안에 갇힌다 — 옆 판은 그대로
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelErrorBoundary } from './PanelErrorBoundary';

function Boom(): never {
  throw new Error('값이 비었다');
}

describe('PanelErrorBoundary', () => {
  it('넘어진 판에만 까닭을 적고 옆 판은 그린다', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <div>
        <PanelErrorBoundary><Boom /></PanelErrorBoundary>
        <PanelErrorBoundary><span>옆 판</span></PanelErrorBoundary>
      </div>,
    );
    expect(screen.getByRole('alert').textContent).toContain('값이 비었다');
    expect(screen.getByText('옆 판')).toBeDefined();
    spy.mockRestore();
  });
});
