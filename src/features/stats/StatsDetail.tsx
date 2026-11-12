// 서비스 하나 펼쳐 보기 — 두 쪽 숫자를 나란히, 가장 느린·에러 트랜잭션은 눌러서 XLog 탭에서 연다
//
// 추이 그래프·분포 겹쳐 보기는 다음 단계(차트 라이브러리)에서 붙인다. 여기서는 숫자로 먼저 보인다.

import { memo, useEffect, useState } from 'react';
import { t } from '../../i18n';
import type { Sample, ServiceStats, StatsSummary } from './statsApi';
import { statsService } from './statsApi';
import { change } from './statsJudge';

interface StatsDetailProps {
  jobId: string;
  service: string;
  onOpenTxid: (txid: string, date: string) => void;
  onClose: () => void;
}

type Field = { label: string; get: (s: StatsSummary) => number; fmt?: (v: number) => string; worseUp?: boolean };

const int = (v: number) => Math.round(v).toLocaleString();
const one = (v: number) => (Math.round(v * 10) / 10).toLocaleString();
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

function fields(): Field[] {
  return [
    { label: t('건수'), get: s => s.count, fmt: int, worseUp: false },
    { label: 'TPS', get: s => s.tps, fmt: v => v.toFixed(3), worseUp: false },
    { label: t('에러율'), get: s => s.error_rate, fmt: pct },
    { label: t('평균(ms)'), get: s => s.avg_ms, fmt: int },
    { label: 'p50(ms)', get: s => s.p50_ms, fmt: int },
    { label: 'p90(ms)', get: s => s.p90_ms, fmt: int },
    { label: 'p95(ms)', get: s => s.p95_ms, fmt: int },
    { label: 'p99(ms)', get: s => s.p99_ms, fmt: int },
    { label: t('최대(ms)'), get: s => s.max_ms, fmt: int },
    { label: t('SQL 횟수'), get: s => s.sql_count_avg, fmt: one },
    { label: 'SQL(ms)', get: s => s.sql_ms_avg, fmt: int },
    { label: t('API 횟수'), get: s => s.api_count_avg, fmt: one },
    { label: 'API(ms)', get: s => s.api_ms_avg, fmt: int },
    { label: 'CPU(ms)', get: s => s.cpu_ms_avg, fmt: int },
  ];
}

export const StatsDetail = memo(function StatsDetail({ jobId, service, onOpenTxid, onClose }: StatsDetailProps) {
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
  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-auto rounded border border-line p-2 text-small">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-fg" title={service}>
          {service}
        </span>
        <button type="button" className="btn-ghost px-1.5 py-0.5 text-micro" onClick={onClose} aria-label={t('닫기')}>
          ✕
        </button>
      </div>
      {error && <p className="text-micro text-danger">{error}</p>}
      {data && (
        <>
          <table className="tnum w-full text-small">
            <thead className="text-micro text-fg-dim">
              <tr>
                <th className="text-left font-normal" />
                <th className="text-right font-normal">{t('현재')}</th>
                <th className="text-right font-normal">{t('기준')}</th>
                <th className="text-right font-normal">{t('변화')}</th>
              </tr>
            </thead>
            <tbody>
              {fields().map(f => {
                const cv = c ? f.get(c) : undefined;
                const bv = b ? f.get(b) : undefined;
                const ch = change(cv, bv);
                const fmt = f.fmt ?? int;
                const bad = ch !== null && ((f.worseUp ?? true) ? ch >= 0.5 : false);
                return (
                  <tr key={f.label} className="border-t border-line">
                    <td className="py-0.5 text-fg-dim">{f.label}</td>
                    <td className="text-right">{cv === undefined ? '–' : fmt(cv)}</td>
                    <td className="text-right text-fg-muted">{bv === undefined ? '–' : fmt(bv)}</td>
                    <td className={`text-right text-micro ${bad ? 'text-danger' : 'text-fg-faint'}`}>
                      {ch === null ? '' : `${ch > 0 ? '+' : ''}${Math.round(ch * 100)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Samples title={t('현재 — 가장 느린 것')} list={c?.slowest ?? []} onOpen={onOpenTxid} />
          <Samples title={t('현재 — 최근 에러')} list={c?.errored ?? []} onOpen={onOpenTxid} />
          <Samples title={t('기준 — 가장 느린 것')} list={b?.slowest ?? []} onOpen={onOpenTxid} />
        </>
      )}
    </div>
  );
});

function Samples({ title, list, onOpen }: { title: string; list: Sample[]; onOpen: (txid: string, date: string) => void }) {
  if (list.length === 0) return null;
  return (
    <div>
      <div className="mb-0.5 text-micro text-fg-dim">{title}</div>
      {list.map(s => (
        <button
          key={s.txid}
          type="button"
          onClick={() => onOpen(s.txid, s.date)}
          className="btn-ghost flex w-full justify-between px-1 py-0 text-micro"
          title={t('XLog 탭에서 프로파일 열기')}
        >
          <span className="tnum font-mono text-fg-muted">{new Date(s.end_time).toLocaleString()}</span>
          <span className={`tnum font-mono ${s.error ? 'text-danger' : 'text-fg'}`}>{s.elapsed.toLocaleString()} ms</span>
        </button>
      ))}
    </div>
  );
}
