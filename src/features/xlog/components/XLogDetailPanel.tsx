// src/features/xlog/components/XLogDetailPanel.tsx
// XLog 상세 프로파일 패널 (우측 드로어)

import React, { memo, useEffect, useMemo, useState } from 'react';
import type { XLogDetailState } from '../hooks/useXLogDetail';
import { ProfileStepList } from './ProfileStepList';
import { ProfileSummaryTable } from './ProfileSummaryTable';
import { CallTreeView } from './CallTreeView';
import { FlowTreeView } from './FlowTreeView';
import { ErrorDetail } from './ErrorDetail';
import { useTextResolver } from '../hooks/useTextResolver';
import { useCallTrace } from '../hooks/useCallTrace';
import { useFlowProfiles } from '../hooks/useFlowProfiles';
import { buildFlowTree } from '../trace/flowTree';
import { formatTime } from '../utils/colorPalette';
import { findStepHits } from './stepSearch';
import { yyyymmdd } from '../types/timeRange';
import type { SXLog } from '../types/xlog';
import { t } from '../../../i18n';

/** 같은 프로파일을 보는 두 가지 방법 */
type ProfileMode = 'list' | 'summary';

/**
 * 호출 흐름의 깊이.
 *
 * `apps` 는 앱 단위(ASIS XLogCallView), `flow` 는 SQL·API 호출까지(XLogFlowView).
 * `flow` 는 트랜잭션 수만큼 프로파일을 더 받으므로 **켰을 때만** 조회한다.
 */
type FlowMode = 'apps' | 'flow';

interface XLogDetailPanelProps {
  state: XLogDetailState;
  onClose: () => void;
  /** objHash → 에이전트명. 호출 흐름에서 어느 앱인지 보여준다 */
  agentMap: Map<number, string>;
  /** 호출 흐름에서 다른 앱의 트랜잭션으로 옮겨 갈 때 */
  onSelectTrace: (xlog: SXLog) => void;
  /**
   * 프로파일 안의 스레드 링크를 눌렀을 때 (ThreadProfile).
   *
   * 여기서는 txid 만 알 수 있다 — 그 트랜잭션을 찾아 여는 건 호출부의 일이다.
   */
  onOpenTxid: (txid: string, date: string) => void;
  /**
   * 프로파일 검색어. 있으면 이 트랜잭션 안에서 걸린 스텝을 찾아 강조하고 넘길 수 있게 한다.
   *
   * **순번이 아니라 검색어를 받는다.** 프로파일과 텍스트가 이미 여기 있으므로
   * 걸린 자리를 여기서 직접 찾는 게 싸고, 여러 군데 걸렸을 때 오갈 수 있다.
   */
  searchQuery?: string;
}

