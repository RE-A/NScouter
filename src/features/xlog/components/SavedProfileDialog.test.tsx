// 저장본 창의 계약
//
// 여기서 지키려는 것:
//   · 빈 폴더를 **에러로 보이지 않게** 한다 (한 번도 저장 안 한 앱의 첫 화면이다)
//   · 목록은 서버(Rust)가 준 순서를 **뒤집지 않는다** — 최신 저장 순이 규칙이다
//   · 고른 파일을 읽어 그대로 넘긴다
//   · 읽기에 실패하면 창을 닫지 않고 이유를 남긴다 (닫아 버리면 왜 안 열렸는지 모른다)

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedProfileDialog } from './SavedProfileDialog';
import type { SavedProfile, SavedProfileEntry } from '../api/scouterApi';

const api = vi.hoisted(() => ({
  rows: [] as SavedProfileEntry[],
  opened: null as SavedProfile | null,
  openError: null as string | null,
}));

vi.mock('../api/scouterApi', () => ({
  listSavedProfiles: () => Promise.resolve(api.rows),
  getProfileDir: () => Promise.resolve('C:/app/profiles'),
  openSavedProfile: () =>
    api.openError ? Promise.reject(new Error(api.openError)) : Promise.resolve(api.opened),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}));

function entry(over: Partial<SavedProfileEntry> = {}): SavedProfileEntry {
  return {
    path: 'C:/app/profiles/20260830-141203_shop_order_z1.json',
    file_name: '20260830-141203_shop_order_z1.json',
    service: '/shop/order',
    txid: 'z1',
    end_time: 1786721179122,
    saved_at: 1786721200000,
    size: 2048,
    ...over,
  };
}

const SAVED = {
  format: 'nscouter-profile',
  version: 1,
  saved_at: 1786721200000,
  service: '/shop/order',
  txid: 'z1',
  end_time: 1786721179122,
  xlog: { txid: 'z1' },
  profile: { txid: 'z1', obj_hash: 1, steps: [] },
  texts: { 7: 'select 1' },
} as unknown as SavedProfile;

beforeEach(() => {
  api.rows = [];
  api.opened = SAVED;
  api.openError = null;
});
afterEach(() => vi.clearAllMocks());

describe('SavedProfileDialog', () => {
  it('저장본이 없으면 에러가 아니라 안내를 낸다', async () => {
    render(<SavedProfileDialog onOpen={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText(/저장한 프로파일이 없습니다/)).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('목록 순서를 여기서 다시 정렬하지 않는다', async () => {
    // 최신 저장 순은 Rust 가 정한다. 화면이 또 정렬하면 규칙이 두 곳이 된다.
    api.rows = [
      entry({ path: 'b.json', service: '/shop/b', saved_at: 200 }),
      entry({ path: 'a.json', service: '/shop/a', saved_at: 100 }),
    ];
    render(<SavedProfileDialog onOpen={vi.fn()} onClose={vi.fn()} />);

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('/shop/b');
    expect(items[1].textContent).toContain('/shop/a');
  });

  it('고른 저장본을 읽어 그대로 넘기고 창을 닫는다', async () => {
    api.rows = [entry()];
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<SavedProfileDialog onOpen={onOpen} onClose={onClose} />);

    fireEvent.click(await screen.findByText('/shop/order'));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(SAVED));
    expect(onClose).toHaveBeenCalled();
  });

  it('읽기에 실패하면 창을 닫지 않고 이유를 남긴다', async () => {
    api.rows = [entry()];
    api.openError = '저장본 형식이 아닙니다';
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<SavedProfileDialog onOpen={onOpen} onClose={onClose} />);

    fireEvent.click(await screen.findByText('/shop/order'));

    expect(await screen.findByText(/저장본 형식이 아닙니다/)).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('저장 폴더 경로를 보여 준다', async () => {
    // 지우는 것도, 남에게 넘기는 것도 결국 폴더에서 한다. 경로를 숨기면 못 한다.
    render(<SavedProfileDialog onOpen={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('C:/app/profiles')).toBeTruthy();
  });
});
