// src/App.tsx

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FloatingPanel } from './components/FloatingPanel';
import { ConnectionDialog } from './features/xlog/components/ConnectionDialog';
import { SettingsDialog } from './features/settings/SettingsDialog';
import { LogLevelSelector } from './features/xlog/components/LogLevelSelector';
import { XLogChart } from './features/xlog/components/XLogChart';
import { XLogToolbar } from './features/xlog/components/XLogToolbar';
import { AgentSelectorPanel } from './features/xlog/components/AgentSelectorPanel';
import { CounterChart } from './features/xlog/components/CounterChart';
import { XLogDetailPanel } from './features/xlog/components/XLogDetailPanel';
import { AlertPanel } from './features/xlog/components/AlertPanel';
import {
  onConnected,
  onDisconnected,
  startCounterStream,
  startAlertStream,
  onAlertData,
} from './features/xlog/api/scouterApi';
import { useXLogDetail } from './features/xlog/hooks/useXLogDetail';
import { useTextResolver } from './features/xlog/hooks/useTextResolver';
import type { AgentObject, SXLog, XLogChartConfig, XLogFilterState } from './features/xlog/types/xlog';
import { DEFAULT_CHART_CONFIG, DEFAULT_FILTER } from './features/xlog/types/xlog';
import type { AlertPack } from './features/xlog/types/alert';
import { alertLevelColor, alertLevelLabel } from './features/xlog/types/alert';