export const XLogDetailPanel = memo(function XLogDetailPanel({
  state,
  onClose,
  agentMap,
  onSelectTrace,
  onOpenTxid,
  searchQuery = '',
}: XLogDetailPanelProps) {
  const { getCached } = useTextResolver();
  const trace = useCallTrace(state.xlog);
  const [profileMode, setProfileMode] = useState<ProfileMode>('list');

  /** 이 트랜잭션 안에서 검색어가 걸린 자리들 */
  const stepHits = useMemo(
    () =>
      state.profile && searchQuery
        ? findStepHits(state.profile.steps, state.texts, searchQuery)
        : [],
    [state.profile, state.texts, searchQuery],
  );
  /** 몇 번째 자리를 보고 있나 */
  const [hitIdx, setHitIdx] = useState(0);

  // 다른 트랜잭션을 열거나 검색어가 바뀌면 처음 자리로 돌아간다.
  // 안 되돌리면 "3곳 중 3번째"인데 두 곳뿐인 프로파일이 열려 강조가 사라진다.
  useEffect(() => {
    setHitIdx(0);
  }, [state.xlog?.txid, searchQuery]);

  const highlightStep = stepHits[hitIdx]?.index ?? null;

  /**
   * 검색으로 연 트랜잭션은 **목록으로 돌려놓는다.**
   * 요약 모드에는 걸린 줄이 없어서, 강조해 봐야 보이지 않는다.
   */
  useEffect(() => {
    if (highlightStep !== null) setProfileMode('list');
  }, [highlightStep]);
  const [flowMode, setFlowMode] = useState<FlowMode>('apps');
  const [showSql, setShowSql] = useState(true);
  const [showApiCall, setShowApiCall] = useState(true);

  const flowProfiles = useFlowProfiles(trace.rows, flowMode === 'flow');
  const flowRoots = useMemo(
    () =>
      buildFlowTree(
        {
          services: trace.rows,
          profiles: flowProfiles.profiles,
          texts: { ...trace.texts, ...flowProfiles.texts },
          agentMap,
        },
        { showSql, showApiCall },
      ),
    [trace.rows, trace.texts, flowProfiles.profiles, flowProfiles.texts, agentMap, showSql, showApiCall],
  );

  if (!state.xlog && !state.isLoading) return null;

  const { xlog, profile, texts, isLoading, error } = state;

  const serviceName = xlog
    ? (getCached('service', xlog.service) ?? `[0x${xlog.service.toString(16)}]`)
    : '';

  const errorText = xlog && xlog.error !== 0
    ? (getCached('error', xlog.error) ?? `[0x${xlog.error.toString(16)}]`)
    : null;

  // ko-KR 로케일은 "4시 36분 18초" 를 낸다. 차트 X축과 같은 표기(04:36:18)를 쓴다.
  const startTime = xlog ? formatTime(xlog.endTime - xlog.elapsed) : '';
  const endTimeStr = xlog ? formatTime(xlog.endTime) : '';

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* 헤더 — 서비스명이 곧 제목이다. "XLog Detail" 같은 라벨은 이미 패널 제목에 있다 */}
      <header className="flex shrink-0 items-start gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-medium text-fg" title={serviceName}>
            {serviceName || '—'}
          </h2>
          <p className="tnum mt-0.5 font-mono text-micro text-fg-dim">
            {startTime} → {endTimeStr}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label={t('상세 닫기')}
          className="shrink-0 rounded px-1 text-fg-dim hover:text-fg"
        >
          ✕
        </button>
      </header>

      {isLoading && (
        <p className="px-3 py-6 text-center text-body text-fg-dim">{t('프로파일을 불러오는 중')}</p>
      )}

      {error && (
        <p className="mx-3 mt-2 rounded border-l-2 border-danger bg-danger/10 px-2 py-1.5 text-small text-danger">
          {error}
        </p>
      )}

      {xlog && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* 핵심 수치 — 나머지보다 확실히 크게. 여기부터 읽게 만든다 */}
          <div className="grid grid-cols-3 gap-px border-b border-line bg-line">
            <Metric label="Elapsed" value={xlog.elapsed} unit="ms" emphasis />
            <Metric label="SQL" value={xlog.sqlTime} unit="ms" sub={`${xlog.sqlCount}${t('건')}`} />
            <Metric label="API" value={xlog.apiCallTime} unit="ms" sub={`${xlog.apiCallCount}${t('건')}`} />
          </div>

          {errorText && (
            <div className="border-b border-line border-l-2 border-l-danger bg-danger/8 px-3 py-2">
              <ErrorDetail text={errorText} />
            </div>
          )}

          {/* 호출 흐름은 프로파일보다 위다 — 어느 앱이 느린지 먼저 좁히고
              그 다음에 그 앱 안을 파고드는 순서다.
              혼자 끝난 요청(gxid=0)에는 아예 나타나지 않는다. */}
          {/* **뿌리 수로 판단하면 안 된다.** 정상적인 2-앱 트레이스는
              뿌리 1개 + 자식 1개라 roots.length 가 늘 1이고, 그러면 이 구획이
              영영 나타나지 않는다. 판단 기준은 트레이스에 속한 **노드 수**다. */}
          {(trace.loading || trace.error || trace.rows.length > 1) && (
            <Section
              title={t('호출 흐름')}
              aside={
                !trace.loading && !trace.error ? (
                  <div className="flex overflow-hidden rounded border border-line-strong">
                    {(['apps', 'flow'] as FlowMode[]).map(m => (
                      <button
                        key={m}
                        onClick={() => setFlowMode(m)}
                        aria-pressed={flowMode === m}
                        title={
                          m === 'apps'
                            ? t('앱 사이의 호출만')
                            : t('SQL·외부 API 까지 (프로파일을 추가로 조회한다)')
                        }
                        className={`px-1.5 py-0.5 text-micro transition-colors ${
                          flowMode === m
                            ? 'bg-accent text-white'
                            : 'text-fg-dim hover:bg-hover hover:text-fg-muted'
                        }`}
                      >
                        {m === 'apps' ? '앱' : t('상세')}
                      </button>
                    ))}
                  </div>
                ) : null
              }
            >
              {trace.loading && (
                <p className="px-3 py-3 text-center text-body text-fg-dim">{t('연관 트랜잭션 조회 중')}</p>
              )}
              {trace.error && (
                <p className="mx-3 my-2 rounded border-l-2 border-danger bg-danger/10 px-2 py-1.5 text-small text-danger">
                  {trace.error}
                </p>
              )}

              {!trace.loading && !trace.error && flowMode === 'apps' && (
                <CallTreeView
                  roots={trace.roots}
                  texts={trace.texts}
                  agentMap={agentMap}
                  activeTxid={xlog.txid}
                  onSelect={onSelectTrace}
                />
              )}

              {!trace.loading && !trace.error && flowMode === 'flow' && (
                <>
                  {/* 잎이 많아 금방 빽빽해진다. 무엇을 볼지 고르게 한다 (ASIS 와 같은 두 토글) */}
                  <div className="flex items-center gap-3 px-3 pb-1">
                    <Toggle checked={showSql} onChange={setShowSql} label="SQL" />
                    <Toggle checked={showApiCall} onChange={setShowApiCall} label={t('API 호출')} />
                  </div>

                  {flowProfiles.loading && (
                    <p className="px-3 py-3 text-center text-body text-fg-dim">{t('프로파일 조회 중')}</p>
                  )}
                  {flowProfiles.error && (
                    <p className="mx-3 my-2 rounded border-l-2 border-danger bg-danger/10 px-2 py-1.5 text-small text-danger">
                      {flowProfiles.error}
                    </p>
                  )}
                  {!flowProfiles.loading && !flowProfiles.error && (
                    <>
                      {/* 빠진 게 있으면 말해 준다. 말없이 덜 그리면 **없는 호출로 읽힌다** */}
                      {flowProfiles.failed > 0 && (
                        <p className="mx-3 mb-1 rounded border-l-2 border-warn bg-warn/10 px-2 py-1 text-micro text-warn">
                          프로파일 {flowProfiles.failed}건을 못 받아 그만큼 잎이 빠져 있습니다
                        </p>
                      )}
                      <FlowTreeView
                        roots={flowRoots}
                        activeTxid={xlog.txid}
                        onSelect={n => {
                          if (n.xlog) onSelectTrace(n.xlog);
                        }}
                      />
                    </>
                  )}
                </>
              )}
            </Section>
          )}

          {/* 목록은 "언제 무엇이", 요약은 "무엇이 몇 번"에 답한다.
              2ms 쿼리가 50번 도는 N+1 은 목록으로는 절대 안 보인다. */}
          <Section
            title={t('프로파일')}
            aside={
              profile && profile.steps.length > 0 ? (
                <div className="flex items-center gap-2">
                  {/* 걸린 자리가 여럿이면 오갈 수 있어야 한다 —
                      한 군데만 데려다 놓으면 나머지는 직접 찾아야 한다. */}
                  {stepHits.length > 0 && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          setHitIdx(i => (i - 1 + stepHits.length) % stepHits.length)
                        }
                        disabled={stepHits.length < 2}
                        title={t('이전 적중')}
                        className="rounded px-1 text-micro text-fg-dim hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:text-fg-faint"
                      >
                        ‹
                      </button>
                      <span className="tnum font-mono text-micro text-accent">
                        {hitIdx + 1}/{stepHits.length}
                      </span>
                      <button
                        onClick={() => setHitIdx(i => (i + 1) % stepHits.length)}
                        disabled={stepHits.length < 2}
                        title={t('다음 적중')}
                        className="rounded px-1 text-micro text-fg-dim hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:text-fg-faint"
                      >
                        ›
                      </button>
                    </div>
                  )}
                  <div className="flex overflow-hidden rounded border border-line-strong">
                  {(['list', 'summary'] as ProfileMode[]).map(m => (
                    <button
                      key={m}
                      onClick={() => setProfileMode(m)}
                      aria-pressed={profileMode === m}
                      className={`px-1.5 py-0.5 text-micro transition-colors ${
                        profileMode === m
                          ? 'bg-accent text-white'
                          : 'text-fg-dim hover:bg-hover hover:text-fg-muted'
                      }`}
                    >
                      {m === 'list' ? '목록' : t('요약')}
                    </button>
                    ))}
                  </div>
                </div>
              ) : null
            }
          >
            {profile ? (
              profileMode === 'list' ? (
                <ProfileStepList
                  steps={profile.steps}
                  texts={texts}
                  totalElapsed={xlog.elapsed}
                  onOpenThread={txid => onOpenTxid(txid, yyyymmdd(xlog.endTime))}
                  highlightIndex={highlightStep}
                />
              ) : (
                <ProfileSummaryTable steps={profile.steps} texts={texts} />
              )
            ) : (
              <p className="px-2 py-4 text-center text-body text-fg-faint">{t('프로파일이 없습니다')}</p>
            )}
          </Section>

          <Section title={t('속성')}>
            <dl className="px-3 py-1.5">
              <Attr label="CPU" value={`${xlog.cpu}ms`} />
              <Attr label="Heap" value={`${xlog.allocKBytes}KB`} />
              <Attr label="IP" value={xlog.ipAddr || '—'} mono />
              <Attr label="TxID" value={xlog.txid} mono />
              {xlog.gxid && xlog.gxid !== '0' && (
                <Attr label="GxID" value={xlog.gxid} mono />
              )}
            </dl>
          </Section>
        </div>
      )}
    </div>
  );
});

