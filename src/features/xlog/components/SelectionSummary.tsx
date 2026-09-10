// 드래그로 고른 구간의 요약.
//
// 끌고 나면 다음 질문은 늘 같다 — «여기 몇 건이고, 얼마나 느렸고, 몇 개가 터졌나».
// 지금까지 이 자리에는 건수만 있었고, 나머지는 목록을 훑어 눈으로 세야 했다.
//
// **트랜잭션 목록의 머리에 둔다.** 캔버스 위에 띄우면 정작 고른 점들을 가리고,
// 다른 데 두면 끌고 나서 눈을 옮겨야 한다 — 여기가 이미 눈이 가는 자리다.

import { memo } from 'react';
import {
  formatSpan,
  selectionTps,
  type ElapsedBreakdown,
  type SelectionStats,
} from './selectionStats';
import { durationTone } from './durationTone';
import { formatYAmount, yAxisShortLabel } from '../types/xlog';
import { t } from '../../../i18n';

interface SelectionSummaryProps {
  stats: SelectionStats;
}

export const SelectionSummary = memo(function SelectionSummary({ stats }: SelectionSummaryProps) {
  if (stats.count === 0) return null;

  const tps = selectionTps(stats);
  /**
   * 느림의 색은 **소요시간 축에서만** 준다.
   *
   * `durationTone` 의 자(300ms·1초)는 ms 를 재는 자다. SQL 건수 축의 «평균 12» 에
   * 그 자를 대면 12건이 «빠르다» 는 뜻이 되어 버린다.
   */
  const timed = stats.mode === 'elapsed' || stats.mode === 'sqlTime' || stats.mode === 'apiCallTime';
  const tone = (v: number | null) =>
    timed && v !== null ? durationTone(v * 1000) : 'text-fg-muted';

  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 normal-case">
      <Item label={t('평균')} value={stats.avg === null ? '—' : formatYAmount(stats.mode, stats.avg)} cls={tone(stats.avg)} />
      <Item label={t('최대')} value={stats.max === null ? '—' : formatYAmount(stats.mode, stats.max)} cls={tone(stats.max)} />

      {/* **에러가 0 이면 적지 않는다.** «에러 0» 이 늘 붙어 있으면 그 자리를 안 읽게 된다 */}
      {stats.errors > 0 && stats.errorRate !== null && (
        <Item
          label={t('에러')}
          value={`${stats.errors.toLocaleString()} (${percent(stats.errorRate)})`}
          cls="text-danger"
        />
      )}

      {/* 폭과 TPS 는 **고른 방식이 만든 수**이기도 하다 — 폭이 짧으면 TPS 를 말하지 않는다 */}
      {stats.spanMs > 0 && <Item label={t('폭')} value={formatSpan(stats.spanMs)} cls="text-fg-dim" />}
      {tps !== null && <Item label="TPS" value={tps.toFixed(1)} cls="text-fg-dim" />}

      {/* 어느 축을 보고 있는지. 없으면 «평균 12» 가 무엇의 12 인지 알 수 없다 */}
      <span className="text-micro text-fg-faint">{yAxisShortLabel(stats.mode)}</span>

      {/* **축은 한 번에 하나만 그릴 수 있다.** 점 하나에 높이가 하나뿐이라
          Elapsed 와 SQL Time 을 동시에 세울 방법이 없다. 대신 고른 뒤에 한자리에서
          답한다 — «그 1,240 이 SQL 이었나 API 였나». */}
      <Breakdown of={stats.breakdown} />
    </span>
  );
});

/** 그 시간이 어디로 갔나 — 한 건 평균 */
function Breakdown({ of }: { of: ElapsedBreakdown }) {
  // 잰 시간이 없으면 나눌 것도 없다.
  //
  // **SQL 도 API 도 0 이면 붙이지 않는다.** 그때 내역은 «SQL 0 · API 0 · 그 외 500ms» 인데,
  // 그 500 은 바로 왼쪽의 평균과 같은 수다 — 나눈 것이 아니라 되풀이한 것이다.
  if (of.totalMs <= 0) return null;
  if (of.sqlMs === 0 && of.apiMs === 0) return null;

  return (
    <span
      className="flex items-baseline gap-1.5 rounded border border-line px-1.5 text-micro"
      title={
        of.overlapped
          ? t('SQL 과 API 가 겹쳐 돌아 둘의 합이 전체보다 큽니다 — 빼서 «나머지» 를 낼 수 없습니다')
          : t('한 건 평균으로 나눈 소요 시간입니다')
      }
    >
      <span className="text-fg-faint">{t('내역')}</span>
      <Part label="SQL" ms={of.sqlMs} cls="text-[var(--cat-sql)]" />
      <Part label="API" ms={of.apiMs} cls="text-[var(--cat-api)]" />
      {/* **겹쳐 돌면 «나머지» 를 적지 않는다.** 0 으로 눌린 값이라 «남는 시간이
          없다» 로 읽히는데, 실제로는 더할 수 없는 것뿐이다. */}
      {of.overlapped ? (
        <span className="text-warn">{t('겹침')}</span>
      ) : (
        <Part label={t('그 외')} ms={of.restMs} cls="text-fg-dim" />
      )}
    </span>
  );
}

function Part({ label, ms, cls }: { label: string; ms: number; cls: string }) {
  return (
    <span className="text-fg-faint">
      {label} <span className={`tnum font-mono ${cls}`}>{ms.toLocaleString()}ms</span>
    </span>
  );
}

function Item({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <span className="text-micro text-fg-faint">
      {label} <span className={`tnum font-mono ${cls}`}>{value}</span>
    </span>
  );
}

/** 0.4% 를 «0%» 로 적으면 없는 것이 된다 */
function percent(ratio: number): string {
  const pct = ratio * 100;
  if (pct === 0) return '0%';
  if (pct < 0.1) return '<0.1%';
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}
