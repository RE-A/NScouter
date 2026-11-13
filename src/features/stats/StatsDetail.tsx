// 서비스 하나 펼쳐 보기 — 현재와 과거를 나란히, 가장 느린·에러 트랜잭션은 눌러서 XLog 탭에서 연다

import { memo, useEffect, useState } from 'react';
import { t } from '../../i18n';
import type { Sample, ServiceStats, StatsSummary } from './statsApi';
import { StatsCharts } from './StatsCharts';
import { statsService } from './statsApi';
import { fmtMetric, fmtVs, pastView } from './statsFormat';
import { dayValue } from './statsJudge';
import { rangeLabel } from './StatsForm';
import type { DaySummary, StatsRange } from './statsApi';
import { termHelp } from './statsGlossary';

interface StatsDetailProps {
  jobId: string;
  service: string;
  onOpenTxid: (txid: string, date: string) => void;
  /** 차트의 시간축 — 기준 구간과 과거 구간들 */
  range: StatsRange;
  baselines: StatsRange[];
}

type Field = { label: string; get: (s: StatsSummary) => number; fmt: (v: number) => string; help: string };

const int = (v: number) => Math.round(v).toLocaleString();

/** 표에 없는 것만 — 건수·평균·p90·p99·에러율은 위 표에 있다 */
function fields(): Field[] {
  return [
    { label: 'p50(ms)', get: s => s.p50_ms, fmt: int, help: termHelp('p50') },
    { label: 'TPS', get: s => s.tps, fmt: v => v.toFixed(2), help: termHelp('tps') },
    { label: t('최대(ms)'), get: s => s.max_ms, fmt: int, help: termHelp('max') },
    { label: t('SQL 시간(ms, 건당)'), get: s => s.sql_ms_avg, fmt: int, help: termHelp('sql') },
    { label: t('API 시간(ms, 건당)'), get: s => s.api_ms_avg, fmt: int, help: termHelp('api') },
    { label: t('CPU(ms, 건당)'), get: s => s.cpu_ms_avg, fmt: int, help: termHelp('cpu') },
  ];
}

