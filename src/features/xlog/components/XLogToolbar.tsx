// src/features/xlog/components/XLogToolbar.tsx

import React, { useEffect, useState } from 'react';
import type { TextFilter, XLogChartConfig, XLogFilterState, YAxisMode } from '../types/xlog';
import { Y_AXIS_CONFIGS } from '../types/xlog';
import type { PastRange, XLogMode } from '../types/timeRange';
import {
  checkRange,
  defaultPastRange,
  fromLocalInput,
  toLocalInput,
} from '../types/timeRange';
import { t } from '../../../i18n';

interface XLogToolbarProps {
  config: XLogChartConfig;
  filter: XLogFilterState;
  onConfigChange: (c: Partial<XLogChartConfig>) => void;
  onFilterChange: (f: Partial<XLogFilterState>) => void;
  mode: XLogMode;
  onModeChange: (m: XLogMode) => void;
  /** 과거 모드에서 실제로 조회 중인 구간. null 이면 아직 조회 안 함 */
  pastRange: PastRange | null;
  onPastRangeChange: (r: PastRange | null) => void;
}

const Y_AXIS_OPTIONS: YAxisMode[] = [
  'elapsed', 'cpu', 'sqlTime', 'sqlCount', 'apiCallTime', 'apiCallCount', 'heapUsed',
];

/**
 * 이전에는 레이블과 값이 같은 밝기(T.text)라 "Y축"과 "응답시간"이 같은 무게로 읽혔다.
 * 레이블은 물러나고 **값만 밝다.** 읽어야 할 건 현재 설정값이지 그 이름이 아니다.
 *
 * 그리고 네 컨트롤을 같은 간격으로 늘어놓으면 관계가 안 보인다.
 * 축·범위(무엇을 그리나)와 에러·최소(무엇을 거르나)를 구분선으로 나눈다.
 */
const CONTROL =
  'rounded border border-line-strong bg-input px-1.5 py-0.5 text-body text-fg';

export function XLogToolbar({
  config,
  filter,
  onConfigChange,
  onFilterChange,
  mode,
  onModeChange,
  pastRange,
  onPastRangeChange,
}: XLogToolbarProps) {
  // 입력 중인 값. **조회를 눌러야** 실제 구간이 된다 —
  // 타이핑할 때마다 수만 건을 다시 받으면 안 된다.
  const [draft, setDraft] = useState<PastRange>(() => defaultPastRange(Date.now()));

  // 휠로 확대하면 구간이 밖에서 바뀐다. 입력칸이 따라가지 않으면
  // 화면이 보여주는 구간과 입력값이 어긋나 어느 쪽이 진짜인지 알 수 없다.
  useEffect(() => {
    if (pastRange) setDraft(pastRange);
  }, [pastRange]);

  const check = checkRange(draft, Date.now());

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-raised px-3 py-1">
      {/* 모드가 나머지 전부의 의미를 바꾸므로 맨 앞이다 */}
      <div className="flex overflow-hidden rounded border border-line-strong">
        {(['live', 'past'] as XLogMode[]).map(m => (
          <button
            key={m}
            onClick={() => {
              onModeChange(m);
              // 실시간으로 돌아가면 과거 조회를 버린다. 남겨두면 다음에 과거로 갈 때
              // 예전 구간이 되살아나 혼란스럽다.
              if (m === 'live') onPastRangeChange(null);
            }}
            aria-pressed={mode === m}
            className={`px-2 py-0.5 text-micro transition-colors ${
              mode === m ? 'bg-accent text-white' : 'text-fg-dim hover:bg-hover hover:text-fg-muted'
            }`}
          >
            {m === 'live' ? t('실시간') : t('과거')}
          </button>
        ))}
      </div>

      {mode === 'past' && (
        <>
          <input
            type="datetime-local"
            value={toLocalInput(draft.stime)}
            onChange={e => {
              const v = fromLocalInput(e.target.value);
              if (v !== null) setDraft(d => ({ ...d, stime: v }));
            }}
            className={CONTROL}
          />
          <span className="text-micro text-fg-faint">→</span>
          <input
            type="datetime-local"
            value={toLocalInput(draft.etime)}
            onChange={e => {
              const v = fromLocalInput(e.target.value);
              if (v !== null) setDraft(d => ({ ...d, etime: v }));
            }}
            className={CONTROL}
          />
          <button
            onClick={() => onPastRangeChange({ ...draft })}
            disabled={!check.ok}
            title={check.reason ?? t('이 구간을 조회합니다')}
            className={`rounded border px-2 py-0.5 text-micro ${
              check.ok
                ? 'border-accent text-accent hover:bg-hover'
                : 'cursor-not-allowed border-line text-fg-faint'
            }`}
          >
            {t('조회')}
          </button>
          {/* 막힌 이유를 말해 주지 않으면 버튼이 왜 안 눌리는지 알 수 없다 */}
          {!check.ok && <span className="text-micro text-warn">{check.reason}</span>}
          {check.ok && pastRange && (
            <span className="text-micro text-fg-faint">
              {new Date(pastRange.stime).toLocaleTimeString('ko-KR', { hour12: false })}~
              {new Date(pastRange.etime).toLocaleTimeString('ko-KR', { hour12: false })}
              {/* 보이지 않는 단축키는 없는 것과 같다 */}
              <span className="ml-2 text-fg-faint">{t('휠=확대 · Shift+휠=이동')}</span>
            </span>
          )}
          <span className="h-4 w-px bg-line" aria-hidden />
        </>
      )}

      <Field label={t('Y축')}>
        <select
          className={CONTROL}
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
      </Field>

      <Field label={t('범위')}>
        <select
          className={CONTROL}
          title={t('가로축이 담는 시간. 좁힐수록 점이 덜 겹친다')}
          value={config.timeRangeMs}
          onChange={e => onConfigChange({ timeRangeMs: Number(e.target.value) })}
        >
          <option value={60_000}>{t('1분')}</option>
          <option value={300_000}>{t('5분')}</option>
          <option value={600_000}>{t('10분')}</option>
          <option value={1_800_000}>{t('30분')}</option>
        </select>
      </Field>

      <span className="h-4 w-px bg-line" aria-hidden />

      <label
        className="flex cursor-pointer items-center gap-1.5 text-body text-fg-muted hover:text-fg"
        title={t('실패한 트랜잭션만 남긴다')}
      >
        <input
          type="checkbox"
          checked={filter.errorOnly}
          onChange={e => onFilterChange({ errorOnly: e.target.checked })}
        />
        {t('에러만')}
      </label>

      {/* 응답시간은 초로 받는다 — Y축이 Elapsed(sec) 라 눈으로 본 값을 그대로 옮기게 된다.
          내부는 ms 다. 0.2 같은 소수도 받으므로 예전 ms 입력이 하던 일을 잃지 않는다. */}
      <Field label={t('응답')}>
        <Direction
          exclude={filter.elapsedExclude}
          onChange={v => onFilterChange({ elapsedExclude: v })}
          onLabel={t('이상')}
          offLabel={t('미만')}
        />
        <input
          type="number"
          className={`${CONTROL} tnum w-16 text-right font-mono`}
          value={filter.elapsedMs === 0 ? '' : filter.elapsedMs / 1000}
          min={0}
          step={0.1}
          placeholder="0"
          title={t('0 이나 빈 칸이면 조건 없음')}
          onChange={e => {
            const sec = Number(e.target.value);
            onFilterChange({ elapsedMs: Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : 0 });
          }}
        />
        <span className="text-micro text-fg-faint">{t('초')}</span>
      </Field>

      <TextCond
        label={t('서비스')}
        value={filter.service}
        placeholder={t('URL 일부')}
        onChange={v => onFilterChange({ service: v })}
      />
      <TextCond
        label="IP"
        value={filter.ip}
        placeholder="10.89."
        onChange={v => onFilterChange({ ip: v })}
      />
    </div>
  );
}

