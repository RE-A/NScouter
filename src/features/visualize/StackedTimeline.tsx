// 스택 타임라인 — **같은 순간에 무엇이 함께 움직였나.**
//
// Counter 탭의 차트 40장은 저마다 자기 x축을 쓴다. 그래서 «TPS 가 튄 그 순간 힙도
// 튀었나» 를 눈으로 맞출 수 없다 — 두 그림에서 같은 시각이 다른 자리에 있다.
// 여기서는 줄들이 x축 하나를 나눠 쓰고, 세로선 하나가 전부를 관통한다.
//
// **캔버스다.** 한 줄에 서버 수만큼 선이 겹치고 마우스를 따라 매 프레임 다시 그린다.
// 자는 `timelineScale.ts` 에 있다 — 화면을 띄우지 않고도 확인할 수 있어야 하는 부분이다.

import { memo, useEffect, useRef, useState } from 'react';
import { counterMeta } from '../xlog/types/counter';
import { CANVAS, SERIES } from '../../styles/tokens';
import { t } from '../../i18n';
import { formatKpi } from './kpi';
import {
  hhmm,
  maxOf,
  nearestIndex,
  niceMax,
  rowLayout,
  timeTicks,
  timeToX,
  valueToY,
  xToTime,
  type Range,
} from './timelineScale';
import type { CounterRow } from './usePastCounters';

/** 줄 안쪽 여백. 선이 줄 경계에 딱 붙으면 옆 줄과 이어져 보인다 */
const ROW_PAD = 6;
/** 왼쪽 이름·눈금 자리 */
const LABEL_W = 92;
/** 아래 시각 눈금 자리 */
const AXIS_H = 18;
/** 줄 하나의 높이 */
const ROW_H = 62;

interface StackedTimelineProps {
  rows: readonly CounterRow[];
  range: Range;
  /** objHash → 이름. 크로스헤어가 어느 서버 값인지 적는다 */
  agentMap: Map<number, string>;
}

