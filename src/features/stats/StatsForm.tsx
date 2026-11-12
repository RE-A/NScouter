// 통계 비교 조건 — 대상 하나 · 현재 구간 · 기준 구간 여럿 · 서비스 · 수집 조건
//
// **대상은 하나다.** 서비스 묶음(같은 서비스의 Task 여럿)이나 서버 이름 하나를 고른다. 여러 대를 한 번에
// 비교하면 어느 서버가 나빠졌는지가 평균에 묻힌다.
// **기준은 여럿을 합친다.** 지난 며칠의 같은 시각을 넣으면 그 전체가 «평소» 다 — 하루하루와 따로 비교하지 않는다.

import { memo, useMemo, useState } from 'react';
import { t } from '../../i18n';
import { Button } from '../../components/Button';
import { fromLocalInput, toLocalInput } from '../xlog/types/timeRange';
import type { Estimate, StatsRange, StatsRequest, StatsTaskRule } from './statsApi';
import { picksByRule } from './taskRule';
import { applyPreset, toPreset, type StatsPreset } from './statsPresets';
import { addRanges, lastWeek, offHours, recentDays, yesterday } from './statsRanges';

const DAY = 24 * 3600 * 1000;
const MAX_BASELINES = 14;

/** 서비스 묶음(설정의 묶기 규칙) · Task 이름 규칙(`shop-app-*`) */
export type TargetKind = 'group' | 'rule';

export interface StatsDraft {
  title: string;
  targetKind: TargetKind;
  /** 서비스 묶음 이름 */
  target: string;
  /** Task 이름 규칙 — 줄바꿈·쉼표로 여럿 */
  rule: string;
  /** 불러온(저장할) 규칙 이름 */
  ruleName: string;
  current: StatsRange;
  baselines: StatsRange[];
  /** 한 줄에 하나 — 비면 현재 구간에 찍힌 서비스 전부 */
  services: string;
  serviceInclude: string;
  serviceExclude: string;
  ipInclude: string;
  ipExclude: string;
  /** 통계에 들어간 트랜잭션을 원본 CSV 로도 남긴다 */
  raw: boolean;
}

export function initialDraft(now: number): StatsDraft {
  // 5분 단위로 내린다 — 조각(5분) 경계와 맞아야 기준 구간과 칸이 어긋나지 않는다
  const end = Math.floor(now / 300_000) * 300_000;
  return {
    title: '',
    targetKind: 'group',
    target: '',
    rule: '',
    ruleName: '',
    current: { stime: end - 3600_000, etime: end },
    baselines: [],
    services: '',
    serviceInclude: '',
    serviceExclude: '',
    ipInclude: '',
    ipExclude: '',
    raw: false,
  };
}

/** 쉼표·줄바꿈으로 나눈 목록 */
export function splitList(s: string): string[] {
  return s
    .split(/[\n,]/)
    .map(x => x.trim())
    .filter(x => x !== '');
}

function rangeError(r: StatsRange): string | null {
  if (!(r.stime > 0 && r.etime > r.stime)) return t('시작이 끝보다 앞서야 합니다');
  if (r.etime - r.stime > DAY) return t('구간은 하루를 넘을 수 없습니다');
  return null;
}

/** 시작할 수 없는 까닭. 없으면 null */
export function draftError(d: StatsDraft): string | null {
  if (d.targetKind === 'group' ? d.target.trim() === '' : splitList(d.rule).length === 0) return t('대상을 고르세요');
  const cur = rangeError(d.current);
  if (cur) return `${t('현재 구간')}: ${cur}`;
  if (d.baselines.length === 0) return t('기준 구간을 하나 이상 넣으세요');
  if (d.baselines.length > MAX_BASELINES) return t('기준 구간이 너무 많습니다 (최대 14)');
  for (const b of d.baselines) {
    const e = rangeError(b);
    if (e) return `${t('기준 구간')}: ${e}`;
  }
  return null;
}

