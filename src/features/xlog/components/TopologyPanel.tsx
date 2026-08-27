// 토폴로지 (ASIS Interaction)
//
// 지금까지의 화면은 전부 "우리 앱 안에서 무엇이 느렸나"였다. 이건 **바깥과의 관계**다 —
// 누가 우리를 부르고, 우리가 무엇에 기대고 있는지.
//
// 캔버스로 그린다. 노드가 수십 개가 되면 DOM 으로는 매 폴링마다 재배치가 일어난다.
// 배치는 힘기반이 아니라 **층**이다 (topologyGraph.ts 참고).

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { getInteraction } from '../api/scouterApi';
import type { InteractionRow } from '../types/interaction';
import { useTextResolver } from '../hooks/useTextResolver';
import { buildGraph, edgeWidth, EXTERNAL_HASH, type Graph, type NodeLayer } from './topologyGraph';
import { CANVAS } from '../../../styles/tokens';
import { t } from '../../../i18n';

interface TopologyPanelProps {
  objType: string;
  /** 에이전트 objHash → 이름. 노드 이름과 층 판정에 쓴다 */
  agentMap: Map<number, string>;
  enabled: boolean;
}

/** 30초 구간으로 집계되므로 그보다 자주 물을 이유가 없다 */
const POLL_MS = 15_000;

const HEIGHT = 320;
const NODE_W = 190;
const NODE_H = 34;
const GAP_Y = 14;

const LAYER_LABEL: Record<NodeLayer, string> = {
  inbound: '외부 유입',
  agent: '애플리케이션',
  resource: '의존 자원',
};