export const StatsDetail = memo(function StatsDetail({ jobId, service, onOpenTxid, range, baselines }: StatsDetailProps) {
  const [data, setData] = useState<ServiceStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    statsService(jobId, service)
      .then(d => alive && setData(d))
      .catch(e => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [jobId, service]);

  const c = data?.current ?? null;
  // 과거는 표와 같이 일자별 평균으로
  const b = data ? pastView(data, baselines.length) : null;
  if (error) return <p className="text-small text-danger">{error}</p>;
  if (!data) return <p className="text-small text-fg-dim">{t('불러오는 중…')}</p>;
  const samples = (c?.slowest.length ?? 0) + (c?.errored.length ?? 0) > 0;
  return (
    <div className="flex flex-col gap-4">
    <StatsCharts current={c} baseline={data.baseline} range={range} baselines={baselines} />
    {(data.baseline_days?.length ?? 0) >= 2 && <DaysTable data={data} baselines={baselines} />}
    <div className="flex flex-wrap items-start gap-x-10 gap-y-3">
      <table className="st-card tnum w-[22rem] border-separate border-spacing-x-3 border-spacing-y-0 p-2 text-body">
        <thead className="text-small text-fg-dim">
          <tr>
            <th className="pb-1 text-left font-normal" />
            <th className="pb-1.5 text-right font-normal"><span className="st-pill st-pill-ref">{t('기준')}</span></th>
            <th className="pb-1.5 text-right font-normal"><span className="st-pill st-pill-past">{t('과거')}</span></th>
            <th className="w-16 pb-1 text-right font-normal">{t('과거 대비')}</th>
          </tr>
        </thead>
        <tbody>
          {fields().map(f => {
            const cv = c ? f.get(c) : undefined;
            const bv = b ? f.get(b) : undefined;
            return (
              <tr key={f.label}>
                <td className="py-1 text-small text-fg-dim" title={f.help}>
                  <span className="st-help">{f.label}</span>
                </td>
                <td className="text-right text-fg">{cv === undefined ? '–' : f.fmt(cv)}</td>
                <td className="text-right text-fg-dim">{bv === undefined ? '–' : f.fmt(bv)}</td>
                <td className="text-right text-micro text-fg-faint">{fmtVs(cv, bv)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {samples && (
        <div className="flex w-72 flex-col gap-3">
          <Samples title={t('가장 느린 것 (기준)')} list={c?.slowest ?? []} onOpen={onOpenTxid} />
          <Samples title={t('최근 에러 (기준)')} list={c?.errored ?? []} onOpen={onOpenTxid} />
          <p className="text-micro text-fg-faint">{t('누르면 XLog 탭에서 프로파일을 엽니다')}</p>
        </div>
      )}
    </div>
    </div>
  );
});

type DayCol = { label: string; get: (d: DaySummary) => number; fmt: (v: number) => string; worse: 'up' | 'none'; help: string };

function dayCols(): DayCol[] {
  const ms = (v: number) => Math.round(v).toLocaleString();
  return [
    { label: t('건수'), get: d => d.count, fmt: ms, worse: 'none', help: termHelp('count') },
    { label: t('평균(ms)'), get: d => dayValue(d, 'avg'), fmt: ms, worse: 'up', help: termHelp('avg') },
    { label: 'p50(ms)', get: d => dayValue(d, 'p50'), fmt: ms, worse: 'up', help: termHelp('p50') },
    { label: 'p90(ms)', get: d => dayValue(d, 'p90'), fmt: ms, worse: 'up', help: termHelp('p90') },
    { label: 'p99(ms)', get: d => dayValue(d, 'p99'), fmt: ms, worse: 'up', help: termHelp('p99') },
    { label: t('에러율'), get: d => dayValue(d, 'err'), fmt: v => fmtMetric('err', v), worse: 'up', help: termHelp('err') },
  ];
}

/**
 * 과거 일자별 — 날마다의 값, 그리고 **일평균**(날마다 같은 무게)·최소·최대.
 * 맨 위에 기준을 두어 «과거 어느 날보다도 나쁜가» 를 한눈에 본다. 날들 중 가장 나빴던 칸은 진하게
 */
function DaysTable({ data, baselines }: { data: ServiceStats; baselines: StatsRange[] }) {
  const all = data.baseline_days ?? [];
  const days = all.filter(d => d.count > 0);
  const cols = dayCols();
  const c = data.current;
  const cur: DaySummary | null = c
    ? { count: c.count, errors: c.errors, error_rate: c.error_rate, tps: c.tps, avg_ms: c.avg_ms, p50_ms: c.p50_ms, p90_ms: c.p90_ms, p99_ms: c.p99_ms, max_ms: c.max_ms }
    : null;
  const stat = (f: (vs: number[]) => number) => (col: DayCol) =>
    days.length === 0 ? '–' : col.fmt(f(col === cols[0] ? all.map(col.get) : days.map(col.get)));
  const mean = stat(vs => vs.reduce((x, y) => x + y, 0) / vs.length);
  const min = stat(vs => Math.min(...vs));
  const max = stat(vs => Math.max(...vs));
  const worst = cols.map(col => (col.worse === 'up' && days.length > 0 ? Math.max(...days.map(col.get)) : null));
  return (
    <div className="st-card w-fit max-w-full overflow-auto p-2">
      <div className="mb-1.5 px-1 text-small text-fg-muted" title={termHelp('past')}>
        <span className="st-help">{t('과거 일자별')}</span>
        <span className="ml-2 text-micro text-fg-faint">{t('일평균은 날마다 낸 값의 평균 · 건수가 없던 날은 응답시간·에러율 평균에서 뺍니다')}</span>
      </div>
      <table className="tnum w-auto border-collapse text-small">
        <thead className="text-micro text-fg-dim">
          <tr>
            <th className="px-2 py-1 text-left font-normal" />
            {cols.map(col => (
              <th key={col.label} className="px-2 py-1 text-right font-normal" title={col.help}>
                <span className="st-help-soft">{col.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cur && (
            <tr className="st-ref border-b border-line">
              <td className="px-2 py-1">
                <span className="st-pill st-pill-ref">{t('기준')}</span>
              </td>
              {cols.map((col, i) => {
                const v = col.get(cur);
                const above = worst[i] !== null && v > (worst[i] ?? 0);
                return (
                  <td key={col.label} className={`px-2 py-1 text-right font-semibold ${above ? 'text-danger' : 'text-fg'}`} title={above ? t('과거 어느 날보다도 나쁩니다') : undefined}>
                    {col.fmt(v)}
                  </td>
                );
              })}
            </tr>
          )}
          {all.map((d, di) => (
            <tr key={di} className="border-b border-line/60">
              <td className="whitespace-nowrap px-2 py-1 text-fg-dim">{baselines[di] ? rangeLabel(baselines[di]) : `#${di + 1}`}</td>
              {cols.map((col, i) => {
                const v = col.get(d);
                const isWorst = d.count > 0 && worst[i] !== null && v === worst[i] && days.length > 1;
                return (
                  <td key={col.label} className={`px-2 py-1 text-right ${d.count === 0 && i > 0 ? 'text-fg-faint' : isWorst ? 'font-semibold text-warn' : 'text-fg-muted'}`}>
                    {d.count === 0 && i > 0 ? '–' : col.fmt(v)}
                  </td>
                );
              })}
            </tr>
          ))}
          {[
            [t('일평균'), mean],
            [t('최소'), min],
            [t('최대'), max],
          ].map(([label, f]) => (
            <tr key={label as string} className="bg-surface/60">
              <td className="px-2 py-1 font-medium text-fg-muted">{label as string}</td>
              {cols.map(col => (
                <td key={col.label} className="px-2 py-1 text-right text-fg-muted">
                  {(f as (c: DayCol) => string)(col)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Samples({ title, list, onOpen }: { title: string; list: Sample[]; onOpen: (txid: string, date: string) => void }) {
  if (list.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-small text-fg-dim">{title}</div>
      {list.map(s => (
        <button
          key={s.txid}
          type="button"
          onClick={() => onOpen(s.txid, s.date)}
          className="btn-ghost flex w-full justify-between px-1.5 py-0.5 text-small"
        >
          <span className="tnum text-fg-muted">{new Date(s.end_time).toLocaleTimeString()}</span>
          <span className={`tnum ${s.error ? 'text-danger' : 'text-fg'}`}>{s.elapsed.toLocaleString()} ms</span>
        </button>
      ))}
    </div>
  );
}
