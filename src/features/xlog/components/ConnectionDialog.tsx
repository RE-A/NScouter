// src/features/xlog/components/ConnectionDialog.tsx

import React, { useEffect, useState } from 'react';
import {
  connectScouter,
  startXLogStream,
  startMockStream,
  stopXLogStream,
  disconnectScouter,
  getObjectList,
  getConfig,
} from '../api/scouterApi';

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 마지막 접속 정보 prefill
  useEffect(() => {
    getConfig().then(cfg => {
      if (cfg.last_host) setHost(cfg.last_host);
      if (cfg.last_port) setPort(String(cfg.last_port));
      if (cfg.last_user) setUser(cfg.last_user);
    }).catch(() => {});
  }, []);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await connectScouter({ host, port: Number(port), user, pass });

      // 오브젝트 목록 조회 후 스트리밍 시작
      const objects = await getObjectList();
      const hashes = objects.map(o => o.obj_hash);

      await startXLogStream(hashes.length > 0 ? hashes : [0]);
      onConnected('scouter', hashes);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
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

  if (isConnected) {
    return (
      <div style={panelStyle}>
        <span style={{ color: '#2ecc71', fontWeight: 600 }}>● 연결됨</span>
        <button onClick={handleDisconnect} disabled={loading} style={btnStyle}>
          {loading ? '...' : '연결 해제'}
        </button>
      </div>
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
      <button type="submit" disabled={loading} style={btnStyle}>
        {loading ? '연결 중...' : '연결'}
      </button>
      <button
        type="button"
        onClick={handleDemo}
        disabled={loading}
        style={{ ...btnStyle, background: '#2d6a4f' }}
        title="실제 Collector 없이 합성 데이터로 차트 테스트"
      >
        Demo
      </button>
      {error && <span style={{ color: '#e74c3c', fontSize: 12 }}>{error}</span>}
    </form>
  );
}

const panelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  background: '#1e1e2e',
  flexWrap: 'wrap',
};

const inputStyle: React.CSSProperties = {
  background: '#2a2a3e',
  border: '1px solid #444',
  borderRadius: 4,
  color: '#fff',
  padding: '4px 8px',
  fontSize: 13,
  width: 120,
};

const btnStyle: React.CSSProperties = {
  background: '#4169E1',
  border: 'none',
  borderRadius: 4,
  color: '#fff',
  padding: '4px 14px',
  fontSize: 13,
  cursor: 'pointer',
};
