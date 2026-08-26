// 5분 집계 카운터 차트 (Canvas 2D)
//
// 실시간 스트림이 아니라 `COUNTER_TODAY_ALL` 로 **오늘 하루치**를 받아 그린다.
// 실시간 팩에 없는 카운터가 있기 때문이다 (F-42, HOST_FIVE_MIN_COUNTERS).
//
// 폴링은 5분에 한 번이면 충분하지만, 화면을 열자마자 최근 슬롯을 보고 싶으므로
// 60초로 둔다. 응답이 288포인트라 이보다 자주 물으면 낭비다.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { getTodayCounter, type CounterSeries } from '../api/scouterApi';
import { counterMeta, type CounterName } from '../types/counter';
import { hasAnyValue, seriesMax, trimAll, type TrimmedSeries } from './fiveMinSeries';
import { CANVAS, SERIES } from '../../../styles/tokens';
import { t } from '../../../i18n';

const POLL_MS = 60_000;

interface FiveMinCounterChartProps {
  counter: CounterName;
  /** 카운터는 objHash 가 아니라 objType 단위로 묻는다 */
  objType: string;
  enabled: boolean;
  /** objHash → objName. 범례에만 쓴다 */
  agentMap: Map<number, string>;
  height?: number;
}

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; rows: CounterSeries[] };

export const FiveMinCounterChart = memo(function FiveMinCounterChart({
  counter,
  objType,
  enabled,
  agentMap,
  height = 110,
}: FiveMinCounterChartProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!enabled || !objType) return;
    let alive = true;

    const poll = () => {
      getTodayCounter(counter, objType)
        .then(rows => { if (alive) setLoad({ kind: 'ok', rows }); })
        .catch(e => { if (alive) setLoad({ kind: 'error', message: String(e) }); });
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [counter, objType, enabled]);

  // 미래 슬롯을 자른다 — 안 자르면 지금 이후가 전부 0으로 그려져
  // "방금 0으로 떨어졌다"로 읽힌다. 응답이 받은 시점 기준으로 한 번만 계산한다.
  const trimmed = useMemo(
    () => (load.kind === 'ok' ? trimAll(load.rows, Date.now()) : []),
    [load],
  );
  const meta = counterMeta(counter);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || load.kind !== 'ok') return;
    const label = (hash: number) => {
      const name = agentMap.get(hash) ?? String(hash);
      return name.split('/').pop() ?? name;
    };
    draw(canvas, trimmed, height, label);
  }, [load.kind, trimmed, height, agentMap]);

  const collected = hasAnyValue(trimmed);
  const points = trimmed.reduce((s, t) => s + t.times.length, 0);

  return (
    <div className="overflow-hidden rounded border border-line bg-surface">
      <div className="truncate px-2 pt-1 text-micro text-fg-muted" title={meta.disp}>
        {meta.disp} ({meta.unit}){' '}
        {load.kind === 'ok' && points > 0 ? `· ${trimmed.length}${t('개 오브젝트')} · ${t('5분 집계')}` : ''}
      </div>

      {load.kind === 'error' && (
        <p className="px-2 py-4 text-small text-danger">{load.message}</p>
      )}
      {load.kind === 'loading' && (
        <p className="px-2 py-4 text-small text-fg-faint">{t('조회 중…')}</p>
      )}
      {load.kind === 'ok' && points === 0 && (
        <p className="px-2 py-4 text-small text-fg-faint">{t('오늘 집계가 없습니다.')}</p>
      )}

      <canvas
        ref={canvasRef}
        style={{ display: load.kind === 'ok' && points > 0 ? 'block' : 'none', width: '100%', height }}
      />

      {/* **직선이 곧 고장은 아니다.** SYN_SENT 는 순간 상태라 5분 표본에 거의 안 잡힌다.
          이 한 줄이 없으면 바닥에 붙은 선을 보고 수집이 죽은 줄 안다. */}
      {load.kind === 'ok' && points > 0 && !collected && (
        <p className="px-2 pb-1 text-micro text-fg-faint">
          집계는 오지만 구간 내 값이 모두 0입니다.
        </p>
      )}
    </div>
  );
});

function draw(
  canvas: HTMLCanvasElement,
  list: TrimmedSeries[],
  height: number,
  label: (objHash: number) => string,
): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth;
  const h = height;
  if (w <= 0) return;

  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = CANVAS.bgSurface;
  ctx.fillRect(0, 0, w, h);

  const usable = h - 20;
  const max = seriesMax(list);

  // x 는 인덱스가 아니라 **시각**으로 잡는다. 오브젝트마다 슬롯 수가 다를 수 있는데
  // 인덱스로 그리면 짧은 쪽이 가로로 늘어나 시간축이 어긋난다.
  let t0 = Number.POSITIVE_INFINITY;
  let t1 = Number.NEGATIVE_INFINITY;
  for (const s of list) {
    for (const t of s.times) {
      if (t < t0) t0 = t;
      if (t > t1) t1 = t;
    }
  }
  const span = t1 > t0 ? t1 - t0 : 1;

  list.forEach((s, i) => {
    if (s.times.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = SERIES[i % SERIES.length];
    ctx.lineWidth = 1.5;
    s.times.forEach((t, j) => {
      const x = ((t - t0) / span) * w;
      const y = usable - (s.values[j] / max) * usable + 4;
      if (j === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  ctx.fillStyle = CANVAS.textDim;
  ctx.font = '9px monospace';
  ctx.fillText(String(Math.round(max)), 2, 12);
  ctx.fillText('0', 2, usable + 4);

  // 시간축은 양 끝만 적는다. 하루치라 눈금을 촘촘히 넣으면 글씨가 겹친다.
  if (Number.isFinite(t0)) {
    const hm = (t: number) => new Date(t).toTimeString().slice(0, 5);
    ctx.fillText(hm(t0), 14, h - 4);
    const end = hm(t1);
    ctx.fillText(end, w - ctx.measureText(end).width - 4, h - 4);
  }

  // 범례는 오브젝트가 둘 이상일 때만. 하나뿐인데 이름을 적으면
  // 좁은 차트에서 시간축 글씨와 겹친다.
  if (list.length > 1) {
    list.forEach((s, i) => {
      ctx.fillStyle = SERIES[i % SERIES.length];
      ctx.fillRect(60 + i * 90, h - 8, 10, 2);
      ctx.fillStyle = CANVAS.textMuted;
      ctx.fillText(label(s.obj_hash).substring(0, 10), 74 + i * 90, h - 4);
    });
  }
}