/**
 * 포함/제외 스위치.
 *
 * **켜짐/꺼짐이 아니라 방향이다.** 체크박스로 두면 "제외 해제"가 "조건 없음"으로
 * 읽히는데 실제로는 포함으로 뒤집히는 것이라 늘 헷갈린다. 두 말을 다 적어 둔다.
 */
function Direction({
  exclude,
  onChange,
  onLabel,
  offLabel,
}: {
  exclude: boolean;
  onChange: (v: boolean) => void;
  /** exclude=false 일 때 보일 말 */
  onLabel: string;
  /** exclude=true 일 때 보일 말 */
  offLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!exclude)}
      aria-pressed={exclude}
      title={exclude ? t('제외 조건 — 눌러서 포함으로') : t('포함 조건 — 눌러서 제외로')}
      className={`rounded border px-1.5 py-0.5 text-micro transition-colors ${
        exclude
          ? 'border-warn/60 bg-warn/10 text-warn'
          : 'border-line-strong text-fg-dim hover:text-fg'
      }`}
    >
      {exclude ? offLabel : onLabel}
    </button>
  );
}

function TextCond({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: TextFilter;
  placeholder: string;
  onChange: (v: TextFilter) => void;
}) {
  return (
    <Field label={label}>
      <Direction
        exclude={value.exclude}
        onChange={v => onChange({ ...value, exclude: v })}
        onLabel={t('포함')}
        offLabel={t('제외')}
      />
      <input
        type="text"
        value={value.text}
        placeholder={placeholder}
        spellCheck={false}
        className={`${CONTROL} w-28`}
        onChange={e => onChange({ ...value, text: e.target.value })}
      />
      {value.text !== '' && (
        // **글자 크기가 곧 누를 수 있는 넓이가 아니다.** 미니 아이콘 하나만 두면
        // 실제로 눌리지 않는다 — 자리를 따로 잡아 준다.
        <button
          type="button"
          onClick={() => onChange({ ...value, text: '' })}
          aria-label={`${label} ${t('조건 지우기')}`}
          title={`${label} ${t('조건 지우기')}`}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-micro text-fg-faint hover:bg-hover hover:text-fg"
        >
          ✕
        </button>
      )}
    </Field>
  );
}

/**
 * 이름표 + 컨트롤 묶음.
 *
 * **`<label>` 이면 안 된다.** 라벨을 누르면 브라우저가 그 클릭을 안쪽 입력칸으로 넘기는데,
 * 안에 버튼(포함/제외, 지우기 ✕)이 있으면 그 버튼이 영영 안 눌린다 — 실제로 안 눌렸다.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-micro text-fg-dim">{label}</span>
      {children}
    </div>
  );
}
