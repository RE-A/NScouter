// 조회 조건 창
//
// **툴바 한 줄로는 두 줄짜리 조건을 못 만든다.** 운영에서 하는 말은
// «이 두 URL 만» 이거나 «헬스체크·모니터링은 빼고» 인데, 칸이 하나면 정규식을 배우게
// 하거나 매번 지우고 다시 쓰게 된다.
//
// 규칙은 하나다 — **자리 안에서는 OR, 자리끼리는 AND**.
//   · 서비스 포함 두 줄 → 둘 중 하나만 맞으면 통과 (둘 다 만족은 애초에 불가능하다)
//   · 서비스 제외 두 줄 → 하나라도 맞으면 뺀다
//   · 서비스 조건과 IP 조건은 둘 다 만족해야 한다
// 이 문장을 창 안에 적어 둔다. 규칙을 모르면 결과를 못 읽는다.

import { memo, useState } from 'react';
import type { FilterField, PatternRule, XLogFilterState } from '../types/xlog';
import { isSame, toPatch, type SavedFilter } from './savedFilters';
import { t } from '../../../i18n';

interface FilterDialogProps {
  filter: XLogFilterState;
  onChange: (patch: Partial<XLogFilterState>) => void;
  onClose: () => void;
  /** 지금 고른 서버 수 — 여기서는 바꾸지 않고 어디서 바꾸는지만 알려 준다 */
  selectedServers: number;
  /** 담아 둔 조건들 */
  saved: readonly SavedFilter[];
  /** 지금 조건을 이 이름으로 담는다 (같은 이름이면 덮어쓴다) */
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
}

const FIELDS: { field: FilterField; label: string; placeholder: string }[] = [
  { field: 'service', label: '서비스', placeholder: 'URL 일부' },
  { field: 'ip', label: 'IP', placeholder: '10.89.' },
];

