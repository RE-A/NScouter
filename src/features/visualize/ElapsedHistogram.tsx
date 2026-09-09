// 응답시간 분포.
//
// **평균 하나로는 못 가르는 두 상황이 있다.** 전부 320ms 인 것과, 95%가 80ms 인데
// 5%가 5초인 것 — 평균은 둘 다 320ms 다. 뒤쪽만 장애다.
//
// 그래서 이 화면은 «몇 ms 인가» 가 아니라 **«어디에 몰려 있고 꼬리가 어디까지 뻗나»**
// 를 보여준다. KpiStrip 이 답하는 «지금 몇» 의 바로 옆자리다.
//
// **캔버스가 아니라 DOM 이다.** 막대가 여덟 개다 (`InstanceGrid` 와 같은 판단).

import { memo } from 'react';
import {
  avgMs,
  bucketViews,
  errorRate,
  isCapped,
  isSlowBucket,
  percent,
  shortMs,
  type ElapsedDistribution,
} from './distribution';
import { t } from '../../i18n';

interface ElapsedHistogramProps {
  data: ElapsedDistribution | null;
  loading: boolean;
}

export const ElapsedHistogram = memo(function ElapsedHistogram({
  data,
  loading,
}: ElapsedHistogramProps) {
  if (data === null) {
    return <Note>{loading ? t('세는 중…') : t('아직 받지 않았습니다')}</Note>;
  }
  if (data.total === 0) {
    return <Note>{t('이 구간에 트랜잭션이 없습니다')}</Note>;
  }

  const views = bucketViews(data);
  const avg = avgMs(data);
  const err = errorRate(data);

  return (
    <div>
      {/* 요약 줄 — 분포를 다 읽지 않아도 «어느 정도인가» 는 여기서 끝난다.
          **평균과 백분위를 나란히 둔다.** 둘이 벌어져 있다는 사실 자체가 꼬리의 신호다. */}
      <dl aria-label={t('요약')} className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Stat label={t('건수')} value={data.total.toLocaleString()} />
        <Stat label={t('평균')} value={avg === null ? '—' : shortMs(avg)} />
        <Stat label="p50" value={shortMs(data.p50_ms)} />
        <Stat
          label="p90"
          value={shortMs(data.p90_ms)}
          capped={isCapped(data.p90_ms, data)}
          cap={data.percentile_cap_ms}
        />
        <Stat
          label="p99"
          value={shortMs(data.p99_ms)}
          capped={isCapped(data.p99_ms, data)}
          cap={data.percentile_cap_ms}
        />
        <Stat label={t('최대')} value={shortMs(data.max_ms)} />
        {/* 에러가 0 이면 적지 않는다 — «에러 0» 이 늘 붙어 있으면 그 자리를 안 읽게 된다 */}
        {err !== null && data.error > 0 && (
          <Stat label={t('에러')} value={`${data.error.toLocaleString()} (${percent(err)})`} danger />
        )}
      </dl>

      <ol className="space-y-0.5">
        {views.map(v => (
          <li
            key={v.label}
            className="grid grid-cols-[86px_minmax(0,1fr)_112px] items-center gap-x-2"
            title={
              v.error > 0
                ? `${v.label} — ${v.count.toLocaleString()}${t('건')}, ${t('에러')} ${v.error.toLocaleString()}`
                : `${v.label} — ${v.count.toLocaleString()}${t('건')}`
            }
          >
            <span className="tnum truncate text-right font-mono text-micro text-fg-dim">
              {v.label}
            </span>

            {/* 막대 안에 에러를 겹쳐 그린다. 옆에 따로 두면 «이 칸이 통째로 에러» 라는
                모양이 안 보인다 — 3초 칸이 전부 빨가면 그건 분포가 아니라 장애다. */}
            <div className="relative h-3 w-full overflow-hidden rounded-sm bg-line/40">
              <div
                className={`absolute inset-y-0 left-0 rounded-sm ${
                  isSlowBucket(v.fromMs) ? 'bg-warn/70' : 'bg-accent/70'
                }`}
                style={{ width: `${v.ratio * 100}%` }}
              >
                {v.error > 0 && (
                  <div
                    className="absolute inset-y-0 right-0 bg-danger"
                    style={{ width: `${(v.error / Math.max(1, v.count)) * 100}%` }}
                  />
                )}
              </div>
            </div>

            <span className="tnum text-right font-mono text-micro">
              <span className={v.count > 0 ? 'text-fg-muted' : 'text-fg-faint'}>
                {v.count.toLocaleString()}
              </span>
              <span className="ml-1 text-fg-faint">{percent(v.share)}</span>
            </span>
          </li>
        ))}
      </ol>

      {/* **잘렸다는 사실을 조용히 두면 «이 구간에 이만큼뿐» 으로 읽힌다.** */}
      {data.truncated && (
        <p className="mt-2 text-micro text-warn">
          {t('상한에 걸려 앞부분만 셌습니다. 구간을 좁히면 전부 셉니다.')}
        </p>
      )}
    </div>
  );
});

function Stat({
  label,
  value,
  capped = false,
  cap = 0,
  danger = false,
}: {
  label: string;
  value: string;
  /** 상한에 눌린 값인가. «30초» 가 아니라 «30초 이상» 이다 */
  capped?: boolean;
  cap?: number;
  danger?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="text-micro text-fg-faint">{label}</dt>
      <dd
        className={`tnum font-mono text-small ${danger ? 'text-danger' : 'text-fg'}`}
        title={capped ? t('이 값보다 느린 건은 상한으로 눌러 셌습니다 — 실제로는 더 느릴 수 있습니다') : undefined}
      >
        {capped ? `≥${shortMs(cap)}` : value}
      </dd>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-3 text-small text-fg-faint">{children}</p>;
}
