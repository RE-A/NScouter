// src/features/xlog/components/AgentSelectorPanel.tsx

import React, { memo, useCallback, useEffect, useState } from 'react';
import { getObjectList } from '../api/scouterApi';
import type { AgentObject } from '../types/xlog';

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

  const handleSelectAll = useCallback(() => onSelectionChange(new Set()), [onSelectionChange]);
  const handleSelectNone = useCallback(() => {
    if (agents.length > 0) onSelectionChange(new Set(agents.map(a => a.obj_hash)));
  }, [agents, onSelectionChange]);

  const isAllSelected = selectedHashes.size === 0;

  return (
    <div style={panelStyle}>
      {/* 헤더 */}
      <div style={headerStyle}>
        <span style={headerLabelStyle}>
          SERVICES {loading && <span style={loadingDotStyle}>•••</span>}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={handleSelectAll} style={ctrlBtnStyle(isAllSelected)} title="전체 선택">All</button>
          <button onClick={handleSelectNone} style={ctrlBtnStyle(!isAllSelected && selectedHashes.size === agents.length)} title="전체 해제">None</button>
        </div>
      </div>

      {/* 목록 */}
      <div style={listStyle}>
        {!isConnected && <div style={emptyStyle}>연결되지 않음</div>}
        {isConnected && agents.length === 0 && !loading && <div style={emptyStyle}>에이전트 없음</div>}
        {agents.map(agent => {
          const selected = isAllSelected || selectedHashes.has(agent.obj_hash);
          const shortName = agent.obj_name.split('/').pop() ?? agent.obj_name;
          return (
            <div
              key={agent.obj_hash}
              style={agentRowStyle(selected, agent.alive)}
              onClick={() => handleToggle(agent.obj_hash)}
              title={`${agent.obj_name}\n${agent.address}\nv${agent.version}`}
            >
              <span style={aliveStyle(agent.alive)} />
              <span style={agentNameStyle}>{shortName || `[${agent.obj_hash}]`}</span>
              <span style={agentTypeStyle}>{agent.obj_type}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ─── 스타일 ────────────────────────────────────────────────────

const C = {
  bg1: '#0d0d1a', bg2: '#111120', bg3: '#161628', bg4: '#1e1e38',
  border: '#1e1e3a', border2: '#252542',
  accent: '#4f72ff', accentDim: 'rgba(79,114,255,0.15)',
  text: '#e8e8ff', textMid: '#9090b0', textDim: '#505070',
  success: '#3dd68c',
};

const panelStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  background: C.bg2,
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 10px',
  borderBottom: `1px solid ${C.border}`,
  flexShrink: 0,
};

const headerLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: C.textDim,
  letterSpacing: 1.2,
  textTransform: 'uppercase',
};

const loadingDotStyle: React.CSSProperties = {
  color: C.accent,
  marginLeft: 4,
  fontSize: 10,
};

const listStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
};

const emptyStyle: React.CSSProperties = {
  padding: '16px 10px',
  fontSize: 11,
  color: C.textDim,
  textAlign: 'center',
};

function agentRowStyle(selected: boolean, alive: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 10px',
    gap: 7,
    cursor: 'pointer',
    fontSize: 11,
    background: selected ? C.accentDim : 'transparent',
    borderLeft: selected ? `2px solid ${C.accent}` : '2px solid transparent',
    borderBottom: `1px solid ${C.border}`,
    opacity: alive ? 1 : 0.4,
    userSelect: 'none',
    transition: 'background 0.1s',
  };
}

function aliveStyle(alive: boolean): React.CSSProperties {
  return {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: alive ? C.success : C.textDim,
    boxShadow: alive ? `0 0 5px ${C.success}` : 'none',
    flexShrink: 0,
  };
}

const agentNameStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: C.text,
  fontSize: 11,
};

const agentTypeStyle: React.CSSProperties = {
  fontSize: 9,
  color: C.textDim,
  flexShrink: 0,
  background: C.bg4,
  padding: '1px 4px',
  borderRadius: 3,
};

function ctrlBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? C.accent : C.bg4,
    border: `1px solid ${active ? C.accent : C.border2}`,
    color: active ? '#fff' : C.textMid,
    fontSize: 10,
    padding: '2px 7px',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  };
}
