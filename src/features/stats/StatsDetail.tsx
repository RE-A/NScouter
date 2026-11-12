// 서비스 하나 펼쳐 보기 — 현재와 평소를 나란히, 가장 느린·에러 트랜잭션은 눌러서 XLog 탭에서 연다

import { memo, useEffect, useState } from 'react';
import { t } from '../../i18n';
import type { Sample, ServiceStats, StatsRange, StatsSummary } from './statsApi';
import { StatsCharts } from './StatsCharts';
import { statsService } from './statsApi';
import { change } from './statsJudge';

interface StatsDetailProps {
  jobId: string;
  service: string;
  onOpenTxid: (txid: string, date: string) => void;
  /** 차트의 시간축 — 현재 구간과 평소 구간들 */
  range: StatsRange;
  baselines: StatsRange[];
}

type Field = { label: string; get: (s: StatsSummary) => number; fmt: (v: number) => string; judge?: boolean };

const int = (v: number) => Math.round(v).toLocaleString();
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

function fields(): Field[] {
  return [
    { label: t('건수'), get: s => s.count, fmt: int },
    { label: 'TPS', get: s => s.tps, fmt: v => v.toFixed(2) },
    { label: t('에러율'), get: s => s.error_rate, fmt: pct, judge: true },
    { label: t('평균(ms)'), get: s => s.avg_ms, fmt: int, judge: true },
    { label: 'p90(ms)', get: s => s.p90_ms, fmt: int, judge: true },
    { label: 'p99(ms)', get: s => s.p99_ms, fmt: int, judge: true },
    { label: t('최대(ms)'), get: s => s.max_ms, fmt: int },
    { label: 'SQL(ms)', get: s => s.sql_ms_avg, fmt: int, judge: true },
    { label: 'API(ms)', get: s => s.api_ms_avg, fmt: int, judge: true },
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
  const b = data?.baseline ?? null;
  if (error) return <p className="text-small text-danger">{error}</p>;
  if (!data) return <p className="text-small text-fg-dim">{t('불러오는 중…')}</p>;
  const samples = (c?.slowest.length ?? 0) + (c?.errored.length ?? 0) > 0;
  return (
    <div className="flex flex-col gap-4">
    <StatsCharts current={c} baseline={b} range={range} baselines={baselines} />
    <div className="flex flex-wrap items-start gap-x-10 gap-y-3">
      <table className="tnum w-80 text-body">
        <thead className="text-small text-fg-dim">
          <tr>
            <th className="pb-1 text-left font-normal" />
            <th className="pb-1 text-right font-normal">{t('현재')}</th>
            <th className="pb-1 text-right font-normal">{t('평소')}</th>
            <th className="w-14 pb-1 text-right font-normal" />
          </tr>
        </thead>
        <tbody>
          {fields().map(f => {
            const cv = c ? f.get(c) : undefined;
            const bv = b ? f.get(b) : undefined;
            const ch = change(cv, bv);
            const p = ch === null ? 0 : Math.round(ch * 100);
            const cls = f.judge && ch !== null && ch >= 0.5 ? 'text-danger' : 'text-fg-faint';
            return (
              <tr key={f.label}>
                <td className="py-0.5 text-small text-fg-dim">{f.label}</td>
                <td className="text-right text-fg">{cv === undefined ? '–' : f.fmt(cv)}</td>
                <td className="text-right text-fg-muted">{bv === undefined ? '–' : f.fmt(bv)}</td>
                <td className={`text-right text-micro ${cls}`}>{Math.abs(p) < 10 ? '' : `${p > 0 ? '▲' : '▼'}${Math.abs(p)}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {samples && (
        <div className="flex w-72 flex-col gap-3">
          <Samples title={t('가장 느린 것')} list={c?.slowest ?? []} onOpen={onOpenTxid} />
          <Samples title={t('최근 에러')} list={c?.errored ?? []} onOpen={onOpenTxid} />
          <p className="text-micro text-fg-faint">{t('누르면 XLog 탭에서 프로파일을 엽니다')}</p>
        </div>
      )}
    </div>
    </div>
  );
});

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
