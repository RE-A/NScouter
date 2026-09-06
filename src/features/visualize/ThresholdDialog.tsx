// 임계값 창 — 어떤 수부터 노랗고 어떤 수부터 빨간지 정한다.
//
// 여기가 설정 창(`SettingsDialog`)이 아닌 이유: 임계는 **보면서 정하는 값**이다.
// 지금 CPU 가 62% 인 걸 보고 «70이면 되겠다» 고 판단하는데, 그 숫자가 다른 창에
// 묻혀 있으면 화면을 오가며 맞춰야 한다.
//
// 저장은 설정 창과 같은 방식이다 — `config.json` 을 읽어 이 항목만 얹어 다시 쓴다.

import { memo, useCallback, useEffect, useState } from 'react';
import { getConfig, saveConfig } from '../xlog/api/scouterApi';
import { KPI_DEFS, type KpiId } from './kpi';
import { DEFAULT_THRESHOLDS, fromThresholds, type ThresholdMap } from './threshold';
import {
  draftState,
  rowError,
  toDraft,
  toMap,
  type Draft,
  type DraftMap,
} from './thresholdDraft';
import { t } from '../../i18n';

interface ThresholdDialogProps {
  value: ThresholdMap;
  /** 저장에 성공하면 부른다. 화면은 이 값으로 바로 바뀐다 */
  onApply: (next: ThresholdMap) => void;
  onClose: () => void;
}

export const ThresholdDialog = memo(function ThresholdDialog({
  value,
  onApply,
  onClose,
}: ThresholdDialogProps) {
  const [draft, setDraft] = useState<DraftMap>(() => toDraft(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const patch = (id: KpiId, next: Partial<Draft>) =>
    setDraft(prev => ({ ...prev, [id]: { ...prev[id], ...next } }));

  const { unfinished, blocked } = draftState(draft);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    const next = toMap(draft);
    try {
      // 설정 파일에는 이 항목 말고도 많은 것이 들어 있다. 읽어서 얹어야
      // 다른 창이 방금 저장한 것을 지우지 않는다.
      const cfg = await getConfig();
      await saveConfig({ ...cfg, kpi_thresholds: fromThresholds(next) });
      onApply(next);
      onClose();
    } catch (e) {
      // **닫지 않는다.** 닫아 버리면 적어 둔 수가 사라진 채로 «저장 안 됨» 만 남는다.
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [draft, onApply, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="max-h-[85vh] w-[34rem] overflow-y-auto rounded border border-line-strong bg-surface p-4"
      >
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-body font-semibold text-fg">{t('지표 임계값')}</h2>
          <button
            onClick={onClose}
            aria-label={t('닫기')}
            className="rounded px-1 text-fg-dim hover:text-fg"
          >
            ✕
          </button>
        </div>
        <p className="mb-3 text-micro text-fg-faint">
          {t('값이 주의 이상이면 노랑, 위험 이상이면 빨강으로 표시합니다. 끄면 색을 쓰지 않습니다 — 사이트마다 정상 범위가 달라 TPS·액티브는 기본이 꺼져 있습니다.')}
        </p>

        <div className="mb-3">
          {KPI_DEFS.map(def => {
            const row = draft[def.id];
            const err = rowError(row);
            return (
              <div key={def.id} className="border-b border-line py-1.5 last:border-b-0">
                <div className="flex items-center gap-2">
                  <label className="flex w-32 shrink-0 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={e => patch(def.id, { enabled: e.target.checked })}
                    />
                    <span className={`text-small ${row.enabled ? 'text-fg' : 'text-fg-faint'}`}>
                      {t(def.label)}
                    </span>
                  </label>

                  <span className="w-10 shrink-0 text-right text-micro text-fg-dim">{t('주의')}</span>
                  <input
                    value={row.warn}
                    onChange={e => patch(def.id, { warn: e.target.value })}
                    disabled={!row.enabled}
                    inputMode="decimal"
                    spellCheck={false}
                    className="w-20 rounded border border-line bg-input px-1.5 py-0.5 text-right text-small text-fg tabular-nums disabled:text-fg-faint"
                  />

                  <span className="w-10 shrink-0 text-right text-micro text-fg-dim">{t('위험')}</span>
                  <input
                    value={row.danger}
                    onChange={e => patch(def.id, { danger: e.target.value })}
                    disabled={!row.enabled}
                    inputMode="decimal"
                    spellCheck={false}
                    className="w-20 rounded border border-line bg-input px-1.5 py-0.5 text-right text-small text-fg tabular-nums disabled:text-fg-faint"
                  />

                  <span className="w-8 shrink-0 text-micro text-fg-faint">{def.unit}</span>
                </div>
                {err && <p className="mt-0.5 pl-6 text-micro text-danger">{t(err)}</p>}
              </div>
            );
          })}
        </div>

        {error && <p className="mb-2 text-micro text-danger">{error}</p>}

        <div className="flex items-center justify-between border-t border-line pt-3">
          <button
            onClick={() => setDraft(toDraft(DEFAULT_THRESHOLDS))}
            className="rounded border border-line px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
          >
            {t('기본값으로')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || blocked}
            // 눌리지 않는 버튼은 이유를 말해야 한다. 어느 줄이 남았는지는 그 줄이 비어 있어 보인다.
            title={unfinished ? t('켜 둔 지표 중 빈 칸이 있습니다') : undefined}
            className="rounded border border-accent px-3 py-0.5 text-micro text-accent hover:bg-hover disabled:cursor-not-allowed disabled:border-line disabled:text-fg-faint"
          >
            {saving ? t('저장 중…') : t('저장')}
          </button>
        </div>

        {/* **적어 둔 자리를 말해 준다.** 손으로 고칠 수 있는 파일이고,
            여러 대에 같은 기준을 깔 때는 그쪽이 빠르다. */}
        <p className="mt-2 text-micro text-fg-faint">
          {t('config.json 의')} <code className="font-mono">kpi_thresholds</code>{' '}
          {t('에 저장됩니다.')}
        </p>
      </div>
    </div>
  );
});