export const TopologyPanel = memo(function TopologyPanel({
  objType,
  agentMap,
  enabled,
}: TopologyPanelProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<InteractionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 자원 이름은 `object` 사전으로 푼다 — `obj` 가 아니다 (F-40)
  const { getCached, resolve } = useTextResolver();
  const [textVersion, setTextVersion] = useState(0);

  const load = useCallback(() => {
    if (!objType) return;
    setLoading(true);
    getInteraction(objType)
      .then(list => {
        setRows(list);
        setError(null);
        setLoadedOnce(true);
        const unknown = [...new Set(list.flatMap(r => [r.from_hash, r.to_hash]))]
          .filter(h => h !== EXTERNAL_HASH && !agentMap.has(h));
        if (unknown.length > 0) {
          resolve('object', unknown)
            .then(() => setTextVersion(v => v + 1))
            .catch(() => {});
        }
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [objType, agentMap, resolve]);

  useEffect(() => {
    if (!open || !enabled) return;
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [open, enabled, load]);

  // 그리기 — 데이터나 사전이 바뀔 때만
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !open) return;

    const label = (hash: number): string => {
      if (hash === EXTERNAL_HASH) return t('외부');
      const agent = agentMap.get(hash);
      if (agent) return agent.split('/').pop() ?? agent;
      return getCached('object', hash) ?? `0x${(hash >>> 0).toString(16)}`;
    };

    const graph = buildGraph(rows, [...agentMap.keys()]);
    drawTopology(canvas, graph, label);
  }, [rows, agentMap, getCached, textVersion, open]);

  if (!enabled) return null;

  const total = rows.reduce((s, r) => s + r.count, 0);
  const errors = rows.reduce((s, r) => s + r.error_count, 0);

  return (
    <section className="mb-4">
      <header className="mb-2 flex items-baseline gap-2 border-b border-line pb-1">
        <h2 className="text-body font-medium text-fg">{t('토폴로지')}</h2>
        <span className="text-micro text-fg-faint">{objType} · {t('호출 관계')}</span>
        <div className="flex-1" />
        {open && rows.length > 0 && (
          <span className="text-micro text-fg-dim">
            {t('호출')} {total.toLocaleString()}
            {errors > 0 && <span className="text-danger"> · {t('에러')} {errors.toLocaleString()}</span>}
          </span>
        )}
        <button
          onClick={() => setOpen(o => !o)}
          className="rounded px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
        >
          {open ? t('닫기') : t('열기')}
        </button>
      </header>

      {open && (
        <div className="rounded border border-line bg-surface">
          {error && <p className="px-3 py-6 text-center text-small text-danger">{error}</p>}

          {/* **0건과 "수집이 꺼짐"은 다르다.** 에이전트 기본값이 꺼짐이라
              여기서 그 사실을 말해 주지 않으면 고장으로 읽힌다 (F-40). */}
          {!error && loadedOnce && rows.length === 0 && (
            <p className="px-3 py-6 text-center text-small text-fg-faint">
              {t('호출 관계가 수집되지 않았습니다.')}
              <br />
              <span className="text-micro">
                {t('에이전트 설정')} <code className="text-fg-dim">counter_interaction_enabled</code> {t('가')}
                {t('기본으로 꺼져 있습니다 — 켜면 30초 뒤부터 쌓입니다.')}
              </span>
            </p>
          )}

          {!error && !loadedOnce && loading && (
            <p className="px-3 py-6 text-center text-small text-fg-faint">{t('조회 중…')}</p>
          )}

          <canvas
            ref={canvasRef}
            style={{
              display: rows.length > 0 && !error ? 'block' : 'none',
              width: '100%',
              height: HEIGHT,
            }}
          />
        </div>
      )}
    </section>
  );
});

/**
 * 층으로 세워 그린다.
 *
 * 캔버스는 `var()` 를 못 읽으므로 실제 색 문자열을 쓴다.
 */
function drawTopology(
  canvas: HTMLCanvasElement,
  graph: Graph,
  label: (hash: number) => string,
): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth;
  const h = HEIGHT;
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

  const layers: NodeLayer[] = ['inbound', 'agent', 'resource'];
  const colX: Record<NodeLayer, number> = {
    inbound: 20,
    agent: (w - NODE_W) / 2,
    resource: w - NODE_W - 20,
  };

  // 노드 위치를 먼저 정해야 간선을 그릴 수 있다
  const pos = new Map<number, { x: number; y: number }>();
  for (const layer of layers) {
    const inLayer = graph.nodes.filter(n => n.layer === layer);
    const totalH = inLayer.length * NODE_H + Math.max(0, inLayer.length - 1) * GAP_Y;
    let y = Math.max(30, (h - totalH) / 2);
    for (const n of inLayer) {
      pos.set(n.hash, { x: colX[layer], y });
      y += NODE_H + GAP_Y;
    }
    // 층 이름
    ctx.fillStyle = CANVAS.textDim;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(t(LAYER_LABEL[layer]), colX[layer], 16);
  }

  // 간선 먼저 — 노드가 위에 와야 글씨가 안 가린다
  const maxCount = Math.max(...graph.edges.map(e => e.count), 1);
  for (const e of graph.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;

    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;

    ctx.strokeStyle = e.errors > 0 ? CANVAS.error : CANVAS.accent;
    ctx.globalAlpha = e.errors > 0 ? 0.9 : 0.45;
    ctx.lineWidth = edgeWidth(e.count, maxCount);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    // 곡선이라야 여러 간선이 겹쳐도 어느 노드로 가는지 따라갈 수 있다
    const mid = (x1 + x2) / 2;
    ctx.bezierCurveTo(mid, y1, mid, y2, x2, y2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 노드
  for (const n of graph.nodes) {
    const p = pos.get(n.hash);
    if (!p) continue;

    ctx.fillStyle = CANVAS.bgBase;
    ctx.strokeStyle = n.errors > 0 ? CANVAS.error : CANVAS.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(p.x, p.y, NODE_W, NODE_H, 4);
    ctx.fill();
    ctx.stroke();

    const name = label(n.hash);
    ctx.fillStyle = n.layer === 'agent' ? CANVAS.accent : CANVAS.textMuted;
    ctx.font = n.layer === 'agent' ? 'bold 11px sans-serif' : '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(fit(ctx, name, NODE_W - 14), p.x + 7, p.y + 15);

    ctx.fillStyle = CANVAS.textDim;
    ctx.font = '9px monospace';
    const stat = n.errors > 0
      ? `${n.calls.toLocaleString()} · err ${n.errors.toLocaleString()}`
      : n.calls.toLocaleString();
    ctx.fillText(stat, p.x + 7, p.y + 27);
  }
}

/** 넘치는 이름은 잘라 준다. 캔버스는 CSS 처럼 알아서 자르지 않는다 */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) {
    s = s.slice(0, -1);
  }
  return `${s}…`;
}