type TabId = 'xlog' | 'counter' | 'alert';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('xlog');
  const [isConnected, setIsConnected] = useState(false);
  const [serverId, setServerId] = useState('');
  const [config, setConfig] = useState<XLogChartConfig>(DEFAULT_CHART_CONFIG);
  const [filter, setFilter] = useState<XLogFilterState>(DEFAULT_FILTER);
  const [selectedXLogs, setSelectedXLogs] = useState<SXLog[]>([]);
  const [agentMap, setAgentMap] = useState<Map<number, string>>(new Map());

  const { state: detailState, fetchDetail, clearDetail } = useXLogDetail();
  const { getCached } = useTextResolver();

  // 플로팅 패널 워크스페이스 측정 (최초 1회)
  const xlogWsRef = useRef<HTMLDivElement>(null);
  const [wsSize, setWsSize] = useState({ w: 0, h: 0 });
  const [panelOrder, setPanelOrder] = useState(['services', 'chart', 'detail']);

  useLayoutEffect(() => {
    const el = xlogWsRef.current;
    if (el) setWsSize({ w: el.clientWidth, h: el.clientHeight });
  }, []);

  const bringToFront = useCallback((name: string) => {
    setPanelOrder(prev => [...prev.filter(n => n !== name), name]);
  }, []);

  useEffect(() => {
    let unlistenConn: (() => void) | null = null;
    let unlistenDisconn: (() => void) | null = null;
    onConnected(id => { setIsConnected(true); setServerId(id); }).then(fn => { unlistenConn = fn; });
    onDisconnected(() => {
      setIsConnected(false); setServerId('');
      setSelectedXLogs([]); setAgentMap(new Map()); clearDetail();
    }).then(fn => { unlistenDisconn = fn; });
    return () => { unlistenConn?.(); unlistenDisconn?.(); };
  }, [clearDetail]);

  useEffect(() => {
    if (!isConnected) return;
    startCounterStream([]).catch(() => {});
    startAlertStream().catch(() => {});
  }, [isConnected]);

  const handleConfigChange = useCallback((p: Partial<XLogChartConfig>) => setConfig(prev => ({ ...prev, ...p })), []);
  const handleFilterChange = useCallback((p: Partial<XLogFilterState>) => setFilter(prev => ({ ...prev, ...p })), []);
  const handleConnected = useCallback((_sid: string, _hashes: number[]) => {}, []);
  const handleDisconnected = useCallback(() => {}, []);
  const handleAgentSelectionChange = useCallback((hashes: Set<number>) => {
    setFilter(prev => ({ ...prev, objHashSet: hashes }));
  }, []);
  const handleAgentsLoaded = useCallback((agents: AgentObject[]) => {
    setAgentMap(new Map(agents.map(a => [a.obj_hash, a.obj_name])));
  }, []);
  const handleXLogSelect = useCallback((xlogs: SXLog[]) => {
    setSelectedXLogs(xlogs);
    if (xlogs.length === 1) fetchDetail(xlogs[0]);
  }, [fetchDetail]);
  const handleRowClick = useCallback((xlog: SXLog) => { fetchDetail(xlog); }, [fetchDetail]);
  const handleAlertBadgeClick = useCallback(() => setActiveTab('alert'), []);

  const [showSettings, setShowSettings] = useState(false);

  const isStreaming = isConnected;
  const hasDetail = !!(detailState.xlog || detailState.isLoading);
  const hasSelected = selectedXLogs.length > 0;

  return (
    <div style={appStyle}>
      {/* ── 헤더 ── */}
      <header style={headerStyle}>
        <div style={logoWrapStyle}>
          <span style={logoNStyle}>N</span>
          <span style={logoTextStyle}>scouter</span>
        </div>

        {serverId && (
          <div style={serverBadgeStyle}>
            <span style={serverDotStyle} />
            {serverId}
          </div>
        )}

        <ConnectionDialog
          isConnected={isConnected}
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
        />

        {/* 탭 네비게이션 */}
        <nav style={tabNavStyle}>
          {(['xlog', 'counter', 'alert'] as TabId[]).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={tabBtnStyle(activeTab === tab)}>
              {TAB_LABELS[tab]}
              {activeTab === tab && <span style={tabUnderlineStyle} />}
            </button>
          ))}
        </nav>

        <div style={headerRightStyle}>
          <AlertPanel isStreaming={isStreaming} onBadgeClick={handleAlertBadgeClick} />
          <div style={logLevelWrapStyle}>
            <span style={logLevelLabelStyle}>LOG</span>
            <LogLevelSelector />
          </div>
          <button onClick={() => setShowSettings(true)} style={settingsBtnStyle} title="설정">
            ⚙
          </button>
        </div>
      </header>

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}

      {/* ── XLog 탭 ── */}
      {activeTab === 'xlog' && (
        <div style={tabBodyStyle}>
          <XLogToolbar
            config={config}
            filter={filter}
            onConfigChange={handleConfigChange}
            onFilterChange={handleFilterChange}
          />
          <div ref={xlogWsRef} style={xlogWorkspaceStyle}>
            {wsSize.h > 0 && (
              <>
                {/* 서비스 패널 */}
                <FloatingPanel
                  key={`services-${wsSize.h}`}
                  title="Services"
                  initialRect={{ x: 0, y: 0, w: 220, h: wsSize.h }}
                  minW={150} minH={200}
                  zIndex={10 + panelOrder.indexOf('services')}
                  onFocus={() => bringToFront('services')}
                >
                  <AgentSelectorPanel
                    isConnected={isConnected}
                    selectedHashes={filter.objHashSet}
                    onSelectionChange={handleAgentSelectionChange}
                    onAgentsLoaded={handleAgentsLoaded}
                  />
                </FloatingPanel>

                {/* XLog 차트 + 하단 목록 */}
                <FloatingPanel
                  key={`chart-${wsSize.h}`}
                  title="XLog"
                  initialRect={{ x: 225, y: 0, w: Math.max(400, wsSize.w - 230), h: wsSize.h }}
                  minW={300} minH={300}
                  zIndex={10 + panelOrder.indexOf('chart')}
                  onFocus={() => bringToFront('chart')}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <div style={{ flex: 1, minHeight: 0, padding: 8, boxSizing: 'border-box' }}>
                      <XLogChart config={config} filter={filter} onSelect={handleXLogSelect} />
                    </div>
                    {hasSelected && (
                      <div style={{ height: 220, borderTop: '1px solid #1e1e3a', flexShrink: 0 }}>
                        <XLogTable
                          xlogs={selectedXLogs}
                          agentMap={agentMap}
                          activeXlog={detailState.xlog ?? null}
                          getCached={getCached}
                          onRowClick={handleRowClick}
                          onClear={() => setSelectedXLogs([])}
                        />
                      </div>
                    )}
                  </div>
                </FloatingPanel>

                {/* 상세 패널 */}
                {hasDetail && (
                  <FloatingPanel
                    key="detail"
                    title="XLog Detail"
                    initialRect={{ x: Math.max(600, wsSize.w - 330), y: 0, w: 320, h: wsSize.h }}
                    minW={240} minH={300}
                    zIndex={10 + panelOrder.indexOf('detail')}
                    onFocus={() => bringToFront('detail')}
                  >
                    <XLogDetailPanel state={detailState} onClose={clearDetail} />
                  </FloatingPanel>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Counter 탭 ── */}
      {activeTab === 'counter' && (
        <div style={tabBodyStyle}>
          <div style={tabPageHeaderStyle}>성능 카운터</div>
          {isConnected ? (
            <div style={counterBodyStyle}>
              <CounterChart isStreaming={isStreaming} metric="tps" label="TPS" height={200} />
              <CounterChart isStreaming={isStreaming} metric="elapsed" label="Elapsed Avg (ms)" height={200} />
            </div>
          ) : (
            <EmptyState text="연결 후 사용 가능합니다." />
          )}
        </div>
      )}

      {/* ── Alert 탭 ── */}
      {activeTab === 'alert' && (
        <div style={tabBodyStyle}>
          <AlertFullView isStreaming={isStreaming} />
        </div>
      )}
    </div>
  );
}

// ─── XLog 하단 목록 ───────────────────────────────────────────

interface XLogTableProps {
  xlogs: SXLog[];
  agentMap: Map<number, string>;
  activeXlog: SXLog | null;
  getCached: (typeKey: string, hash: number) => string | undefined;
  onRowClick: (xlog: SXLog) => void;
  onClear: () => void;
}

function XLogTable({ xlogs, agentMap, activeXlog, getCached, onRowClick, onClear }: XLogTableProps) {
  return (
    <div style={tableWrapStyle}>
      <div style={tableHeaderBarStyle}>
        <span style={tableHeaderTitleStyle}>트랜잭션 목록 <span style={tableCountBadgeStyle}>{xlogs.length}</span></span>
        <button onClick={onClear} style={closeBtnStyle} title="닫기">✕</button>
      </div>
      <div style={colHeaderStyle}>
        <span style={{ width: 74 }}>시간</span>
        <span style={{ width: 100 }}>서버</span>
        <span style={{ flex: 1 }}>URL</span>
        <span style={{ width: 100 }}>IP</span>
        <span style={{ width: 68, textAlign: 'right' }}>Elapsed</span>
        <span style={{ width: 44, textAlign: 'right' }}>상태</span>
      </div>
      <div style={tableBodyStyle}>
        {xlogs.slice(0, 500).map((x, i) => {
          const svcName = getCached('service', x.service) ?? `[0x${x.service.toString(16)}]`;
          const agentName = agentMap.get(x.objHash) ?? `[0x${x.objHash.toString(16)}]`;
          const isActive = activeXlog?.txid === x.txid;
          const hasErr = x.error !== 0;
          const elapsedColor = x.elapsed > 1000 ? '#ff6b6b' : x.elapsed > 300 ? '#f5a623' : '#3dd68c';
          return (
            <div key={i} style={tableRowStyle(hasErr, isActive, i)} onClick={() => onRowClick(x)}>
              <span style={{ width: 74, flexShrink: 0, color: '#606080' }}>{new Date(x.endTime).toLocaleTimeString('ko-KR', { hour12: false })}</span>
              <span style={{ width: 100, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#9090b0' }}>{agentName}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#c8c8e8' }}>{svcName}</span>
              <span style={{ width: 100, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#606080' }}>{x.ipAddr || '-'}</span>
              <span style={{ width: 68, flexShrink: 0, textAlign: 'right', color: elapsedColor, fontWeight: 600 }}>{x.elapsed}ms</span>
              <span style={{ width: 44, flexShrink: 0, textAlign: 'right', color: hasErr ? '#ff4d4f' : '#3dd68c', fontSize: 10, fontWeight: 700 }}>{hasErr ? 'ERR' : 'OK'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Alert 전체 뷰 ───────────────────────────────────────────

function AlertFullView({ isStreaming }: { isStreaming: boolean }) {
  const [alerts, setAlerts] = useState<AlertPack[]>([]);

  useEffect(() => {
    if (!isStreaming) return;
    let unlisten: (() => void) | null = null;
    onAlertData(pack => {
      setAlerts(prev => {
        const next = [pack, ...prev];
        return next.length > 500 ? next.slice(0, 500) : next;
      });
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [isStreaming]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={tabPageHeaderStyle}>
        <span>알림</span>
        {alerts.length > 0 && (
          <button onClick={() => setAlerts([])} style={{ ...closeBtnStyle, marginLeft: 8, fontSize: 11, color: '#505070' }}>Clear</button>
        )}
      </div>
      <div style={{ ...colHeaderStyle, flexShrink: 0 }}>
        <span style={{ width: 74 }}>시간</span>
        <span style={{ width: 60 }}>레벨</span>
        <span style={{ width: 110 }}>에이전트</span>
        <span style={{ flex: 1 }}>제목 / 메시지</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {alerts.length === 0 && <EmptyState text={isStreaming ? '알림 없음' : '연결 후 사용 가능합니다.'} />}
        {alerts.map((a, i) => {
          const color = alertLevelColor(a.level);
          const label = alertLevelLabel(a.level);
          const time = new Date(a.time).toLocaleTimeString('ko-KR', { hour12: false });
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', padding: '5px 14px', borderBottom: '1px solid #12122a', fontSize: 12, gap: 8, background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
              <span style={{ width: 74, flexShrink: 0, color: '#606080' }}>{time}</span>
              <span style={{ width: 60, flexShrink: 0 }}>
                <span style={{ background: color, color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3, letterSpacing: 0.5 }}>{label}</span>
              </span>
              <span style={{ width: 110, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#9090b0' }}>{a.obj_type}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#d0d0f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</div>
                {a.message && <div style={{ color: '#606080', fontSize: 10, wordBreak: 'break-all', marginTop: 2 }}>{a.message}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#404060', fontSize: 13, letterSpacing: 0.3 }}>
      {text}
    </div>
  );
}

// ─── 상수 ─────────────────────────────────────────────────────

const TAB_LABELS: Record<TabId, string> = { xlog: 'XLog', counter: 'Counter', alert: 'Alert' };

// ─── 스타일 ────────────────────────────────────────────────────

const C = {
  bg0: '#08080f',
  bg1: '#0d0d1a',
  bg2: '#111120',
  bg3: '#161628',
  bg4: '#1e1e38',
  border: '#1e1e3a',
  border2: '#252542',
  accent: '#4f72ff',
  accentDim: 'rgba(79,114,255,0.15)',
  text: '#e8e8ff',
  textMid: '#9090b0',
  textDim: '#505070',
  success: '#3dd68c',
  warn: '#f5a623',
  error: '#ff4d4f',
};

const appStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  background: C.bg0,
  color: C.text,
  fontFamily: "'Inter', 'Segoe UI', monospace, sans-serif",
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  background: C.bg2,
  borderBottom: `1px solid ${C.border}`,
  padding: '0 16px',
  height: 48,
  gap: 12,
  flexShrink: 0,
  boxShadow: '0 1px 0 rgba(79,114,255,0.2)',
};

const logoWrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 1,
  flexShrink: 0,
  marginRight: 4,
};

const logoNStyle: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 20,
  color: C.accent,
  letterSpacing: -1,
  lineHeight: 1,
};

const logoTextStyle: React.CSSProperties = {
  fontWeight: 500,
  fontSize: 15,
  color: C.textMid,
  letterSpacing: 0.5,
};

const serverBadgeStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  background: C.bg4,
  border: `1px solid ${C.border2}`,
  borderRadius: 20,
  padding: '2px 10px',
  fontSize: 11,
  color: C.textMid,
  flexShrink: 0,
};

const serverDotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: C.success,
  boxShadow: `0 0 6px ${C.success}`,
};

const tabNavStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 0,
  marginLeft: 8,
  height: '100%',
};

function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    position: 'relative',
    background: 'none',
    border: 'none',
    color: active ? C.text : C.textDim,
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    padding: '0 18px',
    cursor: 'pointer',
    height: '100%',
    letterSpacing: 0.2,
    transition: 'color 0.15s',
    fontFamily: 'inherit',
  };
}

const tabUnderlineStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 0,
  left: 14,
  right: 14,
  height: 2,
  background: C.accent,
  borderRadius: '2px 2px 0 0',
};

const headerRightStyle: React.CSSProperties = {
  marginLeft: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const logLevelWrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const logLevelLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: C.textDim,
  letterSpacing: 1,
  fontWeight: 600,
};

const settingsBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid transparent',
  borderRadius: 4,
  color: C.textDim,
  fontSize: 16,
  cursor: 'pointer',
  padding: '2px 6px',
  lineHeight: 1,
  transition: 'color 0.15s',
};

const tabBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const xlogWorkspaceStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  position: 'relative',
  overflow: 'hidden',
  background: C.bg0,
};

const counterBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  overflowY: 'auto',
  padding: 12,
};

const tabPageHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '8px 16px',
  fontSize: 11,
  fontWeight: 700,
  color: C.textDim,
  letterSpacing: 1.2,
  textTransform: 'uppercase',
  borderBottom: `1px solid ${C.border}`,
  flexShrink: 0,
  background: C.bg2,
};

// 하단 목록 스타일
const tableWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: C.bg1,
  borderTop: `1px solid ${C.border}`,
};

const tableHeaderBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '5px 14px',
  background: C.bg3,
  borderBottom: `1px solid ${C.border}`,
  flexShrink: 0,
};

const tableHeaderTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: C.textMid,
  letterSpacing: 0.3,
  display: 'flex',
  alignItems: 'center',
  gap: 7,
};

const tableCountBadgeStyle: React.CSSProperties = {
  background: C.accentDim,
  color: C.accent,
  fontSize: 10,
  fontWeight: 700,
  padding: '1px 6px',
  borderRadius: 10,
};

const colHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '3px 14px',
  fontSize: 10,
  color: C.textDim,
  letterSpacing: 0.5,
  fontWeight: 600,
  textTransform: 'uppercase',
  background: C.bg2,
  borderBottom: `1px solid ${C.border}`,
  gap: 8,
  flexShrink: 0,
};

const tableBodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
};

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: C.textDim,
  cursor: 'pointer',
  fontSize: 13,
  padding: '2px 4px',
  lineHeight: 1,
  borderRadius: 3,
};

function tableRowStyle(hasErr: boolean, isActive: boolean, idx: number): React.CSSProperties {
  let bg = idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)';
  if (isActive) bg = C.accentDim;
  if (hasErr && !isActive) bg = 'rgba(255,77,79,0.05)';
  return {
    display: 'flex',
    alignItems: 'center',
    padding: '3px 14px',
    fontSize: 12,
    gap: 8,
    borderBottom: `1px solid ${C.border}`,
    borderLeft: isActive ? `2px solid ${C.accent}` : hasErr ? '2px solid rgba(255,77,79,0.4)' : '2px solid transparent',
    background: bg,
    cursor: 'pointer',
  };
}
