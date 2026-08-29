// src/App.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pane } from './components/Pane';
import { Divider } from './components/Divider';
import { clampPane, isMeasured, sideRoom, tableRoom, PANE } from './components/paneSizing';
import { ConnectionDialog } from './features/xlog/components/ConnectionDialog';
import { SettingsDialog } from './features/settings/SettingsDialog';
import { LogLevelSelector } from './features/xlog/components/LogLevelSelector';
import { XLogChart } from './features/xlog/components/XLogChart';
import { XLogToolbar } from './features/xlog/components/XLogToolbar';
import { AgentSelectorPanel } from './features/xlog/components/AgentSelectorPanel';
import { CounterChart } from './features/xlog/components/CounterChart';
import { XLogDetailPanel } from './features/xlog/components/XLogDetailPanel';
import { ActiveServicePanel } from './features/xlog/components/ActiveServicePanel';
import { SummaryPanel } from './features/xlog/components/SummaryPanel';
import { TopologyPanel } from './features/xlog/components/TopologyPanel';
import { FiveMinCounterChart } from './features/xlog/components/FiveMinCounterChart';
import { ServiceGroupPanel } from './features/xlog/components/ServiceGroupPanel';
import { XLogSearchBar } from './features/xlog/components/XLogSearchBar';
import { WideSearchDialog, type WideSearchValues } from './features/xlog/components/WideSearchDialog';
import { useProfileSearch } from './features/xlog/hooks/useProfileSearch';
import { toDateString } from './features/xlog/utils/xlogDate';
import type { ProfileHit } from './features/xlog/api/scouterApi';
import { durationTone } from './features/xlog/components/durationTone';
// ko-KR 로케일은 "4시 36분 18초" 를 낸다 — 폭을 먹고 줄바꿈되며 차트 X축(04:36:18)과도 어긋난다.
import { formatTime } from './features/xlog/utils/colorPalette';
import { AlertPanel } from './features/xlog/components/AlertPanel';
import {
  onConnected,
  onDisconnected,
  getObjectList,
  getXLogDetail,
  startCounterStream,
  startAlertStream,
  getConfig,
  saveUiState,
  searchXLogList,
} from './features/xlog/api/scouterApi';
import { subscribe } from './features/xlog/api/subscribe';
import { alertWatchMessage } from './features/xlog/utils/alertWatch';
import { useAlertStream } from './features/xlog/hooks/useAlertStream';
import { useXLogDetailTabs } from './features/xlog/hooks/useXLogDetailTabs';
import { DetailTabBar } from './features/xlog/components/DetailTabBar';
import { useShortcuts } from './features/xlog/hooks/useShortcuts';
import { toLayout, fromLayout, toChartConfig, fromChartConfig } from './features/xlog/hooks/uiState';
import type { GroupBy } from './features/xlog/components/agentTree';
import { useTextResolver } from './features/xlog/hooks/useTextResolver';
import type { AgentObject, SXLog, XLogChartConfig, XLogFilterState } from './features/xlog/types/xlog';
import { DEFAULT_CHART_CONFIG, DEFAULT_FILTER, xlogPackToSXLog } from './features/xlog/types/xlog';
import type { PastRange, XLogMode } from './features/xlog/types/timeRange';
import type { AlertPack } from './features/xlog/types/alert';
import { alertLevelColor, alertLevelLabel } from './features/xlog/types/alert';
import type { CounterName } from './features/xlog/types/counter';
import {
  isJavaeeObjectType,
  isHostObjectType,
  isDatasourceObjectType,
  HOST_CHART_COUNTERS,
  HOST_FIVE_MIN_COUNTERS,
  HOST_UNCOLLECTED_COUNTERS,
  JAVAEE_UNCOLLECTED_COUNTERS,
  DATASOURCE_CHART_COUNTERS,
  counterMeta,
  isTotalCapable,
} from './features/xlog/types/counter';
import { T, F, FONT_UI } from './styles/tokens';
import { t, useT } from './i18n';
import { useViewOptions } from './features/xlog/hooks/useViewOptions';

/** 기존 지역 팔레트 `C` 를 토큰으로 대체. 값은 styles/tokens.css 하나에만 있다. */
const C = {
  bg0: T.bgBase, bg1: T.bgSurface, bg2: T.bgRaised, bg3: T.bgOverlay, bg4: T.bgHover,
  border: T.border, border2: T.borderStrong,
  accent: T.accent, accentDim: T.accentSoft,
  text: T.text, textMid: T.textMuted, textDim: T.textFaint,
  success: T.success, warn: T.warn, error: T.error,
};

type TabId = 'xlog' | 'counter' | 'alert';

/** 열린 탭이 하나도 없을 때 상세 패널에 줄 빈 상태 */
const EMPTY_DETAIL = {
  isLoading: false,
  error: null,
  profile: null,
  texts: {},
  xlog: null,
} as const;

/**
 * 애플리케이션 카운터 — counters.xml 의 javaee Family 19개 전부.
 *
 * MULTI 요청이라 개수가 늘어도 TCP 연결은 2초당 1회로 같다.
 * 순서는 중요도 순(자주 보는 것부터).
 */
const JAVAEE_CHARTS: CounterName[] = [
  'TPS', 'ElapsedTime', 'ActiveService', 'RecentUser',
  'ErrorRate', 'HeapUsed', 'HeapTotal', 'GcCount', 'GcTime',
  'SqlTimeByService', 'ApiTimeByService', 'Elapsed90%', 'QueuingTime',
  'ServiceCount', 'HeapTotUsage', 'PermUsed', 'PermPercent', 'FdUsage',
];

/**
 * 요청 1회에 두 Family 를 섞어 보낸다.
 *
 * 콜렉터가 objHash × counter 를 훑으며 **맞는 조합만** 담아 준다 —
 * host 오브젝트에 javaee 카운터가 붙어 오지 않는다
 * (live_collector.rs::live_counter_multi_mixed_families 로 실측).
 * 그래서 Family 별로 스트림을 나눌 필요가 없다.
 */
/** 애플리케이션 구역 각주에 쓸 표시명 목록 */
const JAVAEE_UNCOLLECTED_LABEL = JAVAEE_UNCOLLECTED_COUNTERS.map(c => counterMeta(c).disp).join(' · ');

const ALL_CHART_COUNTERS: CounterName[] = [
  ...JAVAEE_CHARTS,
  ...HOST_CHART_COUNTERS,
  ...DATASOURCE_CHART_COUNTERS,
];

