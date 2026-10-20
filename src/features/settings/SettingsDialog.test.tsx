// 설정 창의 테마 고르기
//
// 「바꿔도 안 먹는다」가 나왔다. 기능은 멀쩡했고 **저장을 눌러야** 걸리는 것이 문제였다 —
// 색 조합은 눌러 보고 고르는 것이라, 눌러도 아무 일이 없으면 고장으로 읽힌다.
//
// 그래서 두 가지를 같이 지켜야 한다:
//   · 고르는 **즉시** 화면에 걸린다
//   · 저장 안 하고 닫으면 **되돌린다** — 구경만 했는데 바뀌어 있으면 안 된다

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from './SettingsDialog';

const api = vi.hoisted(() => ({
  config: { ui_theme: 'dark' } as Record<string, unknown>,
  saved: [] as Record<string, unknown>[],
}));

vi.mock('../xlog/api/scouterApi', () => ({
  getConfig: () => Promise.resolve(api.config),
  // 서비스 묶기 미리보기가 명단을 한 번 받는다
  getObjectList: () => Promise.resolve([]),
  saveConfig: (c: Record<string, unknown>) => {
    api.saved.push(c);
    return Promise.resolve();
  },
}));

function theme(): string | null {
  return document.documentElement.getAttribute('data-theme');
}

beforeEach(() => {
  api.config = { ui_theme: 'dark' };
  api.saved = [];
  delete document.documentElement.dataset.theme;
});
afterEach(() => vi.clearAllMocks());

/** 테마 버튼 — 이름으로 집는다 */
function pick(label: string) {
  return screen.getByRole('button', { name: new RegExp(label) });
}

describe('테마 고르기', () => {
  it('누르는 즉시 화면에 걸린다 — 저장을 기다리지 않는다', async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(pick('라이트')).toBeDefined());

    fireEvent.click(pick('라이트'));

    expect(theme()).toBe('light');
  });

  it('저장하면 설정에 담긴다', async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(pick('슬레이트')).toBeDefined());

    fireEvent.click(pick('슬레이트'));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(api.saved).toHaveLength(1));
    expect(api.saved[0].ui_theme).toBe('slate');
  });

  it('저장 없이 닫으면 되돌린다 — 구경만 했는데 바뀌어 있으면 안 된다', async () => {
    const { unmount } = render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(pick('고대비')).toBeDefined());

    fireEvent.click(pick('고대비'));
    expect(theme()).toBe('contrast');

    unmount();

    expect(theme()).toBe('dark');
  });

  it('저장하고 닫으면 고른 것이 남는다', async () => {
    const { unmount } = render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(pick('웜')).toBeDefined());

    fireEvent.click(pick('웜'));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(api.saved).toHaveLength(1));

    unmount();

    expect(theme()).toBe('warm');
  });
});
