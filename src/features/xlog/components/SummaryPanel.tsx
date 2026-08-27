// 구간 요약 (ASIS SummaryDialog)
//
// 카운터가 "지금 몇 TPS"라면 이건 **지난 몇 시간을 통째로 놓고 본 순위**다.
// 스캐터로는 점 하나하나가 보이지만 "무엇이 제일 비쌌나"는 안 보인다.
//
// 콜렉터는 합계만 준다. 평균과 정렬은 여기서 낸다 (summaryRows.ts).

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { getErrorSummary, getSummary } from '../api/scouterApi';
import type { ErrorSummaryRow, SummaryKind, SummaryRow } from '../types/summary';
import { yyyymmdd } from '../types/timeRange';
import { useTextResolver } from '../hooks/useTextResolver';
import { ipFromInt, sortSummary, withAverage, type SummarySortKey } from './summaryRows';
import { durationTone } from './durationTone';
import { t } from '../../../i18n';

interface SummaryPanelProps {
  objType: string;
  enabled: boolean;
  /** 에러 요약의 대표 트랜잭션을 연다. 상세는 XLog 탭에 있으므로 탭 전환까지 호출부가 한다 */
  onOpenTxid: (txid: string, date: string) => void;
}

/**
 * 패널 탭. 에러 요약은 커맨드도 응답 모양도 달라 `SummaryKind` 에 넣을 수 없다.
 */
type PanelTab = SummaryKind | 'error';

/** 종류별 표시 이름과 해시를 푸는 사전 */
const KINDS: { kind: PanelTab; label: string; dict: string | null }[] = [
  { kind: 'service', label: '서비스', dict: 'service' },
  { kind: 'sql', label: 'SQL', dict: 'sql' },
  { kind: 'apicall', label: 'API', dict: 'apicall' },
  // IP 는 사전이 없다 — id 자체가 IPv4 를 담은 정수다 (F-38)
  { kind: 'ip', label: '호출자 IP', dict: null },
  { kind: 'ua', label: 'User-Agent', dict: 'ua' },
  // 에러는 표 구성이 통째로 다르다. 여기서는 사전을 따로 쓴다 (F-39)
  { kind: 'error', label: '에러', dict: null },
];

const RANGES: { label: string; ms: number }[] = [
  { label: '1시간', ms: 60 * 60 * 1000 },
  { label: '6시간', ms: 6 * 60 * 60 * 1000 },
  { label: '24시간', ms: 24 * 60 * 60 * 1000 },
];

const SORTS: { by: SummarySortKey; label: string; hint: string }[] = [
  { by: 'sum', label: '합계', hint: '시간을 어디서 썼나' },
  { by: 'count', label: '횟수', hint: '무엇이 많이 불렸나' },
  { by: 'avg', label: '평균', hint: '한 번이 비싼 것' },
  { by: 'error', label: '에러', hint: '어디서 실패하나' },
];

/** 표에 그릴 최대 행. API 요약은 실측 201행이라 전부 그리면 페이지가 늘어진다 */
const VISIBLE = 50;

const COLS = 'grid grid-cols-[minmax(0,1fr)_72px_88px_72px_64px] items-baseline gap-x-3 px-3';

const TAB = 'rounded px-1.5 py-0.5 text-micro transition-colors';
const TAB_ON = 'bg-accent text-white';
const TAB_OFF = 'text-fg-dim hover:bg-hover hover:text-fg-muted';

