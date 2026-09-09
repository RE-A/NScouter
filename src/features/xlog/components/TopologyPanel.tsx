// 토폴로지 (ASIS Interaction)
//
// 지금까지의 화면은 전부 "우리 앱 안에서 무엇이 느렸나"였다. 이건 **바깥과의 관계**다 —
// 누가 우리를 부르고, 우리가 무엇에 기대고 있는지.
//
// 캔버스로 그린다. 노드가 수십 개가 되면 DOM 으로는 매 폴링마다 재배치가 일어난다.
// 배치는 힘기반이 아니라 **층**이다 (topologyGraph.ts 참고).

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { getInteraction } from '../api/scouterApi';
import type { InteractionRow } from '../types/interaction';
import { useTextResolver } from '../hooks/useTextResolver';
import {
  avgElapsed,
  buildGraph,
  edgeGrade,
  edgeWidth,
  errorRate,
  EXTERNAL_HASH,
  type Graph,
  type GraphNode,
  type NodeLayer,
} from './topologyGraph';
import { CANVAS } from '../../../styles/tokens';
import { SectionHeader } from '../../../components/SectionHeader';
import { t } from '../../../i18n';

interface TopologyPanelProps {
  objType: string;
  /** 에이전트 objHash → 이름. 노드 이름과 층 판정에 쓴다 */
  agentMap: Map<number, string>;
  enabled: boolean;
  /**
   * 이 앱의 트랜잭션을 보러 간다.
   *
   * **지도의 값어치는 «여기가 이상하다» 다음에 있다.** 이상한 칸을 찾아 놓고
   * 서버 목록으로 돌아가 같은 이름을 다시 골라야 하면 지도를 본 보람이 없다.
   * 없으면 노드를 눌러도 아무 일도 없다 — 그때는 커서도 바뀌지 않는다.
   */
  onDrill?: (objHash: number) => void;
}

/** 30초 구간으로 집계되므로 그보다 자주 물을 이유가 없다 */
const POLL_MS = 15_000;

const HEIGHT = 320;
const NODE_W = 200;
/** 이름 · 횟수/평균 · 에러율 세 줄이 들어간다 */
const NODE_H = 42;
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
  onDrill,
}: TopologyPanelProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<InteractionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /**
   * 마지막으로 그린 노드 상자들.
   *
   * **캔버스는 클릭 판정을 대신 해 주지 않는다.** 그릴 때 정한 자리를 들고 있어야
   * 마우스가 어느 노드 위인지 알 수 있다. 다시 그릴 때마다 갈아 끼운다.
   */
  const layoutRef = useRef<NodeBox[]>([]);
  /** 마우스가 올라간 노드. 그 노드에 닿지 않는 간선을 흐리게 만든다 */
  const [hover, setHover] = useState<HoverState | null>(null);

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
    layoutRef.current = drawTopology(canvas, graph, label, hover?.node.hash ?? null);
  }, [rows, agentMap, getCached, textVersion, open, hover]);

  /** 커서 아래의 노드. 없으면 null */
  const hit = useCallback((e: React.MouseEvent<HTMLCanvasElement>): NodeBox | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return (
      layoutRef.current.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) ?? null
    );
  }, []);

  const handleMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const box = hit(e);
      // **같은 노드 위에서 매번 상태를 갈면 안 된다.** 마우스가 조금만 움직여도
      // 리렌더 → 캔버스 전체 다시 그리기가 된다.
      setHover(prev => {
        if (box === null) return prev === null ? prev : null;
        if (prev?.node.hash === box.node.hash) {
          return { ...prev, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
        }
        return {
          node: box.node,
          label: box.label,
          x: e.nativeEvent.offsetX,
          y: e.nativeEvent.offsetY,
        };
      });
    },
    [hit],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const box = hit(e);
      // 자원·외부는 우리 에이전트가 아니라 objHash 로 XLog 를 걸 수 없다.
      if (box && box.node.layer === 'agent') onDrill?.(box.node.hash);
    },
    [hit, onDrill],
  );

  if (!enabled) return null;

  const total = rows.reduce((s, r) => s + r.count, 0);
  const errors = rows.reduce((s, r) => s + r.error_count, 0);

  return (
    <section className="mb-4">
      <SectionHeader
        title={t('토폴로지')}
        subtitle={`${objType} · ${t('호출 관계')}`}
        open={open}
        onToggle={() => setOpen(o => !o)}
        action={
          open && rows.length > 0 ? (
            <span className="text-micro text-fg-dim">
              {t('호출')} {total.toLocaleString()}
              {errors > 0 && (
                <span className="text-danger"> · {t('에러')} {errors.toLocaleString()}</span>
              )}
            </span>
          ) : undefined
        }
      />

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

          {/* 지도를 읽는 일은 «어디가 이상한가» 를 찾는 것이고, 찾고 나면 바로
              그 앱의 트랜잭션으로 가야 한다. 그래서 캔버스가 마우스를 받는다. */}
          <div className="relative">
            <canvas
              ref={canvasRef}
              onMouseMove={handleMove}
              onMouseLeave={() => setHover(null)}
              onClick={handleClick}
              style={{
                display: rows.length > 0 && !error ? 'block' : 'none',
                width: '100%',
                height: HEIGHT,
                cursor: hover?.node.layer === 'agent' && onDrill ? 'pointer' : 'default',
              }}
            />
            {hover && rows.length > 0 && !error && (
              <NodeTip hover={hover} drillable={hover.node.layer === 'agent' && !!onDrill} />
            )}
          </div>
        </div>
      )}
    </section>
  );
});

