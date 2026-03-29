// src/features/xlog/components/LogLevelSelector.tsx

import React, { useState } from 'react';
import { setLogLevel, type LogLevel } from '../api/scouterApi';

const LEVELS: { value: LogLevel; label: string }[] = [
  { value: 'error', label: 'ERROR (일반)' },
  { value: 'warn',  label: 'WARN' },
  { value: 'info',  label: 'INFO' },
  { value: 'debug', label: 'DEBUG (개발)' },
  { value: 'trace', label: 'TRACE' },
];

export function LogLevelSelector() {
  const [current, setCurrent] = useState<LogLevel>('error');
  const [loading, setLoading] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const level = e.target.value as LogLevel;
    setLoading(true);
    try {
      await setLogLevel(level);
      setCurrent(level);
    } catch {
      // 연결 전에는 무시
    } finally {
      setLoading(false);
    }
  }

  return (
    <select
      value={current}
      onChange={handleChange}
      disabled={loading}
      title="Log Level"
      style={selectStyle}
    >
      {LEVELS.map(l => (
        <option key={l.value} value={l.value}>{l.label}</option>
      ))}
    </select>
  );
}

const selectStyle: React.CSSProperties = {
  background: '#2a2a3e',
  border: '1px solid #444',
  borderRadius: 4,
  color: '#aaa',
  padding: '3px 6px',
  fontSize: 11,
  cursor: 'pointer',
};
