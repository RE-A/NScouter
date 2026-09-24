// 접속 한 벌 — **붙는 것만으로 XLog 를 통째로 받아 오지 않는가.**
//
// 예전에는 여기서 오브젝트 전체로 스트림을 열었다. 화면은 «고른 서버» 것만 받는
// 규칙이라 곧이어 App 이 다시 열었고, 결과적으로 접속 한 번에 대량 수신이 **두 번**
// 일어났다(스트림을 다시 열면 커서가 처음으로 돌아가 최신 만 건을 새로 준다).
// 오브젝트가 160개 넘는 운영에서는 이것만으로 접속이 무거웠다.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
  connectScouter: vi.fn(() => Promise.resolve()),
  disconnectScouter: vi.fn(() => Promise.resolve()),
  getObjectList: vi.fn(() => Promise.resolve([{ obj_hash: 1 }, { obj_hash: 2 }])),
  startXLogStream: vi.fn(() => Promise.resolve()),
  stopXLogStream: vi.fn(() => Promise.resolve()),
}));
vi.mock('./scouterApi', () => api);

import { connectToServer, switchToServer } from './connectFlow';

const PARAMS = { host: '127.0.0.1', port: 6100, user: 'admin', pass: 'admin' };

beforeEach(() => vi.clearAllMocks());

describe('접속', () => {
  it('연결만 한다 — 스트림을 열지 않는다', async () => {
    await connectToServer(PARAMS);

    expect(api.connectScouter).toHaveBeenCalledWith(PARAMS);
    // 무엇을 받을지는 «지금 고른 서버» 가 정한다. 여기서는 알 수 없다.
    expect(api.startXLogStream).not.toHaveBeenCalled();
  });

  it('오브젝트 목록도 여기서 받지 않는다 — App 이 따로 받는다', async () => {
    // 같은 목록을 두 곳에서 받으면 접속마다 한 번씩 더 오간다.
    await connectToServer(PARAMS);
    expect(api.getObjectList).not.toHaveBeenCalled();
  });
});

describe('서버 갈아타기', () => {
  it('앞 서버의 스트림을 세우고 끊은 뒤 붙는다', async () => {
    await switchToServer(PARAMS);

    expect(api.stopXLogStream).toHaveBeenCalled();
    expect(api.disconnectScouter).toHaveBeenCalled();
    expect(api.connectScouter).toHaveBeenCalledWith(PARAMS);
    expect(api.startXLogStream).not.toHaveBeenCalled();
  });

  it('끊는 쪽이 실패해도 붙는다', async () => {
    // 이미 끊겼거나 세션이 만료된 채로 갈아타는 일이 흔하다. 거기서 멈추면
    // «끊긴 채로 아무 데도 못 붙는» 자리에 갇힌다.
    api.stopXLogStream.mockRejectedValueOnce(new Error('이미 죽음'));
    api.disconnectScouter.mockRejectedValueOnce(new Error('이미 끊김'));

    await switchToServer(PARAMS);
    expect(api.connectScouter).toHaveBeenCalledWith(PARAMS);
  });

  it('붙는 쪽 실패는 삼키지 않는다', async () => {
    // 실패를 삼키면 화면이 «붙은 척» 한다.
    api.connectScouter.mockRejectedValueOnce(new Error('로그인 실패'));
    await expect(switchToServer(PARAMS)).rejects.toThrow('로그인 실패');
  });
});