export default function App() {
  // 언어가 바뀌면 화면 전체를 다시 그린다. t() 는 모듈 함수라 **구독하지 않으면**
  // 설정에서 언어를 바꿔도 이미 그려진 글자가 그대로 남는다.
  const { lang } = useT();
  // **여기서 한 번은 불러야 한다.** 표시 설정(언어·글자 크기)은 이걸 처음 쓰는
  // 컴포넌트가 마운트될 때 config.json 을 읽는데, 그게 상세 패널이라
  // 앱을 켜고 아무것도 안 열면 저장해 둔 설정이 적용되지 않았다.
  useViewOptions();
  const [activeTab, setActiveTab] = useState<TabId>('xlog');
  const [isConnected, setIsConnected] = useState(false);
  const [serverId, setServerId] = useState('');
  const [config, setConfig] = useState<XLogChartConfig>(DEFAULT_CHART_CONFIG);
  const [filter, setFilter] = useState<XLogFilterState>(DEFAULT_FILTER);
  const [selectedXLogs, setSelectedXLogs] = useState<SXLog[]>([]);
  /** 목록의 ✕ 가 캔버스의 선택 사각형까지 지우도록 보내는 신호 */
  const [clearSignal, setClearSignal] = useState(0);
  /** 실시간 / 과거. 과거면 pastRange 가 실제 조회 구간이다 */
  const [xlogMode, setXLogMode] = useState<XLogMode>('live');
  const [pastRange, setPastRange] = useState<PastRange | null>(null);
  const [agentMap, setAgentMap] = useState<Map<number, string>>(new Map());
  /** 카운터 요청 대상. Family 별로 나눠 둔다 — 화면도 Family 로 나눈다 */
  const [counterHashes, setCounterHashes] = useState<{
    javaee: number[];
    host: number[];
    /** 커넥션 풀. 부모와 별개 오브젝트라 따로 센다 (F-41) */
    datasource: number[];
  }>({ javaee: [], host: [], datasource: [] });
  /**
   * javaee 오브젝트의 objType (`tomcat` 등).
   *
   * 액티브 서비스·오늘 누적은 objHash 가 아니라 **objType** 이 기준이라
   * 해시 목록으로는 요청할 수 없다.
   */
  const [javaeeType, setJavaeeType] = useState('');
  /**
   * 호스트 오브젝트의 objType (`linux` 등).
   *
   * 5분 집계 카운터도 objType 기준이라 해시로는 요청할 수 없다.
   * javaee 와 값이 다르므로 하나로 합칠 수 없다 — Family 가 갈린다 (F-15).
   */
  const [hostType, setHostType] = useState('');

  // **알림은 앱이 하나만 쥔다.** 배지와 Alert 탭이 각자 모으면, 다른 탭을 보는 동안
  // 온 알림이 탭에는 없어서 배지에 2가 떠도 목록은 비어 있다 (실제로 겪었다).
  const alertStream = useAlertStream(isConnected);

  // 상세는 **여러 개** 열어 둘 수 있다. 느린 트랜잭션은 정상인 것과 나란히 놓고 봐야 안다.
  const detail = useXLogDetailTabs();
  const detailState = detail.active ?? EMPTY_DETAIL;
  const clearDetail = detail.closeAll;
  const { getCached, resolve } = useTextResolver();
  // resolve 는 전역 캐시만 갱신하므로 목록을 다시 그리려면 별도 신호가 필요하다.
  const [textVersion, setTextVersion] = useState(0);

  // 경계를 끌 때의 한계를 계산하려면 워크스페이스 크기가 필요하다.
  // **배치에는 쓰지 않는다** — 배치는 flex 가 하므로 이 값이 틀려도 넘치지 않는다.
  const xlogWsRef = useRef<HTMLDivElement>(null);
  const [wsSize, setWsSize] = useState({ w: 0, h: 0 });

  // 사용자가 끌어 정한 패널 크기
  const [servicesW, setServicesW] = useState<number>(PANE.servicesDefaultW);
  const [detailW, setDetailW] = useState<number>(PANE.detailDefaultW);
  const [tableH, setTableH] = useState<number>(PANE.tableDefaultH);
  /** 서비스 목록을 무엇으로 묶는가. 껐다 켜도 남는다 */
  const [agentGroupBy, setAgentGroupBy] = useState<GroupBy>('type');

  /**
   * 저장해 둔 배치·차트 설정을 한 번 읽어 온다.
   *
   * **다 읽기 전에는 저장하지 않는다.** 켜자마자 화면의 기본값이 파일을 덮으면
   * 어제 맞춰 둔 것이 사라진다 — 그러고 나면 되돌릴 방법이 없다.
   */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getConfig()
      .then(cfg => {
        if (cancelled) return;
        const l = toLayout(cfg.ui_layout);
        setServicesW(l.servicesW);
        setDetailW(l.detailW);
        setTableH(l.tableH);
        setActiveTab(l.activeTab);
        setAgentGroupBy(l.agentGroupBy);
        setConfig(toChartConfig(cfg.xlog_chart));
      })
      // 못 읽어도 기본값으로 뜬다. 다만 그 기본값으로 파일을 덮지는 않는다 —
      // 읽기가 실패한 이유가 «잠깐 못 읽었다» 일 수도 있다.
      .catch(() => {})
      .finally(() => { if (!cancelled) setHydrated(true); });
    return () => { cancelled = true; };
  }, []);

  /**
   * 바뀐 것을 파일에 남긴다.
   *
   * **끄는 순간이 아니라 바뀔 때마다** 남긴다 — 앱이 죽으면 «끌 때» 는 오지 않는다.
   * 다만 패널을 끄는 동안 마우스가 움직일 때마다 쓰면 안 되므로 잠깐 모아서 쓴다.
   */
  useEffect(() => {
    if (!hydrated) return;
    const id = setTimeout(() => {
      saveUiState(
        fromLayout({ servicesW, detailW, tableH, activeTab, agentGroupBy }),
        fromChartConfig(config),
      ).catch(() => {});
    }, 600);
    return () => clearTimeout(id);
  }, [hydrated, servicesW, detailW, tableH, activeTab, agentGroupBy, config]);

  useEffect(() => {
    const el = xlogWsRef.current;
    if (!el) return;
    const apply = (w: number, h: number) => {
      const nw = Math.round(w);
      const nh = Math.round(h);
      setWsSize(prev => (prev.w === nw && prev.h === nh ? prev : { w: nw, h: nh }));
    };
    apply(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      apply(width, height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    return subscribe(
      onConnected(id => { setIsConnected(true); setServerId(id); }),
      onDisconnected(() => {
        setIsConnected(false); setServerId('');
        setSelectedXLogs([]); setAgentMap(new Map());
        setCounterHashes({ javaee: [], host: [], datasource: [] });
        setJavaeeType(''); setHostType(''); clearDetail();
      }),
    );
  }, [clearDetail]);

  // 카운터는 objHash 목록이 필요하다.
  // AgentSelectorPanel 은 XLog 탭에서만 마운트되므로 그쪽에 의존하면
  // 다른 탭으로 접속했을 때 카운터가 영영 시작되지 않는다. 여기서 직접 조회한다.
  useEffect(() => {
    if (!isConnected) { setCounterHashes({ javaee: [], host: [], datasource: [] }); return; }
    let cancelled = false;
    getObjectList()
      .then(list => {
        if (cancelled) return;
        // Family 를 나눠 둔다. 요청은 합쳐 보내도 되지만(실측 확인),
        // **화면은 나눠야 한다** — CPU 와 TPS 를 같은 줄에 놓으면 읽히지 않는다.
        const javaee = list.filter(a => isJavaeeObjectType(a.obj_type));
        const host = list.filter(a => isHostObjectType(a.obj_type));
        setCounterHashes({
          javaee: javaee.map(a => a.obj_hash),
          host: host.map(a => a.obj_hash),
          datasource: list.filter(a => isDatasourceObjectType(a.obj_type)).map(a => a.obj_hash),
        });
        // 타입이 섞여 있으면 첫 번째만 쓴다. 실환경에서 javaee 타입이 여럿인 경우는 드물다.
        setJavaeeType(javaee[0]?.obj_type ?? '');
        setHostType(host[0]?.obj_type ?? '');
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isConnected]);

  useEffect(() => {
    if (!isConnected) return;
    const hashes = [...counterHashes.javaee, ...counterHashes.host, ...counterHashes.datasource];
    if (hashes.length === 0) return;
    startCounterStream(hashes, ALL_CHART_COUNTERS).catch(() => {});
  }, [isConnected, counterHashes]);

  useEffect(() => {
    if (!isConnected) return;
    startAlertStream().catch(() => {});
  }, [isConnected]);

  const handleConfigChange = useCallback((p: Partial<XLogChartConfig>) => setConfig(prev => ({ ...prev, ...p })), []);
  const handleFilterChange = useCallback((p: Partial<XLogFilterState>) => setFilter(prev => ({ ...prev, ...p })), []);
  const handleConnected = useCallback((_sid: string, _hashes: number[]) => {}, []);
  const handleDisconnected = useCallback(() => {}, []);
  const handleAgentSelectionChange = useCallback((hashes: Set<number>) => {
    setFilter(prev => ({ ...prev, objHashSet: hashes }));
  }, []);
  // 구간을 바꾸면 이전 구간에서 고른 트랜잭션은 의미가 없다. 같이 비운다.
  const handlePastRangeChange = useCallback((r: PastRange | null) => {
    setPastRange(r);
    setSelectedXLogs([]);
    setClearSignal(n => n + 1);
    clearDetail();
  }, [clearDetail]);
  const handleAgentsLoaded = useCallback((agents: AgentObject[]) => {
    setAgentMap(new Map(agents.map(a => [a.obj_hash, a.obj_name])));
  }, []);
  // 분할 배치라 패널이 겹치지 않는다 — z 순서를 조정할 일이 없다.
  const openDetail = detail.open;

  /**
   * txid 만 알고 있을 때 그 트랜잭션을 연다 (프로파일의 스레드 링크).
   *
   * 상세 패널은 SXLog 를 필요로 하므로 먼저 XLog 를 찾아온다.
   * 스레드 트랜잭션도 XLog 를 남기므로 조회된다.
   */
  // **`detail` 전체를 의존성에 넣으면 안 된다.** 훅이 매 렌더 새 객체를 돌려주므로
  // 이 콜백이 계속 새로 만들어지고, memo 로 막아 둔 상세 패널이 매번 다시 그려진다.
  // 안정적인 `open` 하나만 잡는다.
  const openDetailTab = detail.open;
  const openByTxid = useCallback((txid: string, date: string) => {
    getXLogDetail(txid, date)
      .then(pack => openDetailTab(xlogPackToSXLog(pack)))
      .catch(() => {});
  }, [openDetailTab]);

  /**
   * 요약 화면에서 트랜잭션을 연다.
   *
   * **상세 패널은 XLog 탭에 있다.** 카운터 탭에 머물면 열어 놓고도 아무것도 안 보이므로
   * 탭까지 옮겨 준다.
   */
  const openSummaryTxid = useCallback((txid: string, date: string) => {
    setActiveTab('xlog');
    openByTxid(txid, date);
  }, [openByTxid]);

  // 목록의 서비스 컬럼은 getCached 만 쓰므로 누가 채워주지 않으면 해시가 그대로 남는다.
  useEffect(() => {
    if (selectedXLogs.length === 0) return;
    const svc = [...new Set(selectedXLogs.map(x => x.service).filter(Boolean))];
    if (svc.length === 0) return;
    let cancelled = false;
    resolve('service', svc)
      .then(() => { if (!cancelled) setTextVersion(v => v + 1); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedXLogs, resolve]);

  /**
   * 프로파일 본문 검색.
   *
   * **드래그로 고른 구간만 훑는다** — 트랜잭션 한 건이 요청 하나라 범위가 곧 비용이다.
   */
  const search = useProfileSearch();

  const runProfileSearch = search.run;
  const runSearch = useCallback(
    (query: string) => {
      void runProfileSearch(
        selectedXLogs.map(x => ({
          txid: x.txid,
          obj_hash: x.objHash,
          date: toDateString(x.endTime),
        })),
        query,
      );
    },
    [runProfileSearch, selectedXLogs],
  );

  /**
   * txid → 적중. **검색 전에는 null 이다** — 빈 Map(찾았는데 없음)과 구별해야
   * 목록이 "결과 없음"과 "아직 안 찾음"을 다르게 말할 수 있다.
   */
  const searchHits = useMemo(() => {
    if (search.state.query === '' || search.state.progress === null) return null;
    return new Map(search.state.hits.map(h => [h.txid, h]));
  }, [search.state.query, search.state.progress, search.state.hits]);

  /**
   * **`search` 전체를 의존성에 넣으면 안 된다.** 훅이 매 렌더 새 객체를 돌려주므로
   * 이 콜백이 계속 새로 만들어지고, 그걸 보고 있는 XLogChart 의 선택 이펙트가
   * 매번 다시 돌아 `reset()` 을 부른다 — 검색이 첫 묶음만 돌고 스스로 취소됐다.
   * 안정적인 `reset` 하나만 잡는다.
   */
  const resetSearch = search.reset;
  const handleXLogSelect = useCallback((xlogs: SXLog[]) => {
    setSelectedXLogs(xlogs);
    // 차트에서 새로 고른 것은 검색 결과가 아니다. 경고가 남아 있으면 거짓말이 된다.
    setWideTruncated(null);
    // 다른 구간을 고르면 이전 검색 결과는 그 구간의 것이 아니다. 남겨 두면
    // 목록이 엉뚱한 트랜잭션만 걸러 보여준다.
    resetSearch();
    if (xlogs.length === 1) openDetail(xlogs[0]);
  }, [openDetail, resetSearch]);
  const handleRowClick = useCallback((xlog: SXLog) => { openDetail(xlog); }, [openDetail]);
  // 목록만 지우면 캔버스에 선택 사각형이 남는다. 둘 다 지운다.
  const handleClearSelection = useCallback(() => {
    setSelectedXLogs([]);
    setClearSignal(n => n + 1);
    setWideTruncated(null);
  }, []);
  const handleAlertBadgeClick = useCallback(() => setActiveTab('alert'), []);

  /**
   * 넓은 구간에서 찾기 (SEARCH_XLOG_LIST).
   *
   * 결과는 **기존 트랜잭션 목록으로 흘려보낸다** — 그래야 행을 눌러 상세를 열고
   * 프로파일 검색을 거는 지금 흐름이 그대로 쓰인다. 새 목록을 따로 만들면
   * 같은 기능을 두 벌 갖게 된다.
   */
  const [showWideSearch, setShowWideSearch] = useState(false);
  const [wideRunning, setWideRunning] = useState(false);
  /** 상한에 닿았다 — 더 있었을 수 있다. null 이면 검색 결과가 아니다 */
  const [wideTruncated, setWideTruncated] = useState<{ max: number; known: boolean } | null>(null);

  const runWideSearch = useCallback(
    (v: WideSearchValues) => {
      setWideRunning(true);
      searchXLogList(v)
        .then(res => {
          setShowWideSearch(false);
          setSelectedXLogs(res.xlogs.map(xlogPackToSXLog));
          // 검색 결과는 차트에서 고른 구간이 아니다. 사각형을 남겨 두면
          // 목록이 그 구간의 것인 줄 알게 된다.
          setClearSignal(n => n + 1);
          resetSearch();
          setWideTruncated(res.truncated ? { max: res.max, known: res.max_known } : null);
        })
        .catch(() => {})
        .finally(() => setWideRunning(false));
    },
    [resetSearch],
  );

  const [showSettings, setShowSettings] = useState(false);

  /** Ctrl+F 로 옮겨 갈 자리 */
  const searchInputRef = useRef<HTMLInputElement>(null);
  /** F5 — 값이 바뀌면 차트가 같은 구간을 다시 받는다 */
  const [refreshSignal, setRefreshSignal] = useState(0);

  useShortcuts({
    // Esc 는 **지금 보는 탭 하나만** 닫는다. 전부 닫으면 되돌릴 방법이 없다.
    'close-detail': detail.closeActive,
    'close-detail-tab': detail.closeActive,
    'cycle-detail-next': () => detail.cycle(1),
    'cycle-detail-prev': () => detail.cycle(-1),
    'focus-search': () => {
      // 검색은 XLog 탭에만 있다. 다른 탭에서 눌렀으면 데려온다.
      setActiveTab('xlog');
      // 탭이 바뀐 뒤에 그려지므로 한 틱 넘긴다.
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    },
    'tab-xlog': () => setActiveTab('xlog'),
    'tab-counter': () => setActiveTab('counter'),
    'tab-alert': () => setActiveTab('alert'),
    'open-settings': () => setShowSettings(true),
    'toggle-mode': () => setXLogMode(m => (m === 'live' ? 'past' : 'live')),
    // 실시간은 계속 흘러오므로 다시 받을 것이 없다. 과거 구간에서만 뜻이 있다.
    reload: () => setRefreshSignal(n => n + 1),
  });

  const isStreaming = isConnected;
  const hasDetail = detail.tabs.length > 0;
  const hasSelected = selectedXLogs.length > 0;

  return (
    // key 로 갈아끼우는 이유: memo 로 막아 둔 자식(차트 등)까지 확실히 새 언어로 그린다.
    // 언어 바꾸기는 드문 일이라 이 정도 비용은 값이 싸다.
    <div style={appStyle} key={lang}>
      {/* ── 헤더 ── */}
      {/* 헤더 3구역: 정체(로고+서버) | 탐색(탭) | 상태·설정
          이전에는 9개 요소가 같은 무게로 나열돼 눈이 갈 곳을 못 정했다. */}
      <header className="flex shrink-0 items-center gap-4 border-b border-line bg-overlay px-3 py-1.5">
        {/* 정체 */}
        <div className="flex items-center gap-2">
          <span className="text-title leading-none font-semibold tracking-tight text-accent">N</span>
          <span className="text-body leading-none font-medium tracking-tight text-fg">scouter</span>
          {serverId && (
            <span className="flex items-center gap-1.5 text-micro text-fg-muted">
              <span
                className={`size-1.5 rounded-full ${isConnected ? 'bg-ok' : 'bg-fg-faint'}`}
                aria-hidden
              />
              {/* 데모 서버 이름은 백엔드가 준 한국어 문구다. 진짜 서버 이름은 사전에 없어
                  그대로 나온다 — t() 를 통과시켜도 안전하다. */}
              {t(serverId)}
            </span>
          )}
        </div>

        {/* 탐색 — 유일하게 밝은 요소여야 현재 위치가 읽힌다 */}
        <nav className="flex items-center gap-0.5" aria-label={t('화면 전환')}>
          {(['xlog', 'counter', 'alert'] as TabId[]).map(tab => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                aria-current={active ? 'page' : undefined}
                className={`rounded px-2.5 py-1 text-body transition-colors ${
                  active ? 'bg-hover text-fg' : 'text-fg-dim hover:text-fg-muted'
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* 상태·설정 — 평소엔 조용히 물러나 있어야 한다 */}
        <div className="flex items-center gap-2">
          <ConnectionDialog
            isConnected={isConnected}
            onConnected={handleConnected}
            onDisconnected={handleDisconnected}
          />
          <AlertPanel
            alerts={alertStream.alerts}
            unread={alertStream.unread}
            onClear={alertStream.clear}
            onMarkRead={alertStream.markRead}
            onBadgeClick={handleAlertBadgeClick}
          />
          <LogLevelSelector />
          <button
            onClick={() => setShowSettings(true)}
            title={t('설정')}
            aria-label={t('설정')}
            className="rounded px-1.5 py-1 text-fg-dim hover:text-fg"
          >
            ⚙
          </button>
        </div>
      </header>



      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showWideSearch && (
        <WideSearchDialog
          agents={[...agentMap].map(([obj_hash, obj_name]) => ({ obj_hash, obj_name }) as AgentObject)}
          running={wideRunning}
          onSearch={runWideSearch}
          onClose={() => setShowWideSearch(false)}
        />
      )}

      {/* ── XLog 탭 ── */}
      {activeTab === 'xlog' && (
        <div style={tabBodyStyle}>
          <XLogToolbar
            config={config}
            filter={filter}
            onConfigChange={handleConfigChange}
            onFilterChange={handleFilterChange}
            mode={xlogMode}
            onModeChange={setXLogMode}
            pastRange={pastRange}
            onPastRangeChange={handlePastRangeChange}
            onWideSearch={() => setShowWideSearch(true)}
          />
          {/* 분할 배치.
              이전에는 워크스페이스를 재서 패널을 절대 좌표로 놓았다. 측정값이 실제
              가용 공간과 어긋나면 패널 아래가 창 밖으로 나가 **하단 목록이 잘렸다.**
              flex 로 두면 넘칠 수가 없고, 경계를 끌어 크기를 바꿀 수 있다.
              wsSize 는 이제 배치가 아니라 **끌기 한계 계산에만** 쓴다. */}
          <div ref={xlogWsRef} className="flex min-h-0 flex-1 overflow-hidden bg-base p-1">
            <Pane title="Services" className="shrink-0" style={{ width: servicesW }}>
              <AgentSelectorPanel
                isConnected={isConnected}
                selectedHashes={filter.objHashSet}
                onSelectionChange={handleAgentSelectionChange}
                onAgentsLoaded={handleAgentsLoaded}
                groupBy={agentGroupBy}
                onGroupByChange={setAgentGroupBy}
              />
            </Pane>

            <Divider
              orientation="vertical"
              label={t('서비스 목록 너비')}
              onDrag={d =>
                setServicesW(w =>
                  isMeasured(wsSize)
                    ? clampPane(
                        w + d,
                        PANE.servicesMin,
                        sideRoom(wsSize.w, hasDetail ? detailW : 0, hasDetail ? 2 : 1),
                      )
                    : w,
                )
              }
            />

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <Pane title="XLog" className="min-h-0 flex-1">
                <div className="h-full p-2">
                  <XLogChart
                    config={config}
                    filter={filter}
                    onSelect={handleXLogSelect}
                    connected={isConnected}
                    clearSignal={clearSignal}
                    pastRange={pastRange}
                    refreshSignal={refreshSignal}
                    pastObjHashes={counterHashes.javaee}
                    onPastRangeChange={setPastRange}
                  />
                </div>
              </Pane>

              {/* 목록은 **항상 자리를 지킨다.**
                  선택했을 때만 나타나게 하면 기본 화면에 아예 없어서 기능이 있는 줄도 모르고,
                  선택할 때마다 차트 높이가 튄다. 비어 있을 때는 비어 있다고 말한다. */}
              <Divider
                orientation="horizontal"
                label={t('트랜잭션 목록 높이')}
                onDrag={d =>
                  setTableH(h =>
                    isMeasured(wsSize) ? clampPane(h - d, PANE.tableMinH, tableRoom(wsSize.h)) : h,
                  )
                }
              />
              <Pane
                title={t('트랜잭션')}
                className="shrink-0"
                style={{ height: tableH }}
                aside={
                  hasSelected ? (
                    <span className="flex items-center gap-2">
                      <span className="text-micro normal-case text-fg-dim">
                        <span className="tnum font-mono text-fg-muted">
                          {selectedXLogs.length}
                        </span>
                        {t('건')}
                        {selectedXLogs.length > XLOG_TABLE_LIMIT && (
                          <span className="text-fg-faint"> · {t('느린 순')} {XLOG_TABLE_LIMIT}{t('건')}</span>
                        )}
                      </span>
                      {/* **서버는 잘렸다는 신호를 주지 않는다.** 여기서 말하지 않으면
                          없는 트랜잭션을 없다고 믿게 된다 (F-54). */}
                      {wideTruncated && (
                        <span
                          className="rounded border border-warn/50 px-1 text-micro normal-case text-warn"
                          title={
                            wideTruncated.known
                              ? t('서버 상한에 닿았습니다. 조건을 좁히거나 구간을 나눠 다시 찾으십시오.')
                              : t('서버 상한에 닿은 것으로 보입니다. 상한이 설정에 안 적혀 있어 기본값으로 판단했습니다.')
                          }
                        >
                          {t('상한')} {wideTruncated.max.toLocaleString()}
                          {t('건에서 잘렸을 수 있습니다')}
                        </span>
                      )}
                      <button
                        onClick={handleClearSelection}
                        title={t('선택 해제')}
                        aria-label={t('선택 해제')}
                        className="rounded px-1 text-micro text-fg-faint hover:text-fg"
                      >
                        ✕
                      </button>
                    </span>
                  ) : null
                }
              >
                <div className="flex h-full flex-col">
                  <XLogSearchBar
                    inputRef={searchInputRef}
                    targetCount={selectedXLogs.length}
                    state={search.state}
                    onRun={runSearch}
                    onCancel={search.cancel}
                    onClear={search.reset}
                  />
                  <div className="min-h-0 flex-1">
                    <XLogTable
                      xlogs={selectedXLogs}
                      searchHits={searchHits}
                      agentMap={agentMap}
                      activeXlog={detailState.xlog ?? null}
                      getCached={getCached}
                      textVersion={textVersion}
                      onRowClick={handleRowClick}
                    />
                  </div>
                </div>
              </Pane>
            </div>

            {hasDetail && (
              <>
                <Divider
                  orientation="vertical"
                  label={t('상세 패널 너비')}
                  onDrag={d =>
                    setDetailW(w =>
                      isMeasured(wsSize)
                        ? clampPane(w - d, PANE.detailMin, sideRoom(wsSize.w, servicesW, 2))
                        : w,
                    )
                  }
                />
                <Pane title="XLog Detail" className="shrink-0" style={{ width: detailW }}>
                  {/* 탭이 하나뿐이면 머리를 두지 않는다 — 고를 것이 없는 탭 줄은 자리만 먹는다 */}
                  {detail.tabs.length > 1 && (
                    <DetailTabBar
                      tabs={detail.tabs}
                      activeKey={detail.activeKey}
                      onSelect={detail.activate}
                      onClose={detail.close}
                      onCloseAll={detail.closeAll}
                    />
                  )}
                  <XLogDetailPanel
                    key={detail.activeKey ?? ''}
                    state={detailState}
                    onClose={detail.closeActive}
                    agentMap={agentMap}
                    onSelectTrace={detail.open}
                    onOpenTxid={openByTxid}
                    searchQuery={search.state.query}
                  />
                </Pane>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Counter 탭 ── */}
      {activeTab === 'counter' && (
        <div style={tabBodyStyle}>
          {isConnected ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {/* 추세(카운터 차트)보다 **지금**이 먼저다. 장애 중이면 여기부터 본다. */}
              <ActiveServicePanel
                objType={javaeeType}
                enabled={activeTab === 'counter' && javaeeType !== ''}
                agentMap={agentMap}
              />
              <SummaryPanel
                objType={javaeeType}
                enabled={activeTab === 'counter' && javaeeType !== ''}
                onOpenTxid={openSummaryTxid}
              />
              <TopologyPanel
                objType={javaeeType}
                agentMap={agentMap}
                enabled={activeTab === 'counter' && javaeeType !== ''}
              />
              {/* 카운터가 "서버가 견디는가"라면 이건 "무엇이 들어오는가"다.
                  objType 이 아니라 objHash 목록으로 묻는다 (F-44). */}
              <ServiceGroupPanel
                objHashes={counterHashes.javaee}
                enabled={activeTab === 'counter' && counterHashes.javaee.length > 0}
              />

              {/* Family 를 섞으면 CPU 와 TPS 가 같은 줄에 놓여 읽히지 않는다.
                  요청은 한 번에 보내지만(실측 확인) 화면은 나눈다. */}
              <CounterSection
                title={t('애플리케이션')}
                subtitle={`${counterHashes.javaee.length}${t('개 오브젝트')} · javaee`}
                counters={JAVAEE_CHARTS}
                isStreaming={isStreaming}
                agentMap={agentMap}
                empty={counterHashes.javaee.length === 0 ? t('자바 에이전트가 없습니다.') : null}
                // 없는 것을 없다고 적어 두지 않으면 볼 때마다 같은 조사를 다시 하게 된다.
                footnote={`${JAVAEE_UNCOLLECTED_LABEL}${t(' 는 에이전트 2.21.3 에 수집 코드가 없어 받을 수 없습니다.')}`}
              />
              <CounterSection
                title={t('호스트')}
                subtitle={`${counterHashes.host.length}${t('개 오브젝트')} · host`}
                counters={HOST_CHART_COUNTERS}
                isStreaming={isStreaming}
                agentMap={agentMap}
                empty={
                  counterHashes.host.length === 0
                    ? t('호스트 에이전트가 없습니다. scouter.host 를 콜렉터에 붙이면 CPU·메모리·네트워크가 표시됩니다.')
                    : null
                }
              />
              {/* 실시간 팩에 없는 카운터는 여기서만 보인다 (F-42).
                  같은 "호스트" 안에 섞으면 갱신 주기가 2초와 5분으로 섞여 오해를 부른다. */}
              <FiveMinSection
                objType={hostType}
                enabled={activeTab === 'counter' && hostType !== ''}
                agentMap={agentMap}
              />
              <CounterSection
                title={t('커넥션 풀')}
                subtitle={`${counterHashes.datasource.length}${t('개 풀')} · datasource`}
                counters={DATASOURCE_CHART_COUNTERS}
                isStreaming={isStreaming}
                agentMap={agentMap}
                empty={
                  counterHashes.datasource.length === 0
                    ? // 두 관문이 모두 닫혀 있으면 0건이다. 어느 쪽인지 말해 주지 않으면 고장으로 읽힌다 (F-41).
                      t('커넥션 풀이 수집되지 않았습니다. 앱의 spring.datasource.hikari.register-mbeans 와 에이전트의 jmx_counter_enabled 를 모두 켜야 합니다.')
                    : null
                }
              />
            </div>
          ) : (
            <EmptyState text={t('연결 후 사용 가능합니다.')} />
          )}
        </div>
      )}

      {/* ── Alert 탭 ── */}
      {activeTab === 'alert' && (
        <div style={tabBodyStyle}>
          <AlertFullView
            alerts={alertStream.alerts}
            since={alertStream.since}
            connected={isStreaming}
            onClear={alertStream.clear}
          />
        </div>
      )}
    </div>
  );
}

// ─── Counter 탭 구역 ──────────────────────────────────────────

/**
 * 실시간에는 오지 않는 host 카운터 구역.
 *
 * 에이전트가 REALTIME 팩과 FIVE_MIN 팩에 **서로 다른 카운터 목록**을 담기 때문에
 * 이 둘은 스트림으로는 영원히 안 온다 (F-42). 5분 집계로 따로 묻는다.
 */
function FiveMinSection({
  objType,
  enabled,
  agentMap,
}: {
  objType: string;
  enabled: boolean;
  agentMap: Map<number, string>;
}) {
  if (!enabled) return null;

  return (
    <section className="mb-4">
      <header className="mb-2 flex items-baseline gap-2 border-b border-line pb-1">
        <h2 className="text-body font-medium text-fg">{t('호스트 · 5분 집계')}</h2>
        <span className="text-micro text-fg-faint">{objType} · {t('실시간 팩에 없는 카운터')}</span>
      </header>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
        {HOST_FIVE_MIN_COUNTERS.map(c => (
          <FiveMinCounterChart
            key={c}
            counter={c}
            objType={objType}
            enabled={enabled}
            agentMap={agentMap}
            height={110}
          />
        ))}
      </div>
      {/* 없는 것을 없다고 말해 두지 않으면, 볼 때마다 같은 조사를 다시 하게 된다. */}
      <p className="mt-1 px-1 text-micro text-fg-faint">
        {HOST_UNCOLLECTED_COUNTERS.map(c => counterMeta(c).disp).join(' · ')} {t('는 에이전트')}
        2.21.3 {t('이 값을 계산만 하고 어떤 팩에도 싣지 않아 받을 수 없습니다.')}
      </p>
    </section>
  );
}

function CounterSection({
  title,
  subtitle,
  counters,
  isStreaming,
  agentMap,
  empty,
  footnote,
}: {
  title: string;
  subtitle: string;
  counters: readonly CounterName[];
  isStreaming: boolean;
  agentMap: Map<number, string>;
  /** 이 Family 의 오브젝트가 없을 때 보여줄 안내. 없으면 null */
  empty: string | null;
  /** 이 구역에서 **영영 못 받는** 카운터에 대한 각주. 없으면 생략 */
  footnote?: string;
}) {
  /**
   * 개별 선 / 접은 선 하나 (ASIS RealTimeAllCount vs RealTimeTotalCount).
   *
   * 두 화면이 다른 질문에 답한다 — "어느 서버가 이상한가" 와 "전체가 견디고 있나".
   * 구역 단위로 바꾼다: 카운터마다 따로 두면 어떤 건 합계고 어떤 건 개별인 채로
   * 나란히 놓여 서로 비교하는 순간 틀린다.
   */
  const [total, setTotal] = useState(false);

  return (
    <section className="mb-4 last:mb-0">
      <header className="mb-2 flex items-baseline gap-2 border-b border-line pb-1">
        <h2 className="text-body font-medium text-fg">{title}</h2>
        <span className="text-micro text-fg-faint">{subtitle}</span>
        <div className="flex-1" />
        {/* counters.xml 이 합계를 허용한 카운터가 하나도 없는 구역(host)에는
            토글 자체를 두지 않는다. 눌러도 아무것도 안 바뀌는 버튼은 고장으로 읽힌다. */}
        {!empty && counters.some(isTotalCapable) && (
          <div className="flex gap-0.5">
            {([false, true] as const).map(v => (
              <button
                key={String(v)}
                onClick={() => setTotal(v)}
                className={`rounded px-2 py-0.5 text-micro ${
                  total === v ? 'bg-hover text-fg' : 'text-fg-dim hover:text-fg'
                }`}
              >
                {v ? t('합계') : t('개별')}
              </button>
            ))}
          </div>
        )}
      </header>
      {empty ? (
        <p className="px-1 py-4 text-small text-fg-faint">{empty}</p>
      ) : (
        // 카운터가 37개다. 한 줄에 하나씩 200px 로 쌓으면 8,000px 를 스크롤해야 한다.
        // 개별 카운터는 추세만 보면 되므로 폭을 나눠 한 화면에 담는다.
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {counters.map(c => (
            <CounterChart
              key={c}
              isStreaming={isStreaming}
              counter={c}
              agentMap={agentMap}
              height={110}
              total={total}
            />
          ))}
        </div>
      )}
      {!empty && footnote && (
        <p className="mt-1 px-1 text-micro text-fg-faint">{footnote}</p>
      )}
    </section>
  );
}

// ─── XLog 하단 목록 ───────────────────────────────────────────

interface XLogTableProps {
  xlogs: SXLog[];
  /**
   * 프로파일 검색 결과. null 이면 검색을 안 한 상태다.
   *
   * **빈 Map 과 null 은 다르다** — 빈 Map 은 "찾았는데 없다" 라서 목록도 비어야 하고,
   * null 은 "안 찾았다" 라서 전부 보여야 한다.
   */
  searchHits: Map<string, ProfileHit> | null;
  agentMap: Map<number, string>;
  activeXlog: SXLog | null;
  getCached: (typeKey: string, hash: number) => string | undefined;
  /** 값 자체는 안 쓰고, 텍스트 캐시가 채워졌을 때 다시 그리기 위한 신호다 */
  textVersion?: number;
  onRowClick: (xlog: SXLog) => void;
}

/**
 * 열 정의를 한 곳에만 둔다 — 헤더와 행이 따로 폭을 가지면 반드시 어긋난다.
 *
 * 이전 버전은 행마다 zebra 배경 + 아래 테두리 + 왼쪽 색막대 + 에러 배경틴트로
 * **행을 나누는 장치를 네 개** 겹쳐 썼다. 구분선 하나만 남긴다.
 * 상태 열(OK/ERR)도 뺐다 — 거의 모든 행이 OK 라 초록 기둥만 생겼다.
 * 에러는 예외적으로만 표시한다(왼쪽 막대 + ERR 칩).
 */
const XLOG_COLS = 'grid grid-cols-[62px_minmax(0,104px)_minmax(0,1fr)_minmax(0,96px)_74px] gap-x-3';

/** 목록에 실제로 그리는 최대 행 수. 넘으면 **느린 것부터** 자른다 */
const XLOG_TABLE_LIMIT = 500;

function XLogTable({
  xlogs,
  searchHits,
  agentMap,
  activeXlog,
  getCached,
  onRowClick,
}: XLogTableProps) {
  // 촘촘한 구간을 고르면 수천 건이 잡힌다. 시간 순으로 앞에서 500건을 자르면
  // **가장 오래된 500건**만 남는다 — 1ms 짜리 잡음이다.
  // 구간을 드래그하는 이유는 "무엇이 느렸나" 이므로 느린 순으로 자른다.
  const shown = useMemo(() => {
    const base = searchHits === null ? xlogs : xlogs.filter(x => searchHits.has(x.txid));
    return [...base].sort((a, b) => b.elapsed - a.elapsed).slice(0, XLOG_TABLE_LIMIT);
  }, [xlogs, searchHits]);

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* 선택 개수와 해제 버튼은 Pane 타이틀바로 올렸다 — 머리가 둘이면 목록이 그만큼 짧아진다 */}
      <div
        className={`${XLOG_COLS} shrink-0 items-center border-b border-line px-3 py-1 text-micro font-medium tracking-wide text-fg-faint uppercase`}
      >
        <span>{t('시간')}</span>
        <span>{t('서버')}</span>
        <span>URL</span>
        <span>IP</span>
        <span className="text-right">Elapsed</span>
      </div>

      <div className="flex-1 divide-y divide-line/40 overflow-y-auto">
        {/* 목록은 항상 떠 있으므로 비었을 때 **채우는 방법**을 알려줘야 한다.
            "없음" 만 쓰면 고장인지 사용법을 모르는 건지 구분이 안 된다. */}
        {xlogs.length === 0 && (
          <p className="px-3 py-6 text-center text-small text-fg-faint">
            {t('차트에서 영역을 드래그하면 그 구간의 트랜잭션이 여기에 나옵니다.')}
          </p>
        )}
        {/* **"검색 결과 없음"과 "선택이 없음"은 다른 말이다.** 같은 문구를 쓰면
            드래그를 다시 하라는 안내가 뜨는데 정작 문제는 검색어다. */}
        {xlogs.length > 0 && shown.length === 0 && searchHits !== null && (
          <p className="px-3 py-6 text-center text-small text-fg-faint">
            {t('선택한')} {xlogs.length.toLocaleString()}{t('건의 프로파일에서 찾지 못했습니다.')}
          </p>
        )}
        {shown.map((x, i) => {
          const svcName = getCached('service', x.service) ?? `[0x${x.service.toString(16)}]`;
          const agentName = agentMap.get(x.objHash) ?? `[0x${x.objHash.toString(16)}]`;
          const isActive = activeXlog?.txid === x.txid;
          const hasErr = x.error !== 0;
          const hit = searchHits?.get(x.txid);
          return (
            <div
              key={i}
              onClick={() => onRowClick(x)}
              className={[
                'cursor-pointer border-l-2 px-3 py-1 text-body',
                isActive
                  ? 'border-l-accent bg-accent/12'
                  : hasErr
                    ? 'border-l-danger bg-danger/5 hover:bg-danger/10'
                    : 'border-l-transparent hover:bg-hover/60',
              ].join(' ')}
            >
              <div className={`${XLOG_COLS} items-center`}>
                <span className="tnum font-mono text-micro text-fg-dim">
                  {formatTime(x.endTime)}
                </span>
                <span className="truncate text-fg-muted" title={agentName}>
                  {agentName}
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  {hasErr && (
                    <span className="shrink-0 rounded-sm bg-danger/20 px-1 text-micro font-bold text-danger">
                      ERR
                    </span>
                  )}
                  <span className="truncate text-fg" title={svcName}>
                    {svcName}
                  </span>
                </span>
                <span className="tnum truncate font-mono text-micro text-fg-faint" title={x.ipAddr}>
                  {x.ipAddr || '—'}
                </span>
                <span className={`tnum text-right font-mono ${durationTone(x.elapsed)}`}>
                  {x.elapsed.toLocaleString()}ms
                </span>
              </div>

              {/* **왜 걸렸는지 보여준다.** 목록만 좁혀 놓으면 검색어가 어디에 맞았는지
                  알 수 없어 매번 상세를 열어 봐야 한다. */}
              {hit && (
                <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
                  <span className="shrink-0 rounded-sm bg-accent/15 px-1 font-mono text-micro text-accent">
                    {hit.first.kind}
                  </span>
                  <span
                    className="truncate font-mono text-micro text-fg-dim"
                    title={hit.first.snippet}
                  >
                    {hit.first.snippet}
                  </span>
                  {hit.count > 1 && (
                    <span className="shrink-0 text-micro text-fg-faint">+{hit.count - 1}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Alert 전체 뷰 ───────────────────────────────────────────

function AlertFullView({
  alerts,
  since,
  connected,
  onClear,
}: {
  /** 앱이 쥐고 있는 하나의 버퍼. 여기서 따로 구독하면 배지와 어긋난다 */
  alerts: AlertPack[];
  since: number | null;
  connected: boolean;
  onClear: () => void;
}) {
  // 경과 시간 문구가 멈춰 있으면 화면이 얼어붙은 것처럼 보인다.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => setTick(t => t + 1), 10_000);
    return () => clearInterval(id);
  }, [connected]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={tabPageHeaderStyle}>
        <span>{t('알림')}</span>
        {alerts.length > 0 && (
          <button onClick={onClear} style={{ ...closeBtnStyle, marginLeft: 8, fontSize: F.small, color: T.textFaint }}>Clear</button>
        )}
      </div>
      <div style={{ ...colHeaderStyle, flexShrink: 0 }}>
        <span style={{ width: 74 }}>{t('시간')}</span>
        <span style={{ width: 60 }}>{t('레벨')}</span>
        <span style={{ width: 110 }}>{t('에이전트')}</span>
        <span style={{ flex: 1 }}>{t('제목 / 메시지')}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {alerts.length === 0 && (
          <EmptyState
            text={alertWatchMessage({ connected, since, now: Date.now() })}
            key={tick}
          />
        )}
        {alerts.map((a, i) => {
          const color = alertLevelColor(a.level);
          const label = alertLevelLabel(a.level);
          const time = formatTime(a.time);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', padding: '5px 14px', borderBottom: '1px solid #12122a', fontSize: F.body, gap: 8, background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
              <span style={{ width: 74, flexShrink: 0, color: T.textDim }}>{time}</span>
              <span style={{ width: 60, flexShrink: 0 }}>
                <span style={{ background: color, color: T.text, fontSize: F.micro, fontWeight: 700, padding: '2px 5px', borderRadius: 3, letterSpacing: 0.5 }}>{label}</span>
              </span>
              <span style={{ width: 110, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.textMuted }}>{a.obj_type}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</div>
                {a.message && <div style={{ color: T.textDim, fontSize: F.micro, wordBreak: 'break-all', marginTop: 2 }}>{a.message}</div>}
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: T.textFaint, fontSize: F.base, letterSpacing: 0.3 }}>
      {text}
    </div>
  );
}

// ─── 상수 ─────────────────────────────────────────────────────

const TAB_LABELS: Record<TabId, string> = { xlog: 'XLog', counter: 'Counter', alert: 'Alert' };

// ─── 스타일 ────────────────────────────────────────────────────


const appStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  background: C.bg0,
  color: C.text,
  fontFamily: FONT_UI,
  overflow: 'hidden',
};














const tabBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const tabPageHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '8px 16px',
  fontSize: F.small,
  fontWeight: 700,
  color: C.textDim,
  letterSpacing: 1.2,
  textTransform: 'uppercase',
  borderBottom: `1px solid ${C.border}`,
  flexShrink: 0,
  background: C.bg2,
};

const colHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '3px 14px',
  fontSize: F.micro,
  color: C.textDim,
  letterSpacing: 0.5,
  fontWeight: 600,
  textTransform: 'uppercase',
  background: C.bg2,
  borderBottom: `1px solid ${C.border}`,
  gap: 8,
  flexShrink: 0,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: C.textDim,
  cursor: 'pointer',
  fontSize: F.base,
  padding: '2px 4px',
  lineHeight: 1,
  borderRadius: 3,
};

