// 통계 탭 — 대상 하나의 URL 서비스를 «기준»(살펴볼 시점) 과 «과거»(견줄 지난 시점) 로 나눠 비교한다
//
// 작업은 Rust 가 백그라운드에서 돌린다(`stats` 모듈) — 하루치를 훑으면 몇 분이 걸릴 수 있어서
// 화면을 떠나도, 다른 탭을 봐도 계속 돈다. 끝난 결과는 파일로 남아 다시 열 수 있다.
// 이 탭은 조건을 넣고, 진행을 보이고, 결과 표를 그리는 일만 한다.

import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
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
  statsSavePrefs,
  statsSaveReport,
  statsSaveRules,
  statsService,
  statsShutdown,
  statsStart,
  type Estimate,
  type JobInfo,
  type StatsProgress,
  type ServiceStats,
  type StatsPrefs,
  type StatsResult,
  type StatsTaskRule,
} from './statsApi';
import { statsCsv } from './statsCsv';
import { DEFAULT_RULES, judge, prefsFromRules, rulesFromPrefs, type JudgeRules } from './statsJudge';
import { termHelp } from './statsGlossary';
import { slowName, withPastView } from './statsFormat';
import { StatsSettingsDialog } from './StatsSettingsDialog';
import { parsePresets, type StatsPreset } from './statsPresets';
import { statsReport } from './statsReport';
import { parseWidths, type ColId } from './statsTableModel';
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

/** 목록·머리에 쓰는 상태 — 돌고 있어도 앞 작업을 기다리는 중이면 «대기» */
function statusText(j: JobInfo, p: StatsProgress | null | undefined): string {
  return j.status === 'running' && p?.phase === 'queue' ? t('대기') : t(STATUS_LABEL[j.status]);
}

