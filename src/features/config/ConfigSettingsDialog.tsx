// 설정 창 — 에이전트 · 콜렉터
//
// 둘은 커맨드만 다르고 모양이 같다 (`GET/LIST/SET_CONFIGURE_WAS` ↔ `…_SERVER`, 바이트코드로 확인).
// 그래서 창도 하나다 — 에이전트 설정을 익힌 사람이 콜렉터 설정 앞에서 다시 배울 것이 없어야 한다.
//
// 보기 두 가지:
//   · **설정** (기본) — 구역·한국어 이름·설명이 붙은 편집 화면 (`SettingsForm`)
//   · **원문** — 설정 파일 그대로. 줄 이음·주석을 손으로 다듬는 사람에게는 여전히 이쪽이 낫다

import { memo, useCallback, useEffect, useState } from 'react';
import {
  getAgentConfig,
  getServerConfig,
  saveAgentConfig,
  saveServerConfig,
} from '../xlog/api/scouterApi';
import type { ConfigView } from '../xlog/types/config';
import { ConfigEditor } from '../xlog/components/ConfigEditor';
import type { ConfigScope } from './catalog/types';
import { SettingsForm } from './SettingsForm';
import { scopeOfObjType } from './settingsModel';
import { t } from '../../i18n';

export type ConfigTarget =
  | { kind: 'agent'; objHash: number; objName: string; objType: string }
  | { kind: 'collector'; name: string };

interface ConfigSettingsDialogProps {
  target: ConfigTarget;
  onClose: () => void;
}

export const ConfigSettingsDialog = memo(function ConfigSettingsDialog({
  target,
  onClose,
}: ConfigSettingsDialogProps) {
  const [data, setData] = useState<ConfigView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'form' | 'text'>('form');
  const [editingText, setEditingText] = useState(false);
  const [query, setQuery] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [showInternal, setShowInternal] = useState(false);

  const scope: ConfigScope = target.kind === 'collector' ? 'server' : scopeOfObjType(target.objType);
  const targetName = target.kind === 'collector' ? target.name : target.objName;
  const agentHash = target.kind === 'agent' ? target.objHash : null;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    (agentHash === null ? getServerConfig() : getAgentConfig(agentHash))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [agentHash]);

  useEffect(() => load(), [load]);

  const save = useCallback(
    (text: string) => (agentHash === null ? saveServerConfig(text) : saveAgentConfig(agentHash, text)),
    [agentHash],
  );

  // Esc 로 닫는다. 고친 것이 있을 때 실수로 닫히는 것은 저장 줄이 막지 못하므로,
  // **입력 칸 안에서는 닫지 않는다** — 값을 지우려고 Esc 를 누르는 사람이 있다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title = target.kind === 'collector' ? t('콜렉터 설정') : t('에이전트 설정');
  const scopeName =
    scope === 'server' ? t('콜렉터') : scope === 'host' ? t('호스트 에이전트') : t('자바 에이전트');

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={`${title} — ${targetName}`}
        className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-line-strong bg-raised shadow-2xl"
      >
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-overlay px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="text-title font-semibold text-fg">{title}</h2>
            <p className="truncate text-micro text-fg-dim">
              <span className="font-mono">{targetName}</span> · {scopeName}
            </p>
          </div>
          <div className="flex-1" />

          {mode === 'form' && (
            <>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('이름·설명·키로 찾기')}
                aria-label={t('설정 찾기')}
                className="w-64 rounded border border-line-strong bg-input px-2 py-1 text-small text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
              />
              <label className="flex items-center gap-1.5 text-small text-fg-dim">
                <input type="checkbox" checked={changedOnly} onChange={e => setChangedOnly(e.target.checked)} />
                {t('기본값과 다른 것만')}
              </label>
              <label
                className="flex items-center gap-1.5 text-small text-fg-dim"
                title={t('_ 로 시작하는 항목입니다. 대개 공식 설명이 없고 일상적으로 고칠 것이 아닙니다. 기본값과 다르게 되어 있으면 이 스위치와 무관하게 보입니다.')}
              >
                <input type="checkbox" checked={showInternal} onChange={e => setShowInternal(e.target.checked)} />
                {t('내부 항목')}
              </label>
            </>
          )}

          {!editingText && (
            <div className="flex items-center gap-0.5 rounded border border-line-strong p-0.5">
              {(['form', 'text'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`rounded px-2 py-0.5 text-small ${
                    mode === m ? 'bg-accent text-white' : 'text-fg-dim hover:bg-hover hover:text-fg'
                  }`}
                >
                  {m === 'form' ? t('설정') : t('원문')}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={onClose}
            aria-label={t('닫기')}
            className="rounded px-2 py-1 text-fg-dim hover:bg-hover hover:text-fg"
          >
            ✕
          </button>
        </header>

        {loading && <Note>{t('조회 중…')}</Note>}
        {!loading && error && <Note tone="danger">{error}</Note>}
        {!loading && !error && data && data.entries.length === 0 && mode === 'form' && (
          // **빈 목록을 «설정 없음» 으로 읽으면 안 된다.** 콜렉터가 에이전트에 되물어 오는 것이라
          // 에이전트가 답하지 않으면 오류가 아니라 빈 응답이 온다 (F-37).
          <Note>{t('설정 항목을 받지 못했습니다. 에이전트가 응답하지 않았을 수 있습니다.')}</Note>
        )}

        {!loading && !error && data && mode === 'form' && data.entries.length > 0 && (
          <SettingsForm
            scope={scope}
            data={data}
            targetName={targetName}
            save={save}
            onSaved={load}
            query={query}
            changedOnly={changedOnly}
            showInternal={showInternal}
          />
        )}

        {!loading && !error && data && mode === 'text' && (
          editingText ? (
            <ConfigEditor
              targetName={targetName}
              text={data.text}
              save={save}
              onSaved={() => {
                setEditingText(false);
                load();
              }}
              onCancel={() => setEditingText(false)}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-1.5">
                <span className="text-micro text-fg-faint">
                  {t('설정 파일 그대로입니다. 줄 이음·주석을 손으로 다듬을 때 씁니다.')}
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => setEditingText(true)}
                  title={t('설정 파일을 통째로 바꿉니다')}
                  className="rounded border border-line-strong px-2 py-0.5 text-small text-fg-dim hover:bg-hover hover:text-fg"
                >
                  {t('원문 편집')}
                </button>
              </div>
              {data.text ? (
                <pre className="min-h-0 flex-1 overflow-auto px-4 py-2 font-mono text-micro leading-relaxed whitespace-pre-wrap text-fg">
                  {data.text}
                </pre>
              ) : (
                <Note>{t('설정 파일이 없습니다. 기본값으로 동작 중입니다.')}</Note>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
});

function Note({ children, tone }: { children: React.ReactNode; tone?: 'danger' }) {
  return (
    <p className={`px-4 py-10 text-center text-small ${tone ? 'text-danger' : 'text-fg-faint'}`}>{children}</p>
  );
}
