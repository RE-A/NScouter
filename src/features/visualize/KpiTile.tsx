// 지표 한 칸.
//
// **정상은 조용해야 한다.** 괜찮은 값에도 초록을 칠하면 화면이 늘 알록달록해서
// 정작 빨간 하나가 눈에 안 들어온다. 색은 주의·위험에만 쓴다.

import { memo } from 'react';
import { sparklinePoints, toPolyline } from '../xlog/components/sparkline';
import { KpiGauge } from './KpiGauge';
import { gaugeScale } from './gauge';
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

/**
 * 눈금이 어디서 왔는지.
 *
 * **상대 눈금을 절대 눈금인 척하면 안 된다.** 임계가 없는 지표는 «최근 최대» 를
 * 끝으로 삼는데, 그때 바늘이 끝에 붙은 것은 «위험» 이 아니라 «최근 중 제일 높다» 다.
 */
function scaleHint(kind: 'threshold' | 'observed'): string {
  return kind === 'threshold'
    ? t('눈금은 정해 둔 임계입니다')
    : t('임계가 없어 최근 관측 최대를 눈금 끝으로 씁니다');
}

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
  /**
   * 어제 이 시각의 값. 견줄 것이 없으면 null.
   *
   * **%가 아니라 값 자체를 적는다.** «▲30%» 는 무엇에서 30% 인지 말하지 않는다 —
   * 기준이 눈에 보여야 «평소가 저 정도였구나» 를 같이 읽는다.
   */
  yesterday: number | null;
}

export const KpiTile = memo(function KpiTile({
  def,
  value,
  samples,
  threshold,
  available,
  yesterday,
}: KpiTileProps) {
  const g = grade(value, threshold);
  const trend = formatTrend(trendPct(samples));
  const points = sparklinePoints(samples, SPARK_W, SPARK_H);

  /**
   * 게이지의 눈금.
   *
   * **숫자만으로는 «그게 어디쯤인가» 를 못 읽는다.** 62.4 가 여유인지 코앞인지는
   * 자를 알아야 답할 수 있다. 자의 출처는 둘뿐이고(`gauge.ts`), 둘 다 없으면
   * 게이지를 그리지 않는다 — 없는 자를 그려 놓고 바늘을 얹으면 그 자리가 거짓이다.
   *
   * 안 고른 Family 는 값이 영영 안 오므로 눈금도 만들지 않는다.
   */
  const scale = available ? gaugeScale(threshold, samples, def.unit === '%') : null;

  // 임계를 화면에 상설로 적으면 여섯 칸이 숫자 투성이가 된다. 다만 **어디에도 없으면
  // 노란색이 왜 노란지 알 수 없으므로** 마우스를 올렸을 때는 말해 준다.
  const hint = !available
    ? t('이 지표를 주는 서버를 안 골랐습니다')
    : threshold === null
      ? t('임계 없음')
      : `${t('주의')} ${formatKpi(threshold.warn, def.digits)} · ${t('위험')} ${formatKpi(threshold.danger, def.digits)}`;

  // 최소 폭: 게이지가 68px 를 먹으므로 그만큼 넓혀 둔다. 안 주면 좁은 창에서 여섯 칸을
  // 억지로 한 줄에 밀어 넣다가 **숫자가 잘린다** — 그러면 게이지가 값을 가린 셈이 된다.
  return (
    <div
      className="relative min-w-[188px] flex-1 overflow-hidden rounded border border-line bg-surface px-3 py-2"
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

      {/* 게이지는 **왼쪽**에 둔다. 위에 얹으면 타일이 한 뼘 높아져 여섯 칸이
          화면을 다 먹고, 그러면 «한눈에 훑는 줄» 이라는 이 줄의 이유가 사라진다. */}
      <div className="flex items-center gap-2">
        {scale && (
          <div className="w-[68px] shrink-0" title={scaleHint(scale.kind)}>
            <KpiGauge value={value} scale={scale} grade={g} />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className={`flex items-baseline gap-1 ${TONE[g]}`}>
            <span className="text-title leading-tight font-semibold tabular-nums">
              {formatKpi(value, def.digits)}
            </span>
            {def.unit && <span className="text-micro text-fg-dim">{def.unit}</span>}
          </div>

          {/* **자리는 늘 잡아 둔다.** 어제 것이 있는 타일만 높아지면 줄이 들쭉날쭉해진다 */}
          <div className="h-3 truncate text-micro text-fg-faint">
            {available && yesterday !== null
              ? `${t('어제')} ${formatKpi(yesterday, def.digits)}`
              : ''}
          </div>
        </div>
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
