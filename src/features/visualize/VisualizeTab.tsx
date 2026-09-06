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
import { InstanceGrid } from './InstanceGrid';
import { KpiStrip } from './KpiStrip';
import { ThresholdDialog } from './ThresholdDialog';
import { buildRows } from './instanceRows';
import { DEFAULT_THRESHOLDS, toThresholds, type ThresholdMap } from './threshold';
import { useInstanceKpis } from './useInstanceKpis';
import { useKpiSamples } from './useKpiSamples';
import { t } from '../../i18n';

interface VisualizeTabProps {
  /** 접속돼 있고 이 탭을 보고 있는가 */
  enabled: boolean;
  /** javaee 오브젝트의 objType. 액티브 서비스는 objHash 로는 못 묻는다 */
  javaeeType: string;
  /** 트랜잭션이 있는 오브젝트들. 격자에서 파고들 수 있는 칸을 가른다 */
  javaeeHashes: readonly number[];
  agentMap: Map<number, string>;
  /** 이 서버의 트랜잭션을 보러 간다 (XLog 탭으로 데려가며 조건을 건다) */
  onDrill: (objHash: number) => void;
}

export const VisualizeTab = memo(function VisualizeTab({
  enabled,
  javaeeType,
  javaeeHashes,
  agentMap,
  onDrill,
}: VisualizeTabProps) {
  const { kpis, lastReceivedAt } = useKpiSamples(enabled);
  const { samples } = useInstanceKpis(enabled);
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

  // 2초마다 오는 값으로 매번 줄을 세우면 칸이 수십 개일 때 정렬이 렌더마다 돈다.
  const rows = useMemo(
    () => buildRows({ samples, agentMap, javaeeHashes, thresholds }),
    [samples, agentMap, javaeeHashes, thresholds],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <header className="mb-2 flex items-baseline gap-2 border-b border-line pb-1">
        <h2 className="text-body font-medium text-fg">{t('지금')}</h2>
        <span className="text-micro text-fg-faint">{t('2초마다 갱신')}</span>
        <div className="flex-1" />
        <button
          onClick={() => setShowThresholds(true)}
          title={t('어떤 수부터 노랗고 빨간지 정합니다')}
          className="rounded border border-line-strong px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
        >
          {t('임계값')}
        </button>
      </header>

      <KpiStrip
        kpis={kpis}
        lastReceivedAt={lastReceivedAt}
        connected={enabled}
        thresholds={thresholds}
      />

      {/* 줄이 «전체가 견디고 있나» 라면 격자는 «어느 대가 이상한가» 다.
          접은 값은 열 대 중 한 대가 차 있어도 멀쩡해 보인다. */}
      <div className="mt-3">
        <InstanceGrid rows={rows} onDrill={onDrill} />
      </div>

      {/* 지표가 «몇 이다» 라면 이건 «지금 무엇이 밀려 있나» 다.
          숫자가 커진 이유를 바로 옆에서 물을 수 있어야 한 화면이 된다. */}
      <div>
        <ActiveServicePanel
          objType={javaeeType}
          enabled={enabled && javaeeType !== ''}
          agentMap={agentMap}
        />
      </div>

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
