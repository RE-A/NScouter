// 비교 표 — 서비스 한 줄에 현재·기준과 변화
//
// 수백 줄이라 DOM 표로 충분하다(초당 수만 점을 그리는 XLog 와 다르다). 정렬·거르기는 `useMemo` 로 한 번만.

import { memo, useMemo, useState } from 'react';
import { t } from '../../i18n';
import type { ServiceStats } from './statsApi';
import { change, FLAG_LABEL, FLAG_ORDER, judge, severity, type Flag, type JudgeRules } from './statsJudge';

export type SortKey = 'worst' | 'count' | 'avg' | 'name';

interface StatsTableProps {
  rows: ServiceStats[];
  rules: JudgeRules;
  selected: string | null;
  onSelect: (service: string) => void;
}

const FLAG_CLS: Record<Flag, string> = {
  errors: 'bg-danger/20 text-danger',
  slow: 'bg-warn/20 text-warn',
  volume: 'bg-accent/15 text-accent-bright',
  gone: 'bg-fg-faint/20 text-fg-muted',
  new: 'bg-accent/15 text-accent-bright',
  few: 'text-fg-faint',
};

function ms(v: number | undefined): string {
  return v === undefined ? '–' : Math.round(v).toLocaleString();
}

function pctText(c: number | null): string {
  if (c === null) return '';
  const p = Math.round(c * 100);
  return `${p > 0 ? '+' : ''}${p}%`;
}

function Delta({ cur, base, worseUp = true }: { cur: number | undefined; base: number | undefined; worseUp?: boolean }) {
  const c = change(cur, base);
  if (c === null) return null;
  const bad = worseUp ? c >= 0.5 : c <= -0.5;
  const good = worseUp ? c <= -0.2 : c >= 0.2;
  return <span className={`ml-1 text-micro ${bad ? 'text-danger' : good ? 'text-ok' : 'text-fg-faint'}`}>{pctText(c)}</span>;
}

export const StatsTable = memo(function StatsTable({ rows, rules, selected, onSelect }: StatsTableProps) {
  const [sort, setSort] = useState<SortKey>('worst');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
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
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = judged.filter(
      j =>
        (!onlyFlagged || j.flags.some(f => f !== 'few')) &&
        (q === '' || j.row.service.toLowerCase().includes(q)),
    );
    const cur = (j: (typeof judged)[number]) => j.row.current;
    switch (sort) {
      case 'worst':
        return list.sort((a, b) => b.score - a.score);
      case 'count':
        return list.sort((a, b) => (cur(b)?.count ?? 0) - (cur(a)?.count ?? 0));
      case 'avg':
        return list.sort((a, b) => (cur(b)?.avg_ms ?? 0) - (cur(a)?.avg_ms ?? 0));
      case 'name':
        return list.sort((a, b) => a.row.service.localeCompare(b.row.service));
    }
  }, [judged, onlyFlagged, query, sort]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 pb-1 text-micro">
        <input
          type="text"
          value={query}
          spellCheck={false}
          placeholder={t('서비스 거르기')}
          onChange={e => setQuery(e.target.value)}
          className="search-field w-48 rounded py-0.5 pr-2 text-small"
        />
        <label className="flex items-center gap-1 text-fg-dim">
          <input type="checkbox" checked={onlyFlagged} onChange={e => setOnlyFlagged(e.target.checked)} />
          {t('특이사항만')}
        </label>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortKey)}
          className="rounded border border-line-control bg-input px-2 py-0.5 pr-[26px] text-small text-fg"
          aria-label={t('정렬')}
        >
          <option value="worst">{t('나빠진 순')}</option>
          <option value="count">{t('현재 건수 순')}</option>
          <option value="avg">{t('현재 평균 순')}</option>
          <option value="name">{t('이름 순')}</option>
        </select>
        <span className="text-fg-dim">
          {shown.length.toLocaleString()} / {rows.length.toLocaleString()}
        </span>
        {FLAG_ORDER.filter(f => counts.get(f)).map(f => (
          <span key={f} className={`rounded px-1 ${FLAG_CLS[f]}`}>
            {t(FLAG_LABEL[f])} {counts.get(f)}
          </span>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded border border-line">
        <table className="w-full border-collapse text-small">
          <thead className="sticky top-0 bg-raised text-micro text-fg-dim">
            <tr>
              <th className="px-2 py-1 text-left">{t('서비스')}</th>
              <th className="px-2 py-1 text-left">{t('특이사항')}</th>
              <th className="px-2 py-1 text-right">{t('건수 현재 / 기준')}</th>
              <th className="px-2 py-1 text-right">{t('평균(ms) 현재 / 기준')}</th>
              <th className="px-2 py-1 text-right">{t('p90(ms) 현재 / 기준')}</th>
              <th className="px-2 py-1 text-right">{t('최대(ms) 현재 / 기준')}</th>
              <th className="px-2 py-1 text-right">{t('에러율 현재 / 기준')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ row: r, flags }) => {
              const c = r.current ?? undefined;
              const b = r.baseline ?? undefined;
              const on = r.service === selected;
              return (
                <tr
                  key={r.service}
                  onClick={() => onSelect(r.service)}
                  className={`cursor-pointer border-t border-line ${on ? 'bg-accent/15' : 'hover:bg-hover'}`}
                >
                  <td className="max-w-[28rem] truncate px-2 py-0.5 font-mono" title={r.service}>
                    {r.service}
                  </td>
                  <td className="whitespace-nowrap px-2 py-0.5">
                    {flags.map(f => (
                      <span key={f} className={`mr-1 rounded px-1 text-micro ${FLAG_CLS[f]}`}>
                        {t(FLAG_LABEL[f])}
                      </span>
                    ))}
                  </td>
                  <td className="tnum whitespace-nowrap px-2 py-0.5 text-right">
                    {c?.count.toLocaleString() ?? '–'} <span className="text-fg-faint">/ {b?.count.toLocaleString() ?? '–'}</span>
                    <Delta cur={c?.tps} base={b?.tps} />
                  </td>
                  <td className="tnum whitespace-nowrap px-2 py-0.5 text-right">
                    {ms(c?.avg_ms)} <span className="text-fg-faint">/ {ms(b?.avg_ms)}</span>
                    <Delta cur={c?.avg_ms} base={b?.avg_ms} />
                  </td>
                  <td className="tnum whitespace-nowrap px-2 py-0.5 text-right">
                    {ms(c?.p90_ms)} <span className="text-fg-faint">/ {ms(b?.p90_ms)}</span>
                    <Delta cur={c?.p90_ms} base={b?.p90_ms} />
                  </td>
                  <td className="tnum whitespace-nowrap px-2 py-0.5 text-right">
                    {ms(c?.max_ms)} <span className="text-fg-faint">/ {ms(b?.max_ms)}</span>
                  </td>
                  <td className="tnum whitespace-nowrap px-2 py-0.5 text-right">
                    {c ? `${(c.error_rate * 100).toFixed(2)}%` : '–'}{' '}
                    <span className="text-fg-faint">/ {b ? `${(b.error_rate * 100).toFixed(2)}%` : '–'}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="p-3 text-micro text-fg-dim">{t('보일 서비스가 없습니다')}</p>}
      </div>
    </div>
  );
});
