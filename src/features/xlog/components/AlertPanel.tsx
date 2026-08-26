// src/features/xlog/components/AlertPanel.tsx
// 실시간 알림 배지 + 드롭다운 패널

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { AlertPack } from '../types/alert';
import { alertLevelColor, alertLevelLabel } from '../types/alert';
import { formatTime } from '../utils/colorPalette';
import { T, F } from '../../../styles/tokens';
import { t } from '../../../i18n';

interface AlertPanelProps {
  /** **앱이 쥐고 있는 하나의 버퍼**를 받는다. 여기서 따로 모으면 탭과 어긋난다 */
  alerts: AlertPack[];
  unread: number;
  onClear: () => void;
  onMarkRead: () => void;
  /** 배지 클릭 시 외부 콜백 (예: Alert 탭으로 이동) */
  onBadgeClick?: () => void;
}

export const AlertPanel = memo(function AlertPanel({
  alerts,
  unread,
  onClear,
  onMarkRead,
  onBadgeClick,
}: AlertPanelProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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
      if (!prev) onMarkRead();
      return !prev;
    });
  }, [onBadgeClick, onMarkRead]);

  return (
    <div ref={panelRef} style={wrapStyle}>
      {/* 배지 버튼 */}
      <button onClick={handleToggle} style={badgeBtnStyle(open)} title={t('알림')}>
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
            <button onClick={onClear} style={clearBtnStyle}>Clear</button>
          </div>
          {alerts.length === 0 ? (
            <div style={emptyStyle}>{t('알림 없음')}</div>
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
  const time = formatTime(alert.time);

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
    background: active ? T.bgHover : 'none',
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
  fontSize: F.base,
  lineHeight: 1,
};

const countStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  background: T.error,
  color: T.text,
  fontSize: F.micro,
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
  background: T.bgInput,
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
  fontSize: F.body,
  color: T.textMuted,
  flexShrink: 0,
};

const clearBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #333',
  color: T.textDim,
  fontSize: F.micro,
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
  fontSize: F.body,
  color: T.textFaint,
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
    color: T.text,
    fontSize: F.micro,
    fontWeight: 700,
    padding: '1px 4px',
    borderRadius: 2,
    flexShrink: 0,
  };
}

const rowTimeStyle: React.CSSProperties = {
  fontSize: F.micro,
  color: T.textFaint,
  flexShrink: 0,
};

const rowTitleStyle: React.CSSProperties = {
  fontSize: F.small,
  color: T.text,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const rowMsgStyle: React.CSSProperties = {
  fontSize: F.micro,
  color: T.textMuted,
  marginLeft: 2,
  wordBreak: 'break-all',
};