// ─── 보조 컴포넌트 ─────────────────────────────────────────────

/** 상단 핵심 수치. 값은 크게, 라벨은 작게 — 위계를 크기로 만든다 */
function Metric({
  label,
  value,
  unit,
  sub,
  emphasis,
}: {
  label: string;
  value: number;
  unit: string;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="bg-surface px-3 py-2">
      <div className="text-micro tracking-wide text-fg-dim uppercase">{label}</div>
      <div className="tnum mt-0.5 font-mono">
        <span className={emphasis ? 'text-title text-fg' : 'text-base text-fg-muted'}>
          {value.toLocaleString()}
        </span>
        <span className="ml-0.5 text-micro text-fg-faint">{unit}</span>
      </div>
      {sub && <div className="tnum text-micro text-fg-faint">{sub}</div>}
    </div>
  );
}

/** 구획 — 채운 카드 대신 hairline 과 소문자 라벨로 구분한다 */
function Section({
  title,
  aside,
  children,
}: {
  title: string;
  /** 제목 줄 오른쪽 컨트롤. 구획에 딸린 조작이라 제목과 같은 줄에 둔다 */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line">
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <h3 className="text-micro tracking-wider text-fg-dim uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** 흐름에서 무엇을 볼지 고르는 토글 */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1 text-micro text-fg-dim hover:text-fg-muted">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Attr({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-3 py-0.5">
      <dt className="w-14 shrink-0 text-small text-fg-faint">{label}</dt>
      <dd
        className={`min-w-0 flex-1 break-all text-small text-fg-muted ${mono ? 'tnum font-mono text-micro' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}