export function toRequest(d: StatsDraft, tzOffsetMs: number): StatsRequest {
  const rule = splitList(d.rule);
  const target = d.targetKind === 'group' ? d.target.trim() : d.ruleName.trim() || rule.join(', ');
  const fmt = (ms: number) => toLocalInput(ms).replace('T', ' ');
  return {
    title: d.title.trim() || `${target} ${fmt(d.current.stime)}`,
    groups: d.targetKind === 'group' ? [target] : [],
    servers: [],
    task_patterns: d.targetKind === 'rule' ? rule : [],
    current: d.current,
    baselines: d.baselines,
    services: splitList(d.services),
    service_include: splitList(d.serviceInclude),
    service_exclude: splitList(d.serviceExclude),
    ip_include: splitList(d.ipInclude),
    ip_exclude: splitList(d.ipExclude),
    tz_offset_ms: tzOffsetMs,
    raw: d.raw,
  };
}

/** 기준 구간 한 줄 — `11/11 (수) 08:50–09:50`. 날이 넘으면 끝에도 날짜를 붙인다 */
export function rangeLabel(r: StatsRange): string {
  const s = new Date(r.stime);
  const e = new Date(r.etime);
  const p = (n: number) => String(n).padStart(2, '0');
  const day = (d: Date) => `${d.getMonth() + 1}/${d.getDate()} (${d.toLocaleDateString(undefined, { weekday: 'short' })})`;
  const hm = (d: Date) => `${p(d.getHours())}:${p(d.getMinutes())}`;
  const sameDay = s.toDateString() === e.toDateString() || (e.getHours() === 0 && e.getMinutes() === 0 && r.etime - r.stime <= DAY);
  return `${day(s)} ${hm(s)}–${sameDay ? '' : `${day(e)} `}${hm(e)}`;
}

