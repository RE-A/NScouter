// src/features/xlog/components/XLogChart.tsx

import React, { memo } from 'react';
import { useXLogCanvas } from '../hooks/useXLogCanvas';
import { useXLogStream } from '../hooks/useXLogStream';
import type { SXLog, XLogChartConfig, XLogFilterState } from '../types/xlog';

interface XLogChartProps {
  config: XLogChartConfig;
  filter: XLogFilterState;
  onSelect?: (xlogs: SXLog[]) => void;
}

export const XLogChart = memo(function XLogChart({
  config,
  filter,
  onSelect,
}: XLogChartProps) {
  const { store, streamError, clearError } = useXLogStream(config);
  const { canvasRef, selectedXLogs, clearSelection } = useXLogCanvas(store, config, filter);

  // 선택 변경 시 콜백
  React.useEffect(() => {
    if (selectedXLogs.length > 0) {
      onSelect?.(selectedXLogs);
    }
  }, [selectedXLogs, onSelect]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          cursor: 'crosshair',
        }}
      />

      {streamError && (
        <div style={errorBannerStyle}>
          <span>{streamError}</span>
          <button onClick={clearError} style={closeBtnStyle}>✕</button>
        </div>
      )}

      {selectedXLogs.length > 0 && (
        <div style={selectionBadgeStyle}>
          {selectedXLogs.length}개 선택
          <button onClick={clearSelection} style={closeBtnStyle}>✕</button>
        </div>
      )}
    </div>
  );
});

const errorBannerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(220, 50, 50, 0.9)',
  color: '#fff',
  padding: '6px 12px',
  borderRadius: 4,
  fontSize: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  zIndex: 10,
};

const selectionBadgeStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 36,
  right: 12,
  background: 'rgba(0, 80, 200, 0.85)',
  color: '#fff',
  padding: '4px 10px',
  borderRadius: 4,
  fontSize: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  zIndex: 10,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#fff',
  cursor: 'pointer',
  padding: 0,
  fontSize: 14,
  lineHeight: 1,
};