/** 상태 점의 색 */
const STATUS_DOT: Record<JobInfo['status'], string> = {
  running: 'bg-accent',
  done: 'bg-ok',
  cancelled: 'bg-fg-faint',
  failed: 'bg-danger',
};

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
  /** 판정 기준 · 보관 일수 · 조건 묶음 (config.json `stats`) */
  const [judgeRules, setJudgeRules] = useState<JudgeRules>(DEFAULT_RULES);
  const [keepDays, setKeepDays] = useState(90);
  const [presets, setPresets] = useState<StatsPreset[]>([]);
  const [colWidths, setColWidths] = useState<Partial<Record<ColId, number>>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [reporting, setReporting] = useState(false);
  /** 돌던 작업이 있는데 창을 닫으려 했다 */
  const [closeAsk, setCloseAsk] = useState(false);
  const [closing, setClosing] = useState(false);
  const runningRef = useRef(0);
  runningRef.current = jobs.filter(j => j.status === 'running').length;

  // **돌던 작업이 있으면 바로 닫지 않고 묻는다.** 그냥 닫히면 몇십 분짜리 작업이 흔적 없이 사라진다.
  // 닫기로 하면 취소하고 그때까지 모은 것을 «취소됨» 결과로 남긴 뒤 닫는다
  useEffect(() => {
    const un = getCurrentWindow().onCloseRequested(e => {
      if (runningRef.current > 0) {
        e.preventDefault();
        setCloseAsk(true);
      }
    });
    return () => {
      void un.then(f => f());
    };
  }, []);

  const closeNow = useCallback(() => {
    setClosing(true);
    statsShutdown()
      .catch(() => 0)
      .finally(() => void getCurrentWindow().destroy());
  }, []);
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
      .then(c => {
        setRules(c.stats_rules ?? []);
        const p = c.stats as Partial<StatsPrefs> | undefined;
        setJudgeRules(rulesFromPrefs(p?.judge));
        if (typeof p?.keep_days === 'number') setKeepDays(p.keep_days);
        setPresets(parsePresets(p?.presets));
        setColWidths(parseWidths(p?.col_widths));
      })
      .catch(() => {});
  }, []);

  /** 설정 한 벌을 통째로 저장한다 — 바꾼 것만 넘기면 나머지를 옛 값으로 덮는다 */
  const savePrefs = useCallback(
    (next: { rules?: JudgeRules; keepDays?: number; presets?: StatsPreset[]; colWidths?: Partial<Record<ColId, number>> }) => {
      const r = next.rules ?? judgeRules;
      const k = next.keepDays ?? keepDays;
      const ps = next.presets ?? presets;
      const cw = next.colWidths ?? colWidths;
      // 너비는 화면에 바로 — 저장이 끝나기를 기다리면 놓는 순간 열이 튄다
      if (next.colWidths) setColWidths(cw);
      statsSavePrefs({ judge: prefsFromRules(r), keep_days: k, presets: ps, col_widths: cw as Record<string, number> })
        .then(() => {
          setJudgeRules(r);
          setKeepDays(k);
          setPresets(ps);
        })
        .catch(e => setError(String(e)));
    },
    [judgeRules, keepDays, presets, colWidths],
  );

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
    saveCsvExport({ name, stamp: toFileStamp(result.started_at), csv: statsCsv(result.services, judgeRules, result.request.baselines.length, t) })
      .then(path => setNotice(path))
      .catch(e => setError(String(e)));
  }, [result, judgeRules]);

  /** HTML 보고서 — 특이사항 서비스는 추이까지 받아 차트를 넣는다(많으면 앞의 30개) */
  const exportReport = useCallback(() => {
    if (!result) return;
    setReporting(true);
    const flagged = result.services
      .filter(s => s.current !== null && judge(s, judgeRules).some(f => f !== 'few' && f !== 'gone'))
      .slice(0, 30);
    Promise.all(flagged.map(s => statsService(result.id, s.service).catch(() => null)))
      .then(list => {
        const details = new Map<string, ServiceStats>();
        for (const d of list) if (d) details.set(d.service, d);
        const r = result.request;
        const name = `stats-report-${r.groups[0] ?? r.task_patterns?.[0] ?? r.servers[0] ?? 'target'}`;
        return statsSaveReport(name, toFileStamp(result.started_at), statsReport(result, judgeRules, details, t));
      })
      .then(path => setNotice(path))
      .catch(e => setError(String(e)))
      .finally(() => setReporting(false));
  }, [result, judgeRules]);

  // 과거는 일자별 평균으로 — 표·판정·요약 카드가 모두 이것을 본다
  const pastViewRows = useMemo(
    () => (result ? withPastView(result.services, result.request.baselines.length) : []),
    [result],
  );

  const resultId = result?.id ?? null;
  const resultReq = result?.request ?? null;
  const renderDetail = useCallback(
    (svc: string) =>
      resultId && resultReq ? (
        <StatsDetail jobId={resultId} service={svc} onOpenTxid={onOpenTxid} range={resultReq.current} baselines={resultReq.baselines} />
      ) : null,
    [resultId, resultReq, onOpenTxid],
  );

  const openJob = jobs.find(j => j.id === openId) ?? null;
  const running = openJob?.status === 'running' ? (progress[openJob.id] ?? openJob.progress) : null;
  const req = openJob?.request ?? result?.request ?? null;
  const missing = result?.ranges.reduce((n, r) => n + r.missing.length, 0) ?? 0;

  return (
    <div className="flex h-full min-h-0 gap-2 p-2">
      {/* ── 작업 목록 ── */}
      <aside className="st-card flex w-64 shrink-0 flex-col gap-1 overflow-auto p-2">
        <Button variant={showForm ? 'default' : 'primary'} size="md" onClick={() => setShowForm(true)}>
          {t('+ 새 비교')}
        </Button>
        <div className="mt-2 px-1 text-micro font-medium tracking-wide text-fg-faint uppercase">{t('지난 결과')}</div>
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
              className={`cursor-pointer rounded-md px-2.5 py-2 text-small transition-colors ${
                on ? 'bg-accent/12 shadow-[inset_3px_0_0_var(--accent)]' : 'hover:bg-hover'
              }`}
            >
              <div className="truncate text-body font-medium text-fg" title={j.title}>
                {j.title}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-fg-dim">
                <span className={`st-dot ${STATUS_DOT[j.status]} ${j.status === 'running' ? 'animate-pulse' : ''}`} />
                <span className={j.status === 'failed' ? 'text-danger' : j.status === 'running' ? 'text-accent-bright' : ''}>
                  {statusText(j, p)}
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
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>
          ⚙ {t('통계 설정')}
        </Button>
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
          <div className="st-card overflow-auto p-5">
            <StatsForm
              draft={draft}
              onChange={setDraft}
              groups={groups}
              servers={servers}
              rules={rules}
              onSaveRules={saveRules}
              presets={presets}
              onSavePresets={ps => savePrefs({ presets: ps })}
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
            <div className="st-card flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="truncate text-title font-semibold text-fg">{openJob?.title ?? result?.request.title}</h2>
                {req && (
                  <div className="tnum flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-fg-muted">
                    <span className="inline-flex items-center gap-1.5" title={termHelp('ref')}>
                      <span className="st-pill st-pill-ref">{t('기준')}</span>
                      {rangeLabel(req.current)}
                    </span>
                    <span
                      className="inline-flex items-center gap-1.5"
                      title={`${termHelp('past')}\n\n${req.baselines.map(rangeLabel).join('\n')}`}
                    >
                      <span className="st-pill st-pill-past">{t('과거')}</span>
                      {req.baselines.length === 1 ? rangeLabel(req.baselines[0]) : `${req.baselines.length}${t('개 구간')}`}
                      {req.baselines.length > 1 && <span className="text-fg-faint">· {t('과거 값은 일평균')}</span>}
                    </span>
                    {result && result.ranges.length > 0 && <ServerCount ranges={result.ranges} />}
                  </div>
                )}
              </div>
              <span className="flex-1" />
              <div className="flex flex-wrap items-center gap-1.5">
                {openJob && (
                  <Button size="sm" variant="ghost" onClick={() => reuse(openJob)}>
                    {t('조건 다시 쓰기')}
                  </Button>
                )}
                {result && (
                  <Button size="sm" onClick={exportCsv} disabled={result.services.length === 0} title={t('서비스 한 줄에 기준·과거·과거 대비')}>
                    {t('요약 CSV')}
                  </Button>
                )}
                {result && (
                  <Button size="sm" onClick={exportReport} disabled={result.services.length === 0 || reporting} title={t('남에게 넘길 HTML 한 장 — 특이사항과 추이 차트')}>
                    {reporting ? t('만드는 중…') : t('HTML 보고서')}
                  </Button>
                )}
                {result?.raw_path && (
                  <Button
                    size="sm"
                    onClick={() => void revealItemInDir(result.raw_path ?? '').catch(() => {})}
                    title={result.raw_path}
                  >
                    {t('원본 CSV')}{' '}
                    <span className="tnum text-fg-faint">
                      {result.raw_rows.toLocaleString()}
                      {t('건')}
                      {result.raw_files > 1 ? ` · ${t('파일')} ${result.raw_files}${t('개')}` : ''}
                    </span>
                  </Button>
                )}
                {openJob && openJob.status !== 'running' && (
                  <Button variant="danger" size="sm" onClick={() => onDelete(openJob.id)}>
                    {t('지우기')}
                  </Button>
                )}
              </div>
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
                {result.folded > 0 && (
                  <Warn>
                    {t('서비스가 5,000개를 넘어 나머지')} {result.folded.toLocaleString()}
                    {t('건은 «(기타)» 한 줄로 합쳤습니다 — URL 에 ID 가 들어가 서비스 이름이 늘어나는지 확인하세요')}
                  </Warn>
                )}
                <NoData result={result} />
                <EmptyRanges result={result} />
                <FewerServers result={result} />
                {missing > 0 && (
                  <Warn>
                    {t('못 받은 5분 조각이 있습니다')} ({missing}) — {t('그 시간대는 빠진 채로 계산했습니다')}
                  </Warn>
                )}
                <StatsTable
                  rows={pastViewRows}
                  rules={judgeRules}
                  selected={service}
                  onSelect={setService}
                  detail={renderDetail}
                  widths={colWidths}
                  onWidthsChange={w => savePrefs({ colWidths: w })}
                />
                <p className="px-1 text-small text-fg-faint">
                  <button type="button" className="st-help hover:text-fg" title={rulesText(judgeRules)} onClick={() => setShowSettings(true)}>
                    {t('판정 규칙')}
                  </button>{' '}
                  · {t('수집')} {result.collectors.join(' + ')} · {duration(result.finished_at - result.started_at)}
                </p>
              </>
            )}
          </>
        )}
      </section>

      {showSettings && (
        <StatsSettingsDialog
          rules={judgeRules}
          keepDays={keepDays}
          onClose={() => setShowSettings(false)}
          onSave={(r, k) => {
            savePrefs({ rules: r, keepDays: k });
            setShowSettings(false);
            reloadJobs();
          }}
        />
      )}

      {closeAsk && (
        <Dialog
          title={t('통계 작업이 돌고 있습니다')}
          onClose={() => !closing && setCloseAsk(false)}
          widthClass="w-[28rem]"
          footer={
            <>
              <Button size="md" onClick={() => setCloseAsk(false)} disabled={closing}>
                {t('계속 돌리기')}
              </Button>
              <Button variant="danger" size="md" onClick={closeNow} disabled={closing}>
                {closing ? t('저장하는 중…') : t('중단하고 닫기')}
              </Button>
            </>
          }
        >
          <p className="text-body text-fg-muted">
            {t('닫으면 작업을 멈추고 그때까지 모은 것을 «취소됨» 결과로 남깁니다. 다음에 열어 볼 수 있지만, 빠진 시간대가 있습니다.')}
          </p>
        </Dialog>
      )}
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
      className="tnum st-help text-small text-fg-dim"
      title={`${t('실제로 훑은 서버')}\n\n${t('기준')}:\n${cur.join('\n')}\n\n${t('과거')}:\n${base.join('\n')}`}
    >
      {t('서버')} {t('기준')} {cur.length}{t('대')} · {t('과거')} {base.length}{t('대')}
    </span>
  );
}