/** 원본 CSV 크기 어림 — 한 줄 150바이트쯤 */
function rawSize(rows: number): string {
  const mb = (rows * 150) / 1e6;
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)}GB` : `${Math.max(1, Math.round(mb))}MB`;
}

interface StatsFormProps {
  draft: StatsDraft;
  onChange: (d: StatsDraft) => void;
  /** 고를 수 있는 서비스 묶음 이름 */
  groups: string[];
  /** 지금 보이는 서버 이름 — 규칙에 걸리는 것을 미리 보인다 */
  servers: string[];
  /** 저장해 둔 Task 이름 규칙 */
  rules: StatsTaskRule[];
  onSaveRules: (rules: StatsTaskRule[]) => void;
  /** 이름 붙여 저장한 조건 묶음 */
  presets: StatsPreset[];
  onSavePresets: (presets: StatsPreset[]) => void;
  tzOffsetMs: number;
  connected: boolean;
  estimate: Estimate | null;
  estimating: boolean;
  onEstimate: () => void;
  onStart: () => void;
  starting: boolean;
}

const inputCls = 'rounded border border-line-control bg-input px-2 py-1 text-body text-fg placeholder:text-fg-faint';

export const StatsForm = memo(function StatsForm({
  draft: d,
  onChange,
  groups,
  servers,
  rules,
  onSaveRules,
  presets,
  onSavePresets,
  tzOffsetMs,
  connected,
  estimate,
  estimating,
  onEstimate,
  onStart,
  starting,
}: StatsFormProps) {
  const set = <K extends keyof StatsDraft>(k: K, v: StatsDraft[K]) => onChange({ ...d, [k]: v });
  const [showMore, setShowMore] = useState(
    () => d.services + d.serviceInclude + d.serviceExclude + d.ipInclude + d.ipExclude + d.title !== '',
  );
  const [custom, setCustom] = useState<StatsRange | null>(null);
  const [presetName, setPresetName] = useState('');
  const error = draftError(d);
  const rulePatterns = useMemo(() => splitList(d.rule), [d.rule]);
  const matched = useMemo(() => servers.filter(n => picksByRule(rulePatterns, n)), [servers, rulePatterns]);
  const saved = rules.find(r => r.name === d.ruleName.trim());
  const dirty = !saved || saved.patterns.join('\n') !== rulePatterns.join('\n');
  const saveRule = () => {
    const name = d.ruleName.trim();
    if (name === '' || rulePatterns.length === 0) return;
    onSaveRules([{ name, patterns: rulePatterns }, ...rules.filter(r => r.name !== name)]);
  };
  const off = useMemo(
    () => d.baselines.some(b => offHours(d.current, b, tzOffsetMs)),
    [d.baselines, d.current, tzOffsetMs],
  );
  const addBase = (more: StatsRange[]) => set('baselines', addRanges(d.baselines, more).slice(0, MAX_BASELINES));
  const conditions = [
    splitList(d.services).length > 0 ? `${t('서비스')} ${splitList(d.services).length}${t('개 지정')}` : t('서비스 전부'),
    ...(d.serviceInclude || d.serviceExclude ? [t('서비스 조건')] : []),
    ...(d.ipInclude || d.ipExclude ? [t('IP 조건')] : []),
  ].join(' · ');

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      {/* 조건 묶음 — 대상·서비스·수집 조건·평소 구간 잡는 법. 현재 구간은 그대로 두고 채운다 */}
      <div className="flex flex-wrap items-center gap-2 rounded bg-raised px-2 py-1.5">
        <span className="text-small text-fg-dim">{t('조건 묶음')}</span>
        <select
          value=""
          onChange={e => {
            const p = presets.find(x => x.name === e.target.value);
            if (p) {
              onChange(applyPreset(d, p));
              setPresetName(p.name);
            }
          }}
          className={`${inputCls} w-56 pr-[26px]`}
          aria-label={t('조건 묶음 불러오기')}
        >
          <option value="">{presets.length > 0 ? t('불러오기…') : t('저장한 묶음 없음')}</option>
          {presets.map(p => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={presetName}
          spellCheck={false}
          placeholder={t('조건 묶음 이름')}
          onChange={e => setPresetName(e.target.value)}
          className={`${inputCls} w-44`}
          aria-label={t('조건 묶음 이름')}
        />
        <Button
          size="sm"
          disabled={presetName.trim() === ''}
          onClick={() => onSavePresets([toPreset(presetName, d), ...presets.filter(p => p.name !== presetName.trim())])}
          title={t('평소 구간은 현재 구간에서 떨어진 만큼으로 남깁니다 — 불러오면 그날의 현재 구간에 맞춰 다시 만듭니다')}
        >
          {presets.some(p => p.name === presetName.trim()) ? t('고쳐 저장') : t('지금 조건 저장')}
        </Button>
        {presets.some(p => p.name === presetName.trim()) && (
          <Button variant="ghost" size="sm" onClick={() => onSavePresets(presets.filter(p => p.name !== presetName.trim()))}>
            {t('묶음 지우기')}
          </Button>
        )}
      </div>

      <Section title={t('대상')}>
        <div className="flex items-center gap-1">
          {(['group', 'rule'] as TargetKind[]).map(k => (
            <Button key={k} size="sm" aria-pressed={d.targetKind === k} onClick={() => set('targetKind', k)}>
              {k === 'group' ? t('서비스 묶음') : t('Task 이름 규칙')}
            </Button>
          ))}
        </div>
        {d.targetKind === 'group' ? (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              list="stats-target-choices"
              value={d.target}
              spellCheck={false}
              placeholder={t('묶음 이름')}
              onChange={e => set('target', e.target.value)}
              className={`${inputCls} w-80`}
            />
            <datalist id="stats-target-choices">
              {groups.map(c => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <span className="text-small text-fg-faint">{t('설정의 «서비스로 묶기» 규칙을 씁니다')}</span>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <select
                value={saved ? saved.name : ''}
                onChange={e => {
                  const r = rules.find(x => x.name === e.target.value);
                  onChange({ ...d, ruleName: r?.name ?? '', rule: r ? r.patterns.join('\n') : '' });
                }}
                className={`${inputCls} w-56 pr-[26px]`}
                aria-label={t('저장한 규칙')}
              >
                <option value="">{rules.length > 0 ? t('저장한 규칙 고르기…') : t('저장한 규칙 없음')}</option>
                {rules.map(r => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={d.ruleName}
                spellCheck={false}
                placeholder={t('규칙 이름 (저장할 때)')}
                onChange={e => set('ruleName', e.target.value)}
                className={`${inputCls} w-48`}
              />
              <Button size="sm" onClick={saveRule} disabled={d.ruleName.trim() === '' || rulePatterns.length === 0 || !dirty}>
                {saved ? t('고쳐 저장') : t('규칙 저장')}
              </Button>
              {saved && (
                <Button variant="ghost" size="sm" onClick={() => onSaveRules(rules.filter(r => r.name !== saved.name))}>
                  {t('규칙 지우기')}
                </Button>
              )}
            </div>
            <textarea
              value={d.rule}
              spellCheck={false}
              rows={2}
              placeholder={'shop-app-*\nshop-batch-*'}
              onChange={e => set('rule', e.target.value)}
              className={`${inputCls} w-[34rem] font-mono`}
            />
            <p className="text-small text-fg-faint">
              {t('한 줄에 하나. * 는 아무 글자, ? 는 한 글자 — 별표가 없으면 «포함». 대소문자 무시. 지난 Task 도 그날 목록에서 같은 규칙으로 찾습니다.')}
            </p>
            {rulePatterns.length > 0 && (
              <p className="text-small text-fg-muted" title={matched.join('\n')}>
                {t('지금 걸리는 서버')} <span className="tnum text-fg">{matched.length}</span>
                {t('대')}
                {matched.length > 0 && <span className="text-fg-faint"> — {matched.slice(0, 4).map(shortName).join(', ')}{matched.length > 4 ? ' …' : ''}</span>}
              </p>
            )}
          </div>
        )}
      </Section>

      <Section title={t('현재 구간')} hint={t('최대 하루')}>
        <RangeInput value={d.current} onChange={v => set('current', v)} />
      </Section>

      <Section title={t('평소 (기준 구간)')} hint={t('여러 개를 넣으면 하나로 합쳐 «평소» 로 봅니다')}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={() => addBase(yesterday(d.current))}>{t('+ 어제 같은 시각')}</Button>
          <Button size="sm" onClick={() => addBase(lastWeek(d.current))}>{t('+ 지난주 같은 요일')}</Button>
          <Button size="sm" onClick={() => addBase(recentDays(d.current, 7))}>{t('+ 최근 7일 같은 시각')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setCustom(custom ? null : shiftOneDay(d.current))}>
            {t('+ 직접 입력')}
          </Button>
        </div>
        {custom && (
          <div className="mt-2 flex items-center gap-2">
            <RangeInput value={custom} onChange={setCustom} />
            <Button
              size="sm"
              variant="primary"
              disabled={!(custom.etime > custom.stime)}
              onClick={() => {
                addBase([custom]);
                setCustom(null);
              }}
            >
              {t('추가')}
            </Button>
          </div>
        )}
        {d.baselines.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {d.baselines.map((b, i) => {
              const odd = offHours(d.current, b, tzOffsetMs);
              return (
                <span
                  key={`${b.stime}-${b.etime}`}
                  className={`tnum inline-flex items-center gap-1 rounded border px-2 py-0.5 text-small ${
                    odd ? 'border-warn/50 text-warn' : 'border-line-control text-fg'
                  }`}
                  title={odd ? t('현재 구간과 시각·길이가 달라 피크가 섞일 수 있습니다') : undefined}
                >
                  {rangeLabel(b)}
                  <button
                    type="button"
                    className="text-fg-faint hover:text-fg"
                    onClick={() => set('baselines', d.baselines.filter((_, j) => j !== i))}
                    aria-label={t('빼기')}
                  >
                    ✕
                  </button>
                </span>
              );
            })}
            <button type="button" className="text-small text-fg-dim underline hover:text-fg" onClick={() => set('baselines', [])}>
              {t('모두 빼기')}
            </button>
          </div>
        )}
        {off && (
          <p className="mt-1.5 text-small text-warn">
            {t('현재 구간과 시각·길이가 다른 기준이 있습니다 — 피크·한가한 시간이 섞이면 «느려짐» 이 잘못 뜰 수 있습니다')}
          </p>
        )}
      </Section>

      <div>
        <button
          type="button"
          onClick={() => setShowMore(v => !v)}
          className="flex items-center gap-2 text-small text-fg-muted hover:text-fg"
          aria-expanded={showMore}
        >
          <span>{showMore ? '▾' : '▸'}</span>
          <span>{t('서비스 · 수집 조건')}</span>
          {!showMore && <span className="text-fg-faint">{conditions}</span>}
        </button>
        {showMore && (
          <div className="mt-2 flex flex-col gap-2 border-l-2 border-line pl-3">
            <Field label={t('서비스')}>
              <textarea
                value={d.services}
                spellCheck={false}
                rows={3}
                placeholder={t('비우면 현재 구간에 찍힌 서비스 전부. 직접 고르려면 한 줄에 하나')}
                onChange={e => set('services', e.target.value)}
                className={`${inputCls} min-w-0 flex-1 font-mono`}
              />
            </Field>
            <Field label={t('서비스 포함')}>
              <Text value={d.serviceInclude} onChange={v => set('serviceInclude', v)} placeholder="/api/, /order" />
            </Field>
            <Field label={t('서비스 제외')}>
              <Text value={d.serviceExclude} onChange={v => set('serviceExclude', v)} placeholder="/health, .css" />
            </Field>
            <Field label={t('IP 포함')}>
              <Text value={d.ipInclude} onChange={v => set('ipInclude', v)} placeholder="10.89." />
            </Field>
            <Field label={t('IP 제외')}>
              <Text value={d.ipExclude} onChange={v => set('ipExclude', v)} placeholder="10.0.0.5" />
            </Field>
            <p className="text-small text-fg-faint">
              {t('쉼표로 여럿. 그 글자가 들어 있으면 맞는 것으로 봅니다(대소문자 무시). 제외가 포함보다 먼저입니다.')}
            </p>
            <Field label={t('제목')}>
              <Text value={d.title} onChange={v => set('title', v)} placeholder={t('비우면 대상과 시각')} />
            </Field>
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-body text-fg-muted">
        <input type="checkbox" checked={d.raw} onChange={e => set('raw', e.target.checked)} />
        {t('원본 트랜잭션도 CSV 로 남기기')}
        <span className="text-small text-fg-faint">
          {estimate ? `— ${t('약')} ${rawSize(estimate.total)}` : `— ${t('한 건 한 줄, 내보내기 폴더')}`}
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button variant="primary" size="md" onClick={onStart} disabled={!connected || error !== null || starting}>
          {t('통계 시작')}
        </Button>
        <Button size="md" onClick={onEstimate} disabled={!connected || error !== null || estimating}>
          {estimating ? t('세는 중…') : t('건수 미리 보기')}
        </Button>
        {estimate && (
          <span className="text-small text-fg-muted" title={t('IP 조건은 세지 않은 값입니다')}>
            {t('약')} <span className="tnum text-fg">{estimate.total.toLocaleString()}</span>
            {t('건')}
          </span>
        )}
        {error && <span className="text-small text-danger">{error}</span>}
        {!connected && <span className="text-small text-fg-dim">{t('연결 후 사용 가능합니다.')}</span>}
      </div>
    </div>
  );
});

function shortName(n: string): string {
  return n.split('/').filter(x => x !== '').pop() ?? n;
}

function shiftOneDay(r: StatsRange): StatsRange {
  return { stime: r.stime - DAY, etime: r.etime - DAY };
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h3 className="text-body font-medium text-fg">{title}</h3>
        {hint && <span className="text-small text-fg-faint">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function RangeInput({ value, onChange }: { value: StatsRange; onChange: (r: StatsRange) => void }) {
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="datetime-local"
        value={toLocalInput(value.stime)}
        onChange={e => onChange({ ...value, stime: fromLocalInput(e.target.value) ?? 0 })}
        className={inputCls}
      />
      <span className="text-fg-faint">–</span>
      <input
        type="datetime-local"
        value={toLocalInput(value.etime)}
        onChange={e => onChange({ ...value, etime: fromLocalInput(e.target.value) ?? 0 })}
        className={inputCls}
      />
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-24 shrink-0 pt-1.5 text-small text-fg-dim">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
    </div>
  );
}

function Text({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="text"
      value={value}
      spellCheck={false}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className={`${inputCls} min-w-0 flex-1`}
    />
  );
}
