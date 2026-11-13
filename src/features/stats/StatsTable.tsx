// 비교 표 — 서비스 한 줄에 지표마다 «기준 | 과거 | 과거 대비»
//
// 용어: **기준** = 살펴보는 시점, **과거** = 견줄 지난 시점. 머리글을 두 줄로 두어 어느 숫자가 무엇인지 칸마다 밝힌다.
// 과거 건수는 구간당 평균(과거 구간이 여럿이면 합계로는 견줄 수 없다). 빨간색은 판정에 걸린 칸만.
// 수백 줄이라 DOM 표로 충분하다. 정렬·거르기는 `useMemo` 로 한 번만.

import { Fragment, memo, useMemo, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import type { ServiceStats } from './statsApi';
import { FLAG_LABEL, FLAG_ORDER, judge, severity, type Flag, type JudgeRules } from './statsJudge';
import { flagReason, fmtMetric, fmtMetricVs, metricBad, metricValue, METRICS, splitService, type MetricKey } from './statsFormat';
import { flagHelp, termHelp } from './statsGlossary';

type SortKey = 'worst' | 'service' | MetricKey;

interface StatsTableProps {
  rows: ServiceStats[];
  rules: JudgeRules;
  /** 과거 구간 수 — 과거 건수를 구간당 평균으로 */
  pastRanges: number;
  selected: string | null;
  /** 같은 줄을 다시 누르면 null — 접는다 */
  onSelect: (service: string | null) => void;
  /** 고른 줄 바로 아래에 펼칠 내용 */
  detail: (service: string) => ReactNode;
}

export const FLAG_CLS: Record<Flag, string> = {
  errors: 'bg-danger/20 text-danger',
  slow: 'bg-warn/20 text-warn',
  volume: 'bg-accent/15 text-accent-bright',
  gone: 'bg-fg-faint/20 text-fg-muted',
  new: 'bg-accent/15 text-accent-bright',
  few: 'text-fg-faint',
};

/** 지표 머리 — 함수라 언어를 바꿔도 따라온다 */
function metricLabel(k: MetricKey, pastRanges: number): string {
  switch (k) {
    case 'count':
      return pastRanges > 1 ? t('건수 (과거는 구간당 평균)') : t('건수');
    case 'avg':
      return t('평균(ms)');
    case 'p90':
      return 'p90(ms)';
    case 'p99':
      return 'p99(ms)';
    case 'err':
      return t('에러율');
  }
}

/** 서비스 이름 — 앞부분은 흐리게(넘치면 잘림), 끝부분은 진하게(늘 보임) */
export function ServiceName({ name }: { name: string }) {
  const { head, tail } = splitService(name);
  return (
    <span className="flex min-w-0 max-w-[22rem] font-mono" title={name}>
      <span className="min-w-0 truncate text-fg-faint">{head}</span>
      {/* 끝부분이 칸보다 길면 끝부분도 잘린다 — 넘쳐서 옆 칸을 덮지 않게 */}
      <span className="min-w-0 max-w-full shrink-0 truncate font-semibold text-fg">{tail}</span>
    </span>
  );
}

export const StatsTable = memo(function StatsTable({ rows, rules, pastRanges, selected, onSelect, detail }: StatsTableProps) {
  const [sort, setSort] = useState<SortKey>('worst');
  /** 고른 판정만. null 이면 기준에 있는 것 전부 */
  const [only, setOnly] = useState<Flag | 'any' | null>(null);
  const [query, setQuery] = useState('');

  const judged = useMemo(
    () => rows.map(r => ({ row: r, flags: judge(r, rules), score: severity(r, rules) })),
    [rows, rules],
  );
  const counts = useMemo(() => {
    const m = new Map<Flag, number>();
    for (const j of judged) for (const f of j.flags) m.set(f, (m.get(f) ?? 0) + 1);
    return m;
  }, [judged]);
  // **과거에만 있던 서비스는 기본으로 숨긴다** — 비교 대상은 기준 시점에 찍힌 서비스다. «과거에만» 칩을 눌렀을 때만 보인다
  const notable = (f: Flag) => f !== 'few' && f !== 'gone';
  const flaggedCount = useMemo(() => judged.filter(j => j.flags.some(notable)).length, [judged]);
  const currentCount = useMemo(() => judged.filter(j => j.row.current !== null).length, [judged]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = judged.filter(
      j =>
        (only === null
          ? j.row.current !== null
          : only === 'any'
            ? j.flags.some(notable)
            : j.flags.includes(only)) &&
        (q === '' || j.row.service.toLowerCase().includes(q)),
    );
    if (sort === 'worst') return list.sort((a, b) => b.score - a.score);
    if (sort === 'service') return list.sort((a, b) => a.row.service.localeCompare(b.row.service));
    const get = (j: (typeof list)[number]) => metricValue(j.row.current, sort) ?? -1;
    return list.sort((a, b) => get(b) - get(a));
  }, [judged, only, query, sort]);

  const SortBtn = ({ k, label, left, help }: { k: SortKey; label: string; left?: boolean; help?: string }) => (
    <button
      type="button"
      onClick={() => setSort(k)}
      className={`hover:text-fg ${sort === k ? 'text-fg' : ''} ${left ? '' : 'w-full text-center'}`}
      aria-pressed={sort === k}
      title={help ? `${help}\n\n${t('누르면 기준 값으로 줄 세웁니다')}` : undefined}
    >
      <span className={help ? 'st-help' : ''}>{label}</span>
      {sort === k && ' ↓'}
    </button>
  );

  /** 요약 카드 — 누르면 그것만 남긴다(다시 누르면 전체) */
  const Kpi = ({ value, label, n, tone, help }: { value: Flag | 'any' | null; label: string; n: number; tone?: string; help?: string }) => (
    <button
      type="button"
      onClick={() => setOnly(only === value ? null : value)}
      aria-pressed={only === value}
      className="st-kpi"
      title={help}
    >
      <span className="text-micro text-fg-dim">{label}</span>
      <span className={`tnum text-title font-semibold leading-none ${tone ?? 'text-fg'}`}>{n.toLocaleString()}</span>
    </button>
  );
  const FLAG_TONE: Partial<Record<Flag, string>> = { errors: 'text-danger', slow: 'text-warn', volume: 'text-accent-bright', new: 'text-accent-bright' };

  // 지표 묶음 사이 세로줄 — 어느 칸이 어느 지표인지 눈으로 가른다
  const groupEdge = 'border-l border-line';

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <Kpi value={null} label={t('서비스')} n={currentCount} help={t('기준 구간에 찍힌 서비스')} />
        <Kpi value="any" label={t('특이사항')} n={flaggedCount} tone={flaggedCount > 0 ? 'text-warn' : 'text-fg'} help={termHelp('verdict')} />
        {FLAG_ORDER.filter(f => f !== 'few' && counts.get(f)).map(f => (
          <Kpi key={f} value={f} label={t(FLAG_LABEL[f])} n={counts.get(f) ?? 0} tone={FLAG_TONE[f]} help={flagHelp(f, rules)} />
        ))}
        <span className="flex-1" />
        <input
          type="text"
          value={query}
          spellCheck={false}
          placeholder={t('서비스 거르기')}
          onChange={e => setQuery(e.target.value)}
          className="search-field w-56 rounded py-0.5 pr-2 text-small"
        />
      </div>
      <div className="st-card min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-overlay text-small text-fg-dim shadow-[0_1px_0_var(--border-strong)]">
            <tr>
              <th rowSpan={2} className="px-3 py-1.5 text-left font-normal align-bottom">
                <SortBtn k="service" label={t('서비스')} left />
              </th>
              <th rowSpan={2} className="px-2 py-1 text-left font-normal align-bottom">
                <SortBtn k="worst" label={t('판정')} left help={termHelp('verdict')} />
              </th>
              {METRICS.map(k => (
                <th key={k} colSpan={3} className={`${groupEdge} px-2 pt-1 font-medium text-fg-muted`}>
                  <SortBtn k={k} label={metricLabel(k, pastRanges)} help={termHelp(k)} />
                </th>
              ))}
            </tr>
            <tr className="text-micro">
              {METRICS.map(k => (
                <Fragment key={k}>
                  <th className={`${groupEdge} st-ref whitespace-nowrap px-2 pb-1.5 text-right font-medium`} title={termHelp('ref')}>
                    <span className="st-pill st-pill-ref">{t('기준')}</span>
                  </th>
                  <th className="whitespace-nowrap px-2 pb-1.5 text-right font-normal" title={termHelp('past')}>
                    <span className="st-pill st-pill-past">{t('과거')}</span>
                  </th>
                  <th className="whitespace-nowrap px-2 pb-1.5 text-right font-normal" title={termHelp('vs')}>
                    <span className="st-help-soft">{t('과거 대비')}</span>
                  </th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ row: r, flags }) => {
              const on = r.service === selected;
              return (
                <Fragment key={r.service}>
                  <tr
                    onClick={() => onSelect(on ? null : r.service)}
                    aria-expanded={on}
                    className={`cursor-pointer border-t border-line text-body transition-colors ${
                      on ? 'bg-accent/12 shadow-[inset_3px_0_0_var(--accent)]' : 'hover:bg-hover/70'
                    }`}
                  >
                    <td className="px-3 py-1.5">
                      <ServiceName name={r.service} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {flags.map(f => {
                        const why = flagReason(f, r, rules, t);
                        return (
                          <span key={f} className="mr-2 inline-flex items-center gap-1" title={flagHelp(f, rules)}>
                            <span className={`rounded-full px-2 py-px text-micro font-medium ${FLAG_CLS[f]}`}>{t(FLAG_LABEL[f])}</span>
                            {why && <span className="tnum text-micro text-fg-dim">{why}</span>}
                          </span>
                        );
                      })}
                    </td>
                    {METRICS.map(k => {
                      const c = metricValue(r.current, k);
                      const b = metricValue(r.baseline, k, pastRanges);
                      const vs = fmtMetricVs(k, c, b);
                      const bad = metricBad(k, r, rules);
                      return (
                        <Fragment key={k}>
                          <td className={`${groupEdge} st-ref tnum whitespace-nowrap px-2 py-1.5 text-right font-medium text-fg`}>{fmtMetric(k, c)}</td>
                          <td className="tnum whitespace-nowrap px-2 py-1.5 text-right text-fg-dim">{fmtMetric(k, b)}</td>
                          <td className="tnum whitespace-nowrap px-2 py-1.5 text-right text-small">
                            {vs && (bad ? <span className="st-bad">{vs}</span> : <span className="text-fg-faint">{vs}</span>)}
                          </td>
                        </Fragment>
                      );
                    })}
                  </tr>
                  {on && (
                    <tr className="bg-surface">
                      <td colSpan={2 + METRICS.length * 3} className="px-4 py-4 shadow-[inset_3px_0_0_var(--accent)]">
                        {detail(r.service)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="p-3 text-small text-fg-dim">{t('보일 서비스가 없습니다')}</p>}
      </div>
    </div>
  );
});
