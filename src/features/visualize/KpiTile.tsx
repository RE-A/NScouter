// 지표 한 칸.
//
// **정상은 조용해야 한다.** 괜찮은 값에도 초록을 칠하면 화면이 늘 알록달록해서
// 정작 빨간 하나가 눈에 안 들어온다. 색은 주의·위험에만 쓴다.

import { memo } from 'react';
import { sparklinePoints, toPolyline } from '../xlog/components/sparkline';
import { formatKpi, formatTrend, trendPct, type KpiDef } from './kpi';
import { grade, type Grade, type Threshold } from './threshold';
import { t } from '../../i18n';

/** 숫자와 스파크라인 색. `ok` 는 «괜찮다» 라서 평상시 글자색 그대로다 */
const TONE: Record<Grade, string> = {
  none: 'text-fg',
  ok: 'text-fg',
  warn: 'text-warn',
  danger: 'text-danger',
};

/** 왼쪽 띠. 등급이 붙었을 때만 보인다 */
const EDGE: Record<Grade, string> = {
  none: 'bg-transparent',
  ok: 'bg-transparent',
  warn: 'bg-warn',
  danger: 'bg-danger',
};

const SPARK_W = 120;
const SPARK_H = 22;

interface KpiTileProps {
  def: KpiDef;
  value: number | null;
  /** 최근 표본. 스파크라인과 추세에 쓴다 */
  samples: readonly number[];
  threshold: Threshold | null;
  /**
   * 이 지표를 주는 서버를 골랐는가.
   *
   * CPU 는 host 오브젝트만 준다. tomcat 만 골라 두면 값이 영영 안 오는데,
   * 줄표만 띄우면 **고장으로 읽힌다** — 안 고른 것과 안 오는 것은 다르다.
   */
  available: boolean;
}

export const KpiTile = memo(function KpiTile({
  def,
  value,
  samples,
  threshold,
  available,
}: KpiTileProps) {
  const g = grade(value, threshold);
  const trend = formatTrend(trendPct(samples));
  const points = sparklinePoints(samples, SPARK_W, SPARK_H);

  // 임계를 화면에 상설로 적으면 여섯 칸이 숫자 투성이가 된다. 다만 **어디에도 없으면
  // 노란색이 왜 노란지 알 수 없으므로** 마우스를 올렸을 때는 말해 준다.
  const hint = !available
    ? t('이 지표를 주는 서버를 안 골랐습니다')
    : threshold === null
      ? t('임계 없음')
      : `${t('주의')} ${formatKpi(threshold.warn, def.digits)} · ${t('위험')} ${formatKpi(threshold.danger, def.digits)}`;

  return (
    <div
      className="relative flex-1 overflow-hidden rounded border border-line bg-surface px-3 py-2"
      title={`${t(def.label)} — ${hint}`}
    >
      <div className={`absolute inset-y-0 left-0 w-0.5 ${EDGE[g]}`} aria-hidden />

      <div className="flex items-baseline gap-2">
        <span className="truncate text-micro text-fg-muted">{t(def.label)}</span>
        <div className="flex-1" />
        {/* 오르내림에는 색을 쓰지 않는다 — TPS 가 오르는 것은 나쁜 일이 아니다.
            좋고 나쁨은 임계가 말한다. */}
        {available
          ? trend && <span className="shrink-0 text-micro text-fg-faint">{trend}</span>
          : <span className="shrink-0 text-micro text-fg-faint">{t('미선택')}</span>}
      </div>

      <div className={`flex items-baseline gap-1 ${TONE[g]}`}>
        <span className="text-title leading-tight font-semibold tabular-nums">
          {formatKpi(value, def.digits)}
        </span>
        {def.unit && <span className="text-micro text-fg-dim">{def.unit}</span>}
      </div>

      {/* 점이 둘 미만이면 선이 안 그려진다. 자리는 그대로 둔다 — 타일마다 높이가
          달라지면 값이 들어오는 순간 스트립 전체가 출렁인다. */}
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        preserveAspectRatio="none"
        className={`mt-1 h-5 w-full ${g === 'none' || g === 'ok' ? 'text-accent' : TONE[g]}`}
        aria-hidden
      >
        {points.length >= 2 && (
          <polyline
            points={toPolyline(points)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  );
});
