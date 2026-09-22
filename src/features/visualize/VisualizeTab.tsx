// Visualize 탭 — 판단하는 화면.
//
// Counter 탭과 **다른 질문에 답한다.** 저쪽은 카운터 40장을 전수로 놓고
// «무엇이 어떻게 변했나» 에 답하는 증거 화면이고, 여기는 그 앞에 놓이는
// «지금 정상인가 · 어디가 이상한가» 하나만 맡는다. 둘 다 필요하므로 둘 다 둔다.
//
// 그래서 여기에는 **나열이 없다.** 지표를 하나 더 붙이고 싶을 때마다
// «Counter 탭에 이미 있는가» 를 먼저 물어야 한다.

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { getConfig } from '../xlog/api/scouterApi';
import { ActiveServicePanel } from '../xlog/components/ActiveServicePanel';
import { counterFamily } from '../xlog/types/counter';
import { SectionHeader } from '../../components/SectionHeader';
import { ElapsedHistogram } from './ElapsedHistogram';
import { InstanceGrid } from './InstanceGrid';
import { KpiStrip } from './KpiStrip';
import { StackedTimeline } from './StackedTimeline';
import { TopServices } from './TopServices';
import { useRangeInsight } from './useRangeInsight';
import { ThresholdDialog } from './ThresholdDialog';
import { buildRows } from './instanceRows';
import { KPI_DEFS, type KpiId } from './kpi';
import { DEFAULT_THRESHOLDS, toThresholds, type ThresholdMap } from './threshold';
import { useInstanceKpis } from './useInstanceKpis';
import { useKpiSamples } from './useKpiSamples';
import { usePastCounters, type CounterQuery } from './usePastCounters';
import { useYesterday } from './useYesterday';
import { sameTimeYesterday, yesterdayValue } from './yesterday';
import { t } from '../../i18n';

/**
 * 타임라인이 담는 시간 폭.
 *
 * **하루를 넣지 않는다.** 이 화면이 답하는 질문은 «같은 순간에 무엇이 함께
 * 움직였나» 라서, 한 점이 몇 분씩을 뭉개기 시작하면 «같은 순간» 이 사라진다.
 * 그날 하루의 모양은 Counter 탭의 오늘 누적이 답한다.
 */
const SPANS: readonly { label: string; ms: number }[] = [
  { label: '1시간', ms: 3_600_000 },
  { label: '3시간', ms: 3 * 3_600_000 },
  { label: '6시간', ms: 6 * 3_600_000 },
];

interface VisualizeTabProps {
  /** 접속돼 있고 이 탭을 보고 있는가 */
  enabled: boolean;
  /** javaee 오브젝트의 objType. 액티브 서비스는 objHash 로는 못 묻는다 */
  javaeeTypes: readonly string[];
  /** 지금 보기로 고른 오브젝트. 여기 없는 서버는 그리지 않는다 */
  picked: ReadonlySet<number>;
  /** 호스트 오브젝트의 objType. 없으면 CPU 줄을 물을 데가 없다 */
  hostTypes: readonly string[];
  /** 트랜잭션이 있는 오브젝트들. 격자에서 파고들 수 있는 칸을 가른다 */
  javaeeHashes: readonly number[];
  /** 고른 서버들이 속한 Family. 안 고른 Family 의 지표는 «안 골랐다» 고 말한다 */
  families: ReadonlySet<string>;
  agentMap: Map<number, string>;
  /** 이 서버의 트랜잭션을 보러 간다 (XLog 탭으로 데려가며 조건을 건다) */
  onDrill: (objHash: number) => void;
  /**
   * 이 서비스의 트랜잭션을 보러 간다.
   *
   * **순위표의 값어치는 «이게 제일 비싸다» 다음에 있다.** 이름을 찾아 놓고 XLog 탭에서
   * 같은 글자를 다시 쳐야 하면 순위를 본 보람이 없다.
   */
  onDrillService: (serviceName: string) => void;
}

/** 고른 Family 가 없을 때 넘기는 빈 목록. 렌더마다 새 배열을 만들면 훅이 매번 다시 돈다 */
const NO_TYPES: readonly string[] = [];