/** 그려 둔 노드 상자 하나. 클릭·호버 판정에 쓴다 */
interface NodeBox {
  node: GraphNode;
  /**
   * 화면에 적힌 이름.
   *
   * **`GraphNode.label` 은 비어 있다.** 해시를 이름으로 푸는 것은 사전을 쥔
   * 컴포넌트 쪽 일이라(`buildGraph` 는 순수 함수다), 푼 결과를 여기 같이 담아 둔다 —
   * 툴팁이 다시 풀면 같은 규칙이 두 곳에 생긴다.
   */
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 마우스가 올라간 노드와 그 자리 */
interface HoverState {
  node: GraphNode;
  label: string;
  x: number;
  y: number;
}

/** 간선 등급별 색. `durationTone` 과 같은 자를 쓴다 (`edgeGrade`) */
const EDGE_COLOR: Record<'ok' | 'warn' | 'danger', string> = {
  ok: CANVAS.accent,
  warn: CANVAS.warn,
  danger: CANVAS.error,
};

/**
 * 층으로 세워 그린다.
 *
 * 캔버스는 `var()` 를 못 읽으므로 실제 색 문자열을 쓴다.
 *
 * @param hovered 마우스가 올라간 노드. 그 노드에 **닿지 않는 간선을 흐리게** 한다 —
 *   자원이 열 개쯤 되면 선이 엉켜 «이 DB 를 누가 부르나» 를 눈으로 못 따라간다.
 * @returns 그린 노드 상자들. 호출부가 클릭 판정에 쓴다
 */
function drawTopology(
  canvas: HTMLCanvasElement,
  graph: Graph,
  label: (hash: number) => string,
  hovered: number | null,
): NodeBox[] {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth;
  const h = HEIGHT;
  if (w <= 0) return [];

  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
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

    // **색이 «실패» 만 말하던 것을 «실패 · 느림» 까지 말하게 한다.**
    // 에러가 없어도 평균 300ms 를 넘는 의존은 그 자체로 볼거리다.
    const grade = edgeGrade(e);
    const related = hovered === null || e.from === hovered || e.to === hovered;

    ctx.strokeStyle = EDGE_COLOR[grade];
    // 흐리게 하는 것이지 지우는 것이 아니다 — 지우면 «연결이 없다» 로 읽힌다.
    ctx.globalAlpha = related ? (grade === 'ok' ? 0.45 : 0.9) : 0.08;
    ctx.lineWidth = edgeWidth(e.count, maxCount);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    // 곡선이라야 여러 간선이 겹쳐도 어느 노드로 가는지 따라갈 수 있다
    const mid = (x1 + x2) / 2;
    ctx.bezierCurveTo(mid, y1, mid, y2, x2, y2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 짚은 노드에 걸린 간선에만 숫자를 적는다. 늘 적으면 선이 열 개만 넘어도
    // 숫자가 서로 겹쳐 아무것도 안 읽힌다.
    if (hovered !== null && related) {
      const avg = avgElapsed(e);
      const text = avg === null ? `${e.count.toLocaleString()}` : `${e.count.toLocaleString()} · ${avg}ms`;
      ctx.fillStyle = CANVAS.textMuted;
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(text, mid, (y1 + y2) / 2 - 4);
      ctx.textAlign = 'left';
    }
  }

  // 노드
  const boxes: NodeBox[] = [];
  for (const n of graph.nodes) {
    const p = pos.get(n.hash);
    if (!p) continue;
    const name = label(n.hash);
    boxes.push({ node: n, label: name, x: p.x, y: p.y, w: NODE_W, h: NODE_H });

    ctx.fillStyle = CANVAS.bgBase;
    ctx.strokeStyle =
      n.hash === hovered ? CANVAS.accent : n.errors > 0 ? CANVAS.error : CANVAS.border;
    ctx.lineWidth = n.hash === hovered ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(p.x, p.y, NODE_W, NODE_H, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = n.layer === 'agent' ? CANVAS.accent : CANVAS.textMuted;
    ctx.font = n.layer === 'agent' ? 'bold 11px sans-serif' : '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(fit(ctx, name, NODE_W - 14), p.x + 7, p.y + 15);

    // **횟수만으로는 «많이 불리는 곳» 밖에 못 찾는다.** 지도에서 찾고 싶은 것은
    // «적게 불리는데 한 번이 비싼 곳» 이고, 그건 평균이 있어야 보인다.
    const avg = avgElapsed(n);
    ctx.fillStyle = CANVAS.textDim;
    ctx.font = '9px monospace';
    ctx.fillText(
      avg === null ? n.calls.toLocaleString() : `${n.calls.toLocaleString()} · ${avg}ms`,
      p.x + 7,
      p.y + 27,
    );

    // 에러는 **비율까지** 적는다. 7건이 많은지는 100번 중 7번일 때만 답할 수 있다.
    const rate = errorRate(n);
    if (n.errors > 0 && rate !== null) {
      ctx.fillStyle = CANVAS.error;
      ctx.fillText(
        `err ${n.errors.toLocaleString()} (${(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}%)`,
        p.x + 7,
        p.y + 37,
      );
    }
  }

  return boxes;
}

/**
 * 짚은 노드의 값.
 *
 * 캔버스 위에 **DOM 으로** 띄운다. 캔버스에 그리면 상자 밖으로 나갈 때 잘리고,
 * 글자 폭을 손으로 재서 배경을 깔아야 한다 — 얻는 것이 없다.
 */
function NodeTip({ hover, drillable }: { hover: HoverState; drillable: boolean }) {
  const { node } = hover;
  const avg = avgElapsed(node);
  const rate = errorRate(node);

  return (
    <div
      // 커서 오른쪽 아래. 커서 밑에 두면 마우스가 툴팁을 밀고 다닌다.
      style={{ left: hover.x + 12, top: hover.y + 12 }}
      className="pointer-events-none absolute z-10 max-w-[260px] rounded border border-line-strong bg-overlay px-2 py-1 shadow-lg"
    >
      <p className="truncate text-small text-fg">{hover.label}</p>
      <p className="tnum font-mono text-micro text-fg-dim">
        {t('호출')} {node.calls.toLocaleString()}
        {avg !== null && ` · ${t('평균')} ${avg.toLocaleString()}ms`}
      </p>
      {node.errors > 0 && rate !== null && (
        <p className="tnum font-mono text-micro text-danger">
          {t('에러')} {node.errors.toLocaleString()} ({(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}%)
        </p>
      )}
      {drillable && <p className="text-micro text-accent">{t('눌러서 이 앱의 트랜잭션 보기')}</p>}
    </div>
  );
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
