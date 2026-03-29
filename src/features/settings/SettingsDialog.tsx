// src/features/settings/SettingsDialog.tsx

import React, { memo, useCallback, useEffect, useState } from 'react';
import { getConfig, saveConfig, type AppConfig } from '../xlog/api/scouterApi';

interface SettingsDialogProps {
  onClose: () => void;
}

export const SettingsDialog = memo(function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [config, setConfig] = useState<AppConfig>({});
  const [dataDir, setDataDir] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getConfig().then(cfg => {
      setConfig(cfg);
      setDataDir(cfg.data_dir ?? '');
    }).catch(() => {});
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next: AppConfig = {
        ...config,
        data_dir: dataDir.trim() || null,
      };
      await saveConfig(next);
      setConfig(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [config, dataDir]);

  // ESC 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div style={backdropStyle} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modalStyle}>
        {/* 헤더 */}
        <div style={modalHeaderStyle}>
          <span style={modalTitleStyle}>설정</span>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>

        {/* 본문 */}
        <div style={modalBodyStyle}>
          {/* 데이터 디렉토리 */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>데이터 디렉토리</div>
            <div style={sectionDescStyle}>
              로그 파일과 설정 파일이 저장될 경로입니다.<br />
              비워두면 <code style={codeStyle}>실행파일 경로/</code> 가 사용됩니다.
            </div>
            <input
              style={inputStyle}
              value={dataDir}
              onChange={e => setDataDir(e.target.value)}
              placeholder="비워두면 실행파일 경로 사용"
              spellCheck={false}
            />
          </div>

          {/* 현재 경로 정보 */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>현재 저장 경로</div>
            <div style={pathRowStyle}>
              <span style={pathLabelStyle}>설정 파일</span>
              <span style={pathValueStyle}>
                {dataDir.trim()
                  ? `${dataDir.trim()}\\config.json`
                  : '(실행파일 경로)\\config.json'}
              </span>
            </div>
            <div style={pathRowStyle}>
              <span style={pathLabelStyle}>로그 파일</span>
              <span style={pathValueStyle}>
                {dataDir.trim()
                  ? `${dataDir.trim()}\\logs\\nscouter.log`
                  : '(실행파일 경로)\\logs\\nscouter.log'}
              </span>
            </div>
            <div style={{ ...sectionDescStyle, marginTop: 8, color: '#f5a623' }}>
              ※ 경로 변경은 앱 재시작 후 적용됩니다.
            </div>
          </div>

          {/* 마지막 접속 정보 (읽기 전용) */}
          {(config.last_host || config.last_port || config.last_user) && (
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>마지막 접속 정보</div>
              <div style={pathRowStyle}>
                <span style={pathLabelStyle}>호스트</span>
                <span style={pathValueStyle}>{config.last_host ?? '-'}</span>
              </div>
              <div style={pathRowStyle}>
                <span style={pathLabelStyle}>포트</span>
                <span style={pathValueStyle}>{config.last_port ?? '-'}</span>
              </div>
              <div style={pathRowStyle}>
                <span style={pathLabelStyle}>사용자</span>
                <span style={pathValueStyle}>{config.last_user ?? '-'}</span>
              </div>
            </div>
          )}

          {error && <div style={errorStyle}>{error}</div>}
        </div>

        {/* 푸터 */}
        <div style={modalFooterStyle}>
          {saved && <span style={{ color: '#3dd68c', fontSize: 12 }}>저장 완료</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={cancelBtnStyle}>취소</button>
            <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

// ─── 스타일 ────────────────────────────────────────────────────

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.7)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9000,
};

const modalStyle: React.CSSProperties = {
  background: '#111120',
  border: '1px solid #1e1e3a',
  borderRadius: 8,
  width: 500,
  maxWidth: '90vw',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
};

const modalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 18px',
  borderBottom: '1px solid #1e1e3a',
};

const modalTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: '#e8e8ff',
  letterSpacing: 0.3,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#505070',
  fontSize: 14,
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 4,
  lineHeight: 1,
};

const modalBodyStyle: React.CSSProperties = {
  padding: '16px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#9090b0',
  letterSpacing: 1,
  textTransform: 'uppercase',
  marginBottom: 2,
};

const sectionDescStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#505070',
  lineHeight: 1.6,
};

const codeStyle: React.CSSProperties = {
  background: '#1e1e38',
  padding: '1px 5px',
  borderRadius: 3,
  fontFamily: 'monospace',
  fontSize: 11,
  color: '#9090b0',
};

const inputStyle: React.CSSProperties = {
  background: '#0d0d1a',
  border: '1px solid #252542',
  borderRadius: 4,
  color: '#e8e8ff',
  padding: '7px 10px',
  fontSize: 12,
  fontFamily: 'monospace',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const pathRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
};

const pathLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#505070',
  width: 60,
  flexShrink: 0,
  paddingTop: 1,
};

const pathValueStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#7070a0',
  fontFamily: 'monospace',
  wordBreak: 'break-all',
};

const modalFooterStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '12px 18px',
  borderTop: '1px solid #1e1e3a',
  gap: 8,
};

const cancelBtnStyle: React.CSSProperties = {
  background: '#1e1e38',
  border: '1px solid #252542',
  borderRadius: 4,
  color: '#9090b0',
  fontSize: 12,
  padding: '5px 16px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const saveBtnStyle: React.CSSProperties = {
  background: '#4f72ff',
  border: '1px solid #4f72ff',
  borderRadius: 4,
  color: '#fff',
  fontSize: 12,
  padding: '5px 20px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontWeight: 600,
};

const errorStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#ff4d4f',
  background: 'rgba(255,77,79,0.08)',
  border: '1px solid rgba(255,77,79,0.2)',
  borderRadius: 4,
  padding: '6px 10px',
};
