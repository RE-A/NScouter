// 서비스 순위 — «시간을 누가 먹었나».
//
// 분포가 «어디에 몰려 있나» 를 말한다면 이건 **범인 후보**를 준다.
// 정렬 기준이 곧 질문이라 버튼으로 갈아 낀다 (`summaryRows.SummarySortKey`):
//   합계: 시간을 어디서 썼나 · 횟수: 무엇이 많이 불렸나 · 평균: 한 방이 비싼 것 · 에러
//
// Counter 탭의 `SummaryPanel` 과 **같은 커맨드**를 쓰지만 자리가 다르다. 저쪽은
// 자기 구간을 따로 고르는 표고, 여기는 위의 지표·타임라인과 **같은 구간**을 본다 —
// «지금 이 시간대» 를 보다가 표로 눈을 옮기는 데 조회 조건을 다시 맞출 필요가 없다.

import { memo, useMemo, useState } from 'react';
import { sortSummary, withAverage, type SummarySortKey } from '../xlog/components/summaryRows';
import { durationTone } from '../xlog/components/durationTone';
import { percent } from './distribution';
import type { ServiceRow } from './useRangeInsight';
import { t } from '../../i18n';

/** 몇 줄까지. 순위표는 «위쪽» 이 전부다 — 200줄은 표지 순위가 아니다 */
const VISIBLE = 12;

const SORTS: { by: SummarySortKey; label: string; hint: string }[] = [
  { by: 'sum', label: '합계', hint: '시간을 어디서 썼나' },
  { by: 'count', label: '횟수', hint: '무엇이 많이 불렸나' },
  { by: 'avg', label: '평균', hint: '한 방이 비싼 것' },
  { by: 'error', label: '에러', hint: '어디서 실패하나' },
];

interface TopServicesProps {
  rows: readonly ServiceRow[];
  loading: boolean;
  /** 타입 전체를 센 것인가. 그러면 안 고른 서버의 호출도 들어 있다 */
  wholeType: boolean;
  /** 이 서비스의 트랜잭션을 보러 간다 */
  onDrill?: (serviceName: string) => void;
}

export const TopServices = memo(function TopServices({
  rows,
  loading,
  wholeType,
  onDrill,
}: TopServicesProps) {
  const [by, setBy] = useState<SummarySortKey>('sum');

  const sorted = useMemo(() => sortSummary(withAverage(rows), by), [rows, by]);
  const shown = sorted.slice(0, VISIBLE);
  /** 막대는 **1등 대비**다. 전체 합 대비로 하면 서비스가 200개일 때 전부 실선이 된다 */
  const peak = useMemo(
    () => shown.reduce((m, r) => Math.max(m, valueOf(r, by) ?? 0), 0),
    [shown, by],
  );

  if (rows.length === 0) {
    return (
      <p className="px-1 py-3 text-small text-fg-faint">
        {loading ? t('받는 중…') : t('이 구간에 서비스 호출이 없습니다')}
      </p>
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-1">
        <span className="text-micro text-fg-dim">{t('정렬')}</span>
        {SORTS.map(s => (
          <button
            key={s.by}
            onClick={() => setBy(s.by)}
            title={t(s.hint)}
            aria-pressed={by === s.by}
            className={`rounded px-1.5 py-0.5 text-micro ${
              by === s.by ? 'bg-accent/20 text-accent' : 'text-fg-faint hover:bg-hover hover:text-fg'
            }`}
          >
            {t(s.label)}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-micro text-fg-faint">
          {/* **타입 전체를 셌으면 그렇게 적는다.** 콜렉터가 요약을 오브젝트 하나 또는
              타입 전체로만 주는데, 말하지 않으면 안 고른 서버의 호출까지
              «내가 고른 것» 으로 읽힌다. */}
          {wholeType && `${t('타입 전체')} · `}
          {rows.length > VISIBLE
            ? `${t('상위')} ${VISIBLE}/${rows.length.toLocaleString()}`
            : `${rows.length.toLocaleString()}${t('건')}`}
        </span>
      </div>

      <ol className="space-y-0.5">
        {shown.map(r => {
          const v = valueOf(r, by) ?? 0;
          const failing = (r.error ?? 0) > 0;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={onDrill ? () => onDrill(r.name) : undefined}
                disabled={!onDrill}
                title={`${r.name}\n${t('횟수')} ${r.count.toLocaleString()} · ${t('합계')} ${(r.elapsed ?? 0).toLocaleString()}ms · ${t('평균')} ${r.avg ?? '—'}ms${
                  failing ? ` · ${t('에러')} ${r.error?.toLocaleString()}` : ''
                }`}
                className={`grid w-full grid-cols-[minmax(0,1fr)_58px_58px] items-baseline gap-x-2 rounded px-1 py-0.5 text-left ${
                  onDrill ? 'hover:bg-hover/60' : 'cursor-default'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-small text-fg">{r.name}</span>
                  {/* 막대는 이름 **아래**에 깐다. 옆에 두면 긴 URL 이 막대를 밀어내
                      서비스마다 막대 시작점이 달라져 길이를 견줄 수 없다. */}
                  <span className="mt-0.5 block h-1 w-full overflow-hidden rounded-sm bg-line/40">
                    <span
                      className={`block h-full rounded-sm ${failing ? 'bg-danger/70' : 'bg-accent/70'}`}
                      style={{ width: `${peak > 0 ? (v / peak) * 100 : 0}%` }}
                    />
                  </span>
                </span>

                {/* 단위를 안 적는다. 옆 칸이 `ms` 라 이 칸이 횟수인 것은 대비로 읽히고,
                    «회» 를 붙이면 좁은 칸에서 숫자가 밀린다. 정렬 버튼이 이름을 말한다. */}
                <span className="tnum text-right font-mono text-micro text-fg-muted">
                  {r.count.toLocaleString()}
                </span>

                <span className={`tnum text-right font-mono text-micro ${durationTone(r.avg ?? 0)}`}>
                  {r.avg === null ? '—' : `${r.avg.toLocaleString()}ms`}
                </span>
              </button>
              {failing && (
                <p className="px-1 text-micro text-danger">
                  {t('에러')} {r.error?.toLocaleString()} ({percent((r.error ?? 0) / Math.max(1, r.count))})
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
});

/** 지금 정렬 기준의 값. 막대 길이가 «정렬한 그 수» 를 그려야 순위와 길이가 어긋나지 않는다 */
function valueOf(r: { count: number; elapsed: number | null; error: number | null; avg: number | null }, by: SummarySortKey): number | null {
  switch (by) {
    case 'sum': return r.elapsed;
    case 'count': return r.count;
    case 'avg': return r.avg;
    case 'error': return r.error;
  }
}
