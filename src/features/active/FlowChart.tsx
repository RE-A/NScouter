// 흐르는 트래픽 — **들어와서 머물다가 빠져나간다.**
//
// 화면에 있는 점은 **지금 돌고 있는 트랜잭션뿐**이다 (`flowModel.ts` 머리말):
//
//   왼쪽에서 날아 들어온다 — 방금 들어온 요청
//   가운데에 머문다        — 처리 중. 오래 걸릴수록 위로 뜬다
//   오른쪽으로 사라진다    — 끝났다
//
// 들어오는 양과 빠지는 양이 눈으로 견줘진다. 가운데에 점이 쌓이고 위로 올라가면
// 그게 적체다.
//
// **매 프레임 다시 그린다.** 조회는 2초에 한 번이지만 점은 그 사이에도 움직인다 —
// 들어오고, 자라고, 나간다. 멈추면 폴링이 끊긴 것이고 그 자체가 신호다.

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { CANVAS } from '../../styles/tokens';
import type { ActiveService } from '../xlog/types/object';
import {
  advanceTracks,
  formatTick,
  holdingCount,
  neededYMax,
  nextYMax,
  pickNearest,
  settleTracks,
  toDot,
  yTicks,
  MIN_Y_MS,
  type FlowDot,
  type Track,
} from './flowModel';
import { t } from '../../i18n';

/** 단계별 점 색 — 게이지·목록과 같은 세 색이다 */
const STEP_COLOR: Record<1 | 2 | 3, string> = {
  1: CANVAS.accent,
  2: CANVAS.warn,
  3: CANVAS.error,
};

interface FlowChartProps {
  /** 지금 돌고 있는 것 — **못 받은 서버의 «지난 값» 은 빼고 넘긴다** */
  live: readonly ActiveService[];
  /** 그 조회가 언제 것인가. 아직 한 번도 못 받았으면 null */
  polledAt: number | null;
  /** 초당 처리 건수(콜렉터 카운터). 아직 모르면 null */
  tps: number | null;
  /** 머무는 점을 눌렀을 때 — 그 트랜잭션의 스택을 연다 */
  onPickLive: (row: ActiveService) => void;
  height?: number;
}

