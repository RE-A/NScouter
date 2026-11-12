// 통계 탭 — 대상 하나의 URL 서비스를 «현재» 와 «평소(기준)» 로 나눠 비교한다
//
// 작업은 Rust 가 백그라운드에서 돌린다(`stats` 모듈) — 하루치를 훑으면 몇 분이 걸릴 수 있어서
// 화면을 떠나도, 다른 탭을 봐도 계속 돈다. 끝난 결과는 파일로 남아 다시 열 수 있다.
// 이 탭은 조건을 넣고, 진행을 보이고, 결과 표를 그리는 일만 한다.

import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import { Button } from '../../components/Button';
import { getConfig, saveCsvExport } from '../xlog/api/scouterApi';
import { toFileStamp } from '../xlog/utils/xlogDate';
import { toLocalInput } from '../xlog/types/timeRange';
import {
  onStatsDone,
  onStatsProgress,
  statsControl,
  statsDelete,
  statsEstimate,
  statsJobs,
  statsResult,
  statsSaveRules,
  statsStart,
  type Estimate,
  type JobInfo,
  type StatsProgress,
  type StatsResult,
  type StatsTaskRule,
} from './statsApi';
import { statsCsv } from './statsCsv';
import { DEFAULT_RULES } from './statsJudge';
import { draftError, initialDraft, rangeLabel, StatsForm, toRequest, type StatsDraft } from './StatsForm';
import { StatsTable } from './StatsTable';
import { StatsDetail } from './StatsDetail';

interface StatsTabProps {
  connected: boolean;
  /** 고를 수 있는 서비스 묶음 이름 */
  groups: string[];
  /** 고를 수 있는 서버 이름 */
  servers: string[];
  onOpenTxid: (txid: string, date: string) => void;
}

const fmt = (ms: number) => toLocalInput(ms).replace('T', ' ');

function tzOffset(): number {
  return -new Date().getTimezoneOffset() * 60_000;
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}${t('초')}`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}${t('분')} ${s % 60}${t('초')}` : `${Math.floor(m / 60)}${t('시간')} ${m % 60}${t('분')}`;
}

export const STATUS_LABEL: Record<JobInfo['status'], string> = {
  running: '도는 중',
  done: '완료',
  cancelled: '취소됨',
  failed: '실패',
};

