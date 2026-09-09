// src/features/xlog/components/ConnectionDialog.tsx

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { T, F } from '../../../styles/tokens';
import {
  startMockStream,
  stopXLogStream,
  disconnectScouter,
  getConfig,
  saveConfig,
  type ServerProfile,
} from '../api/scouterApi';
import { connectToServer } from '../api/connectFlow';
import { t } from '../../../i18n';

interface ConnectionDialogProps {
  onConnected: (serverId: string, objHashes: number[]) => void;
  onDisconnected: () => void;
  isConnected: boolean;
  /**
   * 폼에 미리 채워 둘 접속 정보.
   *
   * 비밀번호를 저장하지 않은 서버로 갈아탈 때 쓴다 — 호스트·계정은 아는데
   * 비밀번호만 모르는 상태라, 그것만 치면 되게 한다.
   */
  prefill?: ServerProfile | null;
  /** 접속에 성공했을 때. 목록에 넣거나 갱신하는 것은 부르는 쪽 몫이다 */
  onConnectedProfile?: (profile: ServerProfile, savePass: boolean) => void;
}

export function ConnectionDialog({
  onConnected,
  onDisconnected,
  isConnected,
  prefill = null,
  onConnectedProfile,
}: ConnectionDialogProps) {
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('6100');
  const [user, setUser] = useState('admin');
  const [pass, setPass] = useState('');
  const [autoConnect, setAutoConnect] = useState(false);
  /**
   * 이 서버의 비밀번호를 목록에 남길지.
   *
   * **«자동 연결» 과 갈라 둔다.** 예전에는 이 결정을 그 체크박스가 대신했는데,
   * 자동 연결은 «기동할 때 마지막 서버로 붙어라» 라는 **전역** 설정이고 이건
   * **서버마다** 다른 이야기다. 묶어 두면 자동 연결이 꺼진 상태로 어느 서버에
   * 다시 붙는 순간 그 서버에 기억해 둔 비밀번호가 조용히 지워졌다 —
   * 현장에서 «가끔 자동 로그인이 안 되고 비밀번호를 다시 묻는다» 로 나온 것이 이것이다.
   *
   * 기본값은 **그 서버에 이미 저장된 비밀번호가 있는가** 에서 가져온다.
   * 그래야 재접속이 기억해 둔 것을 지우지 않는다.
   */
  const [rememberPass, setRememberPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoTried = useRef(false);

  /**
   * 접속 + 오브젝트 조회 + XLog 스트림 시작. 수동/자동 공용.
   *
   * **비밀번호 저장 여부를 인자로 받는다.** 상태에서 읽으면 이 콜백이 그 상태에
   * 매달리고, 아래 «마지막 접속 정보» effect 가 이 콜백을 의존성으로 잡고 있어서
   * 체크를 누를 때마다 effect 가 다시 돌며 방금 누른 값을 설정 파일 값으로 덮는다.
   */
  const doConnect = useCallback(async (
    p: { host: string; port: number; user: string; pass: string },
    savePass: boolean,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const hashes = await connectToServer(p);
      onConnected('scouter', hashes);
      // 붙은 곳은 목록에 남긴다 — 다음에 갈아탈 때 다시 치지 않게.
      onConnectedProfile?.({ name: '', ...p }, savePass);
    } catch (err) {
      setError(String(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [onConnected, onConnectedProfile]);

  /**
   * 갈아탈 서버가 정해지면 폼을 그 값으로 채운다.
   *
   * **앞 서버의 비밀번호를 물려주지 않는다** — 엉뚱한 값으로 붙으려다 실패한다.
   * 다만 그 서버에 저장해 둔 값이 있으면 그것을 쓴다: 여기로 오는 길이 둘이라
   * (비밀번호가 없어서 · 접속이 실패해서) 뒤쪽에서는 저장된 값이 멀쩡히 있다.
   *
   * «기억» 체크도 그 서버의 상태를 따라간다. 저장된 비밀번호가 있는 서버에 다시
   * 붙으면서 체크가 꺼져 있으면, 접속하는 순간 기억해 둔 것이 지워진다.
   */
  useEffect(() => {
    if (!prefill) return;
    setHost(prefill.host);
    setPort(String(prefill.port));
    setUser(prefill.user);
    setPass(prefill.pass);
    setRememberPass(prefill.pass !== '');
  }, [prefill]);

  // 마지막 접속 정보 prefill + 자동 연결
  useEffect(() => {
    getConfig().then(cfg => {
      if (cfg.last_host) setHost(cfg.last_host);
      if (cfg.last_port) setPort(String(cfg.last_port));
      if (cfg.last_user) setUser(cfg.last_user);
      if (cfg.last_pass) setPass(cfg.last_pass);
      setAutoConnect(!!cfg.auto_connect);
      // 마지막에 붙던 서버에 저장된 비밀번호가 있으면 «기억» 은 이미 켜진 상태다.
      // 여기서 안 켜 주면 그 서버에 다시 붙는 순간 저장된 값이 지워진다.
      setRememberPass(
        !!cfg.last_pass ||
          (cfg.servers ?? []).some(
            sv => sv.host === cfg.last_host && sv.user === cfg.last_user && sv.pass !== '',
          ),
      );

      // StrictMode 가 effect 를 두 번 실행하므로 한 번만 시도한다.
      if (!cfg.auto_connect || autoTried.current) return;
      if (!cfg.last_host || !cfg.last_user) return;
      autoTried.current = true;
      doConnect(
        {
          host: cfg.last_host,
          port: cfg.last_port ?? 6100,
          user: cfg.last_user,
          pass: cfg.last_pass ?? '',
        },
        // **자동 연결로 붙었다는 것은 비밀번호가 이미 저장돼 있다는 뜻이다.**
        // 여기서 «저장 안 함» 으로 넘기면 기동할 때마다 그 서버의 비밀번호가 지워진다.
        true,
      ).catch(() => { /* 에러는 화면에 표시됨 */ });
    }).catch(() => {});
  }, [doConnect]);

  /**
   * 자동 연결은 접속 폼의 일부가 아니라 **설정**이다. 누른 즉시 저장한다 —
   * 끄고 나서 접속하지 않고 창을 닫으면 다음 실행에서 또 자동 연결된다.
   *
   * 끌 때는 저장된 평문 비밀번호도 같이 지운다. 콜렉터 쪽은 다음 접속 때 지우지만,
   * 껐다가 접속을 안 하면 config.json 에 그대로 남는다.
   */
  const handleAutoConnectChange = useCallback(async (next: boolean) => {
    setAutoConnect(next);
    // 자동 연결은 저장된 비밀번호로 붙는다. 켜면서 «기억» 이 꺼져 있으면
    // 다음 기동에서 붙을 수가 없다.
    if (next) setRememberPass(true);
    try {
      const cfg = await getConfig();
      await saveConfig({ ...cfg, auto_connect: next, last_pass: next ? cfg.last_pass : null });
    } catch { /* 설정 저장 실패는 접속을 막지 않는다 */ }
  }, []);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    // connect_scouter 가 auto_connect 를 보고 비밀번호 저장 여부를 정하므로
    // 접속보다 **먼저** 저장해야 한다.
    try {
      const cfg = await getConfig();
      await saveConfig({ ...cfg, auto_connect: autoConnect });
    } catch { /* 설정 저장 실패는 접속을 막지 않는다 */ }
    // 자동 연결은 저장된 비밀번호로 붙으므로, 켜져 있으면 기억도 켠 것으로 본다.
    doConnect({ host, port: Number(port), user, pass }, rememberPass || autoConnect).catch(
      () => {},
    );
  }

  async function handleDemo() {
    setLoading(true);
    setError(null);
    try {
      await startMockStream();
      onConnected('demo', [0x1001, 0x1002, 0x1003]);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    setLoading(true);
    try {
      await stopXLogStream();
      await disconnectScouter();
      onDisconnected();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  // 연결 상태는 헤더 배지(초록 점 + 서버명)가 이미 말해준다.
  // 여기선 행동(끊기)만 남긴다.
  if (isConnected) {
    return (
      <button
        onClick={handleDisconnect}
        disabled={loading}
        className="rounded px-2 py-1 text-micro text-fg-dim hover:text-fg disabled:opacity-50"
      >
        {loading ? '…' : t('연결 해제')}
      </button>
    );
  }

  return (
    <form onSubmit={handleConnect} style={panelStyle}>
      <input
        style={inputStyle}
        value={host}
        onChange={e => setHost(e.target.value)}
        placeholder="Host"
        required
      />
      <input
        style={{ ...inputStyle, width: 70 }}
        value={port}
        onChange={e => setPort(e.target.value)}
        placeholder="Port"
        type="number"
        required
      />
      <input
        style={{ ...inputStyle, width: 80 }}
        value={user}
        onChange={e => setUser(e.target.value)}
        placeholder="User"
        required
      />
      <input
        style={{ ...inputStyle, width: 100 }}
        type="password"
        value={pass}
        onChange={e => setPass(e.target.value)}
        placeholder="Password"
      />
      {/* **두 체크는 다른 이야기다.** 왼쪽은 «이 서버» 의 비밀번호를 목록에 남길지,
          오른쪽은 «기동할 때» 마지막 서버로 붙을지다. 하나로 묶여 있던 동안
          자동 연결을 끄면 서버마다 기억해 둔 비밀번호가 다음 접속에서 지워졌다. */}
      <label style={autoLabelStyle} title={t('비밀번호가 config.json 에 평문으로 저장됩니다')}>
        <input
          type="checkbox"
          checked={rememberPass}
          onChange={e => setRememberPass(e.target.checked)}
        />
        {t('비밀번호 기억')}
      </label>
      <label style={autoLabelStyle} title={t('기동할 때 마지막 서버로 자동 접속합니다')}>
        <input
          type="checkbox"
          checked={autoConnect}
          onChange={e => { void handleAutoConnectChange(e.target.checked); }}
        />
        {t('자동 연결')}
      </label>
      <button type="submit" disabled={loading} style={btnStyle}>
        {loading ? t('연결 중…') : t('연결')}
      </button>
      <button
        type="button"
        onClick={handleDemo}
        disabled={loading}
        style={{ ...btnStyle, background: T.success }}
        title={t('실제 Collector 없이 합성 데이터로 차트 테스트')}
      >
        Demo
      </button>
      {error && <span style={{ color: T.error, fontSize: F.body }}>{error}</span>}
    </form>
  );
}

const panelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  background: T.bgOverlay,
  flexWrap: 'wrap',
};

const inputStyle: React.CSSProperties = {
  background: T.bgInput,
  border: '1px solid #444',
  borderRadius: 4,
  color: T.text,
  padding: '4px 8px',
  fontSize: F.base,
  width: 120,
};

const autoLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: F.small,
  color: T.textMuted,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const btnStyle: React.CSSProperties = {
  background: T.accent,
  border: 'none',
  borderRadius: 4,
  color: T.text,
  padding: '4px 14px',
  fontSize: F.base,
  cursor: 'pointer',
};
