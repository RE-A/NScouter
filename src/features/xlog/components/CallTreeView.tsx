// 분산 트랜잭션 호출 흐름
//
// 프로파일이 "한 앱 안에서 시간이 어디로 갔나"를 본다면, 이건 **어느 앱이** 먹었나를 본다.
// 그래서 프로파일과 같은 시간축 은유를 쓴다 — 막대의 위치가 시작, 길이가 소요다.
//
// 막대는 두 겹이다. 옅은 부분은 자식(다른 앱)을 기다린 시간이고
// 진한 부분이 그 앱이 실제로 쓴 시간이다. 범인은 진한 쪽에 있다.

import { memo } from 'react';
import { flattenTree, selfTime, traceSpan, type TraceNode } from '../trace/callTree';
import { waterfallGeometry } from './stepLayout';
import { durationTone } from './durationTone';
import type { SXLog } from '../types/xlog';

interface CallTreeViewProps {
  roots: TraceNode[];
  /** service hash → 이름 */
  texts: Record<number, string>;
  /** objHash → 에이전트명 */
  agentMap: Map<number, string>;
  /** 지금 상세 패널이 보고 있는 트랜잭션. 트리에서 위치를 잡아 준다 */
  activeTxid: string;
  /** 다른 앱의 트랜잭션으로 옮겨 간다 — 그 앱의 프로파일을 바로 열 수 있어야 한다 */
  onSelect: (xlog: SXLog) => void;
}

export const CallTreeView = memo(function CallTreeView({
  roots,
  texts,
  agentMap,
  activeTxid,
  onSelect,
}: CallTreeViewProps) {
  const rows = flattenTree(roots);
  const span = traceSpan(roots);

  return (
    <ol className="divide-y divide-line/60">
      {rows.map(node => {
        const { xlog } = node;
        const start = xlog.endTime - xlog.elapsed - span.start;
        const bar = waterfallGeometry(start, xlog.elapsed, span.total);
        const self = selfTime(node);
        // 자기 시간이 전체 막대에서 차지하는 비율. 나머지는 자식을 기다린 시간이다.
        const selfPct = xlog.elapsed > 0 ? (self / xlog.elapsed) * 100 : 100;

        const agent = agentMap.get(xlog.objHash) ?? `[0x${(xlog.objHash >>> 0).toString(16)}]`;
        const service = texts[xlog.service] ?? `0x${(xlog.service >>> 0).toString(16)}`;
        const active = xlog.txid === activeTxid;
        const failed = xlog.error !== 0;

        return (
          <li key={xlog.txid}>
            <button
              onClick={() => onSelect(xlog)}
              aria-current={active ? 'true' : undefined}
              className={[
                'grid w-full grid-cols-[34px_minmax(0,1fr)_minmax(0,90px)_66px] items-baseline gap-x-2',
                'px-2 py-1 text-left hover:bg-hover/60',
                failed ? 'border-l-2 border-danger' : 'border-l-2 border-transparent',
                active ? 'bg-hover' : '',
              ].join(' ')}
            >
              {/* 트레이스 시작 기준 상대 ms */}
              <span className="tnum text-right font-mono text-micro text-fg-faint">
                {Math.round(start)}
              </span>

              <div style={{ paddingLeft: node.depth * 10 }} className="min-w-0">
                <span className="block truncate text-small text-fg" title={service}>
                  {service}
                </span>
                <span className="block truncate text-micro text-fg-dim" title={agent}>
                  {agent}
                </span>
              </div>

              {/* 시간축 — 옅은 부분이 자식 대기, 진한 부분이 자기 시간 */}
              <div className="relative h-1.5 self-center overflow-hidden rounded-sm bg-line/40">
                <div
                  className="absolute top-0 h-full rounded-sm bg-accent/25"
                  style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
                >
                  <div
                    className={`h-full rounded-sm ${failed ? 'bg-danger' : 'bg-accent'}`}
                    style={{ width: `${selfPct}%` }}
                  />
                </div>
              </div>

              <span
                className={`tnum text-right font-mono text-small ${durationTone(xlog.elapsed)}`}
              >
                {xlog.elapsed.toLocaleString()}
                <span className="ml-0.5 text-micro text-fg-faint">ms</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
});
