// 프로파일 본문 검색 막대
//
// **선택한 구간 안에서만 찾는다.** 트랜잭션 한 건이 요청 하나라 범위가 곧 비용이다 —
// 화면 전체를 훑으면 수천 건이고 수십 초가 걸린다.

import { memo, useState } from 'react';
import type { ProfileSearchState } from '../hooks/useProfileSearch';
import { t } from '../../../i18n';

interface XLogSearchBarProps {
  /** 훑을 대상 수. 0 이면 검색할 수 없다 */
  targetCount: number;
  state: ProfileSearchState;
  onRun: (query: string) => void;
  onCancel: () => void;
  onClear: () => void;
}

export const XLogSearchBar = memo(function XLogSearchBar({
  targetCount,
  state,
  onRun,
  onCancel,
  onClear,
}: XLogSearchBarProps) {
  const [draft, setDraft] = useState('');
  const disabled = targetCount === 0;
  const canRun = !disabled && draft.trim() !== '' && !state.running;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-1">
      <span className="text-micro text-fg-dim">{t('프로파일 검색')}</span>

      <input
        type="text"
        value={draft}
        spellCheck={false}
        disabled={disabled}
        placeholder={disabled ? t('먼저 차트에서 구간을 드래그하세요') : t('SQL·예외·URL 일부')}
        title={t('선택한 구간의 트랜잭션 프로파일 안에서 찾습니다')}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && canRun) onRun(draft);
          if (e.key === 'Escape' && state.running) onCancel();
        }}
        className="w-56 rounded border border-line-strong bg-input px-2 py-0.5 text-body text-fg placeholder:text-fg-faint disabled:cursor-not-allowed disabled:text-fg-faint"
      />

      {state.running ? (
        <button
          onClick={onCancel}
          className="rounded border border-line-strong px-2 py-0.5 text-micro text-warn hover:bg-hover"
        >
          {t('중단')}
        </button>
      ) : (
        <button
          onClick={() => onRun(draft)}
          disabled={!canRun}
          className="rounded border border-line-strong px-2 py-0.5 text-micro text-accent hover:bg-hover disabled:cursor-not-allowed disabled:text-fg-faint"
        >
          {t('검색')}
        </button>
      )}

      {/* 무엇을 훑는지 늘 보인다 — 비용이 곧 범위라 숫자를 숨기면 안 된다 */}
      {!disabled && !state.progress && (
        <span className="text-micro text-fg-faint">{t('선택')} {targetCount.toLocaleString()}{t('건 대상')}</span>
      )}

      {state.progress && (
        <span className="tnum font-mono text-micro text-fg-dim">
          {state.progress.done.toLocaleString()} / {state.progress.total.toLocaleString()}
          {state.running ? t(' 훑는 중…') : t(' 완료')} · {t('적중')} {state.hits.length.toLocaleString()}{t('건')}
          {/* 못 읽은 건을 조용히 빼면 "안 걸렸다"와 구별되지 않는다 */}
          {state.progress.failed > 0 && (
            <span className="text-warn"> · {t('못 읽음')} {state.progress.failed.toLocaleString()}</span>
          )}
        </span>
      )}

      {state.error && <span className="text-micro text-danger">{state.error}</span>}

      {state.query !== '' && !state.running && (
        <button
          onClick={onClear}
          className="rounded px-1.5 py-0.5 text-micro text-fg-faint hover:bg-hover hover:text-fg"
        >
          {t('검색 해제')}
        </button>
      )}
    </div>
  );
});
