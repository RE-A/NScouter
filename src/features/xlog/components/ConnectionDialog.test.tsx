// 접속 폼 — **비밀번호를 언제 기억하는가.**
//
// 현장에서 «서버를 여럿 등록해 두고 갈아타는데 가끔 자동 로그인이 안 되고
// 비밀번호를 다시 물어본다» 가 나왔다. 원인은 그 결정을 **«자동 연결»** 이
// 대신하고 있었던 것이다 — 자동 연결은 «기동할 때 마지막 서버로 붙어라» 라는
// 전역 설정이고, 비밀번호 기억은 **서버마다** 다른 이야기다.
//
// 묶여 있는 동안: 자동 연결이 꺼진 채로 어느 서버에 다시 붙으면
// `upsert(savePass=false)` 가 그 서버에 기억해 둔 비밀번호를 지웠다.
// 다음 전환에서 비밀번호를 다시 묻는 것이 그 결과다.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionDialog } from './ConnectionDialog';
import type { AppConfig, ServerProfile } from '../api/scouterApi';

const connectToServer = vi.fn();
const getConfig = vi.fn();
const saveConfig = vi.fn();

vi.mock('../api/connectFlow', () => ({
  connectToServer: (...a: unknown[]) => connectToServer(...a),
}));
vi.mock('../api/scouterApi', () => ({
  getConfig: (...a: unknown[]) => getConfig(...a),
  saveConfig: (...a: unknown[]) => saveConfig(...a),
  startMockStream: vi.fn(),
  stopXLogStream: vi.fn(),
  disconnectScouter: vi.fn(),
}));

const saved: ServerProfile = {
  name: '운영',
  host: '10.0.0.1',
  port: 6100,
  user: 'admin',
  pass: 'secret',
};

/** 자동 연결은 꺼져 있고, 목록에는 비밀번호를 기억해 둔 서버가 하나 있다 */
function config(over: Partial<AppConfig> = {}): AppConfig {
  return {
    auto_connect: false,
    last_host: null,
    last_port: null,
    last_user: null,
    last_pass: null,
    servers: [saved],
    ...over,
  } as unknown as AppConfig;
}

beforeEach(() => {
  getConfig.mockResolvedValue(config());
  saveConfig.mockResolvedValue(undefined);
  connectToServer.mockResolvedValue([1, 2, 3]);
});

afterEach(() => vi.clearAllMocks());

function draw(prefill: ServerProfile | null = null) {
  const onConnectedProfile = vi.fn();
  render(
    <ConnectionDialog
      isConnected={false}
      onConnected={vi.fn()}
      onDisconnected={vi.fn()}
      prefill={prefill}
      onConnectedProfile={onConnectedProfile}
    />,
  );
  return { onConnectedProfile };
}

const rememberBox = () => screen.getByLabelText('비밀번호 기억') as HTMLInputElement;
const autoBox = () => screen.getByLabelText('자동 연결') as HTMLInputElement;

describe('ConnectionDialog — 비밀번호 기억', () => {
  it('«기억» 과 «자동 연결» 은 다른 체크다', () => {
    // 하나로 묶여 있던 것이 이 결함의 원인이었다.
    draw();
    expect(rememberBox()).not.toBe(autoBox());
  });

  it('기억해 둔 서버로 다시 붙을 때는 «기억» 이 켜진 채로 뜬다', async () => {
    // **여기가 결함의 핵심이다.** 꺼진 채로 뜨면 접속하는 순간 저장된 값이 지워지고,
    // 다음 전환에서 비밀번호를 다시 묻는다.
    draw(saved);
    await waitFor(() => expect(rememberBox().checked).toBe(true));
  });

  it('그 서버의 저장된 비밀번호를 폼에 채운다', async () => {
    // 갈아타기가 실패해 폼이 떴을 때도 여기로 온다 — 그때는 값이 멀쩡히 있다.
    draw(saved);
    await waitFor(() =>
      expect((screen.getByPlaceholderText('Password') as HTMLInputElement).value).toBe('secret'),
    );
  });

  it('비밀번호가 없는 서버는 «기억» 이 꺼진 채로 뜬다', async () => {
    draw({ ...saved, pass: '' });
    await waitFor(() =>
      expect((screen.getByPlaceholderText('Password') as HTMLInputElement).value).toBe(''),
    );
    expect(rememberBox().checked).toBe(false);
  });

  it('자동 연결이 꺼져 있어도 «기억» 을 켜면 저장한다', async () => {
    // 예전에는 자동 연결이 꺼져 있으면 무슨 수를 써도 저장되지 않았다.
    const { onConnectedProfile } = draw();
    fireEvent.click(rememberBox());
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: '연결' }));

    await waitFor(() => expect(onConnectedProfile).toHaveBeenCalled());
    expect(onConnectedProfile.mock.calls[0][1]).toBe(true);
  });

  it('«기억» 을 끄면 저장하지 않는다', async () => {
    const { onConnectedProfile } = draw();
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: '연결' }));

    await waitFor(() => expect(onConnectedProfile).toHaveBeenCalled());
    expect(onConnectedProfile.mock.calls[0][1]).toBe(false);
  });

  it('자동 연결을 켜면 «기억» 도 켜진다', () => {
    // 자동 연결은 저장된 비밀번호로 붙는다. 안 켜 주면 다음 기동에서 붙을 수가 없다.
    draw();
    expect(rememberBox().checked).toBe(false);
    fireEvent.click(autoBox());
    expect(rememberBox().checked).toBe(true);
  });

  it('«기억» 을 눌러도 설정 값이 그것을 되돌리지 않는다', async () => {
    // 접속 콜백이 이 상태에 매달려 있으면, 마지막 접속 정보를 읽는 effect 가
    // 체크를 누를 때마다 다시 돌며 방금 누른 값을 설정 파일 값으로 덮는다.
    draw();
    await waitFor(() => expect(getConfig).toHaveBeenCalled());
    fireEvent.click(rememberBox());
    expect(rememberBox().checked).toBe(true);
    // effect 가 다시 돌 틈을 준다
    await new Promise(r => setTimeout(r, 0));
    expect(rememberBox().checked).toBe(true);
  });
});

describe('ConnectionDialog — 자동 연결로 붙을 때', () => {
  it('저장된 비밀번호를 지우지 않는다', async () => {
    // 자동 연결로 붙었다는 것은 비밀번호가 이미 저장돼 있다는 뜻이다.
    // «저장 안 함» 으로 넘기면 기동할 때마다 그 서버의 비밀번호가 지워진다.
    getConfig.mockResolvedValue(
      config({
        auto_connect: true,
        last_host: '10.0.0.1',
        last_port: 6100,
        last_user: 'admin',
        last_pass: 'secret',
      } as Partial<AppConfig>),
    );
    const { onConnectedProfile } = draw();

    await waitFor(() => expect(onConnectedProfile).toHaveBeenCalled());
    expect(onConnectedProfile.mock.calls[0][1]).toBe(true);
  });
});