export const SummaryPanel = memo(function SummaryPanel({
  objType,
  enabled,
  onOpenTxid,
}: SummaryPanelProps) {
  // 요약은 구간 전체를 훑는 무거운 조회다. 카운터 탭을 열 때마다 자동으로 돌리지 않는다.
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PanelTab>('service');
  const [rangeMs, setRangeMs] = useState(RANGES[1].ms);
  const [by, setBy] = useState<SummarySortKey>('sum');
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [errorRows, setErrorRows] = useState<ErrorSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { getCached, resolve } = useTextResolver();
  const [textVersion, setTextVersion] = useState(0);

  const dict = KINDS.find(k => k.kind === kind)?.dict ?? null;

  const load = useCallback(() => {
    if (!objType) return;
    setLoading(true);
    setError(null);
    const now = Date.now();
    const date = yyyymmdd(now);
    const stime = now - rangeMs;

    if (kind === 'error') {
      getErrorSummary(date, stime, now, objType)
        .then(list => {
          setErrorRows(list);
          // 예외 클래스와 메시지는 **둘 다 error 사전**이다 — message 를 hashMsg 로
          // 풀려고 하면 영영 안 나온다 (F-39 실측).
          const errorHashes = list.flatMap(r => [r.error, r.message]).filter(h => h !== 0);
          const serviceHashes = list.map(r => r.service).filter(h => h !== 0);
          Promise.all([
            errorHashes.length > 0 ? resolve('error', errorHashes) : Promise.resolve({}),
            serviceHashes.length > 0 ? resolve('service', serviceHashes) : Promise.resolve({}),
          ])
            .then(() => setTextVersion(v => v + 1))
            .catch(() => {});
        })
        .catch(e => setError(String(e)))
        .finally(() => setLoading(false));
      return;
    }

    getSummary(kind, date, stime, now, objType)
      .then(list => {
        setRows(list);
        // 해시만 있으면 "무엇이" 비쌌는지 알 수 없다 — 이 화면을 여는 이유가 그건데.
        if (dict && list.length > 0) {
          resolve(dict, list.map(r => r.id))
            .then(() => setTextVersion(v => v + 1))
            .catch(() => {});
        }
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [objType, kind, rangeMs, dict, resolve]);

  useEffect(() => {
    if (open && enabled) load();
  }, [open, enabled, load]);

  const view = useMemo(() => sortSummary(withAverage(rows), by), [rows, by]);
  const shown = view.slice(0, VISIBLE);

  const label = useCallback(
    (id: number): string => {
      if (kind === 'ip') return ipFromInt(id);
      return (dict ? getCached(dict, id) : undefined) ?? `0x${(id >>> 0).toString(16)}`;
    },
    [kind, dict, getCached],
  );

  if (!enabled) return null;

  const totalCalls = rows.reduce((s, r) => s + r.count, 0);

  return (
    <section className="mb-4">
      <header className="mb-2 flex items-baseline gap-2 border-b border-line pb-1">
        <h2 className="text-body font-medium text-fg">{t('요약')}</h2>
        <span className="text-micro text-fg-faint">{objType} · {t('구간 누적')}</span>
        <div className="flex-1" />
        <button
          onClick={() => setOpen(o => !o)}
          className="rounded px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
        >
          {open ? t('닫기') : t('열기')}
        </button>
      </header>

      {open && (
        <div className="rounded border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-1.5">
            <div className="flex items-center gap-1">
              {KINDS.map(k => (
                <button
                  key={k.kind}
                  onClick={() => setKind(k.kind)}
                  aria-pressed={kind === k.kind}
                  className={`${TAB} ${kind === k.kind ? TAB_ON : TAB_OFF}`}
                >
                  {t(k.label)}
                </button>
              ))}
            </div>

            <span className="text-micro text-fg-faint">|</span>

            <div className="flex items-center gap-1">
              {RANGES.map(r => (
                <button
                  key={r.ms}
                  onClick={() => setRangeMs(r.ms)}
                  aria-pressed={rangeMs === r.ms}
                  className={`${TAB} ${rangeMs === r.ms ? TAB_ON : TAB_OFF}`}
                >
                  {t(r.label)}
                </button>
              ))}
            </div>

            {kind !== 'error' && <span className="text-micro text-fg-faint">|</span>}

            <div className={`flex items-center gap-1 ${kind === 'error' ? 'hidden' : ''}`}>
              {SORTS.map(s => (
                <button
                  key={s.by}
                  onClick={() => setBy(s.by)}
                  title={t(s.hint)}
                  aria-pressed={by === s.by}
                  className={`${TAB} ${by === s.by ? TAB_ON : TAB_OFF}`}
                >
                  {t(s.label)}
                </button>
              ))}
            </div>

            <div className="flex-1" />
            <button
              onClick={load}
              className="rounded px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
            >
              {t('새로고침')}
            </button>
          </div>

          {loading && <p className="px-3 py-6 text-center text-small text-fg-faint">{t('조회 중…')}</p>}
          {error && <p className="px-3 py-6 text-center text-small text-danger">{error}</p>}

          {!loading && !error && (kind === 'error' ? errorRows.length === 0 : rows.length === 0) && (
            // 요약은 5분 단위로 쌓인다. 방금 띄운 환경이면 정말 없을 수 있다.
            <p className="px-3 py-6 text-center text-small text-fg-faint">
              {t('이 구간에 쌓인 요약이 없습니다.')}
            </p>
          )}

          {!loading && !error && kind === 'error' && errorRows.length > 0 && (
            <ErrorTable
              rows={errorRows}
              text={(type, hash) => getCached(type, hash)}
              textVersion={textVersion}
              onOpenTxid={onOpenTxid}
            />
          )}

          {!loading && !error && kind !== 'error' && rows.length > 0 && (
            <>
              <div
                className={`${COLS} border-b border-line py-1 text-micro font-medium tracking-wide text-fg-faint uppercase`}
              >
                <span>{t('이름')}</span>
                <span className="text-right">{t('횟수')}</span>
                {/* 단위가 없으면 5,275,590 이 초인지 밀리초인지 읽는 사람이 못 정한다 */}
                {/* 머리글이 uppercase 라 그냥 두면 ms 가 MS 로 보인다. 단위는 소문자다 */}
                <span className="text-right">
                  {t('합계')}<span className="normal-case">(ms)</span>
                </span>
                <span className="text-right">
                  {t('평균')}<span className="normal-case">(ms)</span>
                </span>
                <span className="text-right">{t('에러')}</span>
              </div>
              {/* textVersion 은 값이 아니라 **사전이 채워졌다는 신호**다 */}
              <ol className="divide-y divide-line/40" data-text-version={textVersion}>
                {shown.map(r => (
                  <li key={r.id} className={`${COLS} py-1 hover:bg-hover/60`}>
                    <span className="truncate text-small text-fg" title={label(r.id)}>
                      {label(r.id)}
                    </span>
                    <span className="tnum text-right font-mono text-small text-fg-muted">
                      {r.count.toLocaleString()}
                    </span>
                    <span
                      className={`tnum text-right font-mono text-small ${
                        r.elapsed === null ? 'text-fg-faint' : durationTone(r.elapsed)
                      }`}
                    >
                      {/* 없는 값을 0 으로 그리면 "0ms 걸렸다" 가 된다 (F-38) */}
                      {r.elapsed === null ? '—' : r.elapsed.toLocaleString()}
                    </span>
                    <span className="tnum text-right font-mono text-small text-fg-muted">
                      {r.avg === null ? '—' : r.avg.toLocaleString()}
                    </span>
                    <span
                      className={`tnum text-right font-mono text-small ${
                        r.error !== null && r.error > 0 ? 'text-danger' : 'text-fg-faint'
                      }`}
                    >
                      {r.error === null ? '—' : r.error.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ol>
              {/* 무엇을 언제 것으로 모은 값인지 표 옆에 적는다.
                  구간 버튼은 위에 있지만 표만 캡처해 옮기는 일이 잦다. */}
              <p className="px-3 py-2 text-micro text-fg-faint">
                {t('최근')} {RANGES.find(r => r.ms === rangeMs)?.label ?? ''} {t('누적 ·')}{' '}
                {rows.length.toLocaleString()}{t('행 · 호출 합계')} {totalCalls.toLocaleString()}
                {rows.length > VISIBLE && ` · ${t('상위')} ${VISIBLE}${t('개만 표시')}`} · {t('평균은 합계÷횟수')}
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
});

const ERR_COLS = 'grid grid-cols-[minmax(0,260px)_minmax(0,1fr)_64px_48px] items-baseline gap-x-3 px-3';

/**
 * 에러 요약 표.
 *
 * 다른 요약이 "무엇이 느렸나"라면 이건 **무엇이 왜 깨졌나**다.
 * 그래서 열이 통째로 다르고, 대표 트랜잭션을 여는 버튼이 붙는다.
 */
function ErrorTable({
  rows,
  text,
  onOpenTxid,
}: {
  rows: ErrorSummaryRow[];
  text: (typeKey: string, hash: number) => string | undefined;
  /** 값은 안 쓰고, 사전이 채워졌을 때 다시 그리기 위한 신호다 */
  textVersion?: number;
  onOpenTxid: (txid: string, date: string) => void;
}) {
  // 많이 터진 것부터. 한 번 난 예외보다 1,000번 난 쪽을 먼저 본다.
  const sorted = [...rows].sort((a, b) => b.count - a.count);

  return (
    <div>
      <div
        className={`${ERR_COLS} border-b border-line py-1 text-micro font-medium tracking-wide text-fg-faint uppercase`}
      >
        <span>{t('예외 / 서비스')}</span>
        <span>{t('메시지')}</span>
        <span className="text-right">{t('횟수')}</span>
        <span />
      </div>
      <ol className="divide-y divide-line/40">
        {sorted.map(r => {
          const exception = text('error', r.error) ?? `0x${(r.error >>> 0).toString(16)}`;
          const service = text('service', r.service) ?? `0x${(r.service >>> 0).toString(16)}`;
          const full = text('error', r.message) ?? '';
          // 메시지에는 스택트레이스가 통째로 들어 있다. 표에는 첫 줄만 — 나머지는 title 로.
          const head = full.split('\n')[0];
          return (
            <li key={`${r.id}-${r.error}`} className={`${ERR_COLS} py-1 hover:bg-hover/60`}>
              <span className="min-w-0">
                <span className="block truncate text-small text-danger" title={exception}>
                  {exception}
                </span>
                <span className="block truncate font-mono text-micro text-fg-dim" title={service}>
                  {service}
                </span>
              </span>
              <span className="min-w-0">
                <span className="block truncate text-small text-fg-muted" title={full || head}>
                  {head || '—'}
                </span>
                {/* 무엇이 원인이었는지. 0 이면 해당 없음이라 칩을 아예 안 그린다 */}
                <span className="flex gap-1">
                  {r.sql !== 0 && (
                    <span className="rounded-sm bg-[var(--cat-sql)]/20 px-1 text-micro text-[var(--cat-sql)]">
                      SQL
                    </span>
                  )}
                  {r.apicall !== 0 && (
                    <span className="rounded-sm bg-[var(--cat-api)]/20 px-1 text-micro text-[var(--cat-api)]">
                      API
                    </span>
                  )}
                </span>
              </span>
              <span className="tnum text-right font-mono text-small text-fg">
                {r.count.toLocaleString()}
              </span>
              <span className="text-right">
                {/* 요약에서 실제 트랜잭션으로 바로 넘어가는 통로. 이게 이 탭의 핵심이다 */}
                <button
                  onClick={() => onOpenTxid(r.txid, txidDate(r.txid))}
                  title={t('이 에러가 난 트랜잭션을 연다')}
                  className="rounded px-1.5 py-0.5 text-micro text-accent hover:bg-hover"
                >
                  {t('열기')}
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="px-3 py-2 text-micro text-fg-faint">
        {rows.length.toLocaleString()}{t('종 · 발생 합계')}{' '}
        {rows.reduce((s, r) => s + r.count, 0).toLocaleString()}
      </p>
    </div>
  );
}

/**
 * 대표 트랜잭션을 열 때 쓸 날짜.
 *
 * 요약 응답에는 txid 만 있고 **시각이 없다.** 프로파일 조회는 날짜가 필요하므로
 * 오늘로 둔다 — 구간을 24시간으로 잡아 어제 것이 섞이면 못 여는 한계가 있다.
 */
function txidDate(_txid: string): string {
  return yyyymmdd(Date.now());
}
