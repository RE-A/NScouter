// src/features/xlog/components/AgentSelectorPanel.tsx

import React, { memo, useCallback, useEffect, useState } from 'react';
import { getObjectList } from '../api/scouterApi';
import type { AgentObject } from '../types/xlog';
import { agentRowState } from './agentFilter';
import { ContextMenu } from '../../../components/ContextMenu';
import { ObjectInspector, type InspectKind } from './ObjectInspector';
import { isJavaeeObjectType } from '../types/counter';
import { t } from '../../../i18n';

interface AgentSelectorPanelProps {
  isConnected: boolean;
  selectedHashes: Set<number>;
  onSelectionChange: (hashes: Set<number>) => void;
  onAgentsLoaded?: (agents: AgentObject[]) => void;
}

export const AgentSelectorPanel = memo(function AgentSelectorPanel({
  isConnected,
  selectedHashes,
  onSelectionChange,
  onAgentsLoaded,
}: AgentSelectorPanelProps) {
  const [agents, setAgents] = useState<AgentObject[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConnected) { setAgents([]); return; }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const list = await getObjectList();
        if (!cancelled) {
          setAgents(list);
          onAgentsLoaded?.(list);
        }
      } catch { /* 무시 */ } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const timer = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [isConnected, onAgentsLoaded]);

  const handleToggle = useCallback((hash: number) => {
    const next = new Set(selectedHashes);
    if (next.has(hash)) next.delete(hash); else next.add(hash);
    onSelectionChange(next);
  }, [selectedHashes, onSelectionChange]);

  /** 필터 해제 — 빈 집합이 곧 "전부 표시"다 */
  const handleClearFilter = useCallback(() => onSelectionChange(new Set()), [onSelectionChange]);

  const filtering = selectedHashes.size > 0;
  const aliveCount = agents.filter(a => a.alive).length;

  /** 우클릭한 에이전트와 메뉴 위치 */
  const [menu, setMenu] = useState<{ agent: AgentObject; x: number; y: number } | null>(null);
  /** 열려 있는 조회 창 */
  const [inspect, setInspect] = useState<{ agent: AgentObject; kind: InspectKind } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, agent: AgentObject) => {
    e.preventDefault();
    setMenu({ agent, x: e.clientX, y: e.clientY });
  }, []);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-raised">
      {/* 헤더
          "SERVICES" 레이블은 패널 타이틀바와 글자까지 같은 중복이었다.
          그 자리에 실제로 모르는 값 — 살아 있는 개수 — 를 놓는다. */}
      <div className="flex shrink-0 items-center justify-between border-b border-line px-2.5 py-1.5">
        <span className="text-micro text-fg-dim">
          {isConnected ? (
            <>
              <span className="tnum font-mono text-fg-muted">{aliveCount}</span>
              <span className="text-fg-faint">/{agents.length}</span> 활성
            </>
          ) : (
            '—'
          )}
          {loading && <span className="ml-1 animate-pulse text-accent">•</span>}
        </span>
        {/* All/None 쌍은 뺐다. `objHashSet` 은 화이트리스트라 "None"(모든 해시를 담음)이
            "All"(빈 집합)과 결과가 똑같았다 — 눌러도 아무 변화가 없는 버튼이었다.
            표현할 수 있는 상태는 "전체" 와 "N개만" 둘뿐이므로 컨트롤도 하나면 된다. */}
        {filtering ? (
          <button
            onClick={handleClearFilter}
            title={t('필터 해제 — 전부 표시')}
            className="rounded px-1.5 py-0.5 text-micro text-accent hover:bg-hover"
          >
            <span className="tnum font-mono">{selectedHashes.size}</span>개만 · 전체로
          </button>
        ) : (
          <span className="px-1.5 text-micro text-fg-faint">{t('전체')}</span>
        )}
      </div>

      {/* 목록 */}
      <div className="flex-1 divide-y divide-line/40 overflow-y-auto">
        {!isConnected && <Empty>{t('연결되지 않음')}</Empty>}
        {isConnected && agents.length === 0 && !loading && <Empty>{t('에이전트 없음')}</Empty>}
        {agents.map(agent => {
          const state = agentRowState(selectedHashes, agent.obj_hash);
          const shortName = agent.obj_name.split('/').pop() ?? agent.obj_name;
          return (
            <div
              key={agent.obj_hash}
              onClick={() => handleToggle(agent.obj_hash)}
              onContextMenu={e => handleContextMenu(e, agent)}
              title={`${agent.obj_name}\n${agent.address}\nv${agent.version}`}
              className={[
                'flex cursor-pointer items-center gap-2 border-l-2 px-2.5 py-1.5 text-small select-none',
                // 전부 보이는 중(plain)에는 칠하지 않는다 — 전부를 강조하면 강조가 아니다.
                state === 'picked'
                  ? 'border-l-accent bg-accent/12'
                  : state === 'excluded'
                    ? 'border-l-transparent opacity-45 hover:opacity-75'
                    : 'border-l-transparent hover:bg-hover/60',
                agent.alive ? '' : 'opacity-40',
              ].join(' ')}
            >
              <span
                className={`size-1.5 shrink-0 rounded-full ${agent.alive ? 'bg-ok' : 'bg-fg-faint'}`}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-fg">
                {shortName || `[${agent.obj_hash}]`}
              </span>
              {/* 채운 배지는 행마다 반복되면 기둥이 된다. 글자만 남긴다. */}
              <span className="shrink-0 text-micro text-fg-faint">{agent.obj_type}</span>
            </div>
          );
        })}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              // 어떤 오브젝트든 신원은 있다. **막지 않는다** — 목록에 떠 있는데
              // 정체를 못 묻는 오브젝트가 있으면 그게 제일 답답하다.
              label: t('속성'),
              onSelect: () => setInspect({ agent: menu.agent, kind: 'properties' }),
            },
            {
              label: t('실행 중인 트랜잭션'),
              onSelect: () => setInspect({ agent: menu.agent, kind: 'active' }),
              disabled: isJavaeeObjectType(menu.agent.obj_type)
                ? undefined
                : t('JVM 에이전트에서만 조회됩니다'),
            },
            {
              label: t('스레드 목록'),
              onSelect: () => setInspect({ agent: menu.agent, kind: 'threads' }),
              // 호스트 에이전트는 JVM 이 아니라 머신을 본다 — 스레드가 없다.
              disabled: isJavaeeObjectType(menu.agent.obj_type)
                ? undefined
                : t('JVM 에이전트에서만 조회됩니다'),
            },
            {
              label: t('힙 히스토그램'),
              onSelect: () => setInspect({ agent: menu.agent, kind: 'heap' }),
              disabled: isJavaeeObjectType(menu.agent.obj_type)
                ? undefined
                : t('JVM 에이전트에서만 조회됩니다'),
            },
            {
              label: t('스레드 덤프'),
              onSelect: () => setInspect({ agent: menu.agent, kind: 'dump' }),
              disabled: isJavaeeObjectType(menu.agent.obj_type)
                ? undefined
                : t('JVM 에이전트에서만 조회됩니다'),
            },
            {
              label: t('소켓'),
              onSelect: () => setInspect({ agent: menu.agent, kind: 'sockets' }),
              disabled: isJavaeeObjectType(menu.agent.obj_type)
                ? undefined
                : t('JVM 에이전트에서만 조회됩니다'),
            },
            {
              label: t('로드된 클래스'),
              onSelect: () => setInspect({ agent: menu.agent, kind: 'classes' }),
              disabled: isJavaeeObjectType(menu.agent.obj_type)
                ? undefined
                : t('JVM 에이전트에서만 조회됩니다'),
            },
            {
              label: t('환경변수'),
              onSelect: () => setInspect({ agent: menu.agent, kind: 'env' }),
              disabled: isJavaeeObjectType(menu.agent.obj_type)
                ? undefined
                : t('JVM 에이전트에서만 조회됩니다'),
            },
            {
              // 켜고 끄기는 «에이전트 작업»에 있다. **읽는 쪽을 조회 묶음에 둔다** —
              // 모아 놓고 볼 데가 없으면 샘플링을 켤 이유가 없다.
              label: t('모인 스택'),
              onSelect: () => setInspect({ agent: menu.agent, kind: 'stack' }),
              disabled: isJavaeeObjectType(menu.agent.obj_type)
                ? undefined
                : t('JVM 에이전트에서만 조회됩니다'),
            },
            {
              // 호스트 에이전트도 답한다 (실측 41개). JVM 전용이 아니라서 막지 않는다.
              label: t('설정'),
              onSelect: () => setInspect({ agent: menu.agent, kind: 'config' }),
            },
            {
              // 위쪽은 전부 조회다. 이것만 **에이전트를 건드린다** — 그래서 끝에 둔다.
              label: t('에이전트 작업…'),
              onSelect: () => setInspect({ agent: menu.agent, kind: 'actions' }),
              disabled: isJavaeeObjectType(menu.agent.obj_type)
                ? undefined
                : t('JVM 에이전트에서만 실행됩니다'),
            },
          ]}
        />
      )}

      {inspect && (
        <ObjectInspector
          objHash={inspect.agent.obj_hash}
          objName={inspect.agent.obj_name}
          kind={inspect.kind}
          onClose={() => setInspect(null)}
        />
      )}
    </div>
  );
});

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 py-6 text-center text-small text-fg-faint">{children}</div>;
}

