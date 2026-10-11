// 서비스 흐름
//
// 호출 트리가 앱 단위라면 이건 앱이 부른 것까지 내려간다 — SQL, 외부 API, 그리고
// 그 호출이 닿은 다른 앱. 시작점은 요청이 들어온 IP다.
//
// 시간축(막대) 대신 **나무 모양**을 쓴다. 여기서 알고 싶은 건 "언제"가 아니라
// "무엇이 무엇을 불렀나"이고, 접힌 노드는 여러 번의 호출이라 시작 시각이 하나가 아니다.

import { memo } from 'react';
import { flattenFlow, type FlowNode } from '../trace/flowTree';
import { durationTone } from './durationTone';
import { FullTextButton } from './FullTextButton';
import { previewLine } from './textFormat';
import { t } from '../../../i18n';

interface FlowTreeViewProps {
  roots: FlowNode[];
  activeTxid: string;
  onSelect: (node: FlowNode) => void;
}

const KIND: Record<string, { label: string; cls: string }> = {
  user: { label: '⌂', cls: 'text-fg-dim' },
  service: { label: '▣', cls: 'text-accent' },
  sql: { label: 'SQL', cls: 'text-[var(--cat-sql)]' },
  apicall: { label: 'API', cls: 'text-[var(--cat-api)]' },
  thread: { label: 'THR', cls: 'text-[var(--cat-api)]' },
};

export const FlowTreeView = memo(function FlowTreeView({
  roots,
  activeTxid,
  onSelect,
}: FlowTreeViewProps) {
  const rows = flattenFlow(roots);

  if (rows.length === 0) {
    return <p className="px-2 py-4 text-center text-body text-fg-faint">{t('흐름이 없습니다')}</p>;
  }

  return (
    <ol className="divide-y divide-line/60">
      {rows.map(n => {
        const kind = KIND[n.kind];
        const active = n.kind === 'service' && n.xlog?.txid === activeTxid;
        const clickable = n.kind === 'service';

        return (
          <li key={n.key}>
            <div
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => onSelect(n) : undefined}
              onKeyDown={
                clickable
                  ? e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect(n);
                      }
                    }
                  : undefined
              }
              aria-current={active ? 'true' : undefined}
              className={[
                'grid grid-cols-[30px_minmax(0,1fr)_38px_62px] items-baseline gap-x-2 px-2 py-1',
                n.error ? 'border-l-2 border-danger' : 'border-l-2 border-transparent',
                active ? 'bg-hover' : '',
                clickable ? 'cursor-pointer hover:bg-hover/60' : '',
              ].join(' ')}
            >
              <span className={`font-mono text-micro font-semibold ${kind.cls}`}>{kind.label}</span>

              {/* 들여쓰기가 곧 호출 관계다. 세로선으로 계보를 잇는다 */}
              <div
                style={{ paddingLeft: n.depth * 12 }}
                className={`min-w-0 ${n.depth > 0 ? 'border-l border-line/50' : ''}`}
              >
                {/* **전문을 툴팁에 밀어 넣지 않는다.** 잎은 SQL 문장이나 API 주소
                    통째라 그대로 달면 툴팁이 화면을 덮는다 — 전문은 창에서 연다
                    (스텝 목록·요약과 같은 창이다). */}
                <span className="flex min-w-0 items-baseline gap-1">
                  <span
                    className={`min-w-0 truncate text-small ${
                      n.kind === 'service' ? 'text-fg' : 'text-fg-muted'
                    }`}
                    title={previewLine(n.name, 120)}
                  >
                    {n.name}
                  </span>
                  <FullTextButton
                    kind={kind.label}
                    title={previewLine(n.name, 60)}
                    body={n.name}
                    className="shrink-0 rounded px-1 text-micro text-fg-faint hover:bg-hover hover:text-fg"
                  />
                </span>
                {n.agent && (
                  <span className="block truncate text-micro text-fg-dim" title={n.agent}>
                    {n.agent}
                  </span>
                )}
              </div>

              {/* 1회면 굳이 보여주지 않는다. 눈에 띄어야 할 건 반복이다 */}
              <span className="tnum text-right font-mono text-micro text-fg-dim">
                {n.count > 1 ? `×${n.count}` : ''}
              </span>

              <span className="tnum text-right font-mono text-small">
                {n.kind === 'user' ? (
                  <span className="text-fg-faint">—</span>
                ) : (
                  <>
                    <span className={durationTone(n.elapsed)}>{n.elapsed.toLocaleString()}</span>
                    <span className="ml-0.5 text-micro text-fg-faint">ms</span>
                  </>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
});
