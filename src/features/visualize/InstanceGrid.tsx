// 인스턴스 격자 — 한 대가 한 칸.
//
// **캔버스가 아니라 DOM 이다.** XLog 스캐터에 DOM 을 금지한 이유는 초당 수만 점인데
// (CLAUDE.md 3.1), 여기는 서버 수만큼이라 수십 칸이다. 캔버스로 그리면 클릭 판정과
// 글자 자르기를 손으로 다시 만들어야 하고, 얻는 것이 없다.
// 칸이 수백을 넘기 시작하면 그때 다시 볼 일이다.

import { memo } from 'react';
import { formatKpi } from './kpi';
import { countByGrade, type InstanceRow } from './instanceRows';
import type { Grade } from './threshold';
import { t } from '../../i18n';

/** 칸 왼쪽 띠. 정상은 조용해야 한다 — 색은 주의·위험에만 (`KpiTile` 과 같은 규칙) */
const EDGE: Record<Grade, string> = {
  none: 'bg-transparent',
  ok: 'bg-transparent',
  warn: 'bg-warn',
  danger: 'bg-danger',
};

const TONE: Record<Grade, string> = {
  none: 'text-fg-dim',
  ok: 'text-fg-dim',
  warn: 'text-warn',
  danger: 'text-danger',
};

interface InstanceGridProps {
  rows: readonly InstanceRow[];
  /** 이 서버의 트랜잭션을 보러 간다. 파고들 수 없는 칸에는 걸리지 않는다 */
  onDrill: (objHash: number) => void;
}

export const InstanceGrid = memo(function InstanceGrid({ rows, onDrill }: InstanceGridProps) {
  const counts = countByGrade(rows);

  return (
    <section className="mb-4">
      <header className="mb-2 flex items-baseline gap-2 border-b border-line pb-1">
        <h2 className="text-body font-medium text-fg">{t('서버별')}</h2>
        <span className="text-micro text-fg-faint">
          {rows.length}
          {t('대')}
          {/* **0 은 적지 않는다.** «위험 0 · 주의 0» 이 늘 붙어 있으면 그 자리를 안 읽게 된다 */}
          {counts.danger > 0 && ` · ${t('위험')} ${counts.danger}`}
          {counts.warn > 0 && ` · ${t('주의')} ${counts.warn}`}
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="px-1 py-3 text-small text-fg-faint">
          {t('아직 받은 지표가 없습니다.')}
        </p>
      ) : (
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
          {rows.map(row => {
            const worst = row.worst;
            const label = worst
              ? `${t(worst.def.label)} ${formatKpi(worst.value, worst.def.digits)}${worst.def.unit}`
              : '';
            return (
              <button
                key={row.objHash}
                type="button"
                onClick={() => onDrill(row.objHash)}
                disabled={!row.drillable}
                title={
                  row.drillable
                    ? `${row.fullName} — ${t('누르면 이 서버의 XLog 를 봅니다')}`
                    : row.fullName
                }
                className={`relative overflow-hidden rounded border border-line bg-surface px-2.5 py-1.5 text-left ${
                  row.drillable ? 'hover:bg-hover' : 'cursor-default'
                }`}
              >
                <span className={`absolute inset-y-0 left-0 w-0.5 ${EDGE[row.grade]}`} aria-hidden />
                <span className="block truncate text-small text-fg">{row.name}</span>
                {/* 칸이 좁아 지표 하나만 적는다. **가장 나쁜 것**이라 그게 이 칸의 이야기다 */}
                <span className={`block truncate text-micro tabular-nums ${TONE[row.grade]}`}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
});