export const VisualizeTab = memo(function VisualizeTab({
  enabled,
  javaeeTypes,
  hostTypes,
  picked,
  javaeeHashes,
  families,
  agentMap,
  onDrill,
  onDrillService,
}: VisualizeTabProps) {
  const { kpis, lastReceivedAt } = useKpiSamples(enabled, picked);
  const { samples } = useInstanceKpis(enabled, picked);
  const [thresholds, setThresholds] = useState<ThresholdMap>(DEFAULT_THRESHOLDS);
  const [showThresholds, setShowThresholds] = useState(false);

  // 한 번만 읽는다. 창에서 고치면 그쪽이 저장하고 `onApply` 로 여기 값을 바꾼다 —
  // 저장할 때마다 다시 읽으면 파일 왕복 한 번이 화면 반영보다 늦다.
  useEffect(() => {
    let cancelled = false;
    getConfig()
      .then(cfg => { if (!cancelled) setThresholds(toThresholds(cfg.kpi_thresholds)); })
      // 못 읽어도 기본 임계로 뜬다. 색이 없는 것보다 기본 자로라도 읽히는 편이 낫다.
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const applyThresholds = useCallback((next: ThresholdMap) => setThresholds(next), []);

  // ── 타임라인 ────────────────────────────────────────────
  const [spanMs, setSpanMs] = useState(SPANS[0].ms);
  /**
   * 구간의 끝.
   *
   * **매 렌더 `Date.now()` 를 쓰면 안 된다.** 구간이 조금씩 달라져 조회가 끝없이 다시 나간다.
   * 30초마다 한 번만 민다 — 그보다 촘촘히 밀 이유가 없다(한 점이 몇 초짜리다).
   */
  const [anchor, setAnchor] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setAnchor(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [enabled]);

  const range = useMemo(
    () => ({ stime: anchor - spanMs, etime: anchor }),
    [anchor, spanMs],
  );

  /**
   * 무엇을 몇 줄로 쌓을지.
   *
   * KPI 여섯 중 **네 개**만 쌓는다 — 액티브는 «지금» 만 뜻이 있어 과거 곡선이
   * 답하는 질문이 없고, 여섯 줄이면 한 줄이 너무 납작해진다.
   */
  const queries = useMemo<CounterQuery[]>(() => {
    // **고른 Family 만 묻는다.** objType 은 «붙어 있는 종류» 지 «고른 것» 이 아니다 —
    // 호스트를 안 골랐는데 CPU 를 물으면 타입 전체를 받아 통째로 버린다.
    const typesOf = (counter: CounterQuery['counter']): readonly string[] => {
      const family = counterFamily(counter);
      if (family === 'host') return families.has('host') ? hostTypes : [];
      return families.has('javaee') ? javaeeTypes : [];
    };
    const rowsOf: CounterQuery[] = [];
    for (const id of ['tps', 'elapsed', 'error', 'cpu'] as const) {
      const def = KPI_DEFS.find(d => d.id === id);
      if (!def) continue;
      rowsOf.push({ counter: def.counter, objTypes: typesOf(def.counter) });
    }
    return rowsOf;
  }, [javaeeTypes, hostTypes, families]);

  const past = usePastCounters(enabled, queries, range, picked);

  // ── 어제 이 시각 ────────────────────────────────────────
  //
  // **Heap 은 뺀다.** 어제 누적에는 상한이 없어 사용량(MB)만 오는데, 지금 값은 %다 —
  // 단위가 다른 두 수를 나란히 적으면 74% 옆에 «어제 88» 이 붙는다.
  const yesterdayQueries = useMemo(
    () => queries.concat(
      KPI_DEFS.filter(d => d.id === 'active').map(d => ({
        counter: d.counter,
        objTypes: families.has('javaee') ? javaeeTypes : [],
      })),
    ),
    [queries, javaeeTypes, families],
  );
  const yesterdayRaw = useYesterday(enabled, yesterdayQueries);

  const yesterday = useMemo(() => {
    const at = sameTimeYesterday(anchor);
    const out = new Map<KpiId, number | null>();
    for (const def of KPI_DEFS) {
      const series = yesterdayRaw.get(def.counter);
      out.set(def.id, series ? yesterdayValue(series, picked, def.counter, at) : null);
    }
    return out;
  }, [yesterdayRaw, picked, anchor]);

  // ── 이 구간에 무엇이 있었나 ──────────────────────────
  //
  // **펼쳤을 때만 받는다.** 분포는 트랜잭션을 세야 나오는데 1시간이 실측 8만 건이라,
  // 탭을 열 때마다 나가면 이 화면에서 제일 무거운 일이 된다
  // (`SummaryPanel` 이 «구간 전체를 훑는 무거운 조회» 를 다루는 방식과 같다).
  const [showInsight, setShowInsight] = useState(false);
  const insight = useRangeInsight(
    enabled && showInsight,
    families.has('javaee') ? javaeeTypes : NO_TYPES,
    picked,
    range,
  );

  // 2초마다 오는 값으로 매번 줄을 세우면 칸이 수십 개일 때 정렬이 렌더마다 돈다.
  const rows = useMemo(
    () => buildRows({ samples, agentMap, javaeeHashes, thresholds }),
    [samples, agentMap, javaeeHashes, thresholds],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {/* 섹션마다 `mb-4` 하나로 리듬을 맞춘다. 예전에는 지표 줄만 아래 여백이 없고
          격자만 `mt-3` 을 따로 갖고 있어, 네 덩이의 간격이 세 종류였다. */}
      <section className="mb-4">
        <SectionHeader
          title={t('지금')}
          subtitle={t('2초마다 갱신')}
          action={
            <button
              onClick={() => setShowThresholds(true)}
              title={t('어떤 수부터 노랗고 빨간지 정합니다')}
              className="rounded border border-line-strong px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
            >
              {t('임계값')}
            </button>
          }
        />

        <KpiStrip
          kpis={kpis}
          lastReceivedAt={lastReceivedAt}
          connected={enabled}
          thresholds={thresholds}
          families={families}
          yesterday={yesterday}
        />
      </section>

      {/* 줄이 «전체가 견디고 있나» 라면 격자는 «어느 대가 이상한가» 다.
          접은 값은 열 대 중 한 대가 차 있어도 멀쩡해 보인다.
          (`InstanceGrid` 가 제 `<section>` 을 갖고 있어 여기서 감싸지 않는다.) */}
      <InstanceGrid rows={rows} onDrill={onDrill} />

      {/* 줄과 격자가 «지금» 이라면 이건 **«같은 순간에 무엇이 함께 움직였나»** 다.
          Counter 탭의 차트 40장은 저마다 자기 x축이라 이 질문에 답하지 못한다. */}
      <section className="mb-4">
        <SectionHeader
          title={t('같은 시간축')}
          subtitle={past.loading ? t('받는 중…') : t('마우스를 올리면 그 시각의 값을 봅니다')}
          action={
            <div className="flex gap-0.5">
              {SPANS.map(s => (
                <button
                  key={s.ms}
                  onClick={() => setSpanMs(s.ms)}
                  aria-pressed={spanMs === s.ms}
                  className={`rounded px-2 py-0.5 text-micro ${
                    spanMs === s.ms ? 'bg-hover text-fg' : 'text-fg-dim hover:text-fg'
                  }`}
                >
                  {t(s.label)}
                </button>
              ))}
            </div>
          }
        />
        {past.error ? (
          <p className="px-1 py-3 text-small text-danger">{past.error}</p>
        ) : past.rows.length === 0 ? (
          <p className="px-1 py-3 text-small text-fg-faint">
            {past.loading ? t('받는 중…') : t('이 구간에 값이 없습니다')}
          </p>
        ) : (
          <div className="overflow-hidden rounded border border-line bg-surface">
            <StackedTimeline rows={past.rows} range={range} agentMap={agentMap} />
          </div>
        )}
      </section>

      {/* 지표가 «지금 몇» 이라면 이건 **«그 몇이 어떻게 생긴 몇인가»** 다.
          평균 320ms 는 전부 320ms 인 것과 95%가 80ms 인데 5%가 5초인 것에서 똑같이 나오는데,
          **뒤쪽만 장애다.** 분포가 그 둘을 가르고, 순위표가 범인 후보를 준다. */}
      <section className="mb-4">
        {/* 부제가 **무거운 조회라는 것을 먼저 말한다.** 눌러 놓고 몇 초를 기다리게 하면
            고장으로 읽힌다. */}
        <SectionHeader
          title={t('이 구간')}
          open={showInsight}
          onToggle={() => setShowInsight(v => !v)}
          subtitle={
            showInsight
              ? insight.loading
                ? t('트랜잭션을 세는 중…')
                : t('응답시간 분포와 서비스 순위')
              : t('펼치면 이 구간의 트랜잭션을 세어 분포와 순위를 냅니다')
          }
          action={
            showInsight && !insight.loading ? (
              <button
                onClick={insight.reload}
                title={t('같은 구간을 다시 셉니다')}
                className="rounded border border-line-strong px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
              >
                {t('다시')}
              </button>
            ) : undefined
          }
        />

        {showInsight &&
          (insight.error ? (
            <p className="px-1 py-3 text-small text-danger">{insight.error}</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded border border-line bg-surface p-3">
                <h3 className="mb-2 text-small font-medium text-fg-muted">{t('응답시간 분포')}</h3>
                <ElapsedHistogram data={insight.distribution} loading={insight.loading} />
              </div>
              <div className="rounded border border-line bg-surface p-3">
                <h3 className="mb-2 text-small font-medium text-fg-muted">{t('서비스 순위')}</h3>
                <TopServices
                  rows={insight.services}
                  loading={insight.loading}
                  wholeType={insight.wholeType}
                  onDrill={onDrillService}
                />
              </div>
            </div>
          ))}
      </section>

      {/* 지표가 «몇 이다» 라면 이건 «지금 무엇이 밀려 있나» 다.
          숫자가 커진 이유를 바로 옆에서 물을 수 있어야 한 화면이 된다. */}
      <ActiveServicePanel
        objTypes={javaeeTypes}
        enabled={enabled && javaeeTypes.length > 0}
        agentMap={agentMap}
      />

      {showThresholds && (
        <ThresholdDialog
          value={thresholds}
          onApply={applyThresholds}
          onClose={() => setShowThresholds(false)}
        />
      )}
    </div>
  );
});
