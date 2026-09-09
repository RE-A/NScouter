// 반원 게이지.
//
// **파일 이름이 `gauge.ts` 와 겹치면 안 된다.** Windows 는 대소문자를 안 가려서
// `Gauge.tsx` 와 `gauge.ts` 가 같은 파일로 취급된다 — 임포트가 조용히 엉킨다.
// `KpiTile`·`KpiStrip` 과 한 식구이므로 그 이름을 따른다.
//
// 기하와 눈금은 `gauge.ts` 가 정한다. 여기서 하는 일은 그리는 것뿐이다.
//
// **색을 `bg-*` 클래스로 주지 않는다.** 타일의 등급 띠가 그 클래스를 쓰고 있어서,
// 게이지가 같은 클래스를 쓰면 «화면에 위험 표시가 몇 개인가» 를 세는 쪽이 어긋난다.
// SVG 는 stroke 로 칠하므로 토큰 문자열(`T`)을 그대로 쓴다.

import { memo } from 'react';
import { arcPath, needleAt, polar, scaleLabel, type GaugeScale } from './gauge';
import type { Grade } from './threshold';
import { T } from '../../styles/tokens';
import { t } from '../../i18n';

/** 뷰박스 — 반원이라 높이가 폭의 절반보다 조금 크면 된다 (눈금 글자 자리) */
const W = 100;
const H = 58;
const CX = W / 2;
const CY = 50;
const R = 42;
const TRACK = 7;

/** 구간 색. 괜찮은 구간에는 색을 주지 않는다 (`KpiTile` 과 같은 규칙) */
const ZONE: Record<Exclude<Grade, 'none'>, string> = {
  ok: T.border,
  warn: T.warn,
  danger: T.error,
};

interface KpiGaugeProps {
  value: number | null;
  scale: GaugeScale;
  /** 지금 값의 등급. 바늘 색이 이것을 따른다 */
  grade: Grade;
}

export const KpiGauge = memo(function KpiGauge({ value, scale, grade }: KpiGaugeProps) {
  const needle = needleAt(value, scale.max);
  const tip = needle ? polar(CX, CY, R - TRACK / 2 - 3, needle.frac) : null;
  const hub = polar(CX, CY, 0, 0);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full"
      role="img"
      aria-label={
        scale.kind === 'observed'
          ? `${t('최근 최대')} ${scaleLabel(scale.max)}`
          : `0 ~ ${scaleLabel(scale.max)}`
      }
    >
      {/* 바탕 호 — 눈금 전체. 이게 있어야 «어디까지가 끝인지» 가 보인다 */}
      <path
        d={arcPath(CX, CY, R, 0, 1)}
        fill="none"
        stroke={T.border}
        strokeWidth={TRACK}
        strokeLinecap="round"
      />

      {/* 주의·위험 구간. 관측 눈금에는 없다 — 임계가 없으니 «주의» 도 없다 */}
      {scale.zones.map(z => (
        <path
          key={z.grade}
          d={arcPath(CX, CY, R, z.from, z.to)}
          fill="none"
          stroke={ZONE[z.grade]}
          strokeWidth={TRACK}
          strokeLinecap="butt"
          // 구간은 «자» 지 «지금» 이 아니다. 진하게 칠하면 늘 위험해 보인다.
          opacity={0.35}
        />
      ))}

      {/* 바늘. 값이 없으면 그리지 않는다 — 0 자리에 두면 «0 이다» 로 읽힌다 */}
      {tip && (
        <>
          <line
            x1={hub.x}
            y1={hub.y}
            x2={tip.x}
            y2={tip.y}
            stroke={grade === 'danger' ? T.error : grade === 'warn' ? T.warn : T.text}
            strokeWidth={2}
            strokeLinecap="round"
          />
          <circle cx={hub.x} cy={hub.y} r={2.5} fill={T.textDim} />
          {/* **눈금을 넘었으면 끝에 표시를 남긴다.** 붙여 놓기만 하면
              «딱 최대치» 와 구별되지 않는다. */}
          {needle?.over && (
            <circle cx={tip.x} cy={tip.y} r={3} fill={T.error} />
          )}
        </>
      )}

      {/* 양 끝 눈금. 끝값이 없으면 바늘 위치가 아무 뜻도 없다 */}
      <text x={CX - R} y={CY + 8} textAnchor="middle" fontSize={7} fill={T.textFaint}>
        0
      </text>
      <text x={CX + R} y={CY + 8} textAnchor="middle" fontSize={7} fill={T.textFaint}>
        {scaleLabel(scale.max)}
      </text>
    </svg>
  );
});
