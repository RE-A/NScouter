// src/features/xlog/components/CounterChart.tsx
// 실시간 성능 카운터 라인 차트 (Canvas 2D)

import { memo, useEffect, useRef, useState } from 'react';
import type { CounterName, CounterUpdate } from '../types/counter';
import { counterMeta, isTotalCapable, MAX_COUNTER_SAMPLES } from '../types/counter';
import { onCounterData } from '../api/scouterApi';
import { subscribe } from '../api/subscribe';
import { deriveStreamStatus } from '../utils/streamStatus';
import { axisLabel, minuteTicks, sampleX, totalLineVisible } from './counterGeometry';
import { totalMode } from './counterTotal';
import { foldSeries, legendLabel, shownObjectCount, type DrawSeries, type FoldMode } from './counterSeries';
import { CANVAS, SERIES } from '../../../styles/tokens';
import { formatTime } from '../utils/colorPalette';
import { useThemeEpoch } from '../../../styles/useThemeEpoch';
import { t } from '../../../i18n';

/** 카운터 폴링이 2초라 넉넉히 잡는다 */
const STALE_AFTER_MS = 8_000;

interface CounterChartProps {
  isStreaming: boolean;
  /** counters.xml 표기 그대로의 카운터명 */
  counter: CounterName;
  /** objHash → objName. 범례 표시에만 쓴다 */
  agentMap: Map<number, string>;
  /** 차트 높이 (px, 기본 80) */
  height?: number;
  /**
   * 선을 어떻게 접나 (`counterSeries.ts`).
   *   · each    — 오브젝트마다 한 선
   *   · total   — 접은 값 한 선 (ASIS RealTimeTotalCount)
   *   · service — 서비스마다 한 선
   * 접는 셈(합/평균)은 카운터가 정한다 — counterTotal.totalMode
   */
  fold?: FoldMode;
  /** 오브젝트 → 서비스 이름. `fold === 'service'` 일 때만 쓴다 */
  serviceOf?: (objHash: number) => string | null;
  /**
   * 그릴 오브젝트. `null` 이면 전부.
   *
   * **거르는 자리는 그리는 쪽이다.** 받는 쪽에서 거르면 골랐다 풀 때마다 그 서버의
   * 지난 값이 통째로 비어 다시 쌓일 때까지 기다려야 한다.
   */
  visible?: ReadonlySet<number> | null;
}

// Canvas 는 var() 를 못 읽으므로 실제 색 문자열이어야 한다.
// 합계 선 하나에만 쓴다. 오브젝트·서비스 선은 XLog 점과 같은 색(`getAgentColor`)이다 —
// 순서로 돌려 쓰면 같은 서버가 XLog 에서는 노랑, 여기서는 파랑이 된다.
const PALETTE = SERIES;

