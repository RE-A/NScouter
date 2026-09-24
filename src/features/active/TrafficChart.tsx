// 실시간 트래픽 — **점이 흐르는 창.**
//
// 아래 목록은 «지금 안 끝나고 있는 것» 이고, 여기는 그 옆에 **방금 끝난 것**을 같이
// 놓는다. 2초 주기의 스냅샷만으로는 «빠르게 잘 돌고 있다» 와 «아무 일도 없다» 가
// 구별되지 않는다 (`trafficModel.ts` 머리말).
//
// **DOM 으로 그리지 않는다.** 1분 창에 초당 수백 건이 들어오면 점이 수만 개다 —
// div/svg 로는 그 수를 못 버틴다. Canvas 에 직접 찍는다.

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { CANVAS } from '../../styles/tokens';
import type { SXLog } from '../xlog/types/xlog';
import type { ActiveService } from '../xlog/types/object';
import {
  formatTick,
  layoutTraffic,
  neededYMax,
  nextYMax,
  pickNearest,
  yTicks,
  MIN_Y_MS,
  type TrafficPoint,
} from './trafficModel';
import { t } from '../../i18n';

/** 단계별 점 색 — 게이지·목록과 같은 세 색이다 */
const STEP_COLOR: Record<1 | 2 | 3, string> = {
  1: CANVAS.accent,
  2: CANVAS.warn,
  3: CANVAS.error,
};

interface TrafficChartProps {
  done: readonly SXLog[];
  live: readonly ActiveService[];
  picked: ReadonlySet<number>;
  windowMs: number;
  /** 끝난 점을 눌렀을 때 — 그 트랜잭션의 상세를 연다 */
  onPickDone: (xlog: SXLog) => void;
  /** 실행 중인 점을 눌렀을 때 — 목록의 그 줄을 연다 */
  onPickLive: (row: ActiveService) => void;
  height?: number;
}

export const TrafficChart = memo(function TrafficChart({
  done,
  live,
  picked,
  windowMs,
  onPickDone,
  onPickLive,
  height = 132,
}: TrafficChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /**
   * 지금 그려 둔 점들. **클릭은 화면에 보이는 것에 맞춰야 한다** — 그리기와 따로
   * 계산하면 한 프레임 어긋난 점을 열게 된다.
   */
  const shownRef = useRef<TrafficPoint[]>([]);
  const yMaxRef = useRef(MIN_Y_MS);
  const [hover, setHover] = useState<TrafficPoint | null>(null);
  /** 화면에 적을 상한. 그리기는 ref 로 하고, 글자만 state 로 따라온다 */
  const [yMaxLabel, setYMaxLabel] = useState(MIN_Y_MS);
  /**
   * 화면에 적을 건수.
   *
   * **ref 로 세면 안 된다** — 그리기는 rAF 안에서 도는데 ref 를 읽는 것은 렌더다.
   * 그러면 첫 렌더의 0 이 그대로 남아 «끝난 것 0» 이 계속 적힌다.
   */
  const [shownCount, setShownCount] = useState({ done: 0, live: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let last = 0;

    const draw = (ts: number) => {
      raf = requestAnimationFrame(draw);
      // **매 프레임 다시 그리지 않는다.** 점 수만 개를 60fps 로 찍을 이유가 없다 —
      // 1분 창에서 100ms 는 폭의 0.16% 라 눈으로는 이어져 보인다.
      if (ts - last < 100) return;
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
      const need = neededYMax({ done, live, now, windowMs, picked });
      const yMax = nextYMax(yMaxRef.current, need);
      if (yMax !== yMaxRef.current) {
        yMaxRef.current = yMax;
        setYMaxLabel(yMax);
      }

      const points = layoutTraffic({ done, live, now, windowMs, yMax, picked });
      shownRef.current = points;
      const liveShown = points.reduce((n, p) => n + (p.running ? 1 : 0), 0);
      setShownCount(prev =>
        prev.live === liveShown && prev.done === points.length - liveShown
          ? prev // 같은 수면 그대로 둔다 — 100ms 마다 렌더를 새로 돌릴 이유가 없다
          : { live: liveShown, done: points.length - liveShown },
      );

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

      for (const p of points) {
        const x = p.tx * w;
        const y = (1 - p.ty) * h;
        if (p.running) {
          // **실행 중인 것은 속을 비운다.** 끝난 점과 같은 모양이면 «벌써 끝났다» 로
          // 읽힌다 — 이 둘을 가르는 것이 이 차트의 핵심이다.
          ctx.strokeStyle = STEP_COLOR[p.step];
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x - 3, y, 4, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = p.failed ? CANVAS.error : STEP_COLOR[p.step];
          ctx.beginPath();
          ctx.arc(x, y, p.failed ? 2.6 : 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [done, live, picked, windowMs]);

  const onMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const r = canvas.getBoundingClientRect();
    setHover(
      pickNearest(shownRef.current, e.clientX - r.left, e.clientY - r.top, r.width, r.height),
    );
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      const hit = pickNearest(
        shownRef.current,
        e.clientX - r.left,
        e.clientY - r.top,
        r.width,
        r.height,
      );
      if (!hit) return;
      if (hit.live) onPickLive(hit.live);
      else if (hit.done) onPickDone(hit.done);
    },
    [onPickDone, onPickLive],
  );

  return (
    <section
      aria-label={t('실시간 트래픽')}
      className="relative rounded border border-line bg-raised px-3 py-2"
    >
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-micro tracking-wide text-fg-dim uppercase">{t('실시간 트래픽')}</span>
        <span className="text-micro text-fg-faint">
          {t('최근')} {Math.round(windowMs / 1000)}
          {t('초')} · {t('세로축')} {formatTick(yMaxLabel)}
        </span>
        <div className="flex-1" />
        {/* 속 빈 동그라미가 무엇인지 적어 둔다 — 안 적으면 «점이 두 종류인데 왜 다른가» 가 된다 */}
        <span className="text-micro text-fg-faint">
          {t('○ 실행 중')} {shownCount.live} · {t('● 끝난 것')} {shownCount.done}
        </span>
      </div>

      <canvas
        ref={canvasRef}
        style={{ height, width: '100%', display: 'block', cursor: hover ? 'pointer' : 'default' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={onClick}
      />

      {/* 무엇을 누르게 되는지 미리 말한다. 점 하나는 1.8px 이라 누르기 전에는 알 수 없다 */}
      {hover && (
        <p className="mt-1 truncate text-micro text-fg-muted">
          {hover.live ? (
            <>
              <span className="text-accent">{t('실행 중')}</span> {hover.live.service} ·{' '}
              {formatTick(hover.live.elapsed)}
            </>
          ) : (
            <>
              <span className={hover.failed ? 'text-danger' : 'text-fg-dim'}>
                {hover.failed ? t('에러') : t('끝남')}
              </span>{' '}
              {formatTick(hover.done?.elapsed ?? 0)} · {t('눌러서 상세 보기')}
            </>
          )}
        </p>
      )}
    </section>
  );
});