/**
 * 한 건도 못 받은 구간 — 콜렉터 보관 기간(기본 90일)이 지났거나, 그때 대상 서버가 없었거나,
 * 콜렉터 시간대와 이 PC 시간대가 달라 날짜 폴더가 어긋났다(F-18). 과거가 비면 모든 서비스가 «신규» 로 뜬다
 */
function EmptyRanges({ result }: { result: StatsResult }) {
  if (result.status === 'failed') return null;
  const empty = result.ranges.filter(r => r.slices > 0 && r.slices_done === r.slices && r.scanned === 0);
  const noServer = result.ranges.filter(r => r.servers.length === 0);
  const list = [...new Set([...empty, ...noServer])];
  if (list.length === 0) return null;
  const fmtR = (r: StatsResult['ranges'][number]) => `${r.kind === 'current' ? t('기준') : t('과거')} ${rangeLabel(r)}`;
  return (
    <Warn>
      {t('데이터가 하나도 없는 구간')}: {list.map(fmtR).join(', ')} —{' '}
      {t('콜렉터 보관 기간이 지났거나, 그때 대상 서버가 없었거나, 콜렉터와 이 PC 의 시간대가 다를 수 있습니다')}
    </Warn>
  );
}

/** 직접 지정했는데 한 건도 없던 서비스 — 이름이 틀렸을 가능성이 크다 (8) */
function NoData({ result }: { result: StatsResult }) {
  const have = new Set(result.services.map(s => s.service.toLowerCase()));
  const none = result.request.services.filter(s => s.trim() !== '' && !have.has(s.trim().toLowerCase()));
  if (none.length === 0 || result.status === 'failed') return null;
  return (
    <Warn>
      {t('지정한 서비스 중 기준·과거 모두 0건인 것')} ({none.length}): <span className="font-mono">{none.slice(0, 5).join(', ')}{none.length > 5 ? ' …' : ''}</span>
      {' — '}
      {t('이름(대소문자 무시, 완전 일치)을 확인하세요')}
    </Warn>
  );
}

