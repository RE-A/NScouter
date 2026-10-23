// src/features/xlog/components/XLogToolbar.tsx

import React, { useEffect, useState } from 'react';
import type { TextFilter, XLogChartConfig, XLogFilterState, YAxisMode } from '../types/xlog';
import { firstRule, setFirstRule, Y_AXIS_CONFIGS } from '../types/xlog';
import { Y_MAX_PRESETS_SEC } from '../engine/yScale';
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
  /**
   * 넓은 구간에서 찾기 창을 연다.
   *
   * 드래그와 **다른 일**이라 따로 둔다 — 드래그는 «이 구간에 뭐가 있나» 이고
   * 이건 «어디 있는지 모르는 걸 찾는다» 다.
   */
  onWideSearch: () => void;
  /** 저장해 둔 프로파일 목록을 연다 */
  onOpenSaved: () => void;
  /** 필터 창을 연다 */
  onOpenFilters: () => void;
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
  'rounded border border-line-control bg-input px-1.5 py-0.5 text-body text-fg';
/**
 * 고르기 상자. `px-1.5` 가 기본 스타일의 오른쪽 여백(직접 그린 화살표 자리, index.css)을
 * 덮어써서 `5분` 같은 짧은 값이 화살표 밑으로 들어갔다. 오른쪽만 되살린다.
 */
const SELECT = `${CONTROL} pr-[26px]`;

