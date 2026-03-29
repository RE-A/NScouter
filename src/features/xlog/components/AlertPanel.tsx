// src/features/xlog/components/AlertPanel.tsx
// 실시간 알림 배지 + 드롭다운 패널

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { AlertPack } from '../types/alert';
import { alertLevelColor, alertLevelLabel } from '../types/alert';
import { onAlertData } from '../api/scouterApi';

const MAX_ALERTS = 200;

interface AlertPanelProps {
  isStreaming: boolean;
  /** 배지 클릭 시 외부 콜백 (예: Alert 탭으로 이동) */
  onBadgeClick?: () => void;
}

export const AlertPanel = memo(function AlertPanel({ isStreaming, onBadgeClick }: AlertPanelProps) {
  const [alerts, setAlerts] = useState<AlertPack[]>([]);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  // 알림 수신
  useEffect(() => {
    if (!isStreaming) return;

    let unlisten: (() => void) | null = null;
    onAlertData((pack: AlertPack) => {
      setAlerts(prev => {
        const next = [pack, ...prev];
        return next.length > MAX_ALERTS ? next.slice(0, MAX_ALERTS) : next;
      });
      setUnread(prev => prev + 1);
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [isStreaming]);

  // 패널 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleToggle = useCallback(() => {
    if (onBadgeClick) {
      onBadgeClick();
      return;
    }
    setOpen(prev => {
      if (!prev) setUnread(0);
      return !prev;
    });
  }, [onBadgeClick]);

  const handleClear = useCallback(() => {
    setAlerts([]);
    setUnread(0);
  }, []);

  return (
    <div ref={panelRef} style={wrapStyle}>
      {/* 배지 버튼 */}
      <button onClick={handleToggle} style={badgeBtnStyle(open)} title="알림">
        <span style={bellStyle}>🔔</span>
        {unread > 0 && (
          <span style={countStyle}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {/* 드롭다운 패널 */}
      {open && (
        <div style={dropdownStyle}>
          <div style={dropHeaderStyle}>
            <span>알림 ({alerts.length})</span>
            <button onClick={handleClear} style={clearBtnStyle}>Clear</button>
          </div>
          {alerts.length === 0 ? (
            <div style={emptyStyle}>알림 없음</div>
          ) : (
            <div style={listStyle}>
              {alerts.map((a, i) => (
                <AlertRow key={i} alert={a} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function AlertRow({ alert }: { alert: AlertPack }) {
  const color = alertLevelColor(alert.level);
  const label = alertLevelLabel(alert.level);
  const time = new Date(alert.time).toLocaleTimeString('ko-KR', { hour12: false });

  return (
    <div style={rowStyle}>
      <div style={rowTopStyle}>
        <span style={levelBadgeStyle(color)}>{label}</span>
        <span style={rowTimeStyle}>{time}</span>
        <span style={rowTitleStyle}>{alert.title}</span>
      </div>
      {alert.message && (
        <div style={rowMsgStyle}>{alert.message}</div>
      )}
    </div>
  );
}

// ─── 스타일 ────────────────────────────────────────────────────

const wrapStyle: React.CSSProperties = {
  position: 'relative',
  flexShrink: 0,
};

function badgeBtnStyle(active: boolean): React.CSSProperties {
  return {
    position: 'relative',
    background: active ? '#2a2a4e' : 'none',
    border: active ? '1px solid #444' : '1px solid transparent',
    borderRadius: 4,
    cursor: 'pointer',
    padding: '3px 7px',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  };
}

const bellStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1,
};

const countStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  background: '#ef5350',
  color: '#fff',
  fontSize: 9,
  fontWeight: 700,
  borderRadius: 6,
  padding: '1px 3px',
  minWidth: 14,
  textAlign: 'center',
  transform: 'translate(40%, -40%)',
};

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  right: 0,
  width: 360,
  maxHeight: 420,
  background: '#1a1a2e',
  border: '1px solid #333',
  borderRadius: 6,
  boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 1000,
  overflow: 'hidden',
};

const dropHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '6px 12px',
  borderBottom: '1px solid #222',
  fontSize: 12,
  color: '#aaa',
  flexShrink: 0,
};

const clearBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #333',
  color: '#666',
  fontSize: 10,
  padding: '2px 6px',
  borderRadius: 3,
  cursor: 'pointer',
};

const listStyle: React.CSSProperties = {
  overflowY: 'auto',
  flex: 1,
};

const emptyStyle: React.CSSProperties = {
  padding: '16px',
  fontSize: 12,
  color: '#555',
  textAlign: 'center',
};

const rowStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderBottom: '1px solid #12121e',
};

const rowTopStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 2,
};

function levelBadgeStyle(color: string): React.CSSProperties {
  return {
    background: color,
    color: '#fff',
    fontSize: 9,
    fontWeight: 700,
    padding: '1px 4px',
    borderRadius: 2,
    flexShrink: 0,
  };
}

const rowTimeStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#555',
  flexShrink: 0,
};

const rowTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#ccc',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const rowMsgStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#888',
  marginLeft: 2,
  wordBreak: 'break-all',
};
