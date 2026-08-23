// src/features/xlog/components/CounterChart.tsx
// 실시간 성능 카운터 라인 차트 (Canvas 2D)

import { memo, useEffect, useRef, useState } from 'react';
import type { CounterName, CounterUpdate } from '../types/counter';
import { counterMeta, isTotalCapable, MAX_COUNTER_SAMPLES } from '../types/counter';
import { onCounterData } from '../api/scouterApi';
import { subscribe } from '../api/subscribe';
import { deriveStreamStatus } from '../utils/streamStatus';
import { sampleX, totalLineVisible } from './counterGeometry';
import { aggregate, totalMode } from './counterTotal';
import { CANVAS, SERIES } from '../../../styles/tokens';

/** 카운터 폴링이 2초라 넉넉히 잡는다 */
const STALE_AFTER_MS = 8_000;

/** 합계 선의 자리표. 실제 objHash 와 겹치지 않게 둔다 */
const TOTAL_HASH = 0;

interface CounterChartProps {
  isStreaming: boolean;
  /** counters.xml 표기 그대로의 카운터명 */
  counter: CounterName;
  /** objHash → objName. 범례 표시에만 쓴다 */
  agentMap: Map<number, string>;
  /** 차트 높이 (px, 기본 80) */
  height?: number;
  /**
   * true 면 오브젝트별 선 대신 **접은 값 한 선**을 그린다 (ASIS RealTimeTotalCount).
   * 접는 방식(합/평균)은 카운터가 정한다 — counterTotal.totalMode
   */
  total?: boolean;
}

interface AgentSamples {
  objHash: number;
  values: number[];
  times: number[];
  /** 쌍 카운터의 상한. 스칼라 카운터면 null (F-33) */
  total: number | null;
}

// Canvas 는 var() 를 못 읽으므로 실제 색 문자열이어야 한다.
const PALETTE = SERIES;

