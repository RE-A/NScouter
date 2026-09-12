// src/features/xlog/components/AgentSelectorPanel.tsx

import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { getObjectList } from '../api/scouterApi';
import type { AgentObject } from '../types/xlog';
import { agentRowState, groupCheck, toggleGroupPick } from './agentFilter';
import { groupAgents, shortName, type GroupBy } from './agentTree';
import { shouldShowTypes, typeCounts, typeLabel, typeTone } from './objectTypes';
import { ContextMenu } from '../../../components/ContextMenu';
import { ObjectInspector, type InspectKind } from './ObjectInspector';
import { ConfigSettingsDialog } from '../../config/ConfigSettingsDialog';
import { isJavaeeObjectType } from '../types/counter';
import { t } from '../../../i18n';

interface AgentSelectorPanelProps {
  isConnected: boolean;
  selectedHashes: Set<number>;
  onSelectionChange: (hashes: Set<number>) => void;
  onAgentsLoaded?: (agents: AgentObject[]) => void;
  /** 무엇으로 묶을지. 껐다 켜도 남는다 */
  groupBy: GroupBy;
  onGroupByChange: (by: GroupBy) => void;
}

export const AgentSelectorPanel = memo(function AgentSelectorPanel({
  isConnected,
  selectedHashes,
  onSelectionChange,
  onAgentsLoaded,
  groupBy,
  onGroupByChange,
}: AgentSelectorPanelProps) {
  const [agents, setAgents] = useState<AgentObject[]>([]);
  const [loading, setLoading] = useState(false);
  /** 목록 안 검색어 */
  const [query, setQuery] = useState('');
  /** 접어 둔 묶음 이름들 */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  /**
   * 보기로 켜 둔 종류들. **비어 있으면 «거를 것이 없다»** 다 (`agentTree.matchesType`).
   *
   * 서버 고르기(`selectedHashes`)와 **다른 축**이다. 저쪽은 «무엇을 그릴지» 고,
   * 이건 «목록에서 무엇을 볼지» 다 — 종류를 걸러도 이미 고른 서버는 그대로 그려진다.
   * 둘을 묶으면 datasource 를 목록에서 잠깐 치우려다 차트가 비어 버린다.
   */
  const [pickedTypes, setPickedTypes] = useState<ReadonlySet<string>>(new Set());

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

  /** 고른 것을 전부 푼다. **«전부 표시» 가 아니라 «아무것도 안 봄» 이다** (agentFilter.ts) */
  const handleClearFilter = useCallback(() => onSelectionChange(new Set()), [onSelectionChange]);

  /** 묶음을 통째로. 100대짜리 목록에서 한 대씩 누르게 두지 않는다 */
  const handleToggleGroup = useCallback(
    (hashes: readonly number[]) => onSelectionChange(toggleGroupPick(selectedHashes, hashes)),
    [selectedHashes, onSelectionChange],
  );

  const filtering = selectedHashes.size > 0;
  const aliveCount = agents.filter(a => a.alive).length;

  /**
   * 종류가 둘 이상일 때만 종류를 말한다.
   *
   * 전부 tomcat 인 환경에서 줄마다 `tomcat` 을 붙이면 정보가 아니라 여백을 먹는 글자다
   * — 칩도 배지도 그때는 통째로 없앤다.
   */
  const kinds = useMemo(() => typeCounts(agents), [agents]);
  const multiType = useMemo(() => shouldShowTypes(agents), [agents]);

  const groups = useMemo(
    () => groupAgents(agents, query, groupBy, multiType ? pickedTypes : undefined),
    [agents, query, groupBy, multiType, pickedTypes],
  );
  const shown = groups.reduce((n, g) => n + g.agents.length, 0);
  const typeFiltering = multiType && pickedTypes.size > 0;

  const toggleType = useCallback((type: string) => {
    setPickedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  /**
   * 줄마다 종류를 적을 것인가.
   *
   * 타입으로 묶었을 때는 **묶음 머리가 이미 그 말을 하고 있다.** 같은 말을 두 번 적으면
   * 줄이 길어질 뿐이라, 그때는 배지를 접는다. 그룹(호스트)으로 묶었을 때가 원래
   * 종류를 알 데가 없던 자리다 — `/order-app` 아래 WAS 와 커넥션 풀이 섞여 있다.
   */
  const showBadge = multiType && groupBy !== 'type';
  /** 검색 중에는 접힘을 무시한다 — 찾은 걸 숨기면 검색이 아니다 */
  const searching = query.trim() !== '';

  const toggleGroup = useCallback((type: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  /** 우클릭한 에이전트와 메뉴 위치 */
  const [menu, setMenu] = useState<{ agent: AgentObject; x: number; y: number } | null>(null);
  /** 열려 있는 조회 창 */
  const [inspect, setInspect] = useState<{ agent: AgentObject; kind: InspectKind } | null>(null);
  /**
   * 설정 창을 연 에이전트.
   *
   * 설정은 조회 창(`ObjectInspector`)이 아니라 **따로 된 설정 창**이다 — 구역·설명이 붙은
   * 편집 화면이라 조회 창의 폭으로는 안 들어가고, 콜렉터 설정과 같은 창을 쓴다.
   */
  const [configOf, setConfigOf] = useState<AgentObject | null>(null);

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
              <span className="text-fg-faint">/{agents.length}</span> {t('활성')}
            </>
          ) : (
            '—'
          )}
          {loading && <span className="ml-1 animate-pulse text-accent">•</span>}
        </span>
        {/* **«전부» 라는 상태는 없다.** 고른 것이 곧 보는 것이라, 여기 적히는 수가
            화면에 그려지는 서버 수와 같다. 0 이면 화면도 비어 있다. */}
        {filtering ? (
          <button
            onClick={handleClearFilter}
            title={t('고른 서버를 모두 풉니다')}
            className="rounded px-1.5 py-0.5 text-micro text-accent hover:bg-hover"
          >
            <span className="tnum font-mono">{selectedHashes.size}</span>
            {t('대 선택 · 해제')}
          </button>
        ) : (
          <span className="px-1.5 text-micro text-fg-faint">{t('고른 서버 없음')}</span>
        )}
      </div>

      {/* 찾기 — 오브젝트가 백 개를 넘으면 눈으로 훑는 건 방법이 못 된다 */}
      {isConnected && agents.length > 0 && (
        <div className="shrink-0 border-b border-line px-2 py-1.5">
          {/* **두 기준은 서로를 대신하지 못한다.** 타입은 «무엇인가», 그룹은 «어디에
              속하는가» 다. 운영에서는 obj_type 에 시스템 이름을 넣어 쓰기도 해서
              겹치기도 하지만, 그때도 그룹 쪽이 한 겹 더 잘게 나눈다. */}
          <div className="mb-1.5 flex items-center gap-1">
            <span className="text-micro text-fg-dim">{t('묶기')}</span>
            {(['type', 'group'] as const).map(b => (
              <button
                key={b}
                onClick={() => onGroupByChange(b)}
                title={
                  b === 'type'
                    ? t('오브젝트 종류로 묶습니다 (tomcat · datasource · linux)')
                    : t('이름의 부모 경로로 묶습니다 (/CJFW/PRD-FSCP)')
                }
                className={`rounded px-1.5 py-0.5 text-micro ${
                  groupBy === b
                    ? 'bg-accent/20 text-accent'
                    : 'text-fg-faint hover:bg-hover hover:text-fg'
                }`}
              >
                {b === 'type' ? t('타입') : t('그룹')}
              </button>
            ))}
          </div>
          {/* 종류 거르기 — **묶기와 다른 축이다.** 묶기는 «어떻게 쌓을지» 고
              이건 «무엇을 볼지» 다. 그룹으로 묶어 놓고 WAS 만 보는 일이 실제로 잦다.
              종류가 하나뿐인 환경에서는 통째로 안 뜬다. */}
          {multiType && (
            <div className="mb-1.5 flex flex-wrap items-center gap-1">
              <span className="text-micro text-fg-dim">{t('종류')}</span>
              {kinds.map(k => {
                const on = pickedTypes.has(k.type);
                return (
                  <button
                    key={k.type}
                    onClick={() => toggleType(k.type)}
                    aria-pressed={on}
                    title={`${k.type} — ${k.aliveCount}/${k.count} ${t('활성')}`}
                    className={`rounded border px-1.5 py-0.5 font-mono text-micro ${
                      on
                        ? `border-accent/60 bg-accent/10 ${typeTone(k.type)}`
                        : `border-transparent ${typeFiltering ? 'text-fg-faint opacity-60' : typeTone(k.type)} hover:bg-hover`
                    }`}
                  >
                    {k.type}
                    <span className="tnum ml-1 text-fg-faint">{k.count}</span>
                  </button>
                );
              })}
              {typeFiltering && (
                <button
                  onClick={() => setPickedTypes(new Set())}
                  title={t('종류 조건을 풉니다')}
                  className="rounded px-1 py-0.5 text-micro text-accent hover:bg-hover"
                >
                  ✕
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-1">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('이름 · 타입 찾기')}
              className="min-w-0 flex-1 rounded border border-line bg-input px-1.5 py-0.5 text-small text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
            />
            {searching && (
              <button
                onClick={() => setQuery('')}
                title={t('검색어 지우기')}
                aria-label={t('검색어 지우기')}
                className="flex size-5 shrink-0 items-center justify-center rounded text-fg-dim hover:bg-hover hover:text-fg"
              >
                ✕
              </button>
            )}
          </div>
          {(searching || typeFiltering) && (
            <p className="mt-1 text-micro text-fg-faint">
              <span className="tnum font-mono">{shown}</span>
              {t('건 찾음')} · <span className="tnum font-mono">{agents.length}</span>
              {t('건 중')}
            </p>
          )}
        </div>
      )}

      {/* 목록 */}
      <div className="flex-1 overflow-y-auto">
        {!isConnected && <Empty>{t('연결되지 않음')}</Empty>}
        {isConnected && agents.length === 0 && !loading && <Empty>{t('에이전트 없음')}</Empty>}
        {isConnected && agents.length > 0 && groups.length === 0 && (
          <Empty>{t('조건에 맞는 항목이 없습니다.')}</Empty>
        )}
        {groups.map(group => {
          const open = searching || !collapsed.has(group.type);
          // **보이는 것만 고른다.** 검색으로 걸러 낸 상태에서 묶음을 켜면
          // 안 보이는 서버까지 딸려 오는데, 그건 무엇을 골랐는지 알 수 없게 만든다.
          const groupHashes = group.agents.map(a => a.obj_hash);
          return (
            <div key={group.type}>
              {/* 묶음 머리 — 접혀 있어도 **살아 있는 수**는 보여야 한다.
                  체크와 접기는 **다른 버튼**이다. 한 버튼에 묶으면 목록을 펼치려다
                  100대가 통째로 켜진다. */}
              <div className="flex items-center gap-1.5 border-b border-line/60 bg-surface/60 px-2 py-1">
                <input
                  type="checkbox"
                  checked={groupCheck(selectedHashes, groupHashes) === 'all'}
                  ref={el => {
                    // 일부만 고른 묶음은 «켜짐» 도 «꺼짐» 도 아니다. 둘 중 하나로 그리면
                    // 눌렀을 때 무슨 일이 날지 화면이 말해 주지 못한다.
                    if (el) el.indeterminate = groupCheck(selectedHashes, groupHashes) === 'some';
                  }}
                  onChange={() => handleToggleGroup(groupHashes)}
                  title={t('이 묶음을 통째로 고릅니다')}
                  aria-label={group.type}
                  className="shrink-0 cursor-pointer"
                />
                <button
                  onClick={() => toggleGroup(group.type)}
                  aria-expanded={open}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <span className={`shrink-0 text-micro text-fg-dim ${open ? '' : '-rotate-90'}`}>
                    ▾
                  </span>
                  <span className="min-w-0 flex-1 truncate text-micro font-medium text-fg-muted">
                    {group.type}
                  </span>
                </button>
                <span className="tnum shrink-0 font-mono text-micro text-fg-faint">
                  {group.aliveCount}/{group.agents.length}
                </span>
              </div>

              {open && (
                <div className="divide-y divide-line/40">
                  {group.agents.map(agent => {
                    const state = agentRowState(selectedHashes, agent.obj_hash);
                    const name = shortName(agent.obj_name);
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
                {name || `[${agent.obj_hash}]`}
              </span>
              {/* 종류. **이름으로 추측한 게 아니라 콜렉터가 준 `objType` 이다.**
                  색은 Family(javaee · host · datasource)로 준다 — 처음 보는 종류가
                  와도 이름은 그대로 뜬다. 타입으로 묶었을 때는 묶음 머리와 같은 말이라 접는다. */}
              {showBadge && (
                <span
                  className={`shrink-0 font-mono text-micro ${typeTone(agent.obj_type)}`}
                  title={`${t('오브젝트 종류')} — ${typeLabel(agent.obj_type)}`}
                >
                  {typeLabel(agent.obj_type)}
                </span>
              )}
            </div>
                    );
                  })}
                </div>
              )}
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
              onSelect: () => setConfigOf(menu.agent),
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

      {configOf && (
        <ConfigSettingsDialog
          target={{
            kind: 'agent',
            objHash: configOf.obj_hash,
            objName: configOf.obj_name,
            objType: configOf.obj_type,
          }}
          onClose={() => setConfigOf(null)}
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

