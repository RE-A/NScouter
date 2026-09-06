// 지표 한 줄 — «지금 정상인가» 에 답하는 유일한 화면.
//
// Counter 탭이 40장을 나열해 «무엇이 어떻게 변했나» 에 답한다면, 이 줄은
// 그 앞에 놓이는 질문 하나만 맡는다. 그래서 여섯 칸에서 늘지 않는다.

import { memo, useEffect, useState } from 'react';
import { counterFamily } from '../xlog/types/counter';
import { deriveStreamStatus } from '../xlog/utils/streamStatus';
import { KPI_DEFS, type KpiId } from './kpi';
import { KpiTile } from './KpiTile';
import type { ThresholdMap } from './threshold';
import type { KpiSamples } from './useKpiSamples';
import { t } from '../../i18n';

/** 카운터 폴링이 2초라 넉넉히 잡는다 (`CounterChart` 와 같은 값) */
const STALE_AFTER_MS = 8_000;

interface KpiStripProps {
  kpis: KpiSamples;
  lastReceivedAt: number | null;
  connected: boolean;
  thresholds: ThresholdMap;
  /**
   * 고른 서버들이 속한 Family.
   *
   * 지표마다 주는 Family 가 정해져 있다 — CPU 는 host 만 준다. 안 고른 Family 의
   * 타일은 «값이 안 온다» 가 아니라 «안 골랐다» 라고 말해야 한다.
   */
  families: ReadonlySet<string>;
  /** 지표별 «어제 이 시각» 값. 견줄 것이 없으면 빠져 있다 */
  yesterday: ReadonlyMap<KpiId, number | null>;
}

export const KpiStrip = memo(function KpiStrip({
  kpis,
  lastReceivedAt,
  connected,
  thresholds,
  families,
  yesterday,
}: KpiStripProps) {
  // **값이 끊기면 이 컴포넌트도 다시 그려지지 않는다.** 그러면 «수신 없음» 이
  // 영영 안 뜬다 — 스트림이 멈춘 바로 그때 화면이 마지막 값을 정상인 척 붙들고 있게 된다.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 2_000);
    return () => clearInterval(id);
  }, []);

  const status = deriveStreamStatus({
    connected,
    lastReceivedAt,
    now,
    staleAfterMs: STALE_AFTER_MS,
  });

  return (
    <div>
      {/* 좁은 창에서 여섯 칸을 한 줄에 밀어 넣으면 숫자가 잘린다. 접히게 둔다 —
          접힌 두 번째 줄도 여전히 «한눈» 안이다. */}
      <div className="flex flex-wrap gap-2">
        {KPI_DEFS.map(def => (
          <KpiTile
            key={def.id}
            def={def}
            value={kpis[def.id].value}
            samples={kpis[def.id].samples}
            threshold={thresholds[def.id]}
            available={families.has(counterFamily(def.counter) ?? '')}
            yesterday={yesterday.get(def.id) ?? null}
          />
        ))}
      </div>

      {/* **«값이 없다» 와 «안 오고 있다» 를 가른다.** 줄표 여섯 개만 띄우면
          트래픽이 없는 건지 스트림이 끊긴 건지 알 수 없다. 정상일 때는 적지 않는다. */}
      {status.kind !== 'live' && (
        <p
          className={`mt-1 px-1 text-micro ${status.kind === 'stale' ? 'text-danger' : 'text-fg-faint'}`}
        >
          {t(status.message)}
        </p>
      )}
    </div>
  );
});
