// 서비스 하나의 차트 — 5분 추이(현재 vs 과거)와 응답시간 누적 분포
//
// Canvas 2D 로 직접 그린다(다른 카운터 차트와 같은 방식 — 라이브러리 없이 독립망에서도 그대로 돈다).
// 색은 테마 토큰(`CANVAS`)을 쓴다: 현재 = accent, 과거 = 흐린 글자색(점선)과 그 최소~최대 띠.

import { memo, useEffect, useMemo, useRef } from 'react';
import { t } from '../../i18n';
import { CANVAS } from '../../styles/tokens';
import { useThemeEpoch } from '../../styles/useThemeEpoch';
import type { StatsRange, StatsSummary } from './statsApi';
import { cdf, overlay } from './statsSeries';

/** 선 하나 — x 는 0~1, y 는 값(null 이면 끊는다) */
interface Line {
  pts: [number, number | null][];
  color: string;
  dash?: boolean;
}

interface Plot {
  lines: Line[];
  /** 띠 — (x, 아래, 위) */
  band?: [number, number, number][];
  yMax: number;
  yFmt: (v: number) => string;
  xLeft: string;
  xRight: string;
}

const H = 130;
const PAD = { l: 44, r: 8, t: 8, b: 18 };

function draw(canvas: HTMLCanvasElement, p: Plot): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth;
  if (w <= 0) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = CANVAS.bgSurface;
  ctx.fillRect(0, 0, w, H);

  const pw = w - PAD.l - PAD.r;
  const ph = H - PAD.t - PAD.b;
  const max = p.yMax > 0 ? p.yMax : 1;
  const X = (x: number) => PAD.l + x * pw;
  const Y = (v: number) => PAD.t + ph - (Math.min(v, max) / max) * ph;

  // 눈금 — 0 · 절반 · 꼭대기
  ctx.strokeStyle = CANVAS.border;
  ctx.lineWidth = 1;
  ctx.fillStyle = CANVAS.textDim;
  ctx.font = '10px sans-serif';
  for (const f of [0, 0.5, 1]) {
    const y = Math.round(Y(max * f)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(w - PAD.r, y);
    ctx.stroke();
    const label = p.yFmt(max * f);
    ctx.fillText(label, PAD.l - 4 - ctx.measureText(label).width, y + 3);
  }
  ctx.fillText(p.xLeft, PAD.l, H - 4);
  ctx.fillText(p.xRight, w - PAD.r - ctx.measureText(p.xRight).width, H - 4);

  if (p.band && p.band.length > 0) {
    ctx.fillStyle = CANVAS.textDim;
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    p.band.forEach(([x, lo], i) => (i === 0 ? ctx.moveTo(X(x), Y(lo)) : ctx.lineTo(X(x), Y(lo))));
    [...p.band].reverse().forEach(([x, , hi]) => ctx.lineTo(X(x), Y(hi)));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  for (const l of p.lines) {
    ctx.strokeStyle = l.color;
    ctx.lineWidth = l.dash ? 1.25 : 1.75;
    ctx.setLineDash(l.dash ? [4, 3] : []);
    ctx.beginPath();
    let pen = false;
    // 값이 없는 칸에서는 끊는다 — 이어 그리면 비어 있던 시간이 «서서히 변했다» 로 보인다
    for (const [x, v] of l.pts) {
      if (v === null) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(X(x), Y(v));
      else {
        ctx.moveTo(X(x), Y(v));
        pen = true;
      }
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function Chart({ title, plot }: { title: string; plot: Plot }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const epoch = useThemeEpoch();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    draw(c, plot);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => draw(c, plot));
    ro.observe(c);
    return () => ro.disconnect();
  }, [plot, epoch]);
  return (
    <figure className="min-w-[18rem] flex-1">
      <figcaption className="mb-1 text-small text-fg-dim">{title}</figcaption>
      <canvas ref={ref} className="block w-full rounded border border-line" style={{ height: H }} />
    </figure>
  );
}

const hm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
const int = (v: number) => Math.round(v).toLocaleString();

interface StatsChartsProps {
  current: StatsSummary | null;
  baseline: StatsSummary | null;
  range: StatsRange;
  baselines: StatsRange[];
}

export const StatsCharts = memo(function StatsCharts({ current, baseline, range, baselines }: StatsChartsProps) {
  const plots = useMemo(() => {
    const slots = overlay(current?.series ?? [], baseline?.series ?? [], range, baselines);
    const n = slots.length;
    const x = (i: number) => (n <= 1 ? 0.5 : i / (n - 1));
    const xLeft = hm(range.stime);
    const xRight = hm(range.etime);
    const avgMax = Math.max(1, ...slots.flatMap(s => [s.cur.avg ?? 0, s.base.hi ?? 0, s.base.avg ?? 0])) * 1.1;
    const cntMax = Math.max(1, ...slots.flatMap(s => [s.cur.count, s.base.count ?? 0])) * 1.1;
    const avg: Plot = {
      lines: [
        { pts: slots.map((s, i) => [x(i), s.base.avg]), color: CANVAS.textMuted, dash: true },
        { pts: slots.map((s, i) => [x(i), s.cur.avg]), color: CANVAS.accent },
      ],
      band: slots.flatMap((s, i): [number, number, number][] => (s.base.lo !== null && s.base.hi !== null ? [[x(i), s.base.lo, s.base.hi]] : [])),
      yMax: avgMax,
      yFmt: int,
      xLeft,
      xRight,
    };
    const count: Plot = {
      lines: [
        { pts: slots.map((s, i) => [x(i), s.base.count]), color: CANVAS.textMuted, dash: true },
        { pts: slots.map((s, i) => [x(i), current ? s.cur.count : null]), color: CANVAS.accent },
      ],
      yMax: cntMax,
      yFmt: int,
      xLeft,
      xRight,
    };
    // 누적 분포 — x 는 로그(1ms~최대). 오른쪽으로 밀린 선이 느려진 쪽이다
    const cc = cdf(current?.dist ?? []);
    const bc = cdf(baseline?.dist ?? []);
    const top = Math.max(2, ...cc.map(p => p[0]), ...bc.map(p => p[0]));
    const lx = (ms: number) => Math.log(Math.max(1, ms)) / Math.log(top);
    const dist: Plot = {
      lines: [
        { pts: bc.map(([ms, f]) => [lx(ms), f * 100]), color: CANVAS.textMuted, dash: true },
        { pts: cc.map(([ms, f]) => [lx(ms), f * 100]), color: CANVAS.accent },
      ],
      yMax: 100,
      yFmt: v => `${Math.round(v)}%`,
      xLeft: '1ms',
      xRight: `${int(top)}ms`,
    };
    return { avg, count, dist };
  }, [current, baseline, range, baselines]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-3">
        <Chart title={t('평균 응답시간(ms) — 5분')} plot={plots.avg} />
        <Chart title={t('건수 — 5분')} plot={plots.count} />
        <Chart title={t('응답시간 누적 분포 — 오른쪽일수록 느림')} plot={plots.dist} />
      </div>
      <p className="text-micro text-fg-faint">
        <span className="text-accent-bright">━</span> {t('기준')} · <span>┅</span> {t('과거 (띠: 과거 구간들의 최소~최대)')}
      </p>
    </div>
  );
});
