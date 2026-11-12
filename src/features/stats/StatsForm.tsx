// 통계 비교 조건 — 대상 하나 · 현재 구간 · 기준 구간 여럿 · 서비스 · 수집 조건
//
// **대상은 하나다.** 서비스 묶음(같은 서비스의 Task 여럿)이나 서버 이름 하나를 고른다. 여러 대를 한 번에
// 비교하면 어느 서버가 나빠졌는지가 평균에 묻힌다.
// **기준은 여럿을 합친다.** 지난 며칠의 같은 시각을 넣으면 그 전체가 «평소» 다 — 하루하루와 따로 비교하지 않는다.

import { memo, useMemo, useState } from 'react';
import { t } from '../../i18n';
import { Button } from '../../components/Button';
import { fromLocalInput, toLocalInput } from '../xlog/types/timeRange';
import type { Estimate, StatsRange, StatsRequest } from './statsApi';
import { addRanges, lastWeek, offHours, recentDays, yesterday } from './statsRanges';

const DAY = 24 * 3600 * 1000;
const MAX_BASELINES = 14;

export type TargetKind = 'group' | 'server';

export interface StatsDraft {
  title: string;
  targetKind: TargetKind;
  target: string;
  current: StatsRange;
  baselines: StatsRange[];
  /** 한 줄에 하나 — 비면 현재 구간에 찍힌 서비스 전부 */
  services: string;
  serviceInclude: string;
  serviceExclude: string;
  ipInclude: string;
  ipExclude: string;
}

