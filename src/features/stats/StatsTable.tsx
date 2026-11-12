// 비교 표 — 서비스 한 줄에 현재 값과 변화, 그 아래 평소(기준) 값
//
// 숫자는 다섯 가지만 둔다(건수·평균·p90·p99·에러율). 나머지는 줄을 눌러 상세에서 본다.
// 수백 줄이라 DOM 표로 충분하다. 정렬·거르기는 `useMemo` 로 한 번만.

import { Fragment, memo, useMemo, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import type { ServiceStats, StatsSummary } from './statsApi';
import { change, FLAG_LABEL, FLAG_ORDER, judge, severity, type Flag, type JudgeRules } from './statsJudge';

type SortKey = 'worst' | 'service' | 'count' | 'avg' | 'p90' | 'p99' | 'err';

interface StatsTableProps {
  rows: ServiceStats[];
  rules: JudgeRules;
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

const int = (v: number) => Math.round(v).toLocaleString();
const rate = (v: number) => `${(v * 100).toFixed(2)}%`;

/** 숫자 칸 하나 — 위: 현재 + 변화, 아래: 평소 */
function Metric({
  cur,
  base,
  fmt,
  tone = 'up-bad',
  diff,
}: {
  cur: number | undefined;
  base: number | undefined;
  fmt: (v: number) => string;
  /** up-bad: 늘면 나쁨(빨강) · neutral: 색 없음 */
  tone?: 'up-bad' | 'neutral';
  /** 변화를 비율 대신 차이로 적을 때 (에러율 %p) */
  diff?: (c: number, b: number) => string;
}) {
  let delta = '';
  let cls = 'text-fg-faint';
  if (cur !== undefined && base !== undefined) {
    if (diff) {
      delta = diff(cur, base);
      if (tone === 'up-bad' && cur - base > 0.005) cls = 'text-danger';
    } else {
      const c = change(cur, base);
      if (c !== null) {
        const p = Math.round(c * 100);
        // 10% 안쪽 흔들림은 적지 않는다 — 다 적으면 정작 큰 변화가 묻힌다
        delta = Math.abs(p) < 10 ? '' : `${p > 0 ? '▲' : '▼'}${Math.abs(p)}%`;
        if (tone === 'up-bad' && c >= 0.5) cls = 'text-danger';
        else if (tone === 'up-bad' && c <= -0.2) cls = 'text-ok';
      }
    }
  }
  return (
    <td className="tnum whitespace-nowrap px-2 py-1 text-right align-top">
      <div className="text-body text-fg">
        {cur === undefined ? '–' : fmt(cur)}
        <span className={`ml-1.5 inline-block min-w-[2.9rem] text-left text-micro ${cls}`}>{delta}</span>
      </div>
      <div className="text-micro text-fg-faint">
        {t('평소')} {base === undefined ? '–' : fmt(base)}
        <span className="ml-1.5 inline-block min-w-[2.9rem]" />
      </div>
    </td>
  );
}

const pick: Record<Exclude<SortKey, 'worst' | 'service'>, (s: StatsSummary) => number> = {
  count: s => s.count,
  avg: s => s.avg_ms,
  p90: s => s.p90_ms,
  p99: s => s.p99_ms,
  err: s => s.error_rate,
};

export const StatsTable = memo(function StatsTable({ rows, rules, selected, onSelect, detail }: StatsTableProps) {
  const [sort, setSort] = useState<SortKey>('worst');
  /** 고른 판정만. null 이면 전부 */
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
  const flaggedCount = useMemo(() => judged.filter(j => j.flags.some(f => f !== 'few')).length, [judged]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = judged.filter(
      j =>
        (only === null || (only === 'any' ? j.flags.some(f => f !== 'few') : j.flags.includes(only))) &&
        (q === '' || j.row.service.toLowerCase().includes(q)),
    );
    if (sort === 'worst') return list.sort((a, b) => b.score - a.score);
    if (sort === 'service') return list.sort((a, b) => a.row.service.localeCompare(b.row.service));
    const get = pick[sort];
    return list.sort((a, b) => (b.row.current ? get(b.row.current) : -1) - (a.row.current ? get(a.row.current) : -1));
  }, [judged, only, query, sort]);

  const Th = ({ k, label, left }: { k: SortKey; label: string; left?: boolean }) => (
    <th className={`px-2 py-1.5 font-normal ${left ? 'text-left' : 'text-right'}`}>
      <button
        type="button"
        onClick={() => setSort(k)}
        className={`hover:text-fg ${sort === k ? 'text-fg' : ''}`}
        aria-pressed={sort === k}
      >
        {label}
        {sort === k && ' ↓'}
      </button>
    </th>
  );

  const Chip = ({ value, label, n }: { value: Flag | 'any' | null; label: string; n: number }) => (
    <button
      type="button"
      onClick={() => setOnly(value)}
      aria-pressed={only === value}
      className={`rounded px-2 py-0.5 text-small ${
        only === value ? 'bg-accent/20 text-accent-bright' : 'text-fg-muted hover:bg-hover'
      }`}
    >
      {label} <span className="tnum">{n}</span>
    </button>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <Chip value={null} label={t('전체')} n={rows.length} />
        <Chip value="any" label={t('특이사항')} n={flaggedCount} />
        {FLAG_ORDER.filter(f => f !== 'few' && counts.get(f)).map(f => (
          <Chip key={f} value={f} label={t(FLAG_LABEL[f])} n={counts.get(f) ?? 0} />
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
      <div className="min-h-0 flex-1 overflow-auto rounded border border-line">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-raised text-small text-fg-dim">
            <tr>
              <Th k="service" label={t('서비스')} left />
              <Th k="worst" label={t('판정')} left />
              <Th k="count" label={t('건수')} />
              <Th k="avg" label={t('평균(ms)')} />
              <Th k="p90" label="p90(ms)" />
              <Th k="p99" label="p99(ms)" />
              <Th k="err" label={t('에러율')} />
            </tr>
          </thead>
          <tbody>
            {shown.map(({ row: r, flags }) => {
              const c = r.current ?? undefined;
              const b = r.baseline ?? undefined;
              const on = r.service === selected;
              return (
                <Fragment key={r.service}>
                <tr
                  onClick={() => onSelect(on ? null : r.service)}
                  aria-expanded={on}
                  className={`cursor-pointer border-t border-line ${on ? 'bg-accent/15' : 'hover:bg-hover'}`}
                >
                  <td className="max-w-[22rem] truncate px-2 py-1 align-top font-mono text-body text-fg" title={r.service}>
                    {r.service}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 align-top">
                    {flags.map(f => (
                      <span key={f} className={`mr-1 rounded px-1.5 py-px text-micro ${FLAG_CLS[f]}`}>
                        {t(FLAG_LABEL[f])}
                      </span>
                    ))}
                  </td>
                  <Metric cur={c?.count} base={b?.count} fmt={int} tone="neutral" />
                  <Metric cur={c?.avg_ms} base={b?.avg_ms} fmt={int} />
                  <Metric cur={c?.p90_ms} base={b?.p90_ms} fmt={int} />
                  <Metric cur={c?.p99_ms} base={b?.p99_ms} fmt={int} />
                  <Metric
                    cur={c?.error_rate}
                    base={b?.error_rate}
                    fmt={rate}
                    diff={(x, y) => {
                      const d = (x - y) * 100;
                      return Math.abs(d) < 0.1 ? '' : `${d > 0 ? '+' : ''}${d.toFixed(2)}%p`;
                    }}
                  />
                </tr>
                {on && (
                  <tr className="bg-raised">
                    <td colSpan={7} className="px-3 py-3">
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
