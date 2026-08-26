// 액티브 서비스 · 오늘 누적
//
// 카운터 차트가 "지난 몇 분의 추세"라면 이건 **지금 이 순간**이다.
// 소요 시간 단계로 나눠 쌓는다 — 총 10건이어도 전부 3초 이상이면 장애고,
// 100건이어도 전부 1초 미만이면 그냥 바쁜 것이다. 합계로는 둘이 구별되지 않는다.

import { memo } from 'react';
import { useObjTypeStats } from '../hooks/useObjTypeStats';
import {
  barFillPct,
  eqMaxValue,
  speedSegments,
  speedTotal,
  todayTotal,
  worstStep,
  type SpeedStep,
} from './activeSpeed';
import { sparklinePoints, toPolyline } from './sparkline';
import { ActiveServiceList } from './ActiveServiceList';
import { t } from '../../../i18n';

interface ActiveServicePanelProps {
  objType: string;
  enabled: boolean;
  agentMap: Map<number, string>;
}

/** 단계별 색과 이름. 느릴수록 경고색으로 간다 */
const STEP: Record<SpeedStep, { cls: string; label: string }> = {
  1: { cls: 'bg-accent', label: '1초 미만' },
  2: { cls: 'bg-warn', label: '1~3초' },
  3: { cls: 'bg-danger', label: '3초 이상' },
};

const TONE: Record<SpeedStep | 0, string> = {
  0: 'text-fg-faint',
  1: 'text-fg',
  2: 'text-warn',
  3: 'text-danger',
};

