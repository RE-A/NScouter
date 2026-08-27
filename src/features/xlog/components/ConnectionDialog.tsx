// src/features/xlog/components/ConnectionDialog.tsx

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { T, F } from '../../../styles/tokens';
import {
  connectScouter,
  startXLogStream,
  startMockStream,
  stopXLogStream,
  disconnectScouter,
  getObjectList,
  getConfig,
  saveConfig,
} from '../api/scouterApi';
import { t } from '../../../i18n';

interface ConnectionDialogProps {
  onConnected: (serverId: string, objHashes: number[]) => void;
  onDisconnected: () => void;
  isConnected: boolean;
}

export function ConnectionDialog({
  onConnected,
  onDisconnected,
  isConnected,
}: ConnectionDialogProps) {
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('6100');
  const [user, setUser] = useState('admin');
  const [pass, setPass] = useState('');
  const [autoConnect, setAutoConnect] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoTried = useRef(false);

  /** 접속 + 오브젝트 조회 + XLog 스트림 시작. 수동/자동 공용. */
  const doConnect = useCallback(async (p: {
    host: string; port: number; user: string; pass: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      await connectScouter(p);
      const objects = await getObjectList();
      const hashes = objects.map(o => o.obj_hash);
      await startXLogStream(hashes.length > 0 ? hashes : [0]);
      onConnected('scouter', hashes);
    } catch (err) {
      setError(String(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [onConnected]);

  // 마지막 접속 정보 prefill + 자동 연결
  useEffect(() => {
    getConfig().then(cfg => {
      if (cfg.last_host) setHost(cfg.last_host);
      if (cfg.last_port) setPort(String(cfg.last_port));
      if (cfg.last_user) setUser(cfg.last_user);
      if (cfg.last_pass) setPass(cfg.last_pass);
      setAutoConnect(!!cfg.auto_connect);

      // StrictMode 가 effect 를 두 번 실행하므로 한 번만 시도한다.
      if (!cfg.auto_connect || autoTried.current) return;
      if (!cfg.last_host || !cfg.last_user) return;
      autoTried.current = true;
      doConnect({
        host: cfg.last_host,
        port: cfg.last_port ?? 6100,
        user: cfg.last_user,
        pass: cfg.last_pass ?? '',
      }).catch(() => { /* 에러는 화면에 표시됨 */ });
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
    doConnect({ host, port: Number(port), user, pass }).catch(() => {});
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
      <label style={autoLabelStyle} title={t('비밀번호가 config.json 에 평문으로 저장됩니다')}>
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
