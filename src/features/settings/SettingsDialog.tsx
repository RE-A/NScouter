// src/features/settings/SettingsDialog.tsx

import React, { memo, useCallback, useEffect, useState } from 'react';
import { getConfig, saveConfig, type AppConfig } from '../xlog/api/scouterApi';
import {
  applyConfigToViewOptions,
  clampFontScale,
  FONT_SCALES,
} from '../xlog/hooks/useViewOptions';
import { T, F, FONT_MONO } from '../../styles/tokens';
import { t, toLang, type Lang } from '../../i18n';
import { SHORTCUT_HELP, type ShortcutAction } from '../xlog/hooks/shortcuts';

/**
 * 단축키가 무엇을 하는지.
 *
 * **조합 목록은 여기 두지 않는다.** 판정하는 코드(`shortcuts.ts`)가 그대로 주므로
 * 키를 고쳐도 이 창이 거짓말을 하지 않는다. 여기 있는 건 «무슨 뜻인가» 뿐이다.
 */
export const SHORTCUT_LABEL: Record<ShortcutAction, string> = {
  'close-detail': '보고 있는 상세 닫기',
  'focus-search': '프로파일 검색으로 이동',
  'tab-xlog': 'XLog 탭',
  'tab-counter': 'Counter 탭',
  'tab-alert': 'Alert 탭',
  'close-detail-tab': '상세 탭 닫기',
  'cycle-detail-next': '다음 상세 탭',
  'cycle-detail-prev': '이전 상세 탭',
  'open-settings': '설정 열기',
  'toggle-mode': '실시간 ↔ 과거',
  reload: '다시 조회 (과거 구간)',
};

interface SettingsDialogProps {
  onClose: () => void;
}