export function initialDraft(now: number): StatsDraft {
  // 5분 단위로 내린다 — 조각(5분) 경계와 맞아야 기준 구간과 칸이 어긋나지 않는다
  const end = Math.floor(now / 300_000) * 300_000;
  return {
    title: '',
    targetKind: 'group',
    target: '',
    current: { stime: end - 3600_000, etime: end },
    baselines: [],
    services: '',
    serviceInclude: '',
    serviceExclude: '',
    ipInclude: '',
    ipExclude: '',
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
  if (d.target.trim() === '') return t('대상을 고르세요');
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
  const target = d.target.trim();
  const fmt = (ms: number) => toLocalInput(ms).replace('T', ' ');
  return {
    title: d.title.trim() || `${target} ${fmt(d.current.stime)}`,
    groups: d.targetKind === 'group' ? [target] : [],
    servers: d.targetKind === 'server' ? [target] : [],
    current: d.current,
    baselines: d.baselines,
    services: splitList(d.services),
    service_include: splitList(d.serviceInclude),
    service_exclude: splitList(d.serviceExclude),
    ip_include: splitList(d.ipInclude),
    ip_exclude: splitList(d.ipExclude),
    tz_offset_ms: tzOffsetMs,
  };
}

interface StatsFormProps {
  draft: StatsDraft;
  onChange: (d: StatsDraft) => void;
  /** 고를 수 있는 서비스 묶음 이름 */
  groups: string[];
  /** 고를 수 있는 서버 이름 */
  servers: string[];
  tzOffsetMs: number;
  connected: boolean;
  estimate: Estimate | null;
  estimating: boolean;
  onEstimate: () => void;
  onStart: () => void;
  starting: boolean;
}

const inputCls = 'rounded border border-line-control bg-input px-2 py-0.5 text-body text-fg placeholder:text-fg-faint';

export const StatsForm = memo(function StatsForm({
  draft: d,
  onChange,
  groups,
  servers,
  tzOffsetMs,
  connected,
  estimate,
  estimating,
  onEstimate,
  onStart,
  starting,
}: StatsFormProps) {
  const set = <K extends keyof StatsDraft>(k: K, v: StatsDraft[K]) => onChange({ ...d, [k]: v });
  const [showFilters, setShowFilters] = useState(
    () => d.serviceInclude + d.serviceExclude + d.ipInclude + d.ipExclude !== '',
  );
  const error = draftError(d);
  const choices = d.targetKind === 'group' ? groups : servers;
  const off = useMemo(
    () => d.baselines.some(b => offHours(d.current, b, tzOffsetMs)),
    [d.baselines, d.current, tzOffsetMs],
  );
  const addBase = (more: StatsRange[]) => set('baselines', addRanges(d.baselines, more).slice(0, MAX_BASELINES));

  return (
    <div className="flex flex-col gap-2 text-body">
      <Row label={t('대상')}>
        <select
          value={d.targetKind}
          onChange={e => onChange({ ...d, targetKind: e.target.value as TargetKind, target: '' })}
          className={`${inputCls} pr-[26px]`}
        >
          <option value="group">{t('서비스 묶음')}</option>
          <option value="server">{t('서버 이름')}</option>
        </select>
        <input
          type="text"
          list="stats-target-choices"
          value={d.target}
          spellCheck={false}
          placeholder={d.targetKind === 'group' ? t('묶음 이름') : t('이름에 든 글자')}
          onChange={e => set('target', e.target.value)}
          className={`${inputCls} min-w-0 flex-1`}
        />
        <datalist id="stats-target-choices">
          {choices.map(c => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Row>

      <Row label={t('현재 구간')}>
        <RangeInput value={d.current} onChange={v => set('current', v)} />
      </Row>

      <Row label={t('기준 구간')}>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {d.baselines.map((b, i) => (
            <div key={`${b.stime}-${b.etime}-${i}`} className="flex items-center gap-1">
              <RangeInput
                value={b}
                onChange={v => set('baselines', d.baselines.map((x, j) => (j === i ? v : x)))}
              />
              {offHours(d.current, b, tzOffsetMs) && (
                <span className="text-micro text-warn" title={t('현재 구간과 시각·길이가 달라 피크가 섞일 수 있습니다')}>
                  ⚠
                </span>
              )}
              <Button variant="ghost" size="xs" onClick={() => set('baselines', d.baselines.filter((_, j) => j !== i))} aria-label={t('빼기')}>
                ✕
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-1">
            <Button size="xs" onClick={() => addBase(yesterday(d.current))}>{t('+ 어제 같은 시각')}</Button>
            <Button size="xs" onClick={() => addBase(lastWeek(d.current))}>{t('+ 지난주 같은 요일')}</Button>
            <Button size="xs" onClick={() => addBase(recentDays(d.current, 7))}>{t('+ 최근 7일 같은 시각')}</Button>
            <Button
              size="xs"
              onClick={() => addBase([{ stime: 2 * d.current.stime - d.current.etime, etime: d.current.stime }])}
              title={t('현재 구간 바로 앞의 같은 길이 — 시각이 달라 피크가 섞일 수 있습니다')}
            >
              {t('+ 바로 앞 구간')}
            </Button>
            {d.baselines.length > 0 && (
              <Button variant="ghost" size="xs" onClick={() => set('baselines', [])}>{t('모두 빼기')}</Button>
            )}
          </div>
          {off && <p className="text-micro text-warn">{t('현재 구간과 시각·길이가 다른 기준이 있습니다 — 피크·한가한 시간이 섞이면 «느려짐» 이 잘못 뜰 수 있습니다')}</p>}
        </div>
      </Row>

      <Row label={t('서비스')}>
        <textarea
          value={d.services}
          spellCheck={false}
          rows={2}
          placeholder={t('비우면 현재 구간에 찍힌 서비스 전부. 직접 고르려면 한 줄에 하나')}
          onChange={e => set('services', e.target.value)}
          className={`${inputCls} min-w-0 flex-1 font-mono text-small`}
        />
      </Row>

      <div>
        <Button variant="ghost" size="xs" onClick={() => setShowFilters(v => !v)}>
          {showFilters ? t('수집 조건 접기') : t('수집 조건 (서비스·IP 포함/제외)')}
        </Button>
      </div>
      {showFilters && (
        <>
          <Row label={t('서비스 포함')}>
            <Text value={d.serviceInclude} onChange={v => set('serviceInclude', v)} placeholder="/api/, /order" />
          </Row>
          <Row label={t('서비스 제외')}>
            <Text value={d.serviceExclude} onChange={v => set('serviceExclude', v)} placeholder="/health, .css" />
          </Row>
          <Row label={t('IP 포함')}>
            <Text value={d.ipInclude} onChange={v => set('ipInclude', v)} placeholder="10.89." />
          </Row>
          <Row label={t('IP 제외')}>
            <Text value={d.ipExclude} onChange={v => set('ipExclude', v)} placeholder="10.0.0.5" />
          </Row>
          <p className="text-micro text-fg-faint">
            {t('쉼표로 여럿. 그 글자가 들어 있으면 맞는 것으로 봅니다(대소문자 무시). 제외가 포함보다 먼저입니다.')}
          </p>
        </>
      )}

      <Row label={t('제목')}>
        <Text value={d.title} onChange={v => set('title', v)} placeholder={t('비우면 대상과 시각')} />
      </Row>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="md" onClick={onEstimate} disabled={!connected || error !== null || estimating}>
          {estimating ? t('세는 중…') : t('건수 미리 보기')}
        </Button>
        <Button variant="primary" size="md" onClick={onStart} disabled={!connected || error !== null || starting}>
          {t('통계 시작')}
        </Button>
        {error && <span className="text-micro text-danger">{error}</span>}
        {!connected && <span className="text-micro text-fg-dim">{t('연결 후 사용 가능합니다.')}</span>}
      </div>
      {estimate && (
        <p className="text-micro text-fg-dim">
          {t('예상')} <span className="tnum font-mono text-fg-muted">{estimate.total.toLocaleString()}</span>
          {t('건')} ({estimate.ranges.map(r => `${r.kind === 'current' ? t('현재') : t('기준')} ${r.count.toLocaleString()}`).join(' · ')})
          {' — '}
          {t('IP 조건은 세지 않은 값입니다')}
        </p>
      )}
    </div>
  );
});

function RangeInput({ value, onChange }: { value: StatsRange; onChange: (r: StatsRange) => void }) {
  return (
    <span className="flex items-center gap-1">
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-20 shrink-0 pt-1 text-micro text-fg-dim">{label}</span>
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