export const CounterChart = memo(function CounterChart({
  isStreaming,
  counter,
  agentMap,
  height = 80,
  fold = 'each',
  serviceOf,
  visible = null,
}: CounterChartProps) {
  // **counters.xml 이 안 된다고 한 카운터는 접지 않는다.** CPU 를 더하거나
  // Heap Total 을 더한 값은 아무 질문에도 답하지 않는다 — 요청받아도 개별로 그린다.
  const capable = isTotalCapable(counter);
  const drawn: FoldMode = capable ? fold : 'each';
  const mode = totalMode(counter);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 테마가 바뀜 때 한 번 더 그린다 — 캔버스에 칠해 둔 픽셀은 CSS 변수를 따라오지 않는다
  const themeEpoch = useThemeEpoch();

  /**
   * 받은 원본. 한 원소가 한 번의 폴링이다.
   *
   * **받을 때 접지 않는다.** 접는 방식은 그릴 때 정한다 — 그래야 개별/합계/서비스별을
   * 바꿔도 쌓아 둔 이력이 그대로 남는다.
   */
  const updatesRef = useRef<CounterUpdate[]>([]);
  /** 원본이 바뀐 횟수. 그리는 쪽이 다시 접을지 판단한다 */
  const versionRef = useRef(0);
  /** 머리글을 다시 그리게 하는 신호 — 처음 보는 오브젝트가 오면 바뀐다 */
  const [seenCount, setSeenCount] = useState(0);
  const seenRef = useRef<Set<number>>(new Set());
  // rAF 클로저에서 읽으므로 state 가 아니라 ref 여야 한다 (state 면 값이 고정된다).
  const lastReceivedRef = useRef<number | null>(null);
  const streamingRef = useRef(isStreaming);
  streamingRef.current = isStreaming;
  // rAF 클로저에서 읽는다 — deps 에 넣어 루프를 다시 세우면 프레임이 한 번 끊긴다.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const foldRef = useRef(drawn);
  foldRef.current = drawn;
  const serviceOfRef = useRef(serviceOf);
  serviceOfRef.current = serviceOf;

  // 카운터 데이터 수신 — 이벤트는 카운터 단위로 오므로 내 카운터만 골라낸다
  useEffect(() => {
    if (!isStreaming) return;

    return subscribe(
      onCounterData((update: CounterUpdate) => {
        if (update.counter !== counter) return;

        lastReceivedRef.current = Date.now();
        const buf = updatesRef.current;
        buf.push(update);
        if (buf.length > MAX_COUNTER_SAMPLES) buf.shift();
        versionRef.current += 1;

        for (const v of update.values) seenRef.current.add(v.obj_hash);
        setSeenCount(seenRef.current.size);
      }),
    );
  }, [isStreaming, counter]);

  // 연결이 끊기면 수신 이력을 초기화한다. (rAF 는 매 프레임 도니 별도 틱은 불필요)
  useEffect(() => {
    lastReceivedRef.current = null;
    updatesRef.current = [];
    versionRef.current += 1;
    seenRef.current = new Set();
    setSeenCount(0);
  }, [isStreaming]);

  // rAF 렌더 루프
  useEffect(() => {
    let rafId: number;
    const chartH = height;

    // 매 프레임 접으면 37개 차트 × 155 폴링 × 오브젝트 수를 60번씩 돈다.
    // 원본이나 접는 조건이 바뀔 때만 다시 접는다. 색 기준이 바뀌면(themeEpoch) 이 루프가
    // 새로 서므로 캐시도 새로 시작한다.
    let cacheKey: readonly unknown[] = [];
    let cached: DrawSeries[] = [];
    const folded = (): DrawSeries[] => {
      const key = [versionRef.current, foldRef.current, visibleRef.current, serviceOfRef.current];
      if (key.length !== cacheKey.length || key.some((k, i) => k !== cacheKey[i])) {
        cached = foldSeries(updatesRef.current, {
          fold: foldRef.current,
          agg: mode,
          visible: visibleRef.current,
          serviceOf: serviceOfRef.current,
          nameOf: h => {
            const objName = agentMap.get(h) ?? String(h);
            return objName.split('/').pop() ?? objName;
          },
        });
        cacheKey = key;
      }
      return cached;
    };

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) { rafId = requestAnimationFrame(render); return; }

      const ctx = canvas.getContext('2d');
      if (!ctx) { rafId = requestAnimationFrame(render); return; }

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = chartH;
      // 숨겨진 탭(App 의 Counter 탭)에서는 폭이 0 이다. 원본은 계속 쌓고 그리기만 쉰다.
      if (w === 0) { rafId = requestAnimationFrame(render); return; }

      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.scale(dpr, dpr);
      }

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = CANVAS.bgSurface;
      ctx.fillRect(0, 0, w, h);

      const lines = folded();
      if (lines.length === 0) {
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

      drawLines(ctx, lines, w, h);

      // 범례. 합계 선에는 이름 대신 접는 방식을 적는다 —
      // 여기서 "합계인가 평균인가"를 말해 주지 않으면 두 배로 읽거나 절반으로 읽는다.
      lines.forEach((s, i) => {
        ctx.fillStyle = s.color ?? PALETTE[0];
        ctx.fillRect(8 + i * 90, h - 16, 10, 2);
        ctx.fillStyle = CANVAS.textMuted;
        ctx.font = '9px monospace';
        const label = s.color === null ? (mode === 'avg' ? t('평균') : t('합계')) : s.label;
        ctx.fillText(legendLabel(label), 22 + i * 90, h - 8);
      });

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [height, agentMap, mode, themeEpoch]);

  // javaee / host 어느 Family 든 여기서 찾는다.
  const meta = counterMeta(counter);
  /**
   * 머리글에 적는 수.
   *
   * **고른 수를 적는다.** 받은 수를 적으면 «3개 에이전트» 라고 써 놓고 선은 하나만
   * 그려져 고장으로 읽힌다. 접은 선이어도 몇 대를 접었는지는 남긴다 —
   * "TPS 23" 만 있으면 한 대가 23인지 두 대가 각각 11.5인지 알 수 없다.
   */
  const shownCount = seenCount > 0 ? shownObjectCount(updatesRef.current, visible) : 0;
  const how = mode === 'avg' ? t('평균') : t('합계');

  return (
    <div className="overflow-hidden rounded border border-line bg-surface">
      {/* 한 텍스트 노드로 둔다 — jsdom 에 2d 컨텍스트가 없어 캔버스를 못 보므로
          이 라벨이 이벤트 필터링·중복 제거를 검증하는 유일한 통로다
          (CounterChart.test.tsx). */}
      <div className="truncate px-2 pt-1 text-micro text-fg-muted" title={meta.disp}>
        {meta.disp} ({meta.unit}){' '}
        {shownCount > 0
          ? drawn === 'total'
            ? `· ${how} · ${shownCount}${t('개 에이전트')}`
            : drawn === 'service'
              ? `· ${t('서비스별')} ${how} · ${shownCount}${t('개 에이전트')}`
              : // 구역이 접기인데 이 카운터만 개별이면 **말해 줘야 한다.**
                // 조용히 두면 옆 차트와 같은 자로 읽는다.
                `· ${shownCount}${t('개 에이전트')}${fold !== 'each' && !capable ? ` · ${t('합계 없음')}` : ''}`
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
  agents: DrawSeries[],
  w: number,
  h: number,
) {
  const usable = h - 20;
  const allValues = agents.flatMap(a => a.values);
  const maxUsed = Math.max(...allValues, 1);

  // 상한을 같은 축에 놓아도 사용량 추세가 살아 있을 때만 함께 그린다.
  // FdUsage 처럼 상한이 3만 배면 사용량 선이 바닥에 붙어 아무것도 안 보인다.
  const total = agents.find(a => a.total !== null)?.total ?? null;
  const withTotal = totalLineVisible(maxUsed, total);
  const maxVal = withTotal && total !== null ? total : maxUsed;

  // 눈금 — 최대와 0 만 있으면 선이 «어디쯤» 인지와 «언제» 인지를 못 읽는다.
  // 선보다 먼저 흐리게 깔아 선을 가리지 않는다.
  ctx.save();
  ctx.setLineDash([2, 4]);
  ctx.strokeStyle = CANVAS.textDim;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  const midY = usable / 2 + 4;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  // 분 경계 — 가장 긴 선의 시각을 쓴다 (선과 같은 자)
  const longest = agents.reduce((a, b) => (b.times.length > a.times.length ? b : a));
  const ticks = minuteTicks(longest.times, w, MAX_COUNTER_SAMPLES);
  for (const tk of ticks) {
    ctx.moveTo(tk.x, 4);
    ctx.lineTo(tk.x, usable + 4);
  }
  ctx.stroke();
  ctx.restore();

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

  agents.forEach(agent => {
    const data = agent.values;
    if (data.length < 2) return;

    const color = agent.color ?? PALETTE[0];
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
  ctx.fillText(axisLabel(maxVal / 2), 2, midY - 2);
  ctx.fillText('0', 2, usable + 4);

  // 분 눈금의 시각. 왼쪽 위 최댓값·오른쪽 위 상한 글자와 겹치는 자리는 건너뛴다
  for (const tk of ticks) {
    const label = formatTime(tk.at).slice(0, 5);
    const lw = ctx.measureText(label).width;
    const lx = tk.x - lw / 2;
    if (lx < 28 || lx + lw > w - (total !== null && !withTotal ? 90 : 2)) continue;
    // 위쪽에 붙은 선(Heap Total 처럼 상한 근처)과 겹치면 글자가 안 읽힌다 — 바탕을 깐다
    ctx.fillStyle = CANVAS.bgSurface;
    ctx.fillRect(lx - 2, 3, lw + 4, 11);
    ctx.fillStyle = CANVAS.textDim;
    ctx.fillText(label, lx, 12);
  }

  // 기준선을 못 그린 쌍 카운터는 상한을 숫자로라도 알려준다 —
  // "열린 것 36" 만으로는 여유가 있는지 없는지 알 수 없다.
  if (!withTotal && total !== null) {
    const label = `${t('상한')} ${Math.round(total).toLocaleString()}`;
    ctx.fillText(label, w - ctx.measureText(label).width - 4, 12);
  }
}

