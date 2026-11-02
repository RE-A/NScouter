// 차트 모양 설정 — Y축 · 범위 · Y최대 · 밀집. 판 머리의 «차트 ▾» 단추 하나에 모은다.
//
// **조건과 나눈다.** 예전에는 툴바 두 줄째에 «응답 이상 n초»(거르는 것)와 나란히 있어서, 무엇이
// 점을 거르고 무엇이 그리는 모양만 바꾸는지 구분이 안 됐다. 거르는 것은 툴바에, 그리는 모양은
// 그 그림(판) 머리에 둔다 — 화면을 나눴을 때도 판마다 따로라는 것이 자리로 보인다.
//
// 단추 글에 **지금 값**을 적는다(`Elapsed · 5분`). 접어 둔 설정이 무엇인지 안 열어도 안다.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { XLogChartConfig, YAxisMode } from '../types/xlog';
import { Y_AXIS_CONFIGS, yAxisShortLabel } from '../types/xlog';
import { Y_MAX_PRESETS_SEC } from '../engine/yScale';
import { Button } from '../../../components/Button';
import { t } from '../../../i18n';

export const Y_AXIS_OPTIONS: YAxisMode[] = [
  'elapsed', 'cpu', 'sqlTime', 'sqlCount', 'apiCallTime', 'apiCallCount', 'heapUsed',
];

export const TIME_RANGE_OPTIONS: readonly { ms: number; label: string }[] = [
  { ms: 60_000, label: '1분' },
  { ms: 300_000, label: '5분' },
  { ms: 600_000, label: '10분' },
  { ms: 1_800_000, label: '30분' },
];

/** 단추에 적을 범위 — 목록에 없는 값(예전 설정)이면 분으로 */
export function rangeLabel(ms: number): string {
  const hit = TIME_RANGE_OPTIONS.find(o => o.ms === ms);
  return hit ? t(hit.label) : `${Math.round(ms / 60_000)}${t('분')}`;
}

/**
 * 고르기 상자. `px-1.5` 가 기본 스타일의 오른쪽 여백(직접 그린 화살표 자리, index.css)을
 * 덮어써서 `5분` 같은 짧은 값이 화살표 밑으로 들어갔다. 오른쪽만 되살린다.
 */
const SELECT = 'rounded border border-line-control bg-input px-1.5 py-0.5 pr-[26px] text-body text-fg';

export function XLogChartSettings({
  config,
  onConfigChange,
  /** 실시간이면 범위를 고를 수 있다. 과거 구간은 툴바의 시각이 정한다 */
  live,
}: {
  config: XLogChartConfig;
  onConfigChange: (patch: Partial<XLogChartConfig>) => void;
  live: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 판 머리는 넘치는 것을 자르는 상자 안이라 **화면 기준(fixed)** 으로 띄운다
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const b = btnRef.current.getBoundingClientRect();
    const w = panelRef.current?.offsetWidth ?? 240;
    setPos({ left: Math.max(8, Math.min(b.right - w, window.innerWidth - 8 - w)), top: b.bottom + 4 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const n = e.target as Node | null;
      if (n && (panelRef.current?.contains(n) || btnRef.current?.contains(n))) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <Button
        ref={btnRef}
        variant="ghost"
        size="xs"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(v => !v)}
        title={t('Y축·범위·Y최대·밀집 — 점을 거르지 않고 그리는 모양만 바꿉니다')}
        className="normal-case"
      >
        <span className="text-fg-muted">{yAxisShortLabel(config.yAxisMode)}</span>
        {live && <span className="text-fg-faint">· {rangeLabel(config.timeRangeMs)}</span>}
        {config.showDensity && <span className="text-fg-faint">· {t('밀집')}</span>}
        <span aria-hidden className="text-fg-faint">▾</span>
      </Button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t('차트 설정')}
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0 }}
          className="fixed z-50 grid w-60 grid-cols-[4rem_1fr] items-center gap-x-2 gap-y-2 rounded border border-line-strong bg-overlay p-3 text-micro text-fg-dim shadow-lg"
        >
          <label htmlFor="xlog-y-axis">{t('Y축')}</label>
          <select
            id="xlog-y-axis"
            className={SELECT}
            title={t('점의 높이를 무엇으로 볼지. 응답시간·CPU·SQL 시간·SQL 건수 등')}
            value={config.yAxisMode}
            onChange={e => onConfigChange({ yAxisMode: e.target.value as YAxisMode })}
          >
            {Y_AXIS_OPTIONS.map(mode => (
              <option key={mode} value={mode}>
                {Y_AXIS_CONFIGS[mode].label}
              </option>
            ))}
          </select>

          {live && (
            <>
              <label htmlFor="xlog-range">{t('범위')}</label>
              <select
                id="xlog-range"
                className={SELECT}
                title={t('가로축이 담는 시간. 좁힐수록 점이 덜 겹친다')}
                value={config.timeRangeMs}
                onChange={e => onConfigChange({ timeRangeMs: Number(e.target.value) })}
              >
                {TIME_RANGE_OPTIONS.map(o => (
                  <option key={o.ms} value={o.ms}>
                    {t(o.label)}
                  </option>
                ))}
              </select>
            </>
          )}

          {/* 축보다 큰 점은 **천장에 붙어** 그려진다(예전에는 통째로 사라졌다).
              축은 사람이 정한다 — 자동으로 늘리면 튀는 것 하나에 나머지가 바닥에 깔린다.
              Ctrl+휠로도 움직인다. */}
          <label htmlFor="xlog-ymax">{t('Y최대')}</label>
          <select
            id="xlog-ymax"
            className={SELECT}
            title={t('세로축의 최대값. 이보다 큰 것은 맨 위에 붙습니다 (Ctrl+휠로도 조절)')}
            value={String(config.yMax)}
            onChange={e => onConfigChange({ yMax: Number(e.target.value) })}
          >
            {Y_MAX_PRESETS_SEC.map(sec => (
              <option key={sec} value={sec}>
                {sec}{t('초')}
              </option>
            ))}
            {/* 프리셋에 없는 값(Ctrl+휠로 만든 것)도 목록에 보여야 «지금 얼마인지» 를 안다 */}
            {!Y_MAX_PRESETS_SEC.includes(config.yMax as (typeof Y_MAX_PRESETS_SEC)[number]) && (
              <option value={config.yMax}>
                {config.yMax}{t('초')}
              </option>
            )}
          </select>

          {/* 점 하나가 5x5 를 막아 촘촘한 구간에서는 대부분이 안 그려진다 —
              화면은 «여기 좀 있네» 인데 실제로는 한 덩어리다.
              **늘 켜 두지 않는다**: 열이 깔리면 점 색(어느 서버인가)이 읽기 어려워진다. */}
          <span />
          <label
            className="flex cursor-pointer items-center gap-1.5 text-body text-fg-muted hover:text-fg"
            title={t('겹쳐서 안 그려진 것까지 세어 붐비는 자리를 밝기로 보여줍니다')}
          >
            <input
              type="checkbox"
              checked={config.showDensity}
              onChange={e => onConfigChange({ showDensity: e.target.checked })}
            />
            {t('밀집')}
          </label>
        </div>
      )}
    </>
  );
}