export const StatsTab = memo(function StatsTab({ connected, groups, servers, onOpenTxid }: StatsTabProps) {
  const [draft, setDraft] = useState<StatsDraft>(() => initialDraft(Date.now()));
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [progress, setProgress] = useState<Record<string, StatsProgress>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [result, setResult] = useState<StatsResult | null>(null);
  const [service, setService] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [rules, setRules] = useState<StatsTaskRule[]>([]);
  const openRef = useRef(openId);
  openRef.current = openId;

  const reloadJobs = useCallback(() => {
    statsJobs()
      .then(list => setJobs(list.sort((a, b) => b.started_at - a.started_at)))
      .catch(e => setError(String(e)));
  }, []);

  const openResult = useCallback((id: string) => {
    setOpenId(id);
    setService(null);
    setResult(null);
    statsResult(id)
      .then(r => {
        if (openRef.current === id) setResult(r);
      })
      .catch(e => setError(String(e)));
  }, []);

  // 저장한 Task 이름 규칙 (config.json)
  useEffect(() => {
    getConfig()
      .then(c => setRules(c.stats_rules ?? []))
      .catch(() => {});
  }, []);

  const saveRules = useCallback((next: StatsTaskRule[]) => {
    statsSaveRules(next)
      .then(() => setRules(next))
      .catch(e => setError(String(e)));
  }, []);

  useEffect(() => {
    reloadJobs();
    const subs = [
      onStatsProgress((id, p) => setProgress(prev => ({ ...prev, [id]: p }))),
      onStatsDone(id => {
        setProgress(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        reloadJobs();
        // 지금 보고 있는 작업이 끝났으면 결과를 바로 띄운다
        if (openRef.current === id) openResult(id);
      }),
    ];
    return () => {
      for (const s of subs) void s.then(un => un());
    };
  }, [reloadJobs, openResult]);

  // 조건이 바뀌면 미리 본 건수는 맞지 않는다 (제목·원본 CSV 여부는 건수와 무관)
  const countKey = JSON.stringify({ ...draft, title: '', raw: false });
  useEffect(() => setEstimate(null), [countKey]);

  const tz = useMemo(tzOffset, []);

  const onEstimate = useCallback(() => {
    if (draftError(draft)) return;
    setEstimating(true);
    setError(null);
    statsEstimate(toRequest(draft, tz))
      .then(setEstimate)
      .catch(e => setError(String(e)))
      .finally(() => setEstimating(false));
  }, [draft, tz]);

  const onStart = useCallback(() => {
    if (draftError(draft)) return;
    setStarting(true);
    setError(null);
    statsStart(toRequest(draft, tz))
      .then(id => {
        setOpenId(id);
        setResult(null);
        setService(null);
        setShowForm(false);
        reloadJobs();
      })
      .catch(e => setError(String(e)))
      .finally(() => setStarting(false));
  }, [draft, tz, reloadJobs]);

  const onDelete = useCallback(
    (id: string) => {
      statsDelete(id)
        .then(() => {
          if (openRef.current === id) {
            setOpenId(null);
            setResult(null);
          }
          reloadJobs();
        })
        .catch(e => setError(String(e)));
    },
    [reloadJobs],
  );

  /** 지난 조건을 폼으로 되돌린다 — 구간만 바꿔 다시 돌리는 일이 잦다 */
  const reuse = useCallback((j: JobInfo) => {
    const r = j.request;
    const join = (l: string[]) => l.join(', ');
    // 예전 결과의 «서버 이름 글자» 는 별표 없는 규칙과 같다(포함)
    const pats = r.task_patterns?.length ? r.task_patterns : r.servers;
    setDraft({
      title: '',
      targetKind: r.groups.length > 0 ? 'group' : 'rule',
      target: r.groups[0] ?? '',
      rule: r.groups.length > 0 ? '' : pats.join('\n'),
      ruleName: rules.find(x => x.patterns.join('\n') === pats.join('\n'))?.name ?? '',
      current: r.current,
      baselines: r.baselines,
      services: r.services.join('\n'),
      serviceInclude: join(r.service_include),
      serviceExclude: join(r.service_exclude),
      ipInclude: join(r.ip_include),
      ipExclude: join(r.ip_exclude),
      raw: r.raw,
    });
    setShowForm(true);
  }, [rules]);

  const exportCsv = useCallback(() => {
    if (!result) return;
    const r = result.request;
    const name = `stats-${r.groups[0] ?? r.task_patterns?.[0] ?? r.servers[0] ?? 'target'}`;
    saveCsvExport({ name, stamp: toFileStamp(result.started_at), csv: statsCsv(result.services, DEFAULT_RULES) })
      .then(path => setNotice(path))
      .catch(e => setError(String(e)));
  }, [result]);

  const resultId = result?.id ?? null;
  const renderDetail = useCallback(
    (svc: string) => (resultId ? <StatsDetail jobId={resultId} service={svc} onOpenTxid={onOpenTxid} /> : null),
    [resultId, onOpenTxid],
  );

  const openJob = jobs.find(j => j.id === openId) ?? null;
  const running = openJob?.status === 'running' ? (progress[openJob.id] ?? openJob.progress) : null;
  const req = openJob?.request ?? result?.request ?? null;
  const missing = result?.ranges.reduce((n, r) => n + r.missing.length, 0) ?? 0;

  return (
    <div className="flex h-full min-h-0 gap-2 p-2">
      {/* ── 작업 목록 ── */}
      <aside className="flex w-64 shrink-0 flex-col gap-1 overflow-auto rounded border border-line p-1">
        <Button variant={showForm ? 'default' : 'primary'} size="sm" onClick={() => setShowForm(true)}>
          {t('+ 새 비교')}
        </Button>
        {jobs.length === 0 && <p className="p-2 text-small text-fg-dim">{t('지난 결과가 없습니다')}</p>}
        {jobs.map(j => {
          const p = progress[j.id] ?? j.progress;
          const on = j.id === openId;
          return (
            <div
              key={j.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                setShowForm(false);
                if (j.status === 'running') {
                  setOpenId(j.id);
                  setResult(null);
                } else openResult(j.id);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') openResult(j.id);
              }}
              className={`cursor-pointer rounded px-2 py-1.5 text-small ${on ? 'bg-accent/15' : 'hover:bg-hover'}`}
            >
              <div className="truncate text-body text-fg" title={j.title}>
                {j.title}
              </div>
              <div className="flex items-center gap-1 text-fg-dim">
                <span className={j.status === 'failed' ? 'text-danger' : j.status === 'running' ? 'text-accent-bright' : ''}>
                  {t(STATUS_LABEL[j.status])}
                </span>
                {j.status === 'running' && p && p.slices_total > 0 && (
                  <span className="tnum">{Math.floor((p.slices_done / p.slices_total) * 100)}%</span>
                )}
                {j.status !== 'running' && <span className="tnum">· {j.services.toLocaleString()}{t('개 서비스')}</span>}
                <span className="flex-1" />
                <span className="tnum">{fmt(j.started_at).slice(5)}</span>
              </div>
            </div>
          );
        })}
      </aside>

      {/* ── 본문 ── */}
      <section className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">
        {error && (
          <p className="rounded border-l-2 border-danger bg-danger/10 px-2 py-1 text-small text-danger">
            {error}{' '}
            <button type="button" className="underline" onClick={() => setError(null)}>
              {t('닫기')}
            </button>
          </p>
        )}

        {showForm ? (
          <div className="overflow-auto rounded border border-line p-4">
            <StatsForm
              draft={draft}
              onChange={setDraft}
              groups={groups}
              servers={servers}
              rules={rules}
              onSaveRules={saveRules}
              tzOffsetMs={tz}
              connected={connected}
              estimate={estimate}
              estimating={estimating}
              onEstimate={onEstimate}
              onStart={onStart}
              starting={starting}
            />
          </div>
        ) : openJob === null && result === null ? (
          <p className="p-3 text-small text-fg-dim">{t('왼쪽에서 결과를 고르거나 새 비교를 시작하세요')}</p>
        ) : (
          <>
            {/* 머리 — 조건 요약과 할 일 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-title font-medium text-fg">{openJob?.title ?? result?.request.title}</h2>
              {req && (
                <span className="tnum text-small text-fg-dim">
                  {t('현재')} {rangeLabel(req.current)} · {t('평소')} {req.baselines.length}
                  {t('개 구간')}
                </span>
              )}
              {result && result.ranges.length > 0 && <ServerCount ranges={result.ranges} />}
              <span className="flex-1" />
              {openJob && (
                <Button size="sm" onClick={() => reuse(openJob)}>
                  {t('조건 다시 쓰기')}
                </Button>
              )}
              {result && (
                <Button size="sm" onClick={exportCsv} disabled={result.services.length === 0} title={t('서비스 한 줄에 현재·평소·변화')}>
                  {t('요약 CSV')}
                </Button>
              )}
              {result?.raw_path && (
                <Button
                  size="sm"
                  onClick={() => void revealItemInDir(result.raw_path ?? '').catch(() => {})}
                  title={result.raw_path}
                >
                  {t('원본 CSV')} <span className="tnum text-fg-faint">{result.raw_rows.toLocaleString()}{t('건')}</span>
                </Button>
              )}
              {openJob && openJob.status !== 'running' && (
                <Button variant="danger" size="sm" onClick={() => onDelete(openJob.id)}>
                  {t('지우기')}
                </Button>
              )}
            </div>
            {notice && (
              <p className="text-small text-fg-dim">
                {t('저장했습니다')}:{' '}
                <button type="button" className="underline hover:text-fg" onClick={() => void revealItemInDir(notice).catch(() => {})}>
                  {notice}
                </button>{' '}
                <button type="button" className="text-fg-faint hover:text-fg" onClick={() => setNotice(null)} aria-label={t('닫기')}>
                  ✕
                </button>
              </p>
            )}

            {openJob?.status === 'running' && (
              <ProgressBox id={openJob.id} progress={running} />
            )}

            {result && (
              <>
                {result.status !== 'done' && (
                  <Warn>
                    {result.status === 'cancelled' ? t('취소한 작업입니다 — 그때까지 모은 것만 있습니다') : t('실패한 작업입니다')}
                    {result.message ? ` — ${result.message}` : ''}
                  </Warn>
                )}
                {result.raw_error && <Warn>{result.raw_error}</Warn>}
                {missing > 0 && (
                  <Warn>
                    {t('못 받은 5분 조각이 있습니다')} ({missing}) — {t('그 시간대는 빠진 채로 계산했습니다')}
                  </Warn>
                )}
                <StatsTable
                  rows={result.services}
                  rules={DEFAULT_RULES}
                  selected={service}
                  onSelect={setService}
                  detail={renderDetail}
                />
                <p className="text-small text-fg-faint" title={rulesText()}>
                  {t('판정 기준')} ⓘ · {t('수집')} {result.collectors.join(' + ')} · {duration(result.finished_at - result.started_at)}
                </p>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
});

/** 실제로 훑은 서버 — 규칙이 맞게 걸렸는지 결과에서 확인한다 (마우스를 올리면 이름) */
function ServerCount({ ranges }: { ranges: StatsResult['ranges'] }) {
  const of = (kind: string) => [...new Set(ranges.filter(r => r.kind === kind).flatMap(r => r.servers))].sort();
  const cur = of('current');
  const base = of('baseline');
  return (
    <span
      className="tnum cursor-help text-small text-fg-dim underline decoration-dotted"
      title={`${t('현재')}:\n${cur.join('\n')}\n\n${t('평소')}:\n${base.join('\n')}`}
    >
      {t('서버')} {t('현재')} {cur.length}{t('대')} · {t('평소')} {base.length}{t('대')}
    </span>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return <p className="rounded border-l-2 border-warn bg-warn/10 px-2 py-1 text-small text-warn">{children}</p>;
}

/** 판정 기준 — 표 아래 ⓘ 에 마우스를 올리면 보인다 */
function rulesText(): string {
  const r = DEFAULT_RULES;
  return [
    `${t('에러 증가')}: ${t('에러율')} ×${r.errorRatio} · +${r.errorMinDelta * 100}%p`,
    `${t('느려짐')}: ${t('평균 또는 p90 이')} ×${r.slowRatio} · +${r.slowMinMs}ms`,
    `${t('호출량 급변')}: TPS ±${r.volumeRatio * 100}%`,
    `${t('표본 적음')}: < ${r.minCount}${t('건')} (${t('판정하지 않음')})`,
  ].join('\n');
}

function ProgressBox({ id, progress: p }: { id: string; progress: StatsProgress | null }) {
  const ratio = p && p.slices_total > 0 ? p.slices_done / p.slices_total : 0;
  return (
    <div className="flex flex-col gap-1 rounded border border-line p-2 text-small text-fg-dim" role="status">
      <div className="h-1.5 overflow-hidden rounded bg-hover">
        <div className="h-full bg-accent" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span>
          {!p || p.phase === 'plan' ? t('대상 서버를 찾는 중…') : p.paused ? t('잠시 멈춤') : t('훑는 중…')}
        </span>
        {p && p.slices_total > 0 && (
          <span className="tnum">
            {p.slices_done.toLocaleString()} / {p.slices_total.toLocaleString()} {t('조각')} · {t('받은 것')}{' '}
            {p.scanned.toLocaleString()} · {t('맞는 것')} {p.matched.toLocaleString()}
            {p.eta_ms !== null && !p.paused ? ` · ${t('남은 시간')} ~${duration(p.eta_ms)}` : ''}
          </span>
        )}
        <span className="flex-1" />
        {p?.paused ? (
          <Button size="xs" onClick={() => void statsControl(id, 'resume')}>
            {t('계속')}
          </Button>
        ) : (
          <Button size="xs" onClick={() => void statsControl(id, 'pause')}>
            {t('잠시 멈춤')}
          </Button>
        )}
        <Button variant="danger" size="xs" onClick={() => void statsControl(id, 'cancel')}>
          {t('취소')}
        </Button>
      </div>
    </div>
  );
}