export function XLogToolbar({
  config,
  filter,
  onConfigChange,
  onFilterChange,
  mode,
  onModeChange,
  pastRange,
  onPastRangeChange,
  onWideSearch,
  onOpenSaved,
  onOpenFilters,
}: XLogToolbarProps) {
  /** 인라인 칸에 안 보이는 조건 수. 창을 열지 않고도 «더 걸려 있다» 를 안다 */
  const extraRules = Math.max(0, filter.patterns.filter(r => r.text.trim() !== '').length - 2);
  // 입력 중인 값. **조회를 눌러야** 실제 구간이 된다 —
  // 타이핑할 때마다 수만 건을 다시 받으면 안 된다.
  const [draft, setDraft] = useState<PastRange>(() => defaultPastRange(Date.now()));

  /**
   * 접어 둔 줄에서 **지금 걸려 있는** 조건 수.
   *
   * 접히는 것과 꺼지는 것은 다르다 — 접어 둔 조건이 여전히 거르고 있는데
   * 화면에 아무 표시가 없으면 «왜 이만큼만 나오지» 의 답이 숨는다.
   */
  const hiddenActive =
    (filter.elapsedMs > 0 ? 1 : 0) +
    (config.showDensity ? 1 : 0);

  /**
   * 두 줄째를 펼친가.
   *
   * **걸려 있는 것이 있으면 열고 시작한다.** 접은 줄 안에 조건이 숨은 채로
   * 시작하면, 지난번에 걸어 둔 조건을 모르고 «데이터가 안 나온다» 로 읽는다.
   */
  const [showMore, setShowMore] = useState(() => hiddenActive > 0);

  // 휠로 확대하면 구간이 밖에서 바뀐다. 입력칸이 따라가지 않으면
  // 화면이 보여주는 구간과 입력값이 어긋나 어느 쪽이 진짜인지 알 수 없다.
  useEffect(() => {
    if (pastRange) setDraft(pastRange);
  }, [pastRange]);

  const check = checkRange(draft, Date.now());

  return (
    <div className="shrink-0 border-b border-line bg-raised px-3 py-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {/* 모드가 나머지 전부의 의미를 바꾸므로 맨 앞이다 */}
      <div className="flex overflow-hidden rounded border border-line-control">
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
            // 묶음 안이라 저마다 테두리를 두르지 않는다 — 가른 선은 묶음이 갖고 있다.
            className={`px-2 py-0.5 text-micro transition-colors ${
              mode === m ? 'bg-accent text-white' : 'text-fg-dim hover:bg-hover hover:text-fg-muted'
            }`}
          >
            {m === 'live' ? t('실시간') : t('과거')}
          </button>
        ))}
      </div>

      {/* 드래그로는 «이 구간에 뭐가 있나» 만 볼 수 있다. 어디 있는지 모르는 걸
          찾으려면 구간을 잘게 나눠 여러 번 받아야 했다 — 그걸 한 번에 하는 입구다 */}
      <button
        onClick={onWideSearch}
        title={t('구간과 조건을 정해 서버에서 찾습니다')}
        className="btn px-2 py-0.5 text-micro"
      >
        {t('찾기')}
      </button>

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
            className={`btn px-2 py-0.5 text-micro ${
              check.ok ? 'border-accent text-accent-bright' : ''
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
      {/* 서비스·IP 는 **가장 자주 거는 조건**이라 첫 줄에 둔다 — Y축·범위는 한 번 정하면 잘 안 바꾼다.
          인라인 칸은 첫 줄짜리 뷰다. 팝업에서 여러 줄을 걸어 둔 사람이 여기서
          글자를 고쳤다고 나머지 줄이 사라지면 안 된다(setFirstRule). */}
      <TextCond
        label={t('서비스')}
        value={firstRule(filter, 'service')}
        placeholder={t('URL 일부')}
        onChange={v => onFilterChange({ patterns: setFirstRule(filter, 'service', v) })}
      />
      <TextCond
        label="IP"
        value={firstRule(filter, 'ip')}
        // 예시 IP 를 깔아 두면 이미 들어 있는 값으로 읽힌다 — 무엇을 넣는 칸인지만 적는다
        placeholder={t('IP 일부')}
        onChange={v => onFilterChange({ patterns: setFirstRule(filter, 'ip', v) })}
      />

      {/* **접어 둔 조건이 몇 개인지를 적어 둔다.** 안 적으면 «왜 이만큼만 보이지» 의
          답이 접힌 줄 안에 숨는다 — 거르고 있는 것은 항상 드러나야 한다. */}
      <button
        type="button"
        onClick={() => setShowMore(v => !v)}
        aria-expanded={showMore}
        title={t('Y축·범위·저장본·Y최대·밀집·응답을 여닫습니다')}
        className="btn px-2 py-0.5 text-micro"
      >
        {showMore ? t('조건 접기') : t('조건 더보기')}
        {hiddenActive > 0 ? ` ${hiddenActive}` : ''}
      </button>

      {/* 조건이 두 줄을 넘어가면 인라인으로는 못 다룬다 — 거기서부터는 창이 맡는다 */}
      <button
        onClick={onOpenFilters}
        title={t('포함·제외를 여러 줄로 겁니다')}
        className="btn px-2 py-0.5 text-micro"
      >
        {t('필터')}
        {extraRules > 0 ? ` +${extraRules}` : ''}
      </button>
      </div>

      {/* 두 줄째 — 자주 안 건드리는 것들. 접어 두면 찾는 줄이 한 눈에 들어온다. */}
      {showMore && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-1">
        {/* 한 번 정하면 잘 안 바꾸는 것들 — 무엇을 어떤 폭으로 그리나, 파일로 남긴 것 열기 */}
        <Field label={t('Y축')}>
          <select
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
        </Field>
        <Field label={t('범위')}>
          <select
            className={SELECT}
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
        {/* 저장본은 **접속과 무관하다.** 콜렉터에서 이미 밀려난 트랜잭션도 열리므로
            연결 상태와 상관없이 늘 눌린다 */}
        <button
          onClick={onOpenSaved}
          title={t('파일로 남겨 둔 프로파일을 엽니다')}
          className="btn px-2 py-0.5 text-micro"
        >
          {t('저장본')}
        </button>
        <span className="h-4 w-px bg-line" aria-hidden />
        {/* 축보다 큰 점은 **천장에 붙어** 그려진다(예전에는 통째로 사라졌다).
            축은 사람이 정한다 — 자동으로 늘리면 튀는 것 하나에 나머지가 바닥에 깔린다.
            Ctrl+휠로도 움직인다. */}
        <Field label={t('Y최대')}>
          <select
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
        </Field>
        {/* 점 하나가 5x5 를 막아 촘촘한 구간에서는 대부분이 안 그려진다 —
            화면은 «여기 좀 있네» 인데 실제로는 한 덩어리다.
            **늘 켜 두지 않는다**: 열이 깔리면 점 색(어느 서버인가)이 읽기 어려워진다. */}
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

        </div>
      )}
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
      /* **양쪽 다 색을 준다.**
       *
       * 한쪽만 칠해 두니(제외=warn, 포함=회색) «이상/포함/포함» 이 찾기·저장본·필터 같은
       * 평범한 버튼과 같은 회색이라, 셋 중 어느 것이 눌러서 뒤집히는 것인지 구분이 안 됐다.
       * 규칙을 하나로 둔다 — **회색은 일을 시키는 버튼, 색이 있는 것은 상태를 쥔 버튼.**
       *
       * 색이 방향을 말한다: 들이는 쪽은 accent(조건을 건다), 거르는 쪽은 warn(빼낸다).
       *
       * `.btn` 의 호버(테두리·배경이 밝아짐)는 여기 색에 덮인다 — 레이어가 뒤라 유틸이 이긴다.
       * 그래서 호버 신호를 밝기로 따로 준다. 없으면 «눌리는 것» 임을 색으로만 알게 된다. */
      className={`btn px-1.5 py-0.5 text-micro transition-all hover:brightness-125 ${
        exclude
          ? 'border-warn bg-warn/10 text-warn'
          : 'border-accent-bright bg-accent/10 text-accent-bright'
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
  /**
   * **글자가 비면 방향을 담아 둘 줄이 없다.**
   *
   * 조건 한 줄은 글자가 있을 때만 존재한다(setFirstRule — 빈 글자는 줄을 지운다).
   * 그래서 빈 칸에서 «포함»을 눌러도 상위 상태가 그대로라 버튼이 안 뒤집혔다.
   * 방향을 먼저 정하고 글자를 치는 순서가 막히면 안 되므로, 줄이 없는 동안만
   * 화면이 방향을 들고 있다가 글자가 들어올 때 그 방향으로 줄을 만든다.
   */
  const [draftExclude, setDraftExclude] = useState(value.exclude);
  const exclude = value.text === '' ? draftExclude : value.exclude;

  // 줄이 살아 있는 동안의 방향은 상위가 진짜다 — 필터 창에서 뒤집으면 여기도 따라간다
  useEffect(() => {
    if (value.text !== '') setDraftExclude(value.exclude);
  }, [value.text, value.exclude]);

  return (
    <Field label={label}>
      <Direction
        exclude={exclude}
        onChange={v => {
          setDraftExclude(v);
          onChange({ text: value.text, exclude: v });
        }}
        onLabel={t('포함')}
        offLabel={t('제외')}
      />
      <input
        type="text"
        value={value.text}
        placeholder={placeholder}
        spellCheck={false}
        className={`${CONTROL} w-28`}
        onChange={e => onChange({ text: e.target.value, exclude })}
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