/**
 * 서비스 묶음으로 골랐는데 과거 구간 어딘가의 서버가 현재보다 적다 (9).
 * 묶음이 태그로 정해지면 지난 Task 는 그날 목록에 태그가 없어 빠질 수 있다 — 축소일 수도 있으니 «확인» 으로 알린다
 */
function FewerServers({ result }: { result: StatsResult }) {
  if (result.request.groups.length === 0) return null;
  const cur = result.ranges.filter(r => r.kind === 'current').flatMap(r => r.servers);
  const curN = new Set(cur).size;
  const base = result.ranges.filter(r => r.kind === 'baseline');
  if (curN === 0 || base.length === 0) return null;
  const minN = Math.min(...base.map(r => new Set(r.servers).size));
  if (minN >= curN) return null;
  return (
    <Warn>
      {t('과거 구간 중 서버가 기준보다 적은 구간이 있습니다')} ({t('기준')} {curN}{t('대')} · {t('과거 최소')} {minN}{t('대')}) —{' '}
      {t('묶음이 태그로 정해지면 내려간 지난 Task 가 빠질 수 있습니다. 실제로 줄인 게 아니라면 Task 이름 규칙으로 다시 돌려 보세요')}
    </Warn>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-1.5 text-small text-warn">⚠ {children}</p>;
}

/** 판정 기준 — 표 아래 ⓘ 에 마우스를 올리면 보인다 */
function rulesText(r: JudgeRules): string {
  return [
    `${t('에러 증가')}: ${t('에러율')} ×${r.errorRatio} · +${r.errorMinDelta * 100}%p`,
    `${t('느려짐')}: ${r.slowOn.map(m => slowName(m, t)).join('·')} ×${r.slowRatio} · +${r.slowMinMs}ms`,
    `${t('호출량 급변')}: TPS ±${r.volumeRatio * 100}%`,
    `${t('표본 적음')}: < ${r.minCount}${t('건')} (${t('판정하지 않음')})`,
    ...(r.beyondWorst ? [t('과거가 여럿이면 과거 날들 중 가장 나빴던 날보다도 나쁠 때만입니다.')] : []),
  ].join('\n');
}

function ProgressBox({ id, progress: p }: { id: string; progress: StatsProgress | null }) {
  const ratio = p && p.slices_total > 0 ? p.slices_done / p.slices_total : 0;
  const pct = Math.round(ratio * 100);
  const Stat = ({ label, value }: { label: string; value: string }) => (
    <span className="flex flex-col">
      <span className="text-micro text-fg-faint">{label}</span>
      <span className="tnum text-body text-fg">{value}</span>
    </span>
  );
  return (
    <div className="st-card flex flex-col gap-3 px-4 py-3" role="status">
      <div className="flex items-center gap-3">
        <span className="text-body font-medium text-fg">
          {p?.phase === 'queue'
            ? t('대기 중 — 앞 작업이 끝나면 시작합니다 (한 번에 하나씩 돕니다)')
            : !p || p.phase === 'plan'
              ? t('대상 서버를 찾는 중…')
              : p.paused
                ? t('잠시 멈춤')
                : t('훑는 중…')}
        </span>
        <span className="tnum text-title font-semibold text-accent-bright">{p && p.slices_total > 0 ? `${pct}%` : ''}</span>
        <span className="flex-1" />
        {p?.paused ? (
          <Button size="sm" onClick={() => void statsControl(id, 'resume')}>
            {t('계속')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => void statsControl(id, 'pause')}>
            {t('잠시 멈춤')}
          </Button>
        )}
        <Button variant="danger" size="sm" onClick={() => void statsControl(id, 'cancel')}>
          {t('취소')}
        </Button>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-hover">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent to-accent-bright transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      {p && p.slices_total > 0 && (
        <div className="flex flex-wrap gap-6">
          <Stat label={t('조각')} value={`${p.slices_done.toLocaleString()} / ${p.slices_total.toLocaleString()}`} />
          <Stat label={t('받은 것')} value={p.scanned.toLocaleString()} />
          <Stat label={t('맞는 것')} value={p.matched.toLocaleString()} />
          {p.eta_ms !== null && !p.paused && <Stat label={t('남은 시간')} value={`~${duration(p.eta_ms)}`} />}
        </div>
      )}
    </div>
  );
}