export const SettingsDialog = memo(function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [config, setConfig] = useState<AppConfig>({});
  const [dataDir, setDataDir] = useState('');
  /** SQL 바인딩 값을 문장에 채울지. 기본은 채우기 */
  const [bindInline, setBindInline] = useState(true);
  /** 글자 크기 배율 */
  const [fontScale, setFontScale] = useState(1);
  /** 화면 언어 */
  const [lang, setLangValue] = useState<Lang>('ko');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getConfig().then(cfg => {
      setConfig(cfg);
      setDataDir(cfg.data_dir ?? '');
      setBindInline(cfg.sql_bind_inline ?? true);
      setFontScale(clampFontScale(cfg.ui_font_scale ?? 1));
      setLangValue(toLang(cfg.ui_language));
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
        sql_bind_inline: bindInline,
        ui_font_scale: fontScale,
        ui_language: lang,
      };
      await saveConfig(next);
      setConfig(next);
      // **저장만 하면 열려 있는 화면은 안 바뀐다.** 설정을 닫고 다시 열어야
      // 반영되면 저장이 안 된 것으로 읽힌다.
      applyConfigToViewOptions(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [config, dataDir, bindInline, fontScale, lang]);

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
          <span style={modalTitleStyle}>{t('설정')}</span>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>

        {/* 본문 */}
        <div style={modalBodyStyle}>
          {/* 데이터 디렉토리 */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>{t('데이터 디렉토리')}</div>
            <div style={sectionDescStyle}>
              {t('로그 파일과 설정 파일이 저장될 경로입니다.')}<br />
              {t('비워두면')} <code style={codeStyle}>{t('실행파일 경로/')}</code>{' '}
              {t('가 사용됩니다.')}
            </div>
            <input
              style={inputStyle}
              value={dataDir}
              onChange={e => setDataDir(e.target.value)}
              placeholder={t('비워두면 실행파일 경로 사용')}
              spellCheck={false}
            />
          </div>

          {/* 언어 */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>{t('언어')}</div>
            <div style={sectionDescStyle}>
              {t(
                t('Scouter 용어(TPS·XLog·Elapsed)는 원래 영어라 두 언어에서 같습니다. 바뀌는 것은 설명과 레이블입니다.'),
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              {(['ko', 'en'] as Lang[]).map(v => {
                const on = v === lang;
                return (
                  <button
                    key={v}
                    onClick={() => setLangValue(v)}
                    aria-pressed={on}
                    style={{
                      ...scaleBtnStyle,
                      fontSize: F.base,
                      borderColor: on ? T.accent : T.border,
                      color: on ? T.text : T.textDim,
                      background: on ? T.bgHover : 'transparent',
                    }}
                  >
                    {v === 'ko' ? '한국어' : 'English'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 글자 크기 */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>{t('글자 크기')}</div>
            <div style={sectionDescStyle}>
              {t('화면 전체에 적용됩니다. 표·차트 눈금·프로파일 본문이 같은 비율로 커집니다.')}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              {FONT_SCALES.map(v => {
                const on = Math.abs(v - fontScale) < 0.001;
                return (
                  <button
                    key={v}
                    onClick={() => setFontScale(v)}
                    aria-pressed={on}
                    style={{
                      ...scaleBtnStyle,
                      // 고른 배율이 어떤 크기인지 **버튼 글자 자체로** 보여준다
                      fontSize: Math.round(13 * v),
                      borderColor: on ? T.accent : T.border,
                      color: on ? T.text : T.textDim,
                      background: on ? T.bgHover : 'transparent',
                    }}
                  >
                    {v === 1 ? t('보통') : `×${v}`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* SQL 표시 */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>{t('SQL 바인딩 파라미터')}</div>
            <div style={sectionDescStyle}>
              {t('프로파일의 SQL 은 값 대신')} <code style={codeStyle}>?</code>{' '}
              {t('로 옵니다. 값을 문장에 채워 넣으면 그대로 복사해 DB 에 붙일 수 있습니다.')}
            </div>
            {([
              ['inline', t('문장에 채워서 보기'), t('예) where id=126')],
              ['separate', t('값을 따로 보기'), t('예) where id=? · 바인딩 126')],
            ] as const).map(([mode, label, hint]) => {
              const on = mode === 'inline' ? bindInline : !bindInline;
              return (
                <label key={mode} style={radioRowStyle}>
                  <input
                    type="radio"
                    name="sql-bind"
                    checked={on}
                    onChange={() => setBindInline(mode === 'inline')}
                  />
                  <span style={{ color: on ? T.text : T.textDim }}>{label}</span>
                  <span style={{ color: T.textFaint, fontSize: F.micro }}>{hint}</span>
                </label>
              );
            })}
          </div>

          {/* 단축키 — **적어 두지 않으면 없는 기능이다.** 목록은 판정 코드가 그대로 준다 */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>{t('단축키')}</div>
            <div style={sectionDescStyle}>
              {t('입력칸에 글자를 치는 중에는 동작하지 않습니다. Esc 는 그 칸에서 빠져나옵니다.')}
            </div>
            <div style={{ marginTop: 8 }}>
              {SHORTCUT_HELP.map(row => (
                <div key={row.keys} style={pathRowStyle}>
                  <span style={{ ...pathLabelStyle, fontFamily: FONT_MONO }}>{row.keys}</span>
                  <span style={pathValueStyle}>{t(SHORTCUT_LABEL[row.action])}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 현재 경로 정보 */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>{t('현재 저장 경로')}</div>
            <div style={pathRowStyle}>
              <span style={pathLabelStyle}>{t('설정 파일')}</span>
              <span style={pathValueStyle}>
                {dataDir.trim()
                  ? `${dataDir.trim()}\\config.json`
                  : `${t('(실행파일 경로)')}\\config.json`}
              </span>
            </div>
            <div style={pathRowStyle}>
              <span style={pathLabelStyle}>{t('로그 파일')}</span>
              <span style={pathValueStyle}>
                {dataDir.trim()
                  ? `${dataDir.trim()}\\logs\\nscouter.log`
                  : `${t('(실행파일 경로)')}\\logs\\nscouter.log`}
              </span>
            </div>
            <div style={{ ...sectionDescStyle, marginTop: 8, color: T.warn }}>
              {t('※ 경로 변경은 앱 재시작 후 적용됩니다.')}
            </div>
          </div>

          {/* 마지막 접속 정보 (읽기 전용) */}
          {(config.last_host || config.last_port || config.last_user) && (
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>{t('마지막 접속 정보')}</div>
              <div style={pathRowStyle}>
                <span style={pathLabelStyle}>{t('호스트')}</span>
                <span style={pathValueStyle}>{config.last_host ?? '-'}</span>
              </div>
              <div style={pathRowStyle}>
                <span style={pathLabelStyle}>{t('포트')}</span>
                <span style={pathValueStyle}>{config.last_port ?? '-'}</span>
              </div>
              <div style={pathRowStyle}>
                <span style={pathLabelStyle}>{t('사용자')}</span>
                <span style={pathValueStyle}>{config.last_user ?? '-'}</span>
              </div>
            </div>
          )}

          {error && <div style={errorStyle}>{error}</div>}
        </div>

        {/* 푸터 */}
        <div style={modalFooterStyle}>
          {saved && <span style={{ color: T.success, fontSize: F.body }}>{t('저장 완료')}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={cancelBtnStyle}>{t('취소')}</button>
            <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
              {saving ? t('저장 중…') : t('저장')}
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
  background: T.bgRaised,
  border: '1px solid #1e1e3a',
  borderRadius: 8,
  width: 500,
  maxWidth: '90vw',
  // **높이를 창 안에 가둔다.** 글자 크기를 키우면 내용이 길어져 저장 버튼이
  // 창 밖으로 밀려났다 — 설정을 바꾸고도 저장할 수가 없었다.
  maxHeight: '90vh',
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
  fontSize: F.base,
  fontWeight: 700,
  color: T.text,
  letterSpacing: 0.3,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: T.textFaint,
  fontSize: F.base,
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 4,
  lineHeight: 1,
};

const modalBodyStyle: React.CSSProperties = {
  // 넘치는 건 본문이 스크롤한다. 머리말과 버튼 줄은 늘 보인다.
  overflowY: 'auto',
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
  fontSize: F.small,
  fontWeight: 700,
  color: T.textMuted,
  letterSpacing: 1,
  textTransform: 'uppercase',
  marginBottom: 2,
};

const sectionDescStyle: React.CSSProperties = {
  fontSize: F.small,
  color: T.textFaint,
  lineHeight: 1.6,
};

/** 라디오 한 줄 — 이름표와 예시를 같은 줄에 둔다 */
const radioRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  padding: '3px 0',
  cursor: 'pointer',
};

const codeStyle: React.CSSProperties = {
  background: T.bgHover,
  padding: '1px 5px',
  borderRadius: 3,
  fontFamily: 'monospace',
  fontSize: F.small,
  color: T.textMuted,
};

const inputStyle: React.CSSProperties = {
  background: T.bgSurface,
  border: '1px solid #252542',
  borderRadius: 4,
  color: T.text,
  padding: '7px 10px',
  fontSize: F.body,
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
  fontSize: F.small,
  color: T.textFaint,
  width: 60,
  flexShrink: 0,
  paddingTop: 1,
};

const pathValueStyle: React.CSSProperties = {
  fontSize: F.small,
  color: T.textDim,
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
  background: T.bgHover,
  border: '1px solid #252542',
  borderRadius: 4,
  color: T.textMuted,
  fontSize: F.body,
  padding: '5px 16px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const scaleBtnStyle: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: 4,
  border: `1px solid ${T.border}`,
  cursor: 'pointer',
  lineHeight: 1.2,
};

const saveBtnStyle: React.CSSProperties = {
  background: T.accent,
  border: '1px solid #4f72ff',
  borderRadius: 4,
  color: T.text,
  fontSize: F.body,
  padding: '5px 20px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontWeight: 600,
};

const errorStyle: React.CSSProperties = {
  fontSize: F.body,
  color: T.error,
  background: 'rgba(255,77,79,0.08)',
  border: '1px solid rgba(255,77,79,0.2)',
  borderRadius: 4,
  padding: '6px 10px',
};
