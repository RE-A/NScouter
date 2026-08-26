// src/features/xlog/components/LogLevelSelector.tsx

import React, { useState } from 'react';
import { setLogLevel, type LogLevel } from '../api/scouterApi';
import { T, F } from '../../../styles/tokens';
import { t } from '../../../i18n';

const LEVELS: { value: LogLevel; label: string }[] = [
  { value: 'error', label: t('ERROR (일반)') },
  { value: 'warn',  label: 'WARN' },
  { value: 'info',  label: 'INFO' },
  { value: 'debug', label: t('DEBUG (개발)') },
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
  background: T.bgInput,
  border: '1px solid #444',
  borderRadius: 4,
  color: T.textMuted,
  padding: '3px 6px',
  fontSize: F.small,
  cursor: 'pointer',
};
