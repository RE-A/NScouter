// src/features/xlog/components/XLogToolbar.tsx

import React from 'react';
import type { XLogChartConfig, XLogFilterState, YAxisMode } from '../types/xlog';
import { Y_AXIS_CONFIGS } from '../types/xlog';

interface XLogToolbarProps {
  config: XLogChartConfig;
  filter: XLogFilterState;
  onConfigChange: (c: Partial<XLogChartConfig>) => void;
  onFilterChange: (f: Partial<XLogFilterState>) => void;
}

const Y_AXIS_OPTIONS: YAxisMode[] = [
  'elapsed', 'cpu', 'sqlTime', 'sqlCount', 'apiCallTime', 'apiCallCount', 'heapUsed',
];

export function XLogToolbar({
  config,
  filter,
  onConfigChange,
  onFilterChange,
}: XLogToolbarProps) {
  return (
    <div style={toolbarStyle}>
      {/* Y축 모드 선택 */}
      <label style={labelStyle}>
        Y축
        <select
          style={selectStyle}
          value={config.yAxisMode}
          onChange={e => onConfigChange({ yAxisMode: e.target.value as YAxisMode })}
        >
          {Y_AXIS_OPTIONS.map(mode => (
            <option key={mode} value={mode}>
              {Y_AXIS_CONFIGS[mode].label}
            </option>
          ))}
        </select>
      </label>

      {/* 시간 범위 */}
      <label style={labelStyle}>
        범위
        <select
          style={selectStyle}
          value={config.timeRangeMs}
          onChange={e => onConfigChange({ timeRangeMs: Number(e.target.value) })}
        >
          <option value={60_000}>1분</option>
          <option value={300_000}>5분</option>
          <option value={600_000}>10분</option>
          <option value={1_800_000}>30분</option>
        </select>
      </label>

      {/* 에러만 표시 */}
      <label style={labelStyle}>
        <input
          type="checkbox"
          checked={filter.errorOnly}
          onChange={e => onFilterChange({ errorOnly: e.target.checked })}
          style={{ marginRight: 4 }}
        />
        에러만
      </label>

      {/* 최소 응답시간 */}
      <label style={labelStyle}>
        최소(ms)
        <input
          type="number"
          style={{ ...selectStyle, width: 70 }}
          value={filter.minElapsed}
          min={0}
          onChange={e => onFilterChange({ minElapsed: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '4px 12px',
  background: '#16161e',
  borderBottom: '1px solid #333',
  flexWrap: 'wrap',
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: '#ccc',
  fontSize: 12,
};

const selectStyle: React.CSSProperties = {
  background: '#2a2a3e',
  border: '1px solid #444',
  borderRadius: 4,
  color: '#fff',
  padding: '2px 6px',
  fontSize: 12,
};
