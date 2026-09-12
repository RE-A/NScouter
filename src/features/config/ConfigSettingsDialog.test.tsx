// 설정 창 — **누구에게 묻고 누구에게 저장하는가.**
//
// 에이전트와 콜렉터는 커맨드만 다르다. 여기서 틀리면 콜렉터 설정을 에이전트 파일에 덮어쓰거나
// 그 반대가 된다 — 둘 다 파일을 통째로 덮는 저장이라 되돌릴 수 없다.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigSettingsDialog } from './ConfigSettingsDialog';
import type { ConfigView } from '../xlog/types/config';

const api = vi.hoisted(() => ({
  getAgentConfig: vi.fn(),
  getServerConfig: vi.fn(),
  saveAgentConfig: vi.fn(),
  saveServerConfig: vi.fn(),
}));
vi.mock('../xlog/api/scouterApi', () => api);

const SERVER: ConfigView = {
  text: 'net_tcp_listen_port=6100\n',
  entries: [
    { key: 'net_tcp_listen_port', value: '6100', default: '6100', changed: false, desc: 'TCP Port', value_type: 2 },
    { key: 'log_keep_days', value: '31', default: '31', changed: false, desc: 'Keeping period of log', value_type: 2 },
  ],
};

const AGENT: ConfigView = {
  text: 'net_collector_ip=10.0.0.5\n',
  entries: [
    { key: 'net_collector_ip', value: '10.0.0.5', default: '127.0.0.1', changed: true, desc: 'Collector IP', value_type: 1 },
  ],
};

beforeEach(() => {
  api.getServerConfig.mockResolvedValue(SERVER);
  api.getAgentConfig.mockResolvedValue(AGENT);
  api.saveServerConfig.mockResolvedValue(undefined);
  api.saveAgentConfig.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

async function saveOne(label: string, value: string) {
  fireEvent.change(await screen.findByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '저장…' }));
  fireEvent.click(screen.getByRole('button', { name: '덮어쓰기' }));
}

describe('ConfigSettingsDialog', () => {
  it('콜렉터 설정은 콜렉터에 묻고 콜렉터에 저장한다', async () => {
    render(<ConfigSettingsDialog target={{ kind: 'collector', name: '운영' }} onClose={() => {}} />);
    expect(await screen.findByText('TCP 수신 포트')).toBeTruthy();
    expect(api.getServerConfig).toHaveBeenCalled();
    expect(api.getAgentConfig).not.toHaveBeenCalled();

    await saveOne('net_tcp_listen_port', '6200');
    await waitFor(() => expect(api.saveServerConfig).toHaveBeenCalledWith('net_tcp_listen_port=6200\n'));
    expect(api.saveAgentConfig).not.toHaveBeenCalled();
  });

  it('에이전트 설정은 그 에이전트에 묻고 그 에이전트에 저장한다', async () => {
    render(
      <ConfigSettingsDialog
        target={{ kind: 'agent', objHash: 42, objName: '/h/shop-app', objType: 'tomcat' }}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText('콜렉터 IP')).toBeTruthy();
    expect(api.getAgentConfig).toHaveBeenCalledWith(42);

    await saveOne('net_collector_ip', '10.0.0.9');
    await waitFor(() => expect(api.saveAgentConfig).toHaveBeenCalledWith(42, 'net_collector_ip=10.0.0.9\n'));
    expect(api.saveServerConfig).not.toHaveBeenCalled();
  });

  it('저장한 뒤 다시 읽는다 — 저장했다는 말만 믿지 않는다', async () => {
    render(<ConfigSettingsDialog target={{ kind: 'collector', name: '운영' }} onClose={() => {}} />);
    await saveOne('net_tcp_listen_port', '6200');
    await waitFor(() => expect(api.getServerConfig).toHaveBeenCalledTimes(2));
  });

  it('원문 보기로 설정 파일 그대로를 본다', async () => {
    render(<ConfigSettingsDialog target={{ kind: 'collector', name: '운영' }} onClose={() => {}} />);
    await screen.findByText('TCP 수신 포트');
    fireEvent.click(screen.getByRole('button', { name: '원문' }));
    expect(screen.getByText('net_tcp_listen_port=6100')).toBeTruthy();
    expect(screen.getByRole('button', { name: '원문 편집' })).toBeTruthy();
  });

  it('항목을 못 받으면 «설정 없음» 이 아니라 못 받았다고 말한다', async () => {
    // 콜렉터가 에이전트에 되물어 오는 것이라, 에이전트가 답하지 않으면 빈 응답이 온다 (F-37).
    api.getAgentConfig.mockResolvedValue({ text: '', entries: [] });
    render(
      <ConfigSettingsDialog
        target={{ kind: 'agent', objHash: 1, objName: '/h/x', objType: 'tomcat' }}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText(/설정 항목을 받지 못했습니다/)).toBeTruthy();
  });

  it('호스트 에이전트는 호스트 설정 카탈로그를 쓴다', async () => {
    api.getAgentConfig.mockResolvedValue({
      text: '',
      entries: [{ key: 'cpu_warning_pct', value: '70', default: '70', changed: false, desc: '', value_type: 2 }],
    });
    render(
      <ConfigSettingsDialog
        target={{ kind: 'agent', objHash: 7, objName: '/h/host', objType: 'linux' }}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText('CPU 경고 기준(%)')).toBeTruthy();
    expect(screen.getByText(/호스트 에이전트/)).toBeTruthy();
  });
});
