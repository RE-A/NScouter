// 통계 설정 — 꺼 둔 조건의 칸은 검사하지 않고, 저장할 때는 지금 값을 그대로 둔다

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_RULES } from './statsJudge';
import { StatsSettingsDialog } from './StatsSettingsDialog';

describe('StatsSettingsDialog', () => {
  it('꺼 둔 ms 칸이 비어 있어도 저장되고, 그 값은 이전 값을 지킨다', () => {
    const onSave = vi.fn();
    render(<StatsSettingsDialog rules={DEFAULT_RULES} keepDays={90} onSave={onSave} onClose={() => {}} />);
    const ms = screen.getByDisplayValue(String(DEFAULT_RULES.slowMinMs));
    fireEvent.change(ms, { target: { value: '' } });
    const save = screen.getByRole('button', { name: '저장' }) as HTMLButtonElement;
    // 켠 칸이 비면 막힌다
    expect(save.disabled).toBe(true);

    // ms 조건을 끄면 그 칸은 보지 않는다
    const toggle = ms.closest('label')?.querySelector('input[type=checkbox]');
    if (!toggle) throw new Error('ms 체크 상자가 없다');
    fireEvent.click(toggle);
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.slowUseMs).toBe(false);
    expect(saved.slowMinMs).toBe(DEFAULT_RULES.slowMinMs);
  });
});