export const ActiveServicePanel = memo(function ActiveServicePanel({
  objType,
  enabled,
  agentMap,
}: ActiveServicePanelProps) {
  const stats = useObjTypeStats(objType, enabled);

  if (!enabled) return null;

  const group = stats.group;
  const todayCalls = todayTotal(stats.todayCount);
  // 오브젝트별 막대의 공통 눈금. **가장 바쁜 오브젝트**에 맞춘다 —
  // 합계에 맞추면 오브젝트가 늘수록 모든 막대가 짧아져 아무것도 안 보인다.
  const eqScale = eqMaxValue(Math.max(0, ...stats.perObject.map(speedTotal)));

  return (
    <section className="mb-4">
      <header className="mb-2 flex items-baseline gap-2 border-b border-line pb-1">
        <h2 className="text-body font-medium text-fg">{t('액티브 서비스')}</h2>
        <span className="text-micro text-fg-faint">{objType} · 지금 이 순간</span>
      </header>

      {stats.error && (
        <p className="mb-2 rounded border-l-2 border-danger bg-danger/10 px-2 py-1.5 text-small text-danger">
          {stats.error}
        </p>
      )}

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        {/* 타입 전체 */}
        <div className="rounded border border-line bg-surface p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-micro tracking-wide text-fg-dim uppercase">{t('전체')}</span>
            <span className="tnum font-mono text-micro text-fg-dim">
              TPS <span className="text-fg-muted">{(group?.tps ?? 0).toFixed(1)}</span>
            </span>
          </div>

          <div className="tnum mt-1 font-mono">
            <span className={`text-title ${TONE[group ? worstStep(group) : 0]}`}>
              {group ? speedTotal(group) : 0}
            </span>
            <span className="ml-1 text-micro text-fg-faint">{t('건')}</span>
          </div>

          <SpeedBar speed={group} />

          {/* 범례는 색이 무엇을 뜻하는지 한 번만 말한다 */}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
            {([1, 2, 3] as SpeedStep[]).map(s => (
              <span key={s} className="flex items-center gap-1 text-micro text-fg-dim">
                <span className={`h-1.5 w-1.5 rounded-full ${STEP[s].cls}`} />
                {STEP[s].label}
                <span className="tnum font-mono text-fg-muted">
                  {group ? group[`act${s}` as 'act1' | 'act2' | 'act3'] : 0}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* 오브젝트별 — 어느 서버에 몰렸는지.
            막대는 **오브젝트를 통틀어 하나의 자**로 잰다 (ASIS EQView). */}
        <div className="rounded border border-line bg-surface p-3">
          <span className="text-micro tracking-wide text-fg-dim uppercase">{t('오브젝트별')}</span>
          {stats.perObject.length === 0 ? (
            <p className="mt-2 text-small text-fg-faint">{t('받은 값이 없습니다')}</p>
          ) : (
            <>
              <ul className="mt-1.5 space-y-1.5">
                {stats.perObject.map(a => (
                  <li key={a.obj_hash}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-micro text-fg-muted">
                        {agentMap.get(a.obj_hash) ?? `0x${(a.obj_hash >>> 0).toString(16)}`}
                      </span>
                      <span className={`tnum font-mono text-small ${TONE[worstStep(a)]}`}>
                        {speedTotal(a)}
                      </span>
                    </div>
                    <SpeedBar speed={a} scale={eqScale} />
                  </li>
                ))}
              </ul>
              {/* 자를 적어 두지 않으면 "막대가 반쯤 찼다"가 몇 건인지 알 수 없다 */}
              <div className="mt-1.5 text-right text-micro text-fg-faint">눈금 {eqScale}건</div>
            </>
          )}
        </div>

        {/* 오늘 누적 — 5분 단위라 따로 느리게 받는다 */}
        <div className="rounded border border-line bg-surface p-3">
          <span className="text-micro tracking-wide text-fg-dim uppercase">{t('오늘')}</span>

          <div className="mt-1 flex items-baseline gap-4">
            <div>
              <div className="tnum font-mono text-title text-fg">
                {Math.round(todayCalls).toLocaleString()}
              </div>
              <div className="text-micro text-fg-faint">{t('서비스 호출')}</div>
            </div>
            <div>
              <div className="tnum font-mono text-base text-fg-muted">
                {stats.visitors === null ? '—' : stats.visitors.toLocaleString()}
              </div>
              <div className="text-micro text-fg-faint">{t('방문자')}</div>
            </div>
          </div>

          <TodaySpark series={stats.todayCount} />
        </div>
      </div>

      {/* 막대가 "몇 건"이라면 목록은 "무엇이". 기본은 접어 둔다 —
          에이전트에 스레드 스택을 뜨게 하는 요청이라 공짜가 아니다. */}
      <div className="mt-2">
        <ActiveServiceList objType={objType} agentMap={agentMap} />
      </div>
    </section>
  );
});

/** 단계별로 쌓은 가로 막대 */
/**
 * 액티브 서비스 막대.
 *
 * 안쪽은 단계별 색으로 나뉘고(무엇이 느린가), 전체 길이는 `scale` 로 정해진다(얼마나 많은가).
 * `scale` 을 주지 않으면 칸을 꽉 채운다 — 합계 막대처럼 비교 대상이 없는 자리다.
 *
 * **오브젝트별 막대에는 반드시 같은 `scale` 을 넘겨야 한다.** 각자 100%로 채우면
 * 1건인 서버와 50건인 서버가 똑같아 보여 "어디에 몰렸나"를 못 읽는다 (ASIS EQView).
 */
function SpeedBar({
  speed,
  scale,
}: {
  speed: { act1: number; act2: number; act3: number } | null;
  scale?: number;
}) {
  const segments = speed ? speedSegments({ obj_hash: 0, tps: 0, ...speed }) : [];
  const total = speed ? speed.act1 + speed.act2 + speed.act3 : 0;
  const fill = scale === undefined ? 100 : barFillPct(total, scale);

  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-sm bg-line/40">
      <div className="flex h-full" style={{ width: `${fill}%` }}>
        {segments.map(s => (
          <div
            key={s.step}
            className={STEP[s.step].cls}
            style={{ width: `${s.pct}%` }}
            title={`${STEP[s.step].label} ${s.count}${t('건')}`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 오늘 누적 곡선. 오브젝트를 합쳐 하나로 그린다 —
 * 여기서 알고 싶은 건 "오늘 얼마나 들어왔나"이지 서버별 분포가 아니다.
 */
function TodaySpark({ series }: { series: { times: number[]; values: number[] }[] }) {
  const W = 240;
  const H = 28;

  if (series.length === 0) return <div className="mt-2 h-7" />;

  // 시각이 같은 지점끼리 더한다. 길이가 다를 수 있으므로 가장 긴 것을 기준으로 둔다.
  const len = Math.max(...series.map(s => s.values.length));
  const summed = Array.from({ length: len }, (_, i) =>
    series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0),
  );

  const points = sparklinePoints(summed, W, H);
  if (points.length < 2) return <div className="mt-2 h-7" />;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-2 h-7 w-full"
      aria-hidden
    >
      <polyline
        points={toPolyline(points)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
        className="text-accent"
      />
    </svg>
  );
}