export const FilterDialog = memo(function FilterDialog({
  filter,
  onChange,
  onClose,
  selectedServers,
  saved,
  onSave,
  onDelete,
}: FilterDialogProps) {
  /** 담을 이름. 불러온 뒤 그 이름을 채워 두면 «고쳐서 다시 담기» 가 한 번에 된다 */
  const [saveName, setSaveName] = useState('');
  /** 방금 추가한 줄에 바로 칠 수 있게, 마지막에 넣은 자리를 기억한다 */
  const [focusIdx, setFocusIdx] = useState<number | null>(null);

  const setPatterns = (next: PatternRule[]) => onChange({ patterns: next });

  const add = (field: FilterField, exclude: boolean) => {
    setPatterns([...filter.patterns, { field, text: '', exclude }]);
    setFocusIdx(filter.patterns.length);
  };

  const update = (idx: number, patch: Partial<PatternRule>) =>
    setPatterns(filter.patterns.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const remove = (idx: number) => setPatterns(filter.patterns.filter((_, i) => i !== idx));

  const activeCount = filter.patterns.filter(r => r.text.trim() !== '').length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose();
        }}
        className="max-h-[85vh] w-[40rem] overflow-y-auto rounded border border-line-strong bg-surface p-4"
      >
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-body font-semibold text-fg">{t('조회 조건')}</h2>
          <button
            onClick={onClose}
            aria-label={t('닫기')}
            className="rounded px-1 text-micro text-fg-faint hover:bg-hover hover:text-fg"
          >
            ✕
          </button>
        </div>

        {/* **규칙을 적어 둔다.** 모르면 결과를 못 읽는다 */}
        <p className="mb-3 text-micro text-fg-dim">
          {t('같은 자리의 포함은 하나만 맞아도 통과, 제외는 하나라도 맞으면 뺍니다. 서비스와 IP 는 둘 다 만족해야 합니다.')}
        </p>

        {FIELDS.map(({ field, label, placeholder }) => {
          const rows = filter.patterns
            .map((r, idx) => ({ r, idx }))
            .filter(({ r }) => r.field === field);

          return (
            <section key={field} className="mb-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-micro tracking-wide text-fg-dim uppercase">{t(label)}</span>
                <button
                  onClick={() => add(field, false)}
                  className="rounded border border-line px-1.5 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
                >
                  + {t('포함')}
                </button>
                <button
                  onClick={() => add(field, true)}
                  className="rounded border border-line px-1.5 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
                >
                  + {t('제외')}
                </button>
              </div>

              {rows.length === 0 ? (
                <p className="px-1 text-micro text-fg-faint">{t('조건 없음 — 전부 통과합니다')}</p>
              ) : (
                <ul className="space-y-1">
                  {rows.map(({ r, idx }) => (
                    <li key={idx} className="flex items-center gap-1">
                      {/* 포함·제외는 **누르면 바뀐다.** 라디오 두 개를 줄마다 두면 창이 가득 찬다 */}
                      <button
                        onClick={() => update(idx, { exclude: !r.exclude })}
                        aria-pressed={r.exclude}
                        title={t('포함과 제외를 바꿉니다')}
                        className={`w-12 shrink-0 rounded border px-1 py-0.5 text-micro ${
                          r.exclude
                            ? 'border-warn/60 text-warn'
                            : 'border-accent/60 text-accent'
                        }`}
                      >
                        {r.exclude ? t('제외') : t('포함')}
                      </button>
                      <input
                        type="text"
                        autoFocus={focusIdx === idx}
                        value={r.text}
                        spellCheck={false}
                        placeholder={placeholder}
                        onChange={e => update(idx, { text: e.target.value })}
                        className="min-w-0 flex-1 rounded border border-line-strong bg-input px-2 py-0.5 text-body text-fg placeholder:text-fg-faint"
                      />
                      <button
                        onClick={() => remove(idx)}
                        aria-label={`${t(label)} ${idx + 1} ${t('지우기')}`}
                        className="shrink-0 rounded px-1 text-micro text-fg-faint hover:text-danger"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        {/* 수치·플래그 조건 */}
        <section className="mb-3 border-t border-line pt-3">
          <div className="mb-1 text-micro tracking-wide text-fg-dim uppercase">{t('응답시간·에러')}</div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1 text-body text-fg-muted">
              <input
                type="checkbox"
                checked={filter.errorOnly}
                onChange={e => onChange({ errorOnly: e.target.checked })}
              />
              {t('에러만')}
            </label>

            <div className="flex items-center gap-1">
              <button
                onClick={() => onChange({ elapsedExclude: !filter.elapsedExclude })}
                aria-pressed={filter.elapsedExclude}
                className="rounded border border-line-strong px-1.5 py-0.5 text-micro text-fg-muted hover:bg-hover hover:text-fg"
              >
                {filter.elapsedExclude ? t('미만') : t('이상')}
              </button>
              <input
                type="number"
                min={0}
                step={0.1}
                value={filter.elapsedMs === 0 ? '' : filter.elapsedMs / 1000}
                placeholder="0"
                onChange={e => {
                  const sec = Number(e.target.value);
                  onChange({
                    elapsedMs: Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : 0,
                  });
                }}
                className="w-20 rounded border border-line-strong bg-input px-2 py-0.5 text-body text-fg"
              />
              <span className="text-micro text-fg-faint">{t('초')}</span>
            </div>
          </div>
        </section>

        {/* 서버는 여기서 바꾸지 않는다 — 왼쪽 목록이 그 일을 한다.
            두 곳에서 같은 것을 바꾸면 어느 쪽이 이겼는지 알 수 없다. */}
        <p className="mb-3 text-micro text-fg-faint">
          {t('대상 서버')}:{' '}
          {selectedServers === 0
            ? t('전체 — 왼쪽 목록에서 고릅니다')
            : `${selectedServers}${t('개 — 왼쪽 목록에서 바꿉니다')}`}
        </p>

        {/* 담아 두기 — 장애를 볼 때 거는 조건은 매번 새로 짜는 것이 아니라
            «결제만»·«헬스체크 빼고» 처럼 몇 벌이 돌아가며 쓰인다 */}
        <section className="mb-3 border-t border-line pt-3">
          <div className="mb-1 text-micro tracking-wide text-fg-dim uppercase">{t('담아 둔 조건')}</div>

          {saved.length === 0 ? (
            <p className="mb-2 px-1 text-micro text-fg-faint">
              {t('아직 없습니다. 지금 조건에 이름을 붙여 담아 두면 다음에 한 번에 불러옵니다.')}
            </p>
          ) : (
            <ul className="mb-2 max-h-40 space-y-0.5 overflow-y-auto">
              {saved.map(f => {
                const on = isSame(f, filter);
                return (
                  <li key={f.name} className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        onChange(toPatch(f));
                        // 이름을 채워 둔다 — 고쳐서 같은 이름으로 다시 담는 흐름이 잦다
                        setSaveName(f.name);
                      }}
                      className={`min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-micro hover:bg-hover ${
                        on ? 'text-fg' : 'text-fg-muted'
                      }`}
                    >
                      {/* **지금 걸린 것과 같으면 표시한다.** 목록만 보면 무엇이 걸려 있는지 모른다 */}
                      {on ? '● ' : ''}
                      {f.name}
                      <span className="ml-2 text-fg-faint">
                        {f.patterns.length}
                        {t('줄')}
                        {f.errorOnly ? ` · ${t('에러만')}` : ''}
                        {f.elapsedMs > 0
                          ? ` · ${f.elapsedExclude ? '<' : '≥'}${(f.elapsedMs / 1000).toLocaleString()}s`
                          : ''}
                      </span>
                    </button>
                    <button
                      onClick={() => onDelete(f.name)}
                      aria-label={`${f.name} ${t('지우기')}`}
                      className="shrink-0 rounded px-1 text-micro text-fg-faint hover:text-danger"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center gap-1">
            <input
              type="text"
              value={saveName}
              spellCheck={false}
              placeholder={t('이름 (예: 결제만)')}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && saveName.trim() !== '') onSave(saveName);
              }}
              className="min-w-0 flex-1 rounded border border-line-strong bg-input px-2 py-0.5 text-body text-fg placeholder:text-fg-faint"
            />
            <button
              onClick={() => onSave(saveName)}
              disabled={saveName.trim() === ''}
              title={t('같은 이름이면 덮어씁니다')}
              className="shrink-0 rounded border border-accent px-2 py-0.5 text-micro text-accent hover:bg-hover disabled:cursor-not-allowed disabled:border-line disabled:text-fg-faint"
            >
              {saved.some(f => f.name === saveName.trim()) ? t('덮어쓰기') : t('담기')}
            </button>
          </div>
        </section>

        <div className="flex items-center justify-between border-t border-line pt-3">
          <button
            onClick={() =>
              onChange({ patterns: [], errorOnly: false, elapsedMs: 0, elapsedExclude: false })
            }
            className="rounded border border-line px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
          >
            {t('조건 모두 지우기')}
          </button>
          <span className="text-micro text-fg-faint">
            {activeCount}
            {t('줄 걸려 있음')}
          </span>
        </div>
      </div>
    </div>
  );
});