export const CounterChart = memo(function CounterChart({
  isStreaming,
  counter,
  agentMap,
  height = 80,
  total = false,
}: CounterChartProps) {
  // prop 이름이 `total` 인데 쌍 카운터의 상한도 `total` 이라 같은 함수 안에서 겹친다.
  // 지역에서는 이름을 갈라 둔다.
  //
  // **counters.xml 이 안 된다고 한 카운터는 접지 않는다.** CPU 를 더하거나
  // Heap Total 을 더한 값은 아무 질문에도 답하지 않는다 — 요청받아도 개별로 그린다.
  const capable = isTotalCapable(counter);
  const totalOne = total && capable;
  const mode = totalMode(counter);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seriesRef = useRef<Map<number, AgentSamples>>(new Map());
  const [agentCount, setAgentCount] = useState(0);
  // rAF 클로저에서 읽으므로 state 가 아니라 ref 여야 한다 (state 면 값이 고정된다).
  const lastReceivedRef = useRef<number | null>(null);
  const streamingRef = useRef(isStreaming);
  streamingRef.current = isStreaming;

  // 카운터 데이터 수신 — 이벤트는 카운터 단위로 오므로 내 카운터만 골라낸다
  useEffect(() => {
    if (!isStreaming) return;

    return subscribe(
      onCounterData((update: CounterUpdate) => {
        if (update.counter !== counter) return;

        lastReceivedRef.current = Date.now();

        if (totalOne) {
          // 한 시점의 오브젝트 값을 하나로 접어 **선 하나**로 쌓는다.
          const folded = aggregate(update.values.map(v => v.value), mode);
          if (folded === null) return;
          let series = seriesRef.current.get(TOTAL_HASH);
          if (!series) {
            series = { objHash: TOTAL_HASH, values: [], times: [], total: null };
            seriesRef.current.set(TOTAL_HASH, series);
            setAgentCount(update.values.length);
          }
          series.times.push(update.time);
          series.values.push(folded);
          // 쌍 카운터의 상한도 같은 방식으로 접는다 — 안 그러면 기준선이 한 대 몫만 남는다.
          const totals = update.values
            .map(v => v.total)
            .filter((t): t is number => typeof t === 'number');
          series.total = aggregate(totals, mode);
          if (series.values.length > MAX_COUNTER_SAMPLES) {
            series.values.shift();
            series.times.shift();
          }
          return;
        }

        for (const { obj_hash, value, total } of update.values) {
          let series = seriesRef.current.get(obj_hash);
          if (!series) {
            series = { objHash: obj_hash, values: [], times: [], total: null };
            seriesRef.current.set(obj_hash, series);
            setAgentCount(seriesRef.current.size);
          }
          series.times.push(update.time);
          series.values.push(value);
          // 상한은 시간에 따라 거의 변하지 않는다. 최신 값 하나만 든다.
          series.total = total ?? null;

          if (series.values.length > MAX_COUNTER_SAMPLES) {
            series.values.shift();
            series.times.shift();
          }
        }
      }),
    );
  }, [isStreaming, counter]);

  // 연결이 끊기면 수신 이력을 초기화한다. (rAF 는 매 프레임 도니 별도 틱은 불필요)
  //
  // **모드가 바뀔 때도 비운다.** 안 비우면 개별 값과 접은 값이 한 선에 이어져
  // 전환하는 순간 없던 계단이 생긴다.
  useEffect(() => {
    lastReceivedRef.current = null;
    seriesRef.current.clear();
    setAgentCount(0);
  }, [isStreaming, totalOne]);

  // rAF 렌더 루프
  useEffect(() => {
    let rafId: number;
    const chartH = height;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) { rafId = requestAnimationFrame(render); return; }

      const ctx = canvas.getContext('2d');
      if (!ctx) { rafId = requestAnimationFrame(render); return; }

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = chartH;

      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.scale(dpr, dpr);
      }

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = CANVAS.bgSurface;
      ctx.fillRect(0, 0, w, h);

      const agents = Array.from(seriesRef.current.values());
      if (agents.length === 0) {
        // "데이터 없음"만 띄우면 고장인지 트래픽이 없는 건지 알 수 없다.
        const st = deriveStreamStatus({
          connected: streamingRef.current,
          lastReceivedAt: lastReceivedRef.current,
          now: Date.now(),
          staleAfterMs: STALE_AFTER_MS,
        });
        ctx.fillStyle = st.kind === 'stale' ? CANVAS.error : CANVAS.textDim;
        ctx.font = '11px sans-serif';
        ctx.fillText(st.message, 8, 20);
        rafId = requestAnimationFrame(render);
        return;
      }

      drawLines(ctx, agents, w, h, PALETTE);

      // 범례. 합계 모드에는 선이 하나뿐이라 이름 대신 접는 방식을 적는다 —
      // 여기서 "합계인가 평균인가"를 말해 주지 않으면 두 배로 읽거나 절반으로 읽는다.
      if (totalOne) {
        ctx.fillStyle = PALETTE[0];
        ctx.fillRect(8, h - 16, 10, 2);
        ctx.fillStyle = CANVAS.textMuted;
        ctx.font = '9px monospace';
        ctx.fillText(mode === 'avg' ? '평균' : '합계', 22, h - 8);
      } else {
        agents.forEach((a, i) => {
          const color = PALETTE[i % PALETTE.length];
          ctx.fillStyle = color;
          ctx.fillRect(8 + i * 90, h - 16, 10, 2);
          ctx.fillStyle = CANVAS.textMuted;
          ctx.font = '9px monospace';
          const objName = agentMap.get(a.objHash) ?? String(a.objHash);
          const agentLabel = objName.split('/').pop() ?? objName;
          ctx.fillText(agentLabel.substring(0, 10), 22 + i * 90, h - 8);
        });
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [height, agentMap, totalOne, mode]);

  // javaee / host 어느 Family 든 여기서 찾는다.
  const meta = counterMeta(counter);

  return (
    <div className="overflow-hidden rounded border border-line bg-surface">
      {/* 한 텍스트 노드로 둔다 — jsdom 에 2d 컨텍스트가 없어 캔버스를 못 보므로
          이 라벨이 이벤트 필터링·중복 제거를 검증하는 유일한 통로다
          (CounterChart.test.tsx). */}
      <div className="truncate px-2 pt-1 text-micro text-fg-muted" title={meta.disp}>
        {meta.disp} ({meta.unit}){' '}
        {agentCount > 0
          ? totalOne
            ? `· ${mode === 'avg' ? '평균' : '합계'} · ${agentCount}개 에이전트`
            : // 구역이 합계인데 이 카운터만 개별이면 **말해 줘야 한다.**
              // 조용히 두면 옆 차트와 같은 자로 읽는다.
              `· ${agentCount}개 에이전트${total && !capable ? ' · 합계 없음' : ''}`
          : ''}
      </div>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height }}
      />
    </div>
  );
});

function drawLines(
  ctx: CanvasRenderingContext2D,
  agents: AgentSamples[],
  w: number,
  h: number,
  palette: readonly string[],
) {
  const usable = h - 20;
  const allValues = agents.flatMap(a => a.values);
  const maxUsed = Math.max(...allValues, 1);

  // 상한을 같은 축에 놓아도 사용량 추세가 살아 있을 때만 함께 그린다.
  // FdUsage 처럼 상한이 3만 배면 사용량 선이 바닥에 붙어 아무것도 안 보인다.
  const total = agents.find(a => a.total !== null)?.total ?? null;
  const withTotal = totalLineVisible(maxUsed, total);
  const maxVal = withTotal && total !== null ? total : maxUsed;

  if (withTotal && total !== null) {
    const y = usable - (total / maxVal) * usable + 4;
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = CANVAS.textDim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.restore();
  }

  agents.forEach((agent, i) => {
    const data = agent.values;
    if (data.length < 2) return;

    const color = palette[i % palette.length];
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;

    data.forEach((v, j) => {
      const x = sampleX(j, data.length, w, MAX_COUNTER_SAMPLES);
      const y = usable - (v / maxVal) * usable + 4;
      if (j === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();
  });

  ctx.fillStyle = CANVAS.textDim;
  ctx.font = '9px monospace';
  ctx.fillText(String(Math.round(maxVal)), 2, 12);
  ctx.fillText('0', 2, usable + 4);

  // 기준선을 못 그린 쌍 카운터는 상한을 숫자로라도 알려준다 —
  // "열린 것 36" 만으로는 여유가 있는지 없는지 알 수 없다.
  if (!withTotal && total !== null) {
    const label = `상한 ${Math.round(total).toLocaleString()}`;
    ctx.fillText(label, w - ctx.measureText(label).width - 4, 12);
  }
}

