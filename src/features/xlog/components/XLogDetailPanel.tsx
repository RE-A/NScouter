// src/features/xlog/components/XLogDetailPanel.tsx
// XLog 상세 프로파일 패널 (우측 드로어)

import React, { memo } from 'react';
import type { XLogDetailState } from '../hooks/useXLogDetail';
import { ProfileStepList } from './ProfileStepList';
import { useTextResolver } from '../hooks/useTextResolver';

interface XLogDetailPanelProps {
  state: XLogDetailState;
  onClose: () => void;
}

export const XLogDetailPanel = memo(function XLogDetailPanel({
  state,
  onClose,
}: XLogDetailPanelProps) {
  const { getCached } = useTextResolver();

  if (!state.xlog && !state.isLoading) return null;

  const { xlog, profile, texts, isLoading, error } = state;

  const serviceName = xlog
    ? (getCached('service', xlog.service) ?? `[0x${xlog.service.toString(16)}]`)
    : '';

  const errorText = xlog && xlog.error !== 0
    ? (getCached('error', xlog.error) ?? `[0x${xlog.error.toString(16)}]`)
    : null;

  const startTime = xlog
    ? new Date(xlog.endTime - xlog.elapsed).toLocaleTimeString('ko-KR', { hour12: false })
    : '';

  const endTimeStr = xlog
    ? new Date(xlog.endTime).toLocaleTimeString('ko-KR', { hour12: false })
    : '';

  return (
    <div style={panelStyle}>
      {/* 헤더 */}
      <div style={headerStyle}>
        <span style={titleStyle}>XLog Detail</span>
        <button onClick={onClose} style={closeBtnStyle}>✕</button>
      </div>

      {isLoading && (
        <div style={loadingStyle}>프로파일 조회 중...</div>
      )}

      {error && (
        <div style={errorBannerStyle}>{error}</div>
      )}

      {xlog && (
        <div style={bodyStyle}>
          {/* 기본 정보 */}
          <section style={sectionStyle}>
            <div style={sectionTitleStyle}>기본 정보</div>
            <InfoRow label="서비스" value={serviceName} highlight />
            <InfoRow label="시작" value={startTime} />
            <InfoRow label="종료" value={endTimeStr} />
            <InfoRow label="Elapsed" value={`${xlog.elapsed}ms`} highlight />
            <InfoRow label="CPU" value={`${xlog.cpu}ms`} />
            <InfoRow label="IP" value={xlog.ipAddr || '-'} />
            <InfoRow label="TxID" value={xlog.txid} mono />
            {xlog.gxid && xlog.gxid !== '0' && (
              <InfoRow label="GxID" value={xlog.gxid} mono />
            )}
            {errorText && (
              <InfoRow label="Error" value={errorText} error />
            )}
          </section>

          {/* 통계 */}
          <section style={sectionStyle}>
            <div style={sectionTitleStyle}>통계</div>
            <InfoRow label="SQL Count" value={String(xlog.sqlCount)} />
            <InfoRow label="SQL Time" value={`${xlog.sqlTime}ms`} />
            <InfoRow label="API Count" value={String(xlog.apiCallCount)} />
            <InfoRow label="API Time" value={`${xlog.apiCallTime}ms`} />
            <InfoRow label="Heap" value={`${xlog.allocKBytes}KB`} />
          </section>

          {/* 프로파일 Steps */}
          {profile && (
            <section style={sectionStyle}>
              <div style={sectionTitleStyle}>
                Profile ({profile.steps.filter(s => s.kind !== 'Unknown').length} Steps)
              </div>
              <ProfileStepList steps={profile.steps} texts={texts} />
            </section>
          )}
        </div>
      )}
    </div>
  );
});

// ─── 보조 컴포넌트 ─────────────────────────────────────────────

function InfoRow({
  label,
  value,
  highlight,
  error,
  mono,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  error?: boolean;
  mono?: boolean;
}) {
  return (
    <div style={infoRowStyle}>
      <span style={infoLabelStyle}>{label}</span>
      <span
        style={{
          ...infoValueStyle,
          color: error ? '#ef5350' : highlight ? '#e0e8ff' : '#bbb',
          fontFamily: mono ? 'monospace' : undefined,
          fontSize: mono ? 10 : undefined,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── 스타일 ────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  width: 340,
  minWidth: 280,
  maxWidth: 400,
  borderLeft: '1px solid #333',
  background: '#0f0f1e',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  flexShrink: 0,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '6px 12px',
  borderBottom: '1px solid #222',
  flexShrink: 0,
  background: '#1a1a2e',
};

const titleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#aaa',
};

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#666',
  cursor: 'pointer',
  fontSize: 14,
  padding: 0,
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const loadingStyle: React.CSSProperties = {
  padding: '16px',
  fontSize: 12,
  color: '#666',
  textAlign: 'center',
};

const errorBannerStyle: React.CSSProperties = {
  margin: 8,
  padding: '6px 10px',
  background: 'rgba(220, 50, 50, 0.15)',
  border: '1px solid #552222',
  borderRadius: 4,
  fontSize: 11,
  color: '#ef9a9a',
};

const sectionStyle: React.CSSProperties = {
  background: '#1a1a2e',
  borderRadius: 4,
  padding: '6px 8px',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#666',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 4,
};

const infoRowStyle: React.CSSProperties = {
  display: 'flex',
  fontSize: 11,
  gap: 8,
  padding: '2px 0',
  borderBottom: '1px solid #12121e',
};

const infoLabelStyle: React.CSSProperties = {
  width: 72,
  flexShrink: 0,
  color: '#555',
  fontSize: 11,
};

const infoValueStyle: React.CSSProperties = {
  flex: 1,
  color: '#bbb',
};