export const StackedTimeline = memo(function StackedTimeline({
  rows,
  range,
  agentMap,
}: StackedTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 마우스 x (캔버스 좌표). 밖으로 나가면 null */
  const hoverRef = useRef<number | null>(null);
  const [height, setHeight] = useState(0);

  // rAF 클로저에서 읽는다 — deps 에 넣어 루프를 다시 세우면 프레임이 한 번 끊긴다.
  const dataRef = useRef({ rows, range, agentMap });
  dataRef.current = { rows, range, agentMap };

  useEffect(() => setHeight(rows.length * ROW_H + AXIS_H), [rows.length]);

  useEffect(() => {
    let rafId: number;

    const render = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) { rafId = requestAnimationFrame(render); return; }

      const { rows: data, range: r, agentMap: names } = dataRef.current;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = data.length * ROW_H + AXIS_H;

      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.scale(dpr, dpr);
      }

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = CANVAS.bgSurface;
      ctx.fillRect(0, 0, w, h);

      const plotX = LABEL_W;
      const plotW = Math.max(0, w - LABEL_W - 8);
      const layout = rowLayout(data.length, 0, data.length * ROW_H);
      const hover = hoverRef.current;
      const hoverT = hover !== null ? xToTime(hover, r, plotX, plotW) : null;

      // ── 시각 눈금. **줄보다 먼저 그린다** — 선 위에 격자가 얹히면 값이 흐려진다
      const ticks = timeTicks(r, plotW);
      ctx.strokeStyle = CANVAS.border;
      ctx.lineWidth = 1;
      ctx.font = '9px monospace';
      for (const tick of ticks) {
        const x = Math.round(timeToX(tick, r, plotX, plotW)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h - AXIS_H);
        ctx.stroke();
        ctx.fillStyle = CANVAS.textDim;
        ctx.textAlign = 'center';
        ctx.fillText(hhmm(tick), x, h - 5);
      }

      data.forEach((row, i) => {
        const box = layout[i];
        const meta = counterMeta(row.counter);
        const max = niceMax(maxOf(row.series));

        // 줄 경계
        if (i > 0) {
          ctx.strokeStyle = CANVAS.border;
          ctx.beginPath();
          ctx.moveTo(0, Math.round(box.y) + 0.5);
          ctx.lineTo(w, Math.round(box.y) + 0.5);
          ctx.stroke();
        }

        // 이름과 축 위쪽 값
        ctx.textAlign = 'left';
        ctx.fillStyle = CANVAS.textMuted;
        ctx.font = '10px sans-serif';
        ctx.fillText(meta.disp, 6, box.y + 13);
        ctx.fillStyle = CANVAS.textDim;
        ctx.font = '9px monospace';
        ctx.fillText(`${formatKpi(max, max < 10 ? 1 : 0)}${meta.unit}`, 6, box.y + 26);

        if (row.series.length === 0) {
          ctx.fillStyle = CANVAS.textDim;
          ctx.font = '10px sans-serif';
          ctx.fillText(t('이 구간에 값이 없습니다'), plotX + 6, box.y + box.height / 2);
          return;
        }

        row.series.forEach((s, si) => {
          if (s.times.length < 2) return;
          ctx.beginPath();
          ctx.strokeStyle = SERIES[si % SERIES.length];
          ctx.lineWidth = 1.3;
          for (let k = 0; k < s.times.length; k++) {
            const x = timeToX(s.times[k], r, plotX, plotW);
            const y = valueToY(s.values[k], max, box, ROW_PAD);
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        });

        // ── 크로스헤어가 가리키는 값.
        //
        // **세로선 옆에 붙인다.** 줄 오른쪽 끝에 고정하면 그 자리가 바로 최신 데이터가
        // 그려지는 곳이라, 지금 값을 읽으려는 순간 그 값을 가린다.
        if (hoverT !== null && hover !== null && hover >= plotX && hover <= plotX + plotW) {
          let text = '';
          for (const s of row.series) {
            const idx = nearestIndex(s.times, hoverT);
            if (idx < 0) continue;
            const name = (names.get(s.obj_hash) ?? String(s.obj_hash)).split('/').pop() ?? '';
            text += `${text ? '  ' : ''}${name} ${formatKpi(s.values[idx], max < 10 ? 2 : 0)}`;
          }
          if (text) {
            ctx.font = '9px monospace';
            ctx.textAlign = 'left';
            const tw = ctx.measureText(text).width;
            // 오른쪽 끝에서는 글자가 화면 밖으로 나간다. 그때만 왼쪽으로 뒤집는다.
            const flipped = hover + 8 + tw + 6 > w;
            const bx = flipped ? hover - 8 - tw - 6 : hover + 8;
            // 선 위에 글자를 얹으면 둘 다 안 읽힌다. 바탕을 깔아 준다.
            ctx.fillStyle = CANVAS.bgBase;
            ctx.fillRect(bx, box.y + 3, tw + 6, 13);
            ctx.fillStyle = CANVAS.textMuted;
            ctx.fillText(text, bx + 3, box.y + 13);
          }
        }
      });

      // ── 세로선. **맨 마지막에 그린다** — 선 아래 깔리면 관통하는 것으로 안 보인다
      if (hover !== null && hover >= plotX && hover <= plotX + plotW) {
        const x = Math.round(hover) + 0.5;
        ctx.strokeStyle = CANVAS.accent;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h - AXIS_H);
        ctx.stroke();

        if (hoverT !== null) {
          const label = hhmm(hoverT);
          ctx.font = '9px monospace';
          ctx.textAlign = 'center';
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = CANVAS.accent;
          ctx.fillRect(x - tw / 2 - 3, h - AXIS_H, tw + 6, AXIS_H - 2);
          ctx.fillStyle = CANVAS.bgSurface;
          ctx.fillText(label, x, h - 5);
        }
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={e => {
        const rect = e.currentTarget.getBoundingClientRect();
        hoverRef.current = e.clientX - rect.left;
      }}
      onMouseLeave={() => { hoverRef.current = null; }}
      style={{ display: 'block', width: '100%', height }}
    />
  );
});