export const FlowChart = memo(function FlowChart({
  live,
  polledAt,
  tps,
  onPickLive,
  height = 150,
}: FlowChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 추적표. 렌더와 무관하게 이어져야 해서 ref 다 */
  const tracksRef = useRef<Map<string, Track>>(new Map());
  /** 지금 그려 둔 점들. 클릭은 **화면에 보이는 것**에 맞춰야 한다 */
  const shownRef = useRef<FlowDot[]>([]);
  const yMaxRef = useRef(MIN_Y_MS);
  const [yMaxLabel, setYMaxLabel] = useState(MIN_Y_MS);
  const [hover, setHover] = useState<FlowDot | null>(null);
  /** 화면에 적을 수. ref 로 세면 첫 렌더의 0 이 그대로 남는다 */
  const [running, setRunning] = useState(0);

  /**
   * 조회 결과를 추적표에 반영한다.
   *
   * **응답이 올 때만** 한다 — 매 프레임 하면 같은 조회로 들어오기·나가기를 되풀이한다.
   * 그리기는 아래 루프가 맡고, 여기서는 «무엇이 새로 왔고 무엇이 사라졌나» 만 본다.
   */
  useEffect(() => {
    if (polledAt === null) return;
    tracksRef.current = advanceTracks(tracksRef.current, live, polledAt, Date.now());
  }, [polledAt, live]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let last = 0;

    const draw = (ts: number) => {
      raf = requestAnimationFrame(draw);
      // 25fps. 들어오기가 650ms 라 이 정도면 움직임이 이어져 보인다.
      if (ts - last < 40) return;
      last = ts;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const now = Date.now();
      tracksRef.current = settleTracks(tracksRef.current, now);
      const tracks = tracksRef.current;

      const yMax = nextYMax(yMaxRef.current, neededYMax(tracks, now));
      if (yMax !== yMaxRef.current) {
        yMaxRef.current = yMax;
        setYMaxLabel(yMax);
      }

      const dots: FlowDot[] = [];
      for (const track of tracks.values()) dots.push(toDot(track, now, yMax));
      shownRef.current = dots;

      const held = holdingCount(tracks);
      setRunning(prev => (prev === held ? prev : held));

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = CANVAS.bgBase;
      ctx.fillRect(0, 0, w, h);

      // 가로 눈금 — 상한과 절반. 셋 넘게 그으면 작은 차트가 선으로 덮인다.
      ctx.strokeStyle = CANVAS.border;
      ctx.lineWidth = 1;
      for (const tick of yTicks(yMax)) {
        const y = Math.round(h - (tick / yMax) * h) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // **나가는 것을 먼저 그린다.** 끝난 것이 지금 돌고 있는 것을 가리면 안 된다.
      for (const d of dots) {
        if (d.phase !== 'leaving') continue;
        paint(ctx, d, w, h);
      }
      for (const d of dots) {
        if (d.phase === 'leaving') continue;
        paint(ctx, d, w, h);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const hit = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return pickNearest(shownRef.current, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  }, []);

  return (
    <section
      aria-label={t('실시간 트래픽')}
      className="relative rounded border border-line bg-raised px-3 py-2"
    >
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <span className="text-micro tracking-wide text-fg-dim uppercase">{t('실시간 트래픽')}</span>
        <span className="text-micro text-fg-faint">
          {t('세로축')} {formatTick(yMaxLabel)}
        </span>

        <div className="flex-1" />

        {/* 그림만으로는 «몇 건인지» 를 못 읽는다. 지금 값을 숫자로도 적는다. */}
        <span className="text-micro text-fg-muted">
          {t('돌고 있음')} <span className="font-mono tabular-nums text-fg">{running}</span>
          {' · '}
          {t('초당 처리')}{' '}
          <span className="font-mono tabular-nums text-fg">
            {tps === null ? '—' : tps.toFixed(1)}
          </span>
        </span>
      </div>

      <canvas
        ref={canvasRef}
        style={{ height, width: '100%', display: 'block', cursor: hover ? 'pointer' : 'default' }}
        onMouseMove={e => setHover(hit(e))}
        onMouseLeave={() => setHover(null)}
        onClick={e => {
          const d = hit(e);
          if (d) onPickLive(d.row);
        }}
      />

      {/* 무엇을 누르게 되는지 미리 말한다 — 점 하나는 몇 px 이라 누르기 전에는 알 수 없다 */}
      <p className="mt-1 h-4 truncate text-micro text-fg-muted">
        {hover ? (
          <>
            <span className="text-accent-bright">{formatTick(hover.ty * yMaxLabel)}</span>{' '}
            {hover.row.service} · {t('눌러서 상세 보기')}
          </>
        ) : (
          <span className="text-fg-faint">
            {t('왼쪽에서 들어와 가운데서 처리되고 오른쪽으로 빠집니다 · 오래 걸릴수록 위로 뜹니다')}
          </span>
        )}
      </p>
    </section>
  );
});

/** 점 하나. 머무는 것은 채우고, 들어오거나 나가는 것은 옅게 */
function paint(ctx: CanvasRenderingContext2D, d: FlowDot, w: number, h: number): void {
  const x = d.tx * w;
  const y = (1 - d.ty) * h;
  ctx.globalAlpha = d.alpha;
  ctx.fillStyle = STEP_COLOR[d.step];
  ctx.beginPath();
  ctx.arc(x, y, d.phase === 'holding' ? 4 : 3.2, 0, Math.PI * 2);
  ctx.fill();

  // 머무는 점에는 테두리를 둘러 «지금 여기 있다» 를 또렷하게 한다.
  if (d.phase === 'holding') {
    ctx.strokeStyle = CANVAS.bgBase;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
