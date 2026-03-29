// src/features/xlog/components/CounterChart.tsx
// 실시간 성능 카운터 라인 차트 (Canvas 2D)

import React, { memo, useEffect, useRef, useState } from 'react';
import type { PerfCounterPack } from '../types/counter';
import { MAX_COUNTER_SAMPLES } from '../types/counter';
import { onCounterData } from '../api/scouterApi';

interface CounterChartProps {
  isStreaming: boolean;
  /** 표시할 지표 키 */
  metric: 'tps' | 'elapsed';
  /** 차트 상단 레이블 */
  label: string;
  /** 차트 높이 (px, 기본 80) */
  height?: number;
}

interface AgentSamples {
  objName: string;
  tps: number[];
  elapsed: number[];
  times: number[];
}

const PALETTE = ['#4169E1', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c'];

export const CounterChart = memo(function CounterChart({
  isStreaming,
  metric,
  label,
  height = 80,
}: CounterChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seriesRef = useRef<Map<string, AgentSamples>>(new Map());
  const [agentCount, setAgentCount] = useState(0);

  // 카운터 데이터 수신
  useEffect(() => {
    if (!isStreaming) return;

    let unlisten: (() => void) | null = null;
    onCounterData((pack: PerfCounterPack) => {
      let series = seriesRef.current.get(pack.obj_name);
      if (!series) {
        series = { objName: pack.obj_name, tps: [], elapsed: [], times: [] };
        seriesRef.current.set(pack.obj_name, series);
        setAgentCount(seriesRef.current.size);
      }
      series.times.push(pack.time);
      series.tps.push(pack.data['tps'] ?? 0);
      series.elapsed.push(pack.data['elapsed_avg'] ?? 0);

      if (series.tps.length > MAX_COUNTER_SAMPLES) {
        series.tps.shift();
        series.elapsed.shift();
        series.times.shift();
      }
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [isStreaming]);

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
      ctx.fillStyle = '#0d0d1a';
      ctx.fillRect(0, 0, w, h);

      const agents = Array.from(seriesRef.current.values());
      if (agents.length === 0) {
        ctx.fillStyle = '#333';
        ctx.font = '11px monospace';
        ctx.fillText('데이터 없음', 8, 20);
        rafId = requestAnimationFrame(render);
        return;
      }

      drawLines(ctx, agents, metric, w, h, PALETTE);

      // 범례
      agents.forEach((a, i) => {
        const color = PALETTE[i % PALETTE.length];
        ctx.fillStyle = color;
        ctx.fillRect(8 + i * 90, h - 16, 10, 2);
        ctx.fillStyle = '#888';
        ctx.font = '9px monospace';
        const agentLabel = a.objName.split('/').pop() ?? a.objName;
        ctx.fillText(agentLabel.substring(0, 10), 22 + i * 90, h - 8);
      });

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [metric, height]);

  return (
    <div style={containerStyle}>
      <div style={labelStyle}>
        {label} {agentCount > 0 ? `(${agentCount}개 에이전트)` : ''}
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
  key: 'tps' | 'elapsed',
  w: number,
  h: number,
  palette: string[],
) {
  const usable = h - 20;
  const allValues = agents.flatMap(a => a[key]);
  const maxVal = Math.max(...allValues, 1);

  agents.forEach((agent, i) => {
    const data = agent[key];
    if (data.length < 2) return;

    const color = palette[i % palette.length];
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;

    data.forEach((v, j) => {
      const x = (j / (MAX_COUNTER_SAMPLES - 1)) * w;
      const y = usable - (v / maxVal) * usable + 4;
      if (j === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();
  });

  ctx.fillStyle = '#444';
  ctx.font = '9px monospace';
  ctx.fillText(String(Math.round(maxVal)), 2, 12);
  ctx.fillText('0', 2, usable + 4);
}

// ─── 스타일 ────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  background: '#0d0d1a',
  borderBottom: '1px solid #222',
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#555',
  padding: '2px 8px 0',
};
