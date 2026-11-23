// 카운터 판 — 카운터 하나를 판 가득 그린다 (원본 스카우터의 Counter RealTime 창)
//
// Counter 탭의 차트(`CounterChart`)를 그대로 쓴다. 다른 것은 둘:
//   · 높이를 판에 맞춘다 — 판을 끌어 키우면 차트도 커진다
//   · 개별 / 합계 / 서비스별 을 판마다 고른다 (Counter 탭은 구역마다)
// 값은 앱 전체 카운터 스트림 하나에서 온다 — 보이는 카운터 판들의 서버를 합쳐 받는다(App). 이 판은 제 서버만 그린다.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { CounterChart } from './CounterChart';
import { type CounterName } from '../types/counter';
import { isFoldable } from './counterTotal';
import { useSectionFold } from '../hooks/useSectionFold';
import { t } from '../../../i18n';

interface CounterPanelViewProps {
  counter: CounterName;
  isStreaming: boolean;
  agentMap: Map<number, string>;
  /** 오브젝트 → 서비스 이름. 서비스로 묶어 볼 때만 */
  serviceOf?: (objHash: number) => string | null;
  /** 이 판이 그릴 오브젝트 (판의 고르기를 푼 것) */
  hashes: ReadonlySet<number>;
}

/** 차트 머리글·접기 단추가 차지하는 높이 */
const CHROME_PX = 44;

export const CounterPanelView = memo(function CounterPanelView({
  counter,
  isStreaming,
  agentMap,
  serviceOf,
  hashes,
}: CounterPanelViewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(160);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setH(Math.max(60, Math.round(e.contentRect.height) - CHROME_PX)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { fold, setFold, choices } = useSectionFold(serviceOf !== undefined, hashes.size);
  const visible = useMemo(() => new Set(hashes), [hashes]);

  return (
    <div ref={boxRef} className="flex h-full min-h-0 flex-col gap-1">
      {isFoldable(counter) && (
        <div className="flex shrink-0 justify-end gap-0.5">
          {choices.map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setFold(v)}
              aria-pressed={fold === v}
              className={`rounded px-2 py-0.5 text-micro ${fold === v ? 'bg-hover text-fg' : 'text-fg-dim hover:text-fg'}`}
            >
              {v === 'total' ? t('전체') : v === 'service' ? t('서비스별') : t('개별')}
            </button>
          ))}
        </div>
      )}
      <CounterChart
        counter={counter}
        isStreaming={isStreaming}
        agentMap={agentMap}
        height={h}
        fold={fold}
        serviceOf={serviceOf}
        visible={visible}
      />
    </div>
  );
});
