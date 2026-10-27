// src/App.tsx

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pane } from './components/Pane';
import { Divider } from './components/Divider';
import { clampPane, isMeasured, sideRoom, tableRoom, PANE } from './components/paneSizing';
import { ConnectionDialog } from './features/xlog/components/ConnectionDialog';
import { SettingsDialog } from './features/settings/SettingsDialog';
import { ConfigSettingsDialog } from './features/config/ConfigSettingsDialog';
import { XLogChart } from './features/xlog/components/XLogChart';
import { XLogToolbar } from './features/xlog/components/XLogToolbar';
import { AgentSelectorPanel } from './features/xlog/components/AgentSelectorPanel';
import { CounterChart } from './features/xlog/components/CounterChart';
import { XLogDetailPanel } from './features/xlog/components/XLogDetailPanel';
import { ActiveServicePanel } from './features/xlog/components/ActiveServicePanel';
import { ActiveTab } from './features/active/ActiveTab';
import { poolsUnder } from './features/active/poolModel';
import { SummaryPanel } from './features/xlog/components/SummaryPanel';
import { TopologyPanel } from './features/xlog/components/TopologyPanel';
import { FiveMinCounterChart } from './features/xlog/components/FiveMinCounterChart';
import { ServiceGroupPanel } from './features/xlog/components/ServiceGroupPanel';
import { VisualizeTab } from './features/visualize/VisualizeTab';
import { XLogSearchBar } from './features/xlog/components/XLogSearchBar';
import { WideSearchDialog, type WideSearchValues } from './features/xlog/components/WideSearchDialog';
import { SavedProfileDialog } from './features/xlog/components/SavedProfileDialog';
import { FilterDialog } from './features/xlog/components/FilterDialog';
import {
  fromFilter as filterToSaved,
  normalize as normalizeSavedFilters,
  remove as removeSavedFilter,
  upsert as upsertSavedFilter,
  type SavedFilter,
} from './features/xlog/components/savedFilters';
import { ServerSwitcher } from './features/xlog/components/ServerSwitcher';
import {
  displayName,
  fromLegacy,
  normalize,
  rename,
  sameTarget,
  upsert,
} from './features/xlog/components/serverProfiles';
import type { ServerProfile } from './features/xlog/api/scouterApi';
import { switchToServer } from './features/xlog/api/connectFlow';
import { useProfileSearch } from './features/xlog/hooks/useProfileSearch';
import { toDateString, toFileStamp } from './features/xlog/utils/xlogDate';
import type { ProfileHit } from './features/xlog/api/scouterApi';
import { durationTone } from './features/xlog/components/durationTone';
import { SelectionSummary } from './features/xlog/components/SelectionSummary';
import {
  DEFAULT_SORT,
  nextSort,
  pickTableRows,
  sortMark,
  sortXLogs,
  type SortKey,
  type SortNames,
  type SortState,
} from './features/xlog/components/xlogSort';
import {
  gridTemplate,
  resetAt,
  resizeAt,
  visibleCols,
  type XLogColKey,
  type XLogColWidths,
} from './features/xlog/components/xlogColumns';
import { selectionStats } from './features/xlog/components/selectionStats';
// ko-KR 로케일은 "4시 36분 18초" 를 낸다 — 폭을 먹고 줄바꿈되며 차트 X축(04:36:18)과도 어긋난다.
import { formatTime, formatTimeMs } from './features/xlog/utils/colorPalette';
import { AlertPanel } from './features/xlog/components/AlertPanel';
import { prunePicked } from './features/xlog/components/agentFilter';
import {
  onConnected,
  onDisconnected,
  getObjectList,
  loadObjectHistory,
  saveObjectHistory,
  removeInactiveObjects,
  getObjectTypeFamilies,
  getXLogDetail,
  startCounterStream,
  stopCounterStream,
  startAlertStream,
  getConfig,
  getConnectionInfo,
  saveUiState,
  searchXLogList,
  saveXLogProfile,
  saveConfig,
  saveServers,
  startXLogStream,
  stopXLogStream,
} from './features/xlog/api/scouterApi';
import { subscribe } from './features/xlog/api/subscribe';
import { passesFilter } from './features/xlog/engine/rectSelect';
import { alertWatchMessage } from './features/xlog/utils/alertWatch';
import { groupAlerts, quietAlerts, type AlertBurst, type AlertRow } from './features/xlog/utils/alertGroups';
import { useAlertStream } from './features/xlog/hooks/useAlertStream';
import { MAX_DETAIL_TABS, useXLogDetailTabs } from './features/xlog/hooks/useXLogDetailTabs';
import {
  activeTab as activeXLogTab,
  addTab as addXLogTab,
  closeTab as closeXLogTab,
  activate as activateXLogTab,
  initialTabs,
  patchActive as patchActiveTab,
  renameTab as renameXLogTab,
  setResolved as setTabResolved,
  clearSelections as clearTabSelections,
  dropTab as dropXLogTab,
  closePane as closeXLogPane,
  setRatio as setXLogRatio,
  patchTab as patchXLogTab,
  importTabs as importXLogTabs,
  tabTitle,
  tabLabels as xlogTabLabelsOf,
  type DropSide,
  type XLogTab,
  type XLogTabsState,
} from './features/xlog/hooks/xlogTabs';
import { XLogTabBar } from './features/xlog/components/XLogTabBar';
import { XLogSplit } from './features/xlog/components/XLogSplit';
import {
  EV_DETACH,
  EV_HELLO,
  EV_INIT,
  EV_MERGE,
  EV_SNAPSHOT,
  type DetachMessage,
  type InitMessage,
  type MergeMessage,
  type SnapshotMessage,
} from './features/xlog/detached/protocol';
import {
  boundsOf as windowBoundsOf,
  EMPTY_REGISTRY,
  fromConfig as windowsFromConfig,
  nextLabel as nextWindowLabel,
  remove as removeWindow,
  toConfig as windowsToConfig,
  upsert as upsertWindow,
  type Registry,
} from './features/xlog/detached/registry';
import { currentWindowBounds, openXLogWindow, type ScreenPoint } from './features/xlog/detached/windows';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { mergeObjects } from './features/xlog/hooks/objectRefresh';
import { allNames, clearNames, rememberNames } from './features/xlog/hooks/agentNames';
import {
  mergeCandidates,
  pastSelectionState,
  pickTask,
  resolvePastSelection,
  resolveSelection,
  selectionState,
  toggleService,
  type GroupSelection,
} from './features/xlog/hooks/groupSelection';
import {
  asAgent,
  clearObjectHistory,
  objectHistory,
  observeObjects,
  persistableHistory,
  restoreObjectHistory,
} from './features/xlog/hooks/objectTimeline';
import { usePastCandidates } from './features/xlog/hooks/usePastCandidates';
import { searchAll, type WideProgress } from './features/xlog/hooks/wideSearchAll';
import { instanceLabel, serviceNameOf } from './features/xlog/components/instanceGroup';
import { setAgentColorKey } from './features/xlog/utils/colorPalette';
import { repaintCharts } from './styles/theme';
import { useSectionFold } from './features/xlog/hooks/useSectionFold';
import {
  fromTabs as detailsFromTabs,
  normalize as normalizeOpenDetails,
  type OpenDetail,
} from './features/xlog/hooks/openDetails';
import { DetailTabBar } from './features/xlog/components/DetailTabBar';
import { useShortcuts } from './features/xlog/hooks/useShortcuts';
import {
  toLayout,
  fromLayout,
  fromChartConfig,
  fromFilterState,
  toTabs as toXLogTabs,
  fromTabs as xlogTabsToPrefs,
  fromSplit as xlogSplitToPrefs,
  tabToPrefs,
} from './features/xlog/hooks/uiState';
import { shortName, type GroupBy } from './features/xlog/components/agentTree';
import { useTextResolver } from './features/xlog/hooks/useTextResolver';
import type { AgentObject, SXLog, XLogChartConfig, XLogFilterState, YAxisMode } from './features/xlog/types/xlog';
import {
  formatYValue,
  Y_AXIS_CONFIGS,
  xlogPackToSXLog,
  yAxisShortLabel,
} from './features/xlog/types/xlog';
import type { PastRange, XLogMode } from './features/xlog/types/timeRange';
import type { AlertPack } from './features/xlog/types/alert';
import { alertLevelColor, alertLevelLabel } from './features/xlog/types/alert';
import type { CounterName } from './features/xlog/types/counter';
import {
  isJavaeeObjectType,
  isHostObjectType,
  isDatasourceObjectType,
  learnFamiliesFromObjects,
  registerObjectTypeFamilies,
  resetObjectTypeFamilies,
  HOST_CHART_COUNTERS,
  HOST_FIVE_MIN_COUNTERS,
  HOST_UNCOLLECTED_COUNTERS,
  JAVAEE_UNCOLLECTED_COUNTERS,
  DATASOURCE_CHART_COUNTERS,
  counterMeta,
  isTotalCapable,
} from './features/xlog/types/counter';
import { T, F, FONT_UI } from './styles/tokens';
import { SectionHeader } from './components/SectionHeader';
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

type TabId = 'xlog' | 'active' | 'visualize' | 'counter' | 'alert';

/** 열린 탭이 하나도 없을 때 상세 패널에 줄 빈 상태 */
/** 고른 것 없음. 매 렌더 새 객체를 만들면 목록 memo 가 매번 다시 돈다 */
const NO_PICK: { xlogs: SXLog[]; refilter: boolean } = { xlogs: [], refilter: false };

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

export default function App({ windowLabel }: {
  /**
   * 떼어 낸 XLog 창이면 그 창 이름(`xlogwin-N`), 메인 창이면 없다.
   *
   * 뗀 창은 **같은 앱이 XLog 화면만** 띄운 것이다 — 서버 고르기·툴바·차트·목록·상세를 저마다 한다.
   * 접속·서버 전환·Counter/Active/Visualize/Alert·설정 저장은 메인 창만 한다 (`detached/protocol.ts`).
   */
  windowLabel?: string;
} = {}) {
  const isMain = windowLabel === undefined;
  // 언어가 바뀌면 화면 전체를 다시 그린다. t() 는 모듈 함수라 **구독하지 않으면**
  // 설정에서 언어를 바꿔도 이미 그려진 글자가 그대로 남는다.
  const { lang } = useT();
  // **여기서 한 번은 불러야 한다.** 표시 설정(언어·글자 크기)은 이걸 처음 쓰는
  // 컴포넌트가 마운트될 때 config.json 을 읽는데, 그게 상세 패널이라
  // 앱을 켜고 아무것도 안 열면 저장해 둔 설정이 적용되지 않았다.
  const { groupRule, autoRemoveInactiveMin, wideSearchMax } = useViewOptions();
  const [activeTab, setActiveTab] = useState<TabId>('xlog');
  const [isConnected, setIsConnected] = useState(false);
  const [serverId, setServerId] = useState('');
  /**
   * 연결할 때마다 올라가는 번호.
   *
   * `serverId` 는 콜렉터 설정값이라 두 콜렉터가 같을 수 있어 «다른 접속» 을 가르지 못한다.
   * XLog 저장소가 이 번호로 이전 서버의 점을 버린다 (`useConnectionReset`).
   */
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  /**
   * 데모(합성 데이터)로 붙었는가. 그때는 콜렉터가 없어 콜렉터 설정을 물을 곳이 없다.
   * 이름은 Rust `DEMO_SERVER_ID` 와 같아야 한다.
   */
  const isDemo = serverId === 'DEMO (합성 데이터)';
  const [showCollectorConfig, setShowCollectorConfig] = useState(false);
  /**
   * XLog 탭들.
   *
   * 조건(모드·구간·차트 설정·거름)은 **탭마다** 다르다 — «어제 이 시간엔
   * 어때나» 를 보려고 지금 조건을 지우고 되돌리는 일을 없애려는 것이다.
   * **서버 고르기만은 탭 바깥이다**(아래 «서버 고르기는 탭 바깥이다» 참고).
   *
   * 아래 `config`·`filter` 등은 **활성 탭에서 파생**시킨다. 그래야 탭을
   * 몰랐던 쪽(툴바·차트·상세)이 그대로 산다.
   */
  const [xlogTabs, setXLogTabs] = useState<XLogTabsState>(initialTabs);
  /**
   * 떼어 낸 창들 — **메인 창만** 들고 있다(`detached/registry.ts`). 창마다 띄운 탭·분할·자리를
   * 설정 파일에 남겼다가 켤 때 같은 자리에 다시 연다.
   */
  const [xlogWindows, setXLogWindows] = useState<Registry>(EMPTY_REGISTRY);
  const xlogWindowsRef = useRef(xlogWindows);
  xlogWindowsRef.current = xlogWindows;
  /** 이번에 쓴 창 이름 — 닫힌 창의 번호를 다시 안 쓴다 */
  const usedWindowLabelsRef = useRef(new Set<string>());
  const curTab = activeXLogTab(xlogTabs);
  const config = curTab.config;
  const filter = curTab.filter;
  const xlogMode = curTab.mode;
  const pastRange = curTab.pastRange;

  const setConfig = useCallback(
    (v: XLogChartConfig | ((p: XLogChartConfig) => XLogChartConfig)) =>
      setXLogTabs(s =>
        patchActiveTab(s, {
          config: typeof v === 'function' ? v(activeXLogTab(s).config) : v,
        }),
      ),
    [],
  );
  const setFilter = useCallback(
    (v: XLogFilterState | ((p: XLogFilterState) => XLogFilterState)) =>
      setXLogTabs(s =>
        patchActiveTab(s, {
          filter: typeof v === 'function' ? v(activeXLogTab(s).filter) : v,
        }),
      ),
    [],
  );
  const setXLogMode = useCallback(
    (v: XLogMode | ((p: XLogMode) => XLogMode)) =>
      setXLogTabs(s =>
        patchActiveTab(s, { mode: typeof v === 'function' ? v(activeXLogTab(s).mode) : v }),
      ),
    [],
  );
  const setPastRange = useCallback(
    (v: PastRange | null) => setXLogTabs(s => patchActiveTab(s, { pastRange: v })),
    [],
  );

  /**
   * 목록의 원본. 차트에서 고른 것은 **필터 전 그대로** 들고(`refilter`), 보여 줄 때
   * 지금 필터로 거른다 — 고른 뒤 필터를 바꿔도 목록이 차트와 같은 것을 말해야 한다.
   *
   * 넓은 구간 찾기 결과는 거르지 않는다. 그 창에서 오브젝트·서비스를 따로 정해 서버가
   * 걸러 준 것이라, 툴바의 서버 고르기(objHashSet)를 또 걸면 고른 오브젝트가 통째로 빠진다.
   */
  const [picked, setPicked] = useState<{ xlogs: SXLog[]; refilter: boolean }>(NO_PICK);
  const setSelectedXLogs = useCallback(
    (xlogs: SXLog[]) => setPicked({ xlogs, refilter: false }),
    [],
  );
  /** 목록의 ✕ 가 캔버스의 선택 사각형까지 지우도록 보내는 신호 */
  const [clearSignal, setClearSignal] = useState(0);
  /** 실시간 / 과거. 과거면 pastRange 가 실제 조회 구간이다 */
  /**
   * F5 를 누른 횟수 — **지금 보는 화면의 데이터만** 다시 받게 하는 신호.
   *
   * 웹뷰를 통째로 reload 하면 접속·고른 서버·열어 둔 상세가 다 날아간다.
   * 보는 화면마다 «다시 받는다» 의 뜻이 달라서, 각 화면이 이 값을 보고 제 일을 한다.
   */
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [agentMap, setAgentMap] = useState<Map<number, string>>(new Map());
  /**
   * 지금 알고 있는 오브젝트 전부 (방금 내려간 것 포함).
   *
   * 그룹은 이 명단에서 **매번 다시 푸는다** — 묶음을 들고 있으면 Task 가 갈릴 때마다 틀어진다.
   * 합치는 일에 직전 명단이 필요해서 ref 에도 둔다 — 상태만 쓰면 주기 갱신이
   * 매번 옥 값을 보게 된다(효과는 접속당 한 번만 선다).
   */
  const objectsRef = useRef<AgentObject[]>([]);
  /** 화면이 구독하는 명단. 그룹을 다시 푸는 일이 이 값에 달려 있다 */
  const [objects, setObjects] = useState<AgentObject[]>([]);
  /**
   * 무엇을 보기로 골랐나 — **그룹 이름과 낱개 해시**로 들고 있는다. **탭마다다** (`xlogTabs.ts`).
   * 왼쪽 목록은 지금 탭의 것을 보여 주고 고친다.
   *
   * 고를 때의 해시를 집어넣으면 ECS 에서 바로 틀어진다(`groupSelection.ts`).
   * 아래로 내려보내는 것은 여전히 **해시 집합 하나**라 네 화면의 계약은 그대로다.
   */
  const groupSel = curTab.selection;
  const setGroupSel = useCallback(
    (v: GroupSelection | ((p: GroupSelection) => GroupSelection)) =>
      setXLogTabs(s =>
        patchActiveTab(s, {
          selection: typeof v === 'function' ? v(activeXLogTab(s).selection) : v,
        }),
      ),
    [],
  );
  /** 카운터 요청 대상. Family 별로 나눠 둔다 — 화면도 Family 로 나눈다 */
  const [counterHashes, setCounterHashes] = useState<{
    javaee: number[];
    host: number[];
    /** 커넥션 풀. 부모와 별개 오브젝트라 따로 센다 (F-41) */
    datasource: number[];
  }>({ javaee: [], host: [], datasource: [] });
  /**
   * 오브젝트별 objType.
   *
   * 액티브 서비스·요약·오늘 누적·5분 집계는 objHash 가 아니라 **objType** 이 기준이라
   * 해시 목록으로는 요청할 수 없다. 그래서 고른 서버들의 종류를 모아 **종류마다** 묻는다.
   *
   * 예전에는 Family 마다 **첫 종류 하나**(`javaeeType`·`hostType`)만 들고 있었다.
   * «실환경에서 javaee 타입이 여럿인 경우는 드물다» 고 적어 두었는데 드물지 않았다 —
   * 커스텀 종류(`monitoring_group_type`)를 쓰면 시스템마다 종류가 달라, 첫 시스템 말고는
   * Active·Counter·Visualize 에서 통째로 빠졌다.
   */
  const [objTypeOf, setObjTypeOf] = useState<ReadonlyMap<number, string>>(new Map());

  // **알림은 앱이 하나만 쥔다.** 배지와 Alert 탭이 각자 모으면, 다른 탭을 보는 동안
  // 온 알림이 탭에는 없어서 배지에 2가 떠도 목록은 비어 있다 (실제로 겪었다).
  const alertStream = useAlertStream(isConnected);
  /**
   * **Alert 탭을 보고 있으면 읽은 것이다.** 배지를 누르면 이 탭으로 오기만 하고 읽음 처리는
   * 하지 않아서, 알림을 다 보고 나서도 숫자가 그대로 남았다. 보는 중에 새로 온 것도 읽은 셈이다.
   */
  const markAlertsRead = alertStream.markRead;
  /**
   * 알림을 서비스 단위로 묶는다 (alertGroups.ts). **명단이 갱신될 때마다 다시 판정한다** —
   * 새 Task 가 옛 Task 보다 늦게 뜨는 배포에서는 처음엔 «없음» 이다가 1분 뒤 «교체» 가 된다.
   * objectHistory 는 명단을 받을 때 같이 갱신되므로 objects 가 그 신호다.
   */
  const alertRows = useMemo(
    () => groupAlerts(alertStream.alerts, objectHistory(), groupRule),
    // objects 는 본문에서 안 읽는다 — objectHistory 가 갱신됐다는 신호로만 지켜본다
    [alertStream.alerts, objects, groupRule],
  );
  /** 배지 숫자. 교체로 판정된 것은 세지 않는다 — 배포 한 번에 배지가 Task 수만큼 뛰면 배지를 안 본다 */
  const unreadShown = useMemo(() => {
    const quiet = quietAlerts(alertRows);
    return alertStream.alerts.slice(0, alertStream.unread).filter(a => !quiet.has(a)).length;
  }, [alertRows, alertStream.alerts, alertStream.unread]);
  useEffect(() => {
    if (activeTab === 'alert' && alertStream.unread > 0) markAlertsRead();
  }, [activeTab, alertStream.unread, markAlertsRead]);

  // 상세는 **여러 개** 열어 둘 수 있다. 느린 트랜잭션은 정상인 것과 나란히 놓고 봐야 안다.
  const detail = useXLogDetailTabs();
  const detailState = detail.active ?? EMPTY_DETAIL;
  const clearDetail = detail.closeAll;
  const { getCached, resolve } = useTextResolver();
  // resolve 는 전역 캐시만 갱신하므로 목록을 다시 그리려면 별도 신호가 필요하다.
  const [textVersion, setTextVersion] = useState(0);

  /** 차트와 같은 기준으로 판정한다 — 서비스명은 받아 둔 사전만 읽는다 */
  const passesNow = useCallback(
    (x: SXLog) => passesFilter(x, filter, h => getCached('service', h)),
    [filter, getCached],
  );
  /**
   * 목록에 보이는 것.
   *
   * `textVersion` 을 지켜본다 — 서비스명이 늦게 풀리면 판정이 달라진다(못 푼 이름은
   * 포함 조건에서 빠진다). 풀린 뒤에 다시 걸러야 빠졌던 것이 돌아온다.
   */
  const selectedXLogs = useMemo(
    () => (picked.refilter ? picked.xlogs.filter(passesNow) : picked.xlogs),
    [picked, passesNow, textVersion],
  );

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
  /** 트랜잭션 표의 열 너비. 끌어서 정한 것만 있다 (`xlogColumns.ts`) */
  const [xlogCols, setXLogCols] = useState<XLogColWidths>({});
  /**
   * 서비스로 묶어 볼 때 오브젝트 → 서비스 이름. 서비스로 안 묶으면 비어 있다.
   *
   * 정리로 사라진 Task 도 넣는다(objectHistory) — 카운터 차트에는 그 Task 의 지난 값이 남아 있다.
   * objectHistory 는 명단을 받을 때 같이 갱신되므로 objects 가 그 신호다.
   */
  const serviceIndex = useMemo(() => {
    const map = new Map<number, string>();
    if (agentGroupBy === 'service') {
      for (const seen of objectHistory().values()) {
        const svc = serviceNameOf(asAgent(seen), groupRule);
        if (svc !== null) map.set(seen.obj_hash, svc);
      }
    }
    return { map, sig: [...map].map(([h, svc]) => `${h}=${svc}`).join('|') };
    // objects 는 본문에서 안 읽는다 — objectHistory 가 갱신됐다는 신호로만 지켜본다
  }, [agentGroupBy, objects, groupRule]);
  /**
   * 차트에 넘길 함수. **묶음이 같으면 같은 함수다** — 명단은 폴링마다 새로 오는데
   * 그때마다 함수가 바뀌면 카운터 차트가 매번 다시 접고 색 캐시를 비운다.
   */
  const serviceOf = useMemo(
    () => {
      if (serviceIndex.sig === '') return undefined;
      const map = serviceIndex.map;
      return (h: number): string | null => map.get(h) ?? null;
    },
    // sig 가 같으면 map 의 내용도 같다 — map 이 새 객체여도 함수는 그대로 둔다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serviceIndex.sig],
  );
  /**
   * 서비스로 묶어 볼 때는 **서비스가 색을 정한다.** Task 마다 색을 주면 4대짜리 서비스가
   * 네 색으로 흩어지고, 재배포할 때마다 색이 바뀐다.
   *
   * 그리기 전에 건다(layout) — 목록의 색 칸이 옛 기준으로 한 번 그려졌다 바뀌지 않게.
   */
  useLayoutEffect(() => {
    setAgentColorKey(serviceOf ?? null);
    repaintCharts();
  }, [serviceOf]);
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
        setXLogCols(l.xlogCols);
        setSavedFilters(normalizeSavedFilters(cfg.saved_filters));
        // 뗀 창은 여기까지 — 탭은 메인 창에서 받고(init), 보던 화면·서버·상세는 메인 창의 것이다
        if (!isMain) return;
        setXLogWindows(windowsFromConfig(cfg.xlog_windows));
        // 조회 조건도 되살린다. **껐다 켜면 다 날아간다** 가 현장에서 가장 많이 나온 말이다.
        // 탭은 **조건만** 되살린다 — 받아 둔 것은 열면 이미 지나간 것이라 다시 조회한다.
        setXLogTabs(toXLogTabs(cfg.xlog_tabs, cfg.xlog_chart, cfg.xlog_filter, cfg.xlog_split));
        // 프로필 목록이 없으면 **예전 설정에서 하나 만든다** — 앱을 올리자마자
        // «어제까지 붙던 서버» 를 다시 쳐야 하는 것은 퇴보다.
        const list = normalize(cfg.servers);
        setServers(list.length > 0 ? list : fromLegacy(cfg));
        if (cfg.last_server) setCurrentServer(cfg.last_server);
        setPendingDetails(normalizeOpenDetails(cfg.open_details, MAX_DETAIL_TABS));
      })
      // 못 읽어도 기본값으로 뜬다. 다만 그 기본값으로 파일을 덮지는 않는다 —
      // 읽기가 실패한 이유가 «잠깐 못 읽었다» 일 수도 있다.
      .catch(() => {})
      .finally(() => { if (!cancelled && isMain) setHydrated(true); });
    return () => { cancelled = true; };
  }, [isMain]);

  /**
   * (뗀 창) 띄울 탭을 메인 창에서 받는다. 메인 창이 아직 안 듣고 있을 수 있어 받을 때까지 되묻는다.
   * 받은 뒤에야 «다 읽었다» 로 친다 — 그 전에 snapshot 을 보내면 빈 탭으로 메인 창의 기록을 덮는다.
   */
  useEffect(() => {
    if (isMain || !windowLabel) return;
    let got = false;
    const un = listen<InitMessage>(EV_INIT, e => {
      if (e.payload.label !== windowLabel || got) return;
      got = true;
      setXLogTabs(toXLogTabs(e.payload.tabs, undefined, undefined, e.payload.split));
      setHydrated(true);
    });
    const hello = () => { if (!got) void emit(EV_HELLO, { label: windowLabel }); };
    hello();
    const timer = setInterval(hello, 1_500);
    return () => {
      clearInterval(timer);
      void un.then(f => f());
    };
  }, [isMain, windowLabel]);

  /** (뗀 창) 접속 상태를 묻는다 — «붙었다» 이벤트는 이 창이 뜨기 전에 지나갔다 */
  useEffect(() => {
    if (isMain) return;
    getConnectionInfo()
      .then(info => {
        if (!info.connected) return;
        setIsConnected(true);
        setServerId(info.server_id);
        setConnectionEpoch(n => n + 1);
      })
      .catch(() => {});
  }, [isMain]);

  /** (뗀 창) 창을 옮기거나 크기를 바꾸면 자리를 다시 알린다 — 켤 때 같은 자리에 뜨게 */
  const [boundsTick, setBoundsTick] = useState(0);
  useEffect(() => {
    if (isMain) return;
    const w = getCurrentWindow();
    const bump = () => setBoundsTick(n => n + 1);
    const subs = [w.onMoved(bump), w.onResized(bump)];
    // 사용자가 닫았다 — **탭을 메인 창으로 돌려보낸다.** 닫는다고 탭까지 지우면 공들여 맞춘 조건을
    // 실수 한 번에 잃는다. 탭을 정말 없애려면 탭의 ✕ 로 닫는다.
    // (합치기 버튼은 destroy 로 닫으므로 여기를 안 지난다 — 두 번 들이지 않는다)
    const closing = w.onCloseRequested(() => {
      const msg: MergeMessage = { label: windowLabel ?? '', tabs: xlogTabsToPrefs(xlogTabsRef.current), close: true };
      return emit(EV_MERGE, msg);
    });
    return () => {
      for (const u of [...subs, closing]) void u.then(f => f());
    };
  }, [isMain, windowLabel]);

  /**
   * 바뀐 것을 파일에 남긴다.
   *
   * **끄는 순간이 아니라 바뀔 때마다** 남긴다 — 앱이 죽으면 «끌 때» 는 오지 않는다.
   * 다만 패널을 끄는 동안 마우스가 움직일 때마다 쓰면 안 되므로 잠깐 모아서 쓴다.
   */
  useEffect(() => {
    if (!hydrated) return;
    // (뗀 창) 파일에 쓰지 않는다 — 메인 창에 알려 메인 창이 쓴다. 두 창이 같은 파일을 덮으면 서로 지운다
    if (!isMain) {
      const id = setTimeout(() => {
        void (async () => {
          const msg: SnapshotMessage = {
            label: windowLabel ?? '',
            tabs: xlogTabsToPrefs(xlogTabs),
            split: xlogSplitToPrefs(xlogTabs),
            bounds: await currentWindowBounds(),
          };
          void emit(EV_SNAPSHOT, msg);
        })();
      }, 600);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => {
      saveUiState(
        fromLayout({ servicesW, detailW, tableH, activeTab, agentGroupBy, xlogCols }),
        fromChartConfig(config),
        fromFilterState(filter, xlogMode),
      ).catch(() => {});
      // 열어 둔 탭은 별도 저장이다 — save_ui_state 는 배치·차트·조건만 맡는다.
      void (async () => {
        try {
          const cfg = await getConfig();
          await saveConfig({
            ...cfg,
            open_details: detailsFromTabs(detail.tabs, toDateString),
            xlog_tabs: xlogTabsToPrefs(xlogTabs),
            xlog_split: xlogSplitToPrefs(xlogTabs),
            xlog_windows: windowsToConfig(xlogWindowsRef.current),
          });
        } catch {
          // 탭 저장 실패가 화면을 되돌릴 이유는 없다
        }
      })();
    }, 600);
    return () => clearTimeout(id);
  }, [
    hydrated,
    servicesW,
    detailW,
    tableH,
    activeTab,
    agentGroupBy,
    xlogCols,
    config,
    filter,
    xlogMode,
    detail.tabs,
    // **탭 전부를 지켜본다.** 지금 탭의 조건만 보면 이름 바꾸기·화면 분할·옆 판의 조건이
    // 다른 무엇이 바뀔 때까지 저장되지 않아, 껐다 켜면 사라졌다
    xlogTabs,
    xlogWindows,
    boundsTick,
  ]);

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
      onConnected(id => { setIsConnected(true); setServerId(id); setConnectionEpoch(n => n + 1); }),
      onDisconnected(() => {
        setIsConnected(false); setServerId('');
        // 콜렉터를 갈아타면 이름도 비운다 — 해시는 이름의 해시라 서버가 달라도 겹친다(F-35).
        setSelectedXLogs([]); clearNames(); clearObjectHistory(); setAgentMap(new Map());
        objectsRef.current = [];
        setObjects([]); setXLogTabs(clearTabSelections);
        setCounterHashes({ javaee: [], host: [], datasource: [] });
        setObjTypeOf(new Map()); clearDetail();
        // 콜렉터마다 사이트 정의가 다르다. 다른 콜렉터의 종류 표를 들고 가면 안 된다.
        resetObjectTypeFamilies();
      }),
    );
  }, [clearDetail]);

  /**
   * 오브젝트 목록을 **계속 따라간다.**
   *
   * 예전에는 접속할 때 한 번만 읽었다. 왼쪽 패널만 10초마다 다시 읽고 있어서,
   * 새 Task 가 띄면 **거기에만 보이고** 카운터 대상에는 안 들어가고 이름이 `#해시` 로
   * 남았다 — ECS 에서 Task 는 수시로 갈리므로 명단을 사진처럼 찍어 두면 금방 틀어진다.
   *
   * 주기는 왼쪽 패널과 **같은 10초**다. 다르면 화면 두 곣이 서로 다른 명단을 보여준다.
   */
  // 카운터는 objHash 목록이 필요하다.
  // AgentSelectorPanel 은 XLog 탭에서만 마운트되므로 그쪽에 의존하면
  // 다른 탭으로 접속했을 때 카운터가 영영 시작되지 않는다. 여기서 직접 조회한다.
  useEffect(() => {
    if (!isConnected) { setCounterHashes({ javaee: [], host: [], datasource: [] }); return; }
    let cancelled = false;
    // **지난번 기록부터 들인다** (objectTimeline.ts). 첫 목록이 오기 전에 들여야 껐던 사이에
    // 내려간 Task 가 «그때 살아 있었다» 로 끼지 않는다 — 되살린 것은 죽은 것으로 온다.
    // 못 읽어도 목록은 연다.
    // **이름도 들인다** — 목록에서 정리된 Task 의 알림·XLog 가 `#해시` 로 남지 않게. 지금 목록의 이름이
    // 뒤에 덮는다(같은 then 에서 rememberNames(list) 가 나중이다).
    const restored: Promise<unknown> = serverId
      ? loadObjectHistory(serverId)
          .then(d => {
            if (cancelled || restoreObjectHistory(d) === 0) return;
            rememberNames([...objectHistory().values()].map(asAgent));
          })
          .catch(() => {})
      : Promise.resolve();
    /** 마지막으로 파일에 남긴 때. 목록은 10초마다지만 파일은 1분에 한 번만 쓴다 */
    let lastSaved = 0;
    const load = () => {
    // **종류를 가르기 전에 콜렉터의 종류→Family 표부터 받는다.** 커스텀 종류
    // (`monitoring_group_type`)는 이름 목록에 없어서, 표 없이 가르면 WAS 가 통째로 빠진다.
    // 표를 못 받아도(옛 콜렉터) 목록은 연다 — 그때는 `detected` 태그로 배운다.
    Promise.all([getObjectList(), getObjectTypeFamilies().catch(() => []), restored])
      .then(([fresh, families]) => {
        if (cancelled) return;
        // 사라진 Task 를 바로 지우지 않는다 — 재배포 중 몇 초 비는 사이에
        // 서버가 화면에서 통째로 사라지면 «장애» 로 읽힌다.
        const list = mergeObjects(objectsRef.current, fresh, Date.now());
        // 언제 보였고 언제까지 살았나 — 알림 판정과 과거 고르기가 쓴다 (objectTimeline.ts).
        // **받은 그대로(fresh)를 적는다.** 잠시 남겨 둔 것(mergeObjects)은 지금 상태가 아니다.
        const now = Date.now();
        observeObjects(fresh, now);
        // (메인 창만) 파일에 남긴다 — 두 창이 같은 파일을 덮으면 서로 지운다. 뗀 창은 읽기만 한다
        if (isMain && serverId && now - lastSaved >= 60_000) {
          lastSaved = now;
          saveObjectHistory(serverId, persistableHistory(now)).catch(() => {});
        }
        objectsRef.current = list;
        setObjects(list);
        registerObjectTypeFamilies(families);
        learnFamiliesFromObjects(list);
        // Family 를 나눠 둔다. 요청은 합쳐 보내도 되지만(실측 확인),
        // **화면은 나눠야 한다** — CPU 와 TPS 를 같은 줄에 놓으면 읽히지 않는다.
        const javaee = list.filter(a => isJavaeeObjectType(a.obj_type));
        const host = list.filter(a => isHostObjectType(a.obj_type));
        setCounterHashes({
          javaee: javaee.map(a => a.obj_hash),
          host: host.map(a => a.obj_hash),
          datasource: list.filter(a => isDatasourceObjectType(a.obj_type)).map(a => a.obj_hash),
        });
        setObjTypeOf(new Map(list.map(a => [a.obj_hash, a.obj_type])));
        // **이름도 여기서 채운다.** 예전에는 AgentSelectorPanel(XLog 탭)만 채웠는데,
        // 그 패널은 XLog 탭에서만 마운트된다 — 카운터 탭으로 시작하면(마지막에 보던 탭이
        // 복원되면 흔하다) 차트 범례와 서버 고르기가 **해시 숫자로** 남았다.
        // **이름은 명단보다 오래 산다.** 목록에서 사라진 오브젝트가 남긴 XLog 는
        // 화면에 그대로 있어서, 거기서 이름을 못 풀면 `#해시` 로 덮인다 (`agentNames.ts`).
        rememberNames(list);
        const names = allNames();
        setAgentMap(prev => {
          if (prev.size === names.size && [...names.keys()].every(h => prev.has(h))) return prev;
          return names;
        });
      })
      .catch(() => {});
    };

    load();
    const timer = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(timer); };
    // **접속마다 다시 세운다**(connectionEpoch). 같은 server_id 의 두 콜렉터를 갈아타면 끊김·붙음이 한 번에
    // 그려져 isConnected·serverId 가 그대로일 수 있다 — 그러면 새 서버의 기록을 안 읽고, 비워진 기록으로
    // 새 서버의 파일을 덮는다.
  }, [isConnected, serverId, connectionEpoch, isMain]);

  // 알림은 메인 창이 받는다 — 뗀 창에는 알림 화면이 없다
  useEffect(() => {
    if (!isConnected || !isMain) return;
    startAlertStream().catch(() => {});
  }, [isConnected, isMain]);

  const handleConfigChange = useCallback((p: Partial<XLogChartConfig>) => setConfig(prev => ({ ...prev, ...p })), []);
  const handleFilterChange = useCallback((p: Partial<XLogFilterState>) => setFilter(prev => ({ ...prev, ...p })), []);
  /**
   * 접속 창이 «붙었다» 고 알릴 때.
   *
   * **여기서 할 일이 없다.** 실제 상태(연결·오브젝트 목록·스트림)는 Rust 가 보내는
   * `onConnected` 이벤트에 달린 effect 들이 세운다 — 접속 창으로 붙든 서버를
   * 갈아타든 같은 길을 타야 «창으로 붙을 때와 갈아탈 때가 다르다» 가 안 생긴다.
   */
  const handleConnected = useCallback((_sid: string) => {}, []);
  const handleDisconnected = useCallback(() => {}, []);

  /**
   * 갈아 가며 볼 서버들.
   *
   * **한 번에 한 서버다.** 두 콜렉터를 나란히 보는 것이 아니라, 매번 호스트·계정을
   * 다시 치지 않고 옮겨 가기 위한 목록이다.
   */
  const [servers, setServers] = useState<ServerProfile[]>([]);
  /** 지금 붙어 있는 서버 이름. 미연결이면 null */
  const [currentServer, setCurrentServer] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  /** 비밀번호를 저장 안 한 서버를 골랐을 때, 접속 폼에 채워 줄 값 */
  const [prefill, setPrefill] = useState<ServerProfile | null>(null);

  /**
   * 목록을 config.json 에 남긴다. 화면에는 이미 반영된 뒤다.
   *
   * **설정 전체를 읽어 고쳐 쓰지 않는다.** 접속 한 번에 설정 파일을 쓰는 곳이 셋이라
   * (자동 연결 저장 · Rust 의 `last_*` 저장 · 이 목록) 그 사이가 실제로 벌어진다 —
   * 옛 사본이 덮으면 방금 기억한 비밀번호가 사라지고, 그러면 다음 전환에서
   * 비밀번호를 다시 묻는다. 병합은 Rust 가 한다 (`saveServers`).
   */
  const persistServers = useCallback(async (list: ServerProfile[], last: string) => {
    try {
      await saveServers(list, last);
    } catch {
      // 목록 저장 실패가 접속을 막을 이유는 없다. 이번 세션에서는 그대로 쓴다.
    }
  }, []);

  /** 접속에 성공한 서버를 목록에 넣거나 갱신한다 */
  const rememberServer = useCallback(
    (profile: ServerProfile, savePass: boolean) => {
      setServers(prev => {
        const next = upsert(prev, profile, { savePass });
        // 이름은 목록에 있는 것이 이긴다(사용자가 지었을 수 있다). 같은 «대상» 으로 찾는다 —
        // host:port 만 보면 계정이 다른 두 프로필이 한 이름으로 뭉친다.
        const label = displayName(next.find(x => sameTarget(x, profile)) ?? profile);
        setCurrentServer(label);
        void persistServers(next, label);
        return next;
      });
    },
    [persistServers],
  );

  /**
   * 다른 서버로 갈아탄다.
   *
   * 화면 상태는 **끊길 때** 이미 비워진다(onDisconnected) — 오브젝트 해시가 서버마다
   * 달라 필터도 상세 탭도 그대로 둘 수 없다. 여기서는 붙이는 일만 한다.
   */
  const switchServer = useCallback(
    (profile: ServerProfile) => {
      const label = displayName(profile);
      if (profile.pass === '') {
        // 저장 안 한 비밀번호는 물어야 한다. 끊고 접속 폼에 값을 채워 둔다.
        setPrefill(profile);
        void switchToServer({ host: profile.host, port: profile.port, user: profile.user, pass: '' })
          .catch(() => {});
        return;
      }
      setSwitching(true);
      switchToServer(profile)
        .then(() => {
          setCurrentServer(label);
          // **콜백이 잡아 둔 `servers` 를 쓰면 안 된다.** 방금 `rememberServer` 가
          // 목록을 갈아 끼웠다면 그 사본은 이미 옛것이고, 그대로 저장하면
          // 기억해 둔 비밀번호가 되돌아간다. 최신 목록을 setState 안에서 집는다.
          setServers(prev => {
            void persistServers(prev, label);
            return prev;
          });
          handleConnected('scouter');
        })
        .catch(() => {
          // 실패하면 끊긴 채로 남는다. 접속 폼이 다시 나오므로 손으로 붙을 수 있다.
          setCurrentServer(null);
          setPrefill(profile);
        })
        .finally(() => setSwitching(false));
    },
    [persistServers, handleConnected],
  );

  /**
   * 서버에 이름을 붙인다.
   *
   * `10.89.2.18:6100` 셋이 늘어선 목록에서 운영과 QA 를 가르는 유일한 단서다.
   * **이름이 곧 식별자라서**(`displayName`) 지금 붙어 있는 서버의 이름을 바꾸면
   * 헤더가 가리키는 이름도 같이 옮겨야 한다 — 안 그러면 «어디에 붙어 있는지»가
   * 목록에 없는 이름을 가리킨다.
   */
  const renameServer = useCallback(
    (profile: ServerProfile, name: string) => {
      setServers(prev => {
        const next = rename(prev, profile, name);
        const before = displayName(profile);
        const after = displayName(next.find(x => sameTarget(x, profile)) ?? profile);
        setCurrentServer(cur => (cur === before ? after : cur));
        void persistServers(next, after);
        return next;
      });
    },
    [persistServers],
  );

  /**
   * 탭(판)을 옮기면 고른 점을 버린다 — 다른 탭의 점이 남아 있으면 어느 탭 것인지 모른다.
   * **차트의 선택 사각형도 지운다** — 판을 나눠 띄우면 옛 판의 사각형이 보인 채로 남아,
   * 아래 목록이 어느 판에서 뽑은 것인지 헷갈린다.
   */
  const activeXLogKeyRef = useRef(xlogTabs.activeKey);
  activeXLogKeyRef.current = xlogTabs.activeKey;
  const handleXLogTabActivate = useCallback((key: string) => {
    if (key === activeXLogKeyRef.current) return;
    setXLogTabs(s => activateXLogTab(s, key));
    setSelectedXLogs([]);
    setClearSignal(n => n + 1);
  }, []);
  const xlogTabsRef = useRef(xlogTabs);
  xlogTabsRef.current = xlogTabs;

  /**
   * 새 창을 연다 (메인 창). 탭은 이미 보낸 쪽에서 빠졌다 — 못 열면 이 창으로 들인다.
   */
  const openDetached = useCallback((msg: DetachMessage) => {
    if (msg.tabs.length === 0) return;
    const label = nextWindowLabel(xlogWindowsRef.current, usedWindowLabelsRef.current);
    usedWindowLabelsRef.current.add(label);
    const content = { tabs: msg.tabs, split: { panes: [0], active: 0, dir: 'row', ratio: 0.5 } };
    setXLogWindows(r => upsertWindow(r, label, content));
    const title = tabTitle(toXLogTabs(msg.tabs, undefined, undefined).tabs[0]);
    openXLogWindow(label, title, { at: msg.at }).catch(() => {
      setXLogWindows(r => removeWindow(r, label));
      setXLogTabs(s => importXLogTabs(s, toXLogTabs(msg.tabs, undefined, undefined).tabs));
    });
  }, []);
  /**
   * 탭을 새 창으로 뗀다. **이 창에서 빠져 그 창의 것이 된다** — 그 창에서 서버 고르기·목록·상세까지 한다.
   * 이 창의 마지막 탭은 떼지 않는다(이 창이 빈다).
   */
  const handleXLogTabDetach = useCallback((key: string, at?: ScreenPoint) => {
    const cur = xlogTabsRef.current;
    const tab = cur.tabs.find(t => t.key === key);
    if (!tab || cur.tabs.length <= 1) return;
    if (key === cur.activeKey) {
      setSelectedXLogs([]);
      setClearSignal(n => n + 1);
    }
    setXLogTabs(closeXLogTab(cur, key));
    const msg: DetachMessage = { tabs: [tabToPrefs(tab)], at };
    // 창은 메인 창이 연다 — 창 목록을 적어 두고 저장하는 쪽이 메인 창이다
    if (isMain) openDetached(msg);
    else void emit(EV_DETACH, msg);
  }, [isMain, openDetached]);
  /** (뗀 창) 탭 하나를 메인 창으로 보낸다. 마지막 탭이면 창째로 합친다 */
  const handleSendTabToMain = useCallback((key: string) => {
    if (!windowLabel) return;
    const cur = xlogTabsRef.current;
    const tab = cur.tabs.find(t => t.key === key);
    if (!tab) return;
    const last = cur.tabs.length <= 1;
    const msg: MergeMessage = { label: windowLabel, tabs: [tabToPrefs(tab)], close: last };
    void emit(EV_MERGE, msg).then(() => {
      if (last) void getCurrentWindow().destroy();
    });
    if (!last) {
      if (key === cur.activeKey) setSelectedXLogs([]);
      setXLogTabs(s => closeXLogTab(s, key));
    }
  }, [windowLabel]);
  /**
   * (메인 창) 뗀 창들의 말을 듣는다 — 열어 달라 · 띄울 것을 달라 · 바뀌었다 · 합친다 · 닫았다.
   */
  useEffect(() => {
    if (!isMain) return;
    const subs = [
      listen<{ label: string }>(EV_HELLO, e => {
        const w = xlogWindowsRef.current.get(e.payload.label);
        if (!w) return;
        const msg: InitMessage = { label: w.label, tabs: w.tabs, split: w.split };
        void emit(EV_INIT, msg);
      }),
      listen<SnapshotMessage>(EV_SNAPSHOT, e => {
        const { label, tabs, split, bounds } = e.payload;
        // 닫힌 뒤 늦게 온 것은 버린다 — 지운 창이 되살아난다
        if (!xlogWindowsRef.current.has(label)) return;
        setXLogWindows(r => upsertWindow(r, label, { tabs, split }, bounds));
      }),
      listen<MergeMessage>(EV_MERGE, e => {
        const { label, tabs, close } = e.payload;
        setXLogTabs(s => importXLogTabs(s, toXLogTabs(tabs, undefined, undefined).tabs));
        if (close) setXLogWindows(r => removeWindow(r, label));
      }),
      listen<DetachMessage>(EV_DETACH, e => openDetached(e.payload)),
    ];
    return () => { for (const u of subs) void u.then(f => f()); };
  }, [isMain, openDetached]);

  /** (메인 창) 켤 때 지난번 뗀 창들을 같은 자리에 다시 연다 — 설정을 다 읽은 뒤 한 번 */
  const windowsRestoredRef = useRef(false);
  useEffect(() => {
    if (!isMain || !hydrated || windowsRestoredRef.current) return;
    windowsRestoredRef.current = true;
    for (const w of xlogWindowsRef.current.values()) {
      usedWindowLabelsRef.current.add(w.label);
      const title = tabTitle(toXLogTabs(w.tabs, undefined, undefined).tabs[0]);
      openXLogWindow(w.label, title, { bounds: windowBoundsOf(w) }).catch(() => {
        // 못 열면 그 탭들을 이 창으로 들인다 — 어디에도 안 보이는 채로 남으면 안 된다
        setXLogWindows(r => removeWindow(r, w.label));
        setXLogTabs(s => importXLogTabs(s, toXLogTabs(w.tabs, undefined, undefined).tabs));
      });
    }
  }, [isMain, hydrated]);

  /** (뗀 창) 이 창의 탭을 전부 메인 창으로 보내고 닫는다 */
  const handleMergeWindow = useCallback(() => {
    if (!windowLabel) return;
    const msg: MergeMessage = { label: windowLabel, tabs: xlogTabsToPrefs(xlogTabsRef.current), close: true };
    void emit(EV_MERGE, msg).then(() => getCurrentWindow().destroy());
  }, [windowLabel]);
  const handleXLogTabDrop = useCallback((key: string, target: string, side: DropSide) => {
    setXLogTabs(s => dropXLogTab(s, key, target, side));
    if (key !== activeXLogKeyRef.current) {
      setSelectedXLogs([]);
      setClearSignal(n => n + 1);
    }
  }, []);
  const handleXLogPaneClose = useCallback((key: string) => {
    if (key === activeXLogKeyRef.current) setSelectedXLogs([]);
    setXLogTabs(s => closeXLogPane(s, key));
  }, []);
  const handleXLogRatioDelta = useCallback((d: number) => {
    setXLogTabs(s => setXLogRatio(s, s.ratio + d));
  }, []);
  const handleXLogTabAdd = useCallback(() => {
    setXLogTabs(addXLogTab);
    setSelectedXLogs([]);
  }, []);
  const handleXLogTabClose = useCallback((key: string) => {
    setXLogTabs(s => closeXLogTab(s, key));
    setSelectedXLogs([]);
  }, []);
  const handleXLogTabRename = useCallback((key: string, title: string) => {
    setXLogTabs(s => renameXLogTab(s, key, title));
  }, []);

  const removeServer = useCallback(
    (profile: ServerProfile) => {
      setServers(prev => {
        const next = prev.filter(x => displayName(x) !== displayName(profile));
        void persistServers(next, currentServer ?? '');
        return next;
      });
    },
    [persistServers, currentServer],
  );
  // 지금 탭의 고르기만 바꾼다 — 다른 탭은 저마다 고른 것을 본다
  const handleAgentSelectionChange = useCallback((hashes: Set<number>) => {
    // 왼쪽 목록이 해시만 넘기는 경로(«전부 풀기» 등). 그룹은 건드리지 않는다.
    setGroupSel(prev => ({ services: hashes.size === 0 ? new Set() : prev.services, hashes }));
  }, []);

  /**
   * 비활성 정리. 지운 뒤에는 명단도 비워 **다음 갱신을 기다리지 않는다.**
   *
   * 이름은 안 비운다 — 지운 오브젝트가 남긴 XLog 는 화면에 그대로 있고,
   * 그 이름을 잃으면 `#해시` 로 덮인다 (`agentNames.ts`).
   */
  const handleCleanupInactive = useCallback(async () => {
    await removeInactiveObjects();
    objectsRef.current = objectsRef.current.filter(a => a.alive);
    setObjects(objectsRef.current);
  }, []);

  /**
   * 자동 정리. **기본은 끕이다**(0) — 전역이라 남의 화면까지 바뀜다.
   *
   * 콜렉터가 죽은 오브젝트를 스스로 안 지우므로(F-60) ECS 처럼 Task 가 계속
   * 갈리는 곳에서는 명단이 끝없이 는다. 그런 곣에서만 켜면 된다.
   */
  useEffect(() => {
    // 정리는 메인 창 하나만 돌린다 — 창마다 돌리면 같은 정리를 여러 번 보낸다
    if (!isConnected || !isMain || autoRemoveInactiveMin <= 0) return;
    const timer = setInterval(
      () => { void handleCleanupInactive().catch(() => {}); },
      autoRemoveInactiveMin * 60_000,
    );
    return () => clearInterval(timer);
  }, [isConnected, isMain, autoRemoveInactiveMin, handleCleanupInactive]);

  const handleToggleService = useCallback(
    (name: string) => setGroupSel(prev => toggleService(prev, name)),
    [],
  );
  const handlePickTask = useCallback(
    (agent: AgentObject) =>
      setGroupSel(prev => pickTask(prev, agent, objectsRef.current, groupRule)),
    [],
  );

  /**
   * 고른 것을 **지금 명단 기준으로** 풀어 모든 탭에 적는다.
   *
   * 명단이 10초마다 갱신되므로, 새 Task 는 다시 고르지 않아도 저절로 들어오고
   * 죽은 Task 는 빠진다. «명단을 사진으로 찍어 두지 않는다» 가 이 기능의 핵심이다.
   */
  //
  // **내용이 같으면 같은 Set 을 돌려준다.** 명단은 10초마다 갱신되는데, 그때마다 새
  // Set 을 만들면 그걸 의존성으로 쓰는 탭·차트·목록이 전부 다시 선다 — Task 가
  // 하나도 안 바뀌었는데도 그렇다. ECS 에서는 그 갱신이 끝없이 돈다.
  //
  // **과거 구간을 보는 중이면 죽은 Task 까지 푼다** (`resolvePastSelection`). 그때 돌던 Task 가
  // 지금은 하나도 없을 수 있다(ECS 재배포). 후보는 지금 목록 · 그날 콜렉터 목록 · 이 앱이 본
  // 기록 셋이다 — 정리하면 지금 목록에서 빠지고, 오늘자 목록에 계속 남는다고 장담할 수 없다(F-61).
  const viewingPastRange = xlogMode === 'past' && pastRange !== null ? pastRange : null;
  const dailyObjects = usePastCandidates(viewingPastRange, isConnected, connectionEpoch);
  const pastCandidates = useMemo(
    () =>
      viewingPastRange === null
        ? null
        : mergeCandidates(objects, dailyObjects, [...objectHistory().values()].map(asAgent)),
    // objectHistory 는 명단을 받을 때 같이 갱신된다 — objects 가 바뀌는 것이 그 신호다
    [viewingPastRange, objects, dailyObjects],
  );
  const pickedKey = useMemo(
    () =>
      [...(pastCandidates
        ? resolvePastSelection(groupSel, pastCandidates, groupRule)
        : resolveSelection(groupSel, objects, groupRule))]
        .sort((a, b) => a - b)
        .join(','),
    [groupSel, objects, pastCandidates],
  );
  const pickedHashes = useMemo(
    () => new Set(pickedKey === '' ? [] : pickedKey.split(',').map(Number)),
    [pickedKey],
  );
  useEffect(() => {
    setXLogTabs(s => setTabResolved(s, s.activeKey, pickedHashes));
  }, [pickedHashes, xlogTabs.activeKey]);
  /**
   * **지금 탭이 아닌 실시간 탭도 명단을 따라간다.** 화면을 나눠 띄운 판은 지금 판이 아니어도
   * 보이고 있다 — 새 Task 가 떴는데 옆 판만 옛 해시로 묻고 있으면 안 된다.
   * 과거 탭은 그 탭을 볼 때 그날 목록까지 넣어 푼다(위). 과거 구간의 Task 는 이미 정해져 있다.
   */
  const otherSelSig = xlogTabs.tabs
    .filter(t => t.key !== xlogTabs.activeKey && t.mode === 'live')
    .map(t => `${t.key}:${[...t.selection.services].join(',')}/${[...t.selection.hashes].join(',')}`)
    .join('|');
  useEffect(() => {
    if (otherSelSig === '') return;
    setXLogTabs(s => {
      let next = s;
      for (const tab of s.tabs) {
        if (tab.key === s.activeKey || tab.mode !== 'live') continue;
        next = setTabResolved(next, tab.key, resolveSelection(tab.selection, objects, groupRule));
      }
      return next;
    });
  }, [otherSelSig, objects, groupRule]);
  /** 목록 정리(handleAgentsLoaded)가 과거 구간에 넣은 죽은 Task 를 도로 빼지 않게 한다 */
  const pickedHashesRef = useRef(pickedHashes);
  pickedHashesRef.current = pickedHashes;

  /** «안 골랐다» 와 «골랐는데 살아 있는 게 없다» 는 다른 일이다 */
  const pickState = useMemo(
    () =>
      pastCandidates
        ? pastSelectionState(groupSel, pastCandidates, groupRule)
        : selectionState(groupSel, objects, groupRule),
    [groupSel, objects, pastCandidates],
  );
  // 구간을 바꾸면 이전 구간에서 고른 트랜잭션은 의미가 없다. 같이 비운다.
  const handlePastRangeChange = useCallback((r: PastRange | null) => {
    setPastRange(r);
    setSelectedXLogs([]);
    setClearSignal(n => n + 1);
    clearDetail();
  }, [clearDetail]);
  const handleAgentsLoaded = useCallback((agents: AgentObject[]) => {
    rememberNames(agents);
    setAgentMap(allNames());
    // **목록에서 사라진 서버는 선택에서도 뺀다.** 남겨 두면 «3대 골랐는데 화면은
    // 비어 있다» 로 굳고, 다른 콜렉터로 갈아탄 뒤에는 그 해시가 영영 안 온다.
    // 내려간(alive=false) 서버는 목록에 남으므로 지우지 않는다 — 잠깐 멈춘 것일 수 있다.
    // 고르기가 푼 것은 남긴다 — 과거 구간에서는 목록에서 정리된 Task 도 일부러 넣는다.
    const listed = [...agents.map(a => a.obj_hash), ...pickedHashesRef.current];
    setFilter(prev => {
      const kept = prunePicked(prev.objHashSet, listed);
      return kept === prev.objHashSet ? prev : { ...prev, objHashSet: new Set(kept) };
    });
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
  /**
   * 되살릴 상세 탭들. 접속이 끝난 뒤에 연다 — 연결 전에는 콜렉터에 물을 수 없다.
   *
   * 한 번만 시도한다. 못 연 것을 계속 다시 물으면, 밀려난 트랜잭션 때문에
   * 접속할 때마다 조용한 실패가 반복된다.
   */
  const [pendingDetails, setPendingDetails] = useState<OpenDetail[]>([]);
  const restoredRef = useRef(false);
  /** 못 되살린 탭 수. 아무 말 없이 사라지면 «복원이 안 되는 앱» 으로 읽힌다 */
  const [restoreMissed, setRestoreMissed] = useState(0);

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
  // **걸러지기 전 원본을 푼다.** 거른 것만 풀면, 이름을 몰라 빠진 것은 끝내 안 풀려
  // 영영 빠진 채로 남는다.
  useEffect(() => {
    if (picked.xlogs.length === 0) return;
    const svc = [...new Set(picked.xlogs.map(x => x.service).filter(Boolean))];
    if (svc.length === 0) return;
    let cancelled = false;
    resolve('service', svc)
      .then(() => { if (!cancelled) setTextVersion(v => v + 1); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [picked, resolve]);

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
    setPicked({ xlogs, refilter: true });
    // 차트에서 새로 고른 것은 검색 결과가 아니다. 경고가 남아 있으면 거짓말이 된다.
    setWideTruncated(null);
    // 다른 구간을 고르면 이전 검색 결과는 그 구간의 것이 아니다. 남겨 두면
    // 목록이 엉뚱한 트랜잭션만 걸러 보여준다.
    resetSearch();
    // 사각형 안에 하나뿐이어도 지금 필터에 걸려 안 보이는 것이면 열지 않는다.
    const shown = xlogs.filter(passesNow);
    if (shown.length === 1) openDetail(shown[0]);
  }, [openDetail, resetSearch, passesNow]);
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
  /**
   * 다 못 찾았다 — 그 까닭과 어디까지 찾았나. null 이면 다 찾았거나 검색 결과가 아니다.
   *
   * 상한(기본 500)에 닿으면 구간을 나눠 이어 찾으므로(`wideSearchAll.ts`) 이제 «500 에서 잘림» 은
   * 없다. 남는 것은 1초에 상한을 넘는 빽빽한 구간, 모은 것이 너무 많아 멈춘 것, 멈춤을 누른 것이다.
   */
  const [wideTruncated, setWideTruncated] = useState<{
    kind: 'dense' | 'cap' | 'cancelled';
    max: number;
    stoppedAt: number | null;
  } | null>(null);
  const [wideProgress, setWideProgress] = useState<WideProgress | null>(null);
  const wideCancelRef = useRef(false);

  const runWideSearch = useCallback(
    (v: WideSearchValues) => {
      setWideRunning(true);
      wideCancelRef.current = false;
      setWideProgress({ found: 0, done: 0, requests: 0 });
      searchAll(v, searchXLogList, {
        cap: wideSearchMax,
        // 조각마다 바로 화면 모양으로 — 수십만 건을 날것과 바꾼 것 두 벌로 들지 않는다
        map: xlogPackToSXLog,
        onProgress: setWideProgress,
        isCancelled: () => wideCancelRef.current,
      })
        .then(res => {
          setShowWideSearch(false);
          setSelectedXLogs(res.xlogs);
          // 검색 결과는 차트에서 고른 구간이 아니다. 사각형을 남겨 두면
          // 목록이 그 구간의 것인 줄 알게 된다.
          setClearSignal(n => n + 1);
          resetSearch();
          setWideTruncated(
            res.cut === 'none' ? null : { kind: res.cut, max: res.limit.max, stoppedAt: res.stoppedAt },
          );
        })
        .catch(() => {})
        .finally(() => {
          setWideRunning(false);
          setWideProgress(null);
        });
    },
    [resetSearch, wideSearchMax],
  );

  const [showSettings, setShowSettings] = useState(false);

  /**
   * 저장본.
   *
   * 저장할 알맹이는 **지금 화면에 있는 상세 그대로**다 — 콜렉터에 다시 묻지 않는다.
   * 사전이 풀린 채로 들어가야 나중에 접속 없이도 이름이 나온다.
   */
  const [showSaved, setShowSaved] = useState(false);
  /** 조회 조건 창. 툴바 한 줄로는 두 줄짜리 조건을 못 만든다 */
  const [showFilters, setShowFilters] = useState(false);
  /**
   * 이름 붙여 담아 둔 조건들.
   *
   * 장애를 볼 때 거는 조건은 매번 새로 짜는 것이 아니라 몇 벌이 돌아가며 쓰인다.
   * **조건만** 담는다 — 서버 해시는 콜렉터마다 다르다(savedFilters).
   */
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);

  const persistSavedFilters = useCallback(async (list: SavedFilter[]) => {
    try {
      const cfg = await getConfig();
      await saveConfig({
        ...cfg,
        saved_filters: list.map(f => ({
          name: f.name,
          patterns: f.patterns.map(r => ({ field: r.field, text: r.text, exclude: r.exclude })),
          error_only: f.errorOnly,
          elapsed_ms: f.elapsedMs,
          elapsed_exclude: f.elapsedExclude,
        })),
      });
    } catch {
      // 담기 실패가 보던 화면을 되돌릴 이유는 없다. 이번 세션에서는 그대로 쓴다.
    }
  }, []);

  const saveCurrentFilter = useCallback(
    (name: string) => {
      setSavedFilters(prev => {
        const next = upsertSavedFilter(prev, filterToSaved(name, filter));
        void persistSavedFilters(next);
        return next;
      });
    },
    [filter, persistSavedFilters],
  );

  const deleteSavedFilter = useCallback(
    (name: string) => {
      setSavedFilters(prev => {
        const next = removeSavedFilter(prev, name);
        void persistSavedFilters(next);
        return next;
      });
    },
    [persistSavedFilters],
  );
  /** 방금 저장한 결과. 잠깐 띄우고 지운다 — 저장은 조용히 끝나면 됐는지 알 수 없다 */
  const [saveNote, setSaveNote] = useState<string | null>(null);

  const saveActiveDetail = useCallback(async () => {
    const active = detail.active;
    if (!active?.xlog || !active.profile) return;
    try {
      const path = await saveXLogProfile({
        service: getCached('service', active.xlog.service) ?? `0x${(active.xlog.service >>> 0).toString(16)}`,
        txid: active.xlog.txid,
        end_time: active.xlog.endTime,
        stamp: toFileStamp(active.xlog.endTime),
        xlog: active.xlog,
        profile: active.profile,
        texts: active.texts,
      });
      setSaveNote(path);
    } catch (e) {
      setSaveNote(String(e));
    }
  }, [detail.active, getCached]);

  // 저장 알림은 **읽을 시간만** 남긴다. 계속 떠 있으면 화면을 먹는다.
  useEffect(() => {
    if (saveNote === null) return;
    const id = setTimeout(() => setSaveNote(null), 4000);
    return () => clearTimeout(id);
  }, [saveNote]);

  /**
   * 껐을 때 열려 있던 상세 탭을 되살린다.
   *
   * **트랜잭션은 콜렉터에서 밀려난다.** 어제 열어 둔 것이 오늘 없을 수 있고 그건
   * 고장이 아니다 — 못 연 것은 건너뛰되 몇 개인지는 말한다.
   */
  useEffect(() => {
    if (!isConnected || restoredRef.current || pendingDetails.length === 0) return;
    restoredRef.current = true;

    let missed = 0;
    void Promise.all(
      pendingDetails.map(d =>
        getXLogDetail(d.txid, d.date)
          .then(pack => openDetailTab(xlogPackToSXLog(pack)))
          .catch(() => { missed += 1; }),
      ),
    ).then(() => setRestoreMissed(missed));
  }, [isConnected, pendingDetails, openDetailTab]);

  // 안내는 읽을 시간만 남긴다.
  useEffect(() => {
    if (restoreMissed === 0) return;
    const id = setTimeout(() => setRestoreMissed(0), 6000);
    return () => clearTimeout(id);
  }, [restoreMissed]);

  /**
   * 실시간 스트림 대상을 **고른 서버로 좁힌다.**
   *
   * 지금까지는 접속할 때 받은 전체 오브젝트로 스트림을 열고, 화면에서 걸러 그렸다.
   * 서버가 스무 대 넘는 환경에서는 **보지도 않을 열아홉 대의 XLog 를 계속 받아**
   * 버퍼가 그것들로 차고(상한이 금방 걸린다), 직렬화·전송도 그만큼 든다.
   *
   * 콜렉터는 objHash 목록으로 걸러 준다 — 실시간 스트림이 원래 그 파라미터를 받는다.
   * 고른 것이 없으면 전체다.
   *
   * **같은 목록이면 다시 열지 않는다.** 스트림을 다시 열면 최신 10,000건을 새로 받으므로,
   * 렌더마다 열면 그것만으로 앱이 바쁘다.
   */
  const streamHashesRef = useRef<string>('');
  /**
   * 어느 접속에서 연 스트림인가.
   *
   * **같은 목록이라도 서버를 갈아탔으면 다시 열어야 한다.** objHash 는 objName 의
   * 해시라(F-35) 개발·운영이 같은 이름을 쓰면 **해시까지 같다** — 그러면 «같은 목록»
   * 으로 보여 새 서버에서 스트림을 안 열고, 화면이 조용히 빈 채로 남는다.
   */
  const streamEpochRef = useRef(connectionEpoch);
  /**
   * F5 를 누른 횟수.
   *
   * 실시간은 «다시 받을 것» 이 없어 보이지만, **끊긴 스트림을 되살리는 수단**이 된다.
   * 스트림이 죽은 채로 있으면 화면은 조용히 비어 가는데, 그때 누를 것이 없었다.
   */
  const streamReloadRef = useRef(refreshSignal);
  /**
   * 스트림으로 받을 서버 — 지금 탭과 **화면에 띄운 실시간 판 전부**의 것을 합친다.
   *
   * 스트림은 하나라 지금 탭 것만 받으면, 나눠 띄운 옆 판은 지금 탭과 겹치는 서버의 점만 받았다.
   * 판마다 제 서버만 그리므로(`filter.objHashSet`) 합쳐 받아도 섞이지 않는다.
   */
  const liveVisible = xlogTabs.tabs.filter(t => xlogTabs.panes.includes(t.key) && t.mode === 'live');
  const streamKey = (() => {
    const set = new Set<number>(filter.objHashSet);
    for (const tab of liveVisible) for (const h of tab.filter.objHashSet) set.add(h);
    return [...set].sort((a, b) => a - b).join(',');
  })();
  const anyLivePane = liveVisible.length > 0;
  useEffect(() => {
    // **과거를 보는 동안에는 받지 않는다.** 과거 구간을 조회하는 중에도 실시간 폴링이
    // 500ms 마다 돌고 있었다 — 보지도 않을 것을 받느라 콜렉터·네트워크를 같이 쓰고,
    // 운영에서는 그 폴링이 먼저 끊겨 «스트리밍 오류» 배너가 조회를 덮었다.
    //
    // **Active 탭은 예외다.** 거기 트래픽 차트가 이 스트림을 쓰므로, XLog 탭을
    // 보면서 과거 모드일 때만 멈춘다.
    // 판을 나눠 두었으면 **띄운 판이 전부 과거일 때만** 멈춘다
    const viewingPast = activeTab === 'xlog' && !anyLivePane;
    if (!isConnected || viewingPast) {
      if (streamHashesRef.current !== '') {
        streamHashesRef.current = '';
        stopXLogStream().catch(() => {});
      }
      return;
    }
    if (streamEpochRef.current !== connectionEpoch) {
      streamEpochRef.current = connectionEpoch;
      streamHashesRef.current = '';
    }
    if (streamReloadRef.current !== refreshSignal) {
      // 같은 목록이라도 다시 연다 — 되살리는 것이 목적이다.
      streamReloadRef.current = refreshSignal;
      streamHashesRef.current = '';
    }
    // **고른 것이 곧 받는 것이다.** 예전에는 빈 선택을 «전부» 로 읽어 접속하자마자
    // 100대의 XLog 를 받았다 (agentFilter.ts 머리말).
    const hashes = streamKey === '' ? [] : streamKey.split(',').map(Number);

    if (hashes.length === 0) {
      // 고르기를 다 풀었으면 받던 것도 멈춘다. 화면은 비어 있는데 트래픽만 도는 상태가
      // 남으면, 다시 골랐을 때 지난 것이 섞여 들어온다.
      if (streamHashesRef.current !== '') {
        streamHashesRef.current = '';
        stopXLogStream().catch(() => {});
      }
      return;
    }

    if (streamKey === streamHashesRef.current) return;
    streamHashesRef.current = streamKey;
    startXLogStream(hashes).catch(() => {});
  }, [isConnected, streamKey, anyLivePane, connectionEpoch, activeTab, refreshSignal]);

  /**
   * 과거 조회 대상.
   *
   * **`counterHashes.javaee` 를 쓰고 있었다.** 그 목록은 objType 이
   * `tomcat`·`java`·`jboss`·`jetty`·`resin` 인 것만 담는데, 운영에서는 objType 이
   * 시스템 이름(`CJFW`·`PRD-ORD`…)으로 쓰인다(B-7). 그래서 목록이 비고,
   * 대상이 0개면 조회 자체를 건너뛰어 **과거 조회가 통째로 안 먹었다.**
   * 로컬 테스트 환경은 `tomcat` 이라 드러나지 않았다.
   *
   * XLog 가 보는 것은 Family 가 아니라 **지금 고른 서버**다. 아무것도 안 골랐으면
   * 조회할 것도 없다 — 실시간 스트림과 같은 규칙이다.
   *
   * 차트에는 **그 탭의** 것을 넣는다(탭마다 딸로 든다). 여기는 그 밖의
   * 쓰는 곳을 위해 활성 탭 기준으로 남겨 둔다.
   */

  /**
   * 지금 그릴 오브젝트를 Family 로 나눈 것.
   *
   * `counterHashes` 는 **붙어 있는 것 전부**이고, 화면에 올릴 것은 그중 고른 것뿐이다.
   * 둘을 섞어 쓰면 «3대 골랐는데 차트에는 100줄» 이 된다.
   */
  const shownHashes = useMemo(() => {
    const picked = filter.objHashSet;
    return {
      javaee: counterHashes.javaee.filter(h => picked.has(h)),
      host: counterHashes.host.filter(h => picked.has(h)),
      datasource: counterHashes.datasource.filter(h => picked.has(h)),
    };
  }, [counterHashes, filter.objHashSet]);

  /** 고른 서버들의 종류 — 종류 단위 요청은 이 종류마다 한 번씩 묻고 합친다 */
  const pickedJavaeeTypes = useMemo(
    () => typesOf(shownHashes.javaee, objTypeOf),
    [shownHashes.javaee, objTypeOf],
  );
  const pickedHostTypes = useMemo(
    () => typesOf(shownHashes.host, objTypeOf),
    [shownHashes.host, objTypeOf],
  );

  /**
   * 값을 받아야 할 커넥션 풀 — **고른 WAS 아래 것까지 스스로 찾는다.**
   *
   * 예전에는 고른 것만 받았다. 그런데 풀을 보려면 왼쪽 목록에서 `datasource`
   * 오브젝트를 따로 골라야 했고, 어느 것이 내가 보는 WAS 의 풀인지는 목록만 봐서는
   * 알 수 없었다 — 이름이 다 `HikariPool-1` 이다.
   *
   * 부모는 이름으로 **확정적으로** 안다 (`poolsUnder` 주석 참고). 고른 것에 이걸
   * 더해 받되, **고르기 자체는 건드리지 않는다** — 고르기는 XLog 대상이기도 해서
   * 여기서 손대면 사용자가 고르지 않은 서버의 점이 스캐터에 섞인다.
   */
  const poolHashes = useMemo(() => {
    const entries = counterHashes.datasource.map(h => ({
      objHash: h,
      objName: agentMap.get(h) ?? '',
    }));
    const parents = shownHashes.javaee.map(h => agentMap.get(h) ?? '');
    return [...new Set([...shownHashes.datasource, ...poolsUnder(entries, parents)])];
  }, [counterHashes.datasource, shownHashes.datasource, shownHashes.javaee, agentMap]);

  /**
   * 카운터도 **고른 서버 것만** 받는다.
   *
   * 예전에는 붙어 있는 오브젝트 전부를 요청했다. 서버가 100대면 2초마다 오브젝트
   * 100개짜리 요청이 나가고, 화면은 그중 몇 대만 그린다 — 나머지는 받아서 버린다.
   *
   * **고른 WAS 아래 커넥션 풀은 더해서 받는다.** 풀은 부모와 별개의 오브젝트라
   * (F-41) 안 더하면 값이 영영 안 온다. 늘어나는 것은 한 요청에 담기는 objHash 몇
   * 개뿐이고, 요청 수는 그대로다.
   */
  const counterStreamRef = useRef<string>('');
  /** XLog 쪽과 같은 이유 — 이름이 같으면 해시도 같아서 «같은 목록» 으로 보인다 */
  const counterEpochRef = useRef(connectionEpoch);
  useEffect(() => {
    // 카운터 스트림도 하나다 — 뗀 창이 제 고르기로 다시 열면 메인 창 Counter 화면이 바뀐다
    if (!isConnected || !isMain) { counterStreamRef.current = ''; return; }
    if (counterEpochRef.current !== connectionEpoch) {
      counterEpochRef.current = connectionEpoch;
      counterStreamRef.current = '';
    }
    const hashes = [...new Set([...filter.objHashSet, ...poolHashes])];

    if (hashes.length === 0) {
      if (counterStreamRef.current !== '') {
        counterStreamRef.current = '';
        stopCounterStream().catch(() => {});
      }
      return;
    }

    const key = hashes.slice().sort((a, b) => a - b).join(',');
    if (key === counterStreamRef.current) return;
    counterStreamRef.current = key;
    startCounterStream(hashes, ALL_CHART_COUNTERS).catch(() => {});
  }, [isConnected, isMain, filter.objHashSet, poolHashes, connectionEpoch]);

  /** 아무것도 안 골랐는가. 화면마다 «고르세요» 로 갈리는 자리다 */
  const nothingPicked = filter.objHashSet.size === 0;
  /**
   * 빈 화면에 적을 말.
   *
   * **«안 골랐다» 와 «고른 서비스가 통째로 내려갔다» 는 다른 일이다.**
   * 둘 다 비어 보이지만 할 일이 다르다 — 앞은 고르면 되고, 뒤는 그 서비스가
   * 지금 한 대도 안 떠 있다는 뜻이다. 같은 문구를 보여 주면 «앱이 고장났나» 를
   * 먼저 의심하게 된다.
   */
  const emptyPickText =
    pickState === 'empty-group'
      ? pastCandidates
        // 과거 구간은 죽은 Task 까지 찾는다 — 그래도 없으면 «살아 있는 것이 없다» 가 아니다
        ? t('고른 서비스의 Task 를 이 날짜 기록에서 찾지 못했습니다.')
        : t('고른 서비스에 살아 있는 Task 가 없습니다.')
      : t('왼쪽에서 볼 서버를 고르세요.');

  const xlogTabLabels = useMemo(() => xlogTabLabelsOf(xlogTabs.tabs), [xlogTabs.tabs]);
  /**
   * 고른 점은 **지금 판의 것만** 목록으로 받는다. 판을 누르는 순간 지금 판이 바뀌므로
   * (XLogSplit) 끌어서 고른 판이 곧 지금 판이지만, 옆 판이 늦게 알려 오는 것은 버린다.
   */
  const handleXLogSelectRef = useRef(handleXLogSelect);
  handleXLogSelectRef.current = handleXLogSelect;
  /**
   * 판마다 **같은 함수**를 넘긴다. 차트는 memo 라, 그릴 때마다 새 화살표 함수를 주면
   * App 이 다시 그릴 때마다(명단 갱신 10초 등) 판 넷이 통째로 다시 그려진다.
   */
  const paneHandlersRef = useRef(new Map<string, {
    select: (xlogs: SXLog[]) => void;
    config: (c: Partial<XLogChartConfig>) => void;
    range: (r: PastRange | null) => void;
  }>());
  const paneHandlers = (key: string) => {
    let h = paneHandlersRef.current.get(key);
    if (!h) {
      h = {
        select: xlogs => {
          if (key === activeXLogKeyRef.current) handleXLogSelectRef.current(xlogs);
        },
        // 휠·Ctrl+휠은 **그 판을** 고친다 — 휠은 판을 누르지 않으므로 지금 판이 아닐 수 있다
        config: c => setXLogTabs(s => patchXLogTab(s, key, t0 => ({ config: { ...t0.config, ...c } }))),
        range: r => setXLogTabs(s => patchXLogTab(s, key, () => ({ pastRange: r }))),
      };
      paneHandlersRef.current.set(key, h);
    }
    return h;
  };
  /** 해시 배열도 같은 Set 이면 같은 배열을 준다 (위와 같은 이유) */
  const hashArraysRef = useRef(new WeakMap<ReadonlySet<number>, number[]>());
  const hashArray = (set: ReadonlySet<number>) => {
    let a = hashArraysRef.current.get(set);
    if (!a) { a = [...set]; hashArraysRef.current.set(set, a); }
    return a;
  };
  const renderXLogTab = useCallback(
    (tab: XLogTab, visible: boolean) => {
      // **안 골랐으면 그리지 않는다.** 차트에 «0 dots» 만 떠 있으면
      // 트래픽이 없는 것인지 안 고른 것인지 구별되지 않는다.
      // 지금 판이 아니면 그 판의 고르기 사정을 따로 풀지 않는다 — 고르라는 말만 한다.
      if (visible && isConnected && tab.filter.objHashSet.size === 0) {
        return (
          <EmptyState
            text={tab.key === xlogTabs.activeKey ? emptyPickText : t('이 판을 누르고 왼쪽에서 볼 서버를 고르세요.')}
          />
        );
      }
      return (
        <XLogChart
          config={tab.config}
          filter={tab.filter}
          onSelect={paneHandlers(tab.key).select}
          connected={isConnected}
          connectionEpoch={connectionEpoch}
          clearSignal={clearSignal}
          pastRange={tab.pastRange}
          refreshSignal={refreshSignal}
          objHashes={hashArray(tab.filter.objHashSet)}
          onConfigChange={paneHandlers(tab.key).config}
          onPastRangeChange={paneHandlers(tab.key).range}
          active={visible}
        />
      );
    },
    // paneHandlers·hashArray 는 ref 위의 캐시라 deps 가 아니다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isConnected, xlogTabs.activeKey, emptyPickText, connectionEpoch, clearSignal, refreshSignal],
  );

  /**
   * 고른 서버들이 속한 Family.
   *
   * 지표마다 주는 Family 가 정해져 있다 — CPU 는 host 만 준다. tomcat 만 골라 두면
   * CPU 값이 영영 안 오는데, 그걸 «수집이 안 된다» 로 읽으면 엉뚱한 데를 뒤진다.
   */
  const pickedFamilies = useMemo(() => {
    const out = new Set<string>();
    if (shownHashes.javaee.length > 0) out.add('javaee');
    if (shownHashes.host.length > 0) out.add('host');
    if (shownHashes.datasource.length > 0) out.add('datasource');
    return out;
  }, [shownHashes]);

  /** Ctrl+F 로 옮겨 갈 자리 */
  const searchInputRef = useRef<HTMLInputElement>(null);
  /**
   * 트랜잭션 목록이 어느 열로 서 있는가.
   *
   * **실시간과 과거가 한 상태를 쓴다.** 모드마다 따로 두면 오갈 때마다 목록이
   * 뒤집혀 읽던 자리를 잃는다 (`xlogSort.DEFAULT_SORT` 주석).
   */
  const [tableSort, setTableSort] = useState<SortState>(DEFAULT_SORT);
  const handleSort = useCallback((key: SortKey) => setTableSort(cur => nextSort(cur, key)), []);

  /**
   * 격자에서 서버 한 대를 눌렀을 때.
   *
   * **조건을 갈아 끼운다.** 기존 조건에 더하면 «한 대만 보려고 눌렀는데 두 대가 나온다» 가
   * 된다. 응답시간·에러 조건은 그대로 두는데, 그건 «무엇을 보려던 참인가» 라서
   * 서버를 바꿔도 유지되는 편이 맞다.
   */
  const drillToXLog = useCallback((objHash: number) => {
    // 고르기를 그 한 대로 바꾼다 — 해시만 적으면 다음 명단 갱신 때 고르기에서 다시 풀려 사라진다
    setXLogTabs(s => patchActiveTab(s, { selection: { services: new Set(), hashes: new Set([objHash]) } }));
    setActiveTab('xlog');
  }, []);

  /**
   * 순위표에서 서비스 하나를 눌렀을 때.
   *
   * **서버 고르기는 건드리지 않는다.** 위 격자는 «이 서버 한 대» 로 좁히는 것이지만
   * 여기서 고른 것은 이름 하나라, 어느 서버를 보고 있었는지는 그대로 두는 편이 맞다.
   *
   * 조건은 **서비스 자리만** 갈아 끼운다 — IP 조건은 «무엇을 보려던 참인가» 라서
   * 서비스를 바꿔도 유지되는 편이 맞다 (`drillToXLog` 와 같은 규칙).
   */
  const drillToService = useCallback((serviceName: string) => {
    setFilter(prev => ({
      ...prev,
      patterns: [
        ...prev.patterns.filter(r => r.field !== 'service'),
        { field: 'service' as const, text: serviceName, exclude: false },
      ],
    }));
    setActiveTab('xlog');
  }, []);

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
    // 뗀 창은 XLog 만 띄운다 — 다른 화면으로 가는 단축키는 안 듣는다
    'tab-active': () => { if (isMain) setActiveTab('active'); },
    'tab-visualize': () => { if (isMain) setActiveTab('visualize'); },
    'tab-counter': () => { if (isMain) setActiveTab('counter'); },
    'tab-alert': () => { if (isMain) setActiveTab('alert'); },
    'open-settings': () => setShowSettings(true),
    'toggle-mode': () => setXLogMode(m => (m === 'live' ? 'past' : 'live')),
    /**
     * F5 — **웹뷰를 통째로 다시 띄우지 않는다.** 그러면 접속·고른 서버·열어 둔 상세가
     * 다 날아간다. 지금 보는 화면의 **데이터만** 다시 받는다:
     *   XLog 과거  구간을 다시 조회
     *   XLog 실시간 스트림을 다시 연다 (끊긴 것을 되살리는 수단)
     *   Active     지금 한 번 더 묻는다
     *   Counter·Visualize  패널들을 다시 세워 받는다
     */
    reload: () => setRefreshSignal(n => n + 1),
  });

  const isStreaming = isConnected;
  const hasDetail = detail.tabs.length > 0;
  const hasSelected = selectedXLogs.length > 0;
  /**
   * 고른 구간의 요약.
   *
   * **축을 따라간다** — 점 높이가 SQL Time 인데 요약이 Elapsed 를 말하면
   * «왜 3초짜리가 맨 밑에 있나» 가 다시 시작된다 (`formatYValue` 주석 참고).
   */
  const selection = useMemo(
    () => selectionStats(selectedXLogs, config.yAxisMode),
    [selectedXLogs, config.yAxisMode],
  );

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
          <span className="text-title leading-none font-semibold tracking-tight text-accent-bright">N</span>
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

        {/* 탐색 — 유일하게 밝은 요소여야 현재 위치가 읽힌다. 뗀 창은 XLog 만 띄운다 */}
        {!isMain && <span className="text-micro text-fg-dim">XLog · {t('떼어 낸 창')}</span>}
        {isMain && <nav className="flex items-center gap-0.5" aria-label={t('화면 전환')}>
          {(['xlog', 'active', 'visualize', 'counter', 'alert'] as TabId[]).map(tab => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                aria-current={active ? 'page' : undefined}
                // 탭은 늘 윤곽을 두르면 다섯 개가 상자로 늘어선다. 고른 것만 세운다.
                className={`btn-ghost px-2.5 py-1 text-body transition-colors ${
                  active ? 'border-accent bg-accent/15 text-accent-bright' : ''
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            );
          })}
        </nav>}

        <div className="flex-1" />

        {/* 뗀 창 — 접속·서버 전환·설정은 메인 창이 한다. 할 일은 합치기뿐이다 */}
        {!isMain && (
          <button
            type="button"
            onClick={handleMergeWindow}
            title={t('이 창의 탭을 전부 메인 창으로 보내고 창을 닫습니다')}
            className="btn px-2 py-0.5 text-micro"
          >
            {t('메인 창으로 합치기')}
          </button>
        )}
        {/* 상태·설정 — 평소엔 조용히 물러나 있어야 한다 */}
        {isMain && <div className="flex items-center gap-2">
          <ServerSwitcher
            profiles={servers}
            current={isConnected ? currentServer : null}
            busy={switching}
            onSwitch={switchServer}
            onRemove={removeServer}
            onRename={renameServer}
          />
          <ConnectionDialog
            isConnected={isConnected}
            onConnected={handleConnected}
            onDisconnected={handleDisconnected}
            prefill={prefill}
            onConnectedProfile={rememberServer}
          />
          <AlertPanel
            alerts={alertStream.alerts}
            unread={unreadShown}
            onClear={alertStream.clear}
            onMarkRead={alertStream.markRead}
            onBadgeClick={handleAlertBadgeClick}
          />
          {/* 로그 레벨은 **설정 창으로 옮겼다.** 여기 있던 것은 라벨이 없어서,
              «로그 좀 받아 주세요» 를 받은 사람이 설정 창을 뒤지다 못 찾았다.
              두 군데 두면 각자 제 상태를 들고 있어 서로 다른 값을 보여준다. */}
          {/* 콜렉터 설정 — **붙어 있을 때만.** 데모는 콜렉터가 없어 물을 곳이 없다 */}
          {isConnected && !isDemo && (
            <button
              onClick={() => setShowCollectorConfig(true)}
              title={t('지금 붙은 콜렉터의 설정을 보고 고칩니다')}
              className="btn px-2 py-0.5 text-micro"
            >
              {t('콜렉터 설정')}
            </button>
          )}
          <button
            onClick={() => setShowSettings(true)}
            title={t('설정')}
            aria-label={t('설정')}
            className="btn-ghost px-1.5 py-1"
          >
            ⚙
          </button>
        </div>}
      </header>



      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showCollectorConfig && (
        <ConfigSettingsDialog
          target={{ kind: 'collector', name: currentServer ?? serverId }}
          onClose={() => setShowCollectorConfig(false)}
        />
      )}
      {showFilters && (
        <FilterDialog
          filter={filter}
          onChange={handleFilterChange}
          onClose={() => setShowFilters(false)}
          selectedServers={filter.objHashSet.size}
          saved={savedFilters}
          onSave={saveCurrentFilter}
          onDelete={deleteSavedFilter}
        />
      )}
      {showSaved && (
        <SavedProfileDialog
          onOpen={detail.openSaved}
          onClose={() => setShowSaved(false)}
        />
      )}
      {/* 되살리지 못한 탭이 있으면 말한다. 조용히 사라지면 «복원이 안 되는 앱» 으로 읽힌다 —
          트랜잭션이 콜렉터에서 밀려나는 것은 고장이 아니다 */}
      {restoreMissed > 0 && (
        <div className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded border border-line-strong bg-surface px-3 py-1.5 text-micro text-fg-muted shadow">
          {t('열어 두었던 상세')} {restoreMissed}{t('개는 콜렉터에 남아 있지 않아 열지 못했습니다')}
        </div>
      )}
      {saveNote && (
        <div className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded border border-line-strong bg-surface px-3 py-1.5 text-micro text-fg-muted shadow">
          {t('저장했습니다')} · <span className="font-mono text-fg-dim">{saveNote}</span>
        </div>
      )}
      {showWideSearch && (
        <WideSearchDialog
          agents={[...agentMap].map(([obj_hash, obj_name]) => ({ obj_hash, obj_name }) as AgentObject)}
          running={wideRunning}
          progress={wideProgress}
          cap={wideSearchMax}
          onCancel={() => { wideCancelRef.current = true; }}
          onSearch={runWideSearch}
          onClose={() => setShowWideSearch(false)}
        />
      )}

      {/* ── 서버 고르기는 화면(XLog·Active·Counter) 바깥이다 ──
          세 화면이 **지금 XLog 탭의 선택**을 쓴다. 화면마다 따로 고르게 두면 서버가 100대인 곳에서
          같은 일을 세 번 해야 하고, 화면을 옮길 때마다 무엇을 보고 있는지가 달라진다.
          XLog 탭끼리는 따로다 (`xlogTabs.ts`).
          알림은 여기 걸리지 않는다 — 안 보기로 한 서버가 죽는 것이야말로 알아야 한다.
          **그래서 Alert 탭에서는 목록을 접는다** — 고를 것이 없는데 자리만 차지하면 알림 줄이 좁아진다.
          지우지 않고 숨긴다 — 펼쳐 둔 묶음·스크롤이 돌아왔을 때 그대로여야 한다. */}
      <div ref={xlogWsRef} className="flex min-h-0 flex-1 overflow-hidden bg-base p-1">
        <Pane
          title="Services"
          className="shrink-0"
          // 클래스(hidden)로 숨기면 Pane 의 flex 와 부딪쳐 어느 쪽이 이길지 순서에 달린다
          style={activeTab === 'alert' ? { width: servicesW, display: 'none' } : { width: servicesW }}
        >
          <AgentSelectorPanel
            isConnected={isConnected}
            selectedHashes={filter.objHashSet}
            onSelectionChange={handleAgentSelectionChange}
            selectedServices={groupSel.services}
            onToggleService={handleToggleService}
            onPickTask={handlePickTask}
            onCleanup={handleCleanupInactive}
            onAgentsLoaded={handleAgentsLoaded}
            groupBy={agentGroupBy}
            onGroupByChange={setAgentGroupBy}
          />
        </Pane>

        {activeTab !== 'alert' && <Divider
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
        />}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">

      {/* ── XLog 탭 ── */}
      {activeTab === 'xlog' && (
        <div style={tabBodyStyle}>
          {/* 탭 줄은 툴바 **위**다 — 툴바는 «지금 탭의 조건» 이라 그 안에 들어가야 한다 */}
          <XLogTabBar
            tabs={xlogTabs.tabs}
            activeKey={xlogTabs.activeKey}
            panes={xlogTabs.panes}
            onDetach={handleXLogTabDetach}
            onSendToMain={isMain ? undefined : handleSendTabToMain}
            onActivate={handleXLogTabActivate}
            onClose={handleXLogTabClose}
            onAdd={handleXLogTabAdd}
            onRename={handleXLogTabRename}
          />
          {/* 탭마다 따로 세운다 — 툴바가 쥔 입력 중인 과거 구간이 탭을 옮겨도 남아,
              다른 탭의 날짜가 칸에 떠 있었다 */}
          <XLogToolbar
            key={xlogTabs.activeKey}
            config={config}
            filter={filter}
            onConfigChange={handleConfigChange}
            onFilterChange={handleFilterChange}
            mode={xlogMode}
            onModeChange={setXLogMode}
            pastRange={pastRange}
            onPastRangeChange={handlePastRangeChange}
            onWideSearch={() => setShowWideSearch(true)}
            onOpenSaved={() => setShowSaved(true)}
            onOpenFilters={() => setShowFilters(true)}
          />
          {/* 분할 배치.
              이전에는 워크스페이스를 재서 패널을 절대 좌표로 놓았다. 측정값이 실제
              가용 공간과 어긋나면 패널 아래가 창 밖으로 나가 **하단 목록이 잘렸다.**
              flex 로 두면 넘칠 수가 없고, 경계를 끌어 크기를 바꿀 수 있다.
              wsSize 는 이제 배치가 아니라 **끌기 한계 계산에만** 쓴다. */}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <Pane title="XLog" className="min-h-0 flex-1">
                {/* 탭을 전부 띄워 두고 판에 놓인 것만 보인다 (XLogSplit).
                    받고 그리는 것은 **보이는 판만** 한다(`active`) — 안 그러면 탭 수만큼
                    같은 스트림이 쌓이고 숨겨둔 판에 매 프레임 헛돈을 쓴다. */}
                <XLogSplit
                  tabs={xlogTabs.tabs}
                  labels={xlogTabLabels}
                  panes={xlogTabs.panes}
                  activeKey={xlogTabs.activeKey}
                  dir={xlogTabs.dir}
                  ratio={xlogTabs.ratio}
                  renderTab={renderXLogTab}
                  onFocus={handleXLogTabActivate}
                  onDrop={handleXLogTabDrop}
                  onClosePane={handleXLogPaneClose}
                  onDetach={handleXLogTabDetach}
                  onRatioDelta={handleXLogRatioDelta}
                />
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
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 whitespace-nowrap text-micro normal-case text-fg-dim">
                        <span className="tnum font-mono text-fg-muted">
                          {selectedXLogs.length}
                        </span>
                        {t('건')}
                        {selectedXLogs.length > XLOG_TABLE_LIMIT && (
                          <span className="text-fg-faint"> · {t('느린 순')} {XLOG_TABLE_LIMIT}{t('건')}</span>
                        )}
                      </span>
                      {/* 끌고 나면 다음 질문은 늘 같다 — «얼마나 느렸고 몇 개가 터졌나».
                          건수만 적혀 있으면 그 답을 목록을 훑어 눈으로 세야 한다. */}
                      <SelectionSummary stats={selection} />
                      {/* **서버는 잘렸다는 신호를 주지 않는다.** 여기서 말하지 않으면
                          없는 트랜잭션을 없다고 믿게 된다 (F-54). */}
                      {wideTruncated && (
                        <span
                          className="shrink-0 whitespace-nowrap rounded border border-warn/50 px-1 text-micro normal-case text-warn"
                          title={
                            wideTruncated.kind === 'dense'
                              ? t('1초 안에 서버 상한보다 많이 걸리는 구간이 있어, 그 1초는 상한만큼만 담았습니다. 조건을 좁히면 다 나옵니다.')
                              : t('뒤쪽은 찾지 않았습니다. 구간을 그 뒤로 잡아 다시 찾으십시오.')
                          }
                        >
                          {wideTruncated.kind === 'dense'
                            ? `${t('빽빽한 구간은 1초에')} ${wideTruncated.max.toLocaleString()}${t('건까지만')}`
                            : `${wideTruncated.kind === 'cap'
                                ? `${wideSearchMax.toLocaleString()}${t('건에서 멈춤')}`
                                : t('찾다 멈춤')} — ${wideTruncated.stoppedAt === null ? '' : formatTime(wideTruncated.stoppedAt)}${t('까지 찾음')}`}
                        </span>
                      )}
                      <button
                        onClick={handleClearSelection}
                        title={t('선택 해제')}
                        aria-label={t('선택 해제')}
                        className="shrink-0 rounded px-1 text-micro text-fg-faint hover:text-fg"
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
                      yAxisMode={config.yAxisMode}
                      sort={tableSort}
                      onSort={handleSort}
                      colWidths={xlogCols}
                      onColWidthsChange={setXLogCols}
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
                    onSave={detail.activeKey?.startsWith('file:') ? undefined : saveActiveDetail}
                    fromFile={detail.activeKey?.startsWith('file:') ?? false}
                  />
                </Pane>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Active 탭 ── */}
      {/* 「지금 이 순간 무엇이 걸려 있는가」. 나머지 탭은 전부 이미 지나간 것을 본다. */}
      {activeTab === 'active' && (
        <div style={tabBodyStyle}>
          {!isConnected ? (
            <EmptyState text={t('연결 후 사용 가능합니다.')} />
          ) : nothingPicked ? (
            <EmptyState text={emptyPickText} />
          ) : (
            <ActiveTab
              enabled={activeTab === 'active'}
              javaeeTypes={pickedJavaeeTypes}
              picked={filter.objHashSet}
              expectedHashes={shownHashes.javaee}
              agentMap={agentMap}
              poolHashes={poolHashes}
              anyDatasource={counterHashes.datasource.length > 0}
              connectionEpoch={connectionEpoch}
              refreshSignal={refreshSignal}
            />
          )}
        </div>
      )}

      {/* ── Visualize 탭 ── */}
      {/* Counter 탭과 나눠 둔 이유는 VisualizeTab.tsx 머리말 참고 —
          여기는 «지금 정상인가», 저기는 «무엇이 어떻게 변했나» 다. */}
      {activeTab === 'visualize' && (
        <div style={tabBodyStyle}>
          {!isConnected ? (
            <EmptyState text={t('연결 후 사용 가능합니다.')} />
          ) : nothingPicked ? (
            <EmptyState text={emptyPickText} />
          ) : (
            /* **F5 는 패널을 다시 세운다.** 이 탭의 패널마다 조회 훅이 따로 있어
               신호를 일일이 내려보내면 손이 많이 가고 빠뜨리기 쉽다. 다시 세우면
               전부가 한 번에 다시 받는다 — 대신 패널 안의 펼침·정렬 같은 상태는
               초기화된다(접속·고른 서버·필터는 이 바깥에 있어 그대로다). */
            <VisualizeTab
              key={`visualize-${refreshSignal}`}
              enabled={activeTab === 'visualize'}
              javaeeTypes={pickedJavaeeTypes}
              hostTypes={pickedHostTypes}
              picked={filter.objHashSet}
              javaeeHashes={shownHashes.javaee}
              families={pickedFamilies}
              agentMap={agentMap}
              onDrill={drillToXLog}
              onDrillService={drillToService}
            />
          )}
        </div>
      )}

      {/* ── Counter 탭 ── */}
      {/* **Counter 탭은 떠나도 내리지 않고 숨긴다.** 카운터 스트림은 탭과 무관하게 고른
          서버 것을 계속 받는데, 차트는 쌓아 둔 표본을 자기 안에 든다. 탭을 오갈 때마다
          새로 세우면 그동안 받은 것을 버리고 0 부터 다시 쌓아, 들어올 때마다 선이 오른쪽
          끝에만 붙어 있었다. 폴링하는 패널은 `enabled` 로 탭이 보일 때만 돈다. */}
      {isMain && (activeTab === 'counter' || isConnected) && (
        <div style={activeTab === 'counter' ? tabBodyStyle : HIDDEN_TAB_STYLE}>
          {!isConnected ? (
            <EmptyState text={t('연결 후 사용 가능합니다.')} />
          ) : nothingPicked ? (
            <EmptyState text={emptyPickText} />
          ) : (
            /* F5 — Visualize 탭과 같은 규칙으로 패널을 다시 세운다 */
            <div key={`counter-${refreshSignal}`} className="min-h-0 flex-1 overflow-y-auto p-3">
              {/* 추세(카운터 차트)보다 **지금**이 먼저다. 장애 중이면 여기부터 본다. */}
              <ActiveServicePanel
                objTypes={pickedJavaeeTypes}
                enabled={activeTab === 'counter' && pickedJavaeeTypes.length > 0}
                agentMap={agentMap}
              />
              <SummaryPanel
                objTypes={pickedJavaeeTypes}
                enabled={activeTab === 'counter' && pickedJavaeeTypes.length > 0}
                onOpenTxid={openSummaryTxid}
              />
              <TopologyPanel
                objTypes={pickedJavaeeTypes}
                agentMap={agentMap}
                enabled={activeTab === 'counter' && pickedJavaeeTypes.length > 0}
                onDrill={drillToXLog}
              />
              {/* 카운터가 "서버가 견디는가"라면 이건 "무엇이 들어오는가"다.
                  objType 이 아니라 objHash 목록으로 묻는다 (F-44). */}
              <ServiceGroupPanel
                objHashes={shownHashes.javaee}
                enabled={activeTab === 'counter' && shownHashes.javaee.length > 0}
              />

              {/* Family 를 섞으면 CPU 와 TPS 가 같은 줄에 놓여 읽히지 않는다.
                  요청은 한 번에 보내지만(실측 확인) 화면은 나눈다. */}
              <CounterSection
                title={t('애플리케이션')}
                subtitle={`${shownHashes.javaee.length}${t('개 오브젝트')} · javaee`}
                counters={JAVAEE_CHARTS}
                isStreaming={isStreaming}
                agentMap={agentMap}
                serviceOf={serviceOf}
                hashes={shownHashes.javaee}
                empty={shownHashes.javaee.length === 0 ? t('고른 서버 중 자바 에이전트가 없습니다.') : null}
                // 없는 것을 없다고 적어 두지 않으면 볼 때마다 같은 조사를 다시 하게 된다.
                footnote={`${JAVAEE_UNCOLLECTED_LABEL}${t(' 는 에이전트 2.21.3 에 수집 코드가 없어 받을 수 없습니다.')}`}
              />
              <CounterSection
                title={t('호스트')}
                subtitle={`${shownHashes.host.length}${t('개 오브젝트')} · host`}
                counters={HOST_CHART_COUNTERS}
                isStreaming={isStreaming}
                agentMap={agentMap}
                serviceOf={serviceOf}
                hashes={shownHashes.host}
                empty={
                  shownHashes.host.length === 0
                    ? t('고른 것 중 호스트 에이전트가 없습니다. 왼쪽 목록에서 linux · windows 오브젝트를 함께 고르면 CPU·메모리·네트워크가 표시됩니다.')
                    : null
                }
              />
              {/* 실시간 팩에 없는 카운터는 여기서만 보인다 (F-42).
                  같은 "호스트" 안에 섞으면 갱신 주기가 2초와 5분으로 섞여 오해를 부른다. */}
              <FiveMinSection
                objTypes={pickedHostTypes}
                enabled={activeTab === 'counter' && pickedHostTypes.length > 0}
                agentMap={agentMap}
              />
              <CounterSection
                title={t('커넥션 풀')}
                subtitle={`${shownHashes.datasource.length}${t('개 풀')} · datasource`}
                counters={DATASOURCE_CHART_COUNTERS}
                isStreaming={isStreaming}
                agentMap={agentMap}
                serviceOf={serviceOf}
                hashes={shownHashes.datasource}
                empty={
                  shownHashes.datasource.length === 0
                    ? // 두 관문이 모두 닫혀 있으면 0건이다. 어느 쪽인지 말해 주지 않으면 고장으로 읽힌다 (F-41).
                      t('고른 것 중 커넥션 풀이 없습니다. 풀이 아예 안 잡힌다면 앱의 spring.datasource.hikari.register-mbeans 와 에이전트의 jmx_counter_enabled 를 모두 켜야 합니다.')
                    : null
                }
              />
            </div>
          )}
        </div>
      )}

      {/* ── Alert 탭 ── */}
      {activeTab === 'alert' && (
        <div style={tabBodyStyle}>
          <AlertFullView
            alerts={alertStream.alerts}
            rows={alertRows}
            since={alertStream.since}
            connected={isStreaming}
            onClear={alertStream.clear}
            agentMap={agentMap}
          />
        </div>
      )}

        </div>
      </div>
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
  objTypes,
  enabled,
  agentMap,
}: {
  objTypes: readonly string[];
  enabled: boolean;
  agentMap: Map<number, string>;
}) {
  if (!enabled) return null;

  return (
    <section className="mb-4">
      <header className="mb-2 flex items-baseline gap-2 border-b border-line pb-1">
        <h2 className="text-body font-medium text-fg">{t('호스트 · 5분 집계')}</h2>
        <span className="text-micro text-fg-faint">{objTypes.join(' · ')} · {t('실시간 팩에 없는 카운터')}</span>
      </header>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
        {HOST_FIVE_MIN_COUNTERS.map(c => (
          <FiveMinCounterChart
            key={c}
            counter={c}
            objTypes={objTypes}
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
  serviceOf,
  hashes,
  empty,
  footnote,
}: {
  title: string;
  subtitle: string;
  counters: readonly CounterName[];
  isStreaming: boolean;
  agentMap: Map<number, string>;
  /** 오브젝트 → 서비스 이름. 서버 목록을 서비스로 묶어 볼 때만 있다 */
  serviceOf?: (objHash: number) => string | null;
  /**
   * 이 구역이 그릴 오브젝트.
   *
   * **여기서 다시 고르지 않는다.** 서버를 고르는 곳은 왼쪽 목록 하나뿐이라,
   * 이 값은 이미 «고른 것 중 이 Family» 다 (App 의 `shownHashes`).
   */
  hashes: readonly number[];
  /** 이 Family 의 오브젝트가 없을 때 보여줄 안내. 없으면 null */
  empty: string | null;
  /** 이 구역에서 **영영 못 받는** 카운터에 대한 각주. 없으면 생략 */
  footnote?: string;
}) {
  /**
   * 개별 선 / 접은 선 하나 (ASIS RealTimeAllCount vs RealTimeTotalCount) / 서비스마다 한 선.
   *
   * 셋이 다른 질문에 답한다 — "어느 서버가 이상한가", "전체가 견디고 있나",
   * "어느 서비스가 견디고 있나". 구역 단위로 바꾼다: 카운터마다 따로 두면 어떤 건 합계고
   * 어떤 건 개별인 채로 나란히 놓여 서로 비교하는 순간 틀린다.
   * 서비스로 묶어 볼 때는 서비스별이 기본이다 (useSectionFold).
   */
  const { fold, setFold, choices: folds } = useSectionFold(serviceOf !== undefined);

  /**
   * 차트에 넘길 «그릴 서버».
   *
   * 스트림은 고른 것만 주므로 사실상 전부지만, 고르기를 바꾼 직후에는 이전 서버의
   * 값이 한 폴링 더 들어온다 — 그것까지 그리면 방금 뺀 서버가 잠깐 되살아난다.
   */
  const visible = useMemo(() => new Set(hashes), [hashes]);

  return (
    <section className="mb-4 last:mb-0">
      <SectionHeader
        title={title}
        subtitle={subtitle}
        action={
          !empty && counters.some(isTotalCapable) ? (
            <div className="flex gap-0.5">
              {folds.map(v => (
                <button
                  key={v}
                  onClick={() => setFold(v)}
                  aria-pressed={fold === v}
                  className={`rounded px-2 py-0.5 text-micro ${
                    fold === v ? 'bg-hover text-fg' : 'text-fg-dim hover:text-fg'
                  }`}
                >
                  {v === 'total' ? t('합계') : v === 'service' ? t('서비스별') : t('개별')}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />
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
              fold={fold}
              serviceOf={serviceOf}
              visible={visible}
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
  /** 지금 차트가 그리는 축. Elapsed 가 아니면 그 값을 한 칸 더 보여준다 */
  yAxisMode: YAxisMode;
  /** 어느 열로 서 있는가. 실시간·과거가 같은 상태를 쓴다 */
  sort: SortState;
  onSort: (key: SortKey) => void;
  /** 끌어서 정한 열 너비 (`xlogColumns.ts`). 껐다 켜도 남는다 */
  colWidths: XLogColWidths;
  onColWidthsChange: (w: XLogColWidths) => void;
}

/**
 * 열 배치는 한 곳에서만 만든다(`gridTemplate`) — 헤더와 행이 따로 폭을 가지면 반드시 어긋난다.
 *
 * 이전 버전은 행마다 zebra 배경 + 아래 테두리 + 왼쪽 색막대 + 에러 배경틴트로
 * **행을 나누는 장치를 네 개** 겹쳐 썼다. 구분선 하나만 남긴다.
 * 상태 열(OK/ERR)도 뺐다 — 거의 모든 행이 OK 라 초록 기둥만 생겼다.
 * 에러는 예외적으로만 표시한다(왼쪽 막대 + ERR 칩).
 *
 * **열 경계는 선으로 긋는다**(`--border-table`). 간격만으로 가르던 때는 IP 와 Elapsed 처럼
 * 숫자끼리 붙은 칸이 한 덩어리로 읽혔고, 행 구분선은 어느 테마에서도 거의 안 보였다.
 *
 * Y축이 Elapsed 가 아니면 **그 축의 값을 한 칸 더 보여준다.** 점 높이와 목록의 숫자가 다른
 * 값을 보고 있으면 «왜 3초짜리가 맨 밑에 있나» 가 된다.
 */
const XLOG_GRID = 'grid items-stretch';
/** 칸마다 — 오른쪽 경계선을 긋고 마지막 칸만 뺀다 */
const XLOG_CELLS = '[&>*]:min-w-0 [&>*]:border-r [&>*]:border-line-table [&>*]:px-2 [&>*:last-child]:border-r-0';

/** 목록에 실제로 그리는 최대 행 수. 넘으면 **느린 것부터** 자른다 */
const XLOG_TABLE_LIMIT = 500;

/**
 * 누를 수 있는 열 머리.
 *
 * **정렬 중인 열에만 화살표를 단다.** 모든 열에 달면 어느 것이 켜졌는지 안 보인다.
 */
function SortHead({
  sort,
  onSort,
  col,
  label,
  align = 'left',
  tone = '',
  title,
}: {
  sort: SortState;
  onSort: (key: SortKey) => void;
  col: SortKey;
  label: string;
  align?: 'left' | 'right';
  tone?: string;
  title?: string;
}) {
  const mark = sortMark(sort, col);
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      title={title ?? t('눌러서 이 열로 정렬합니다')}
      aria-label={`${label}${mark === '' ? '' : mark === '▲' ? ' ▲' : ' ▼'}`}
      className={`flex min-w-0 items-baseline gap-0.5 truncate rounded hover:text-fg ${
        align === 'right' ? 'justify-end' : ''
      } ${mark === '' ? '' : 'text-fg'} ${tone}`}
    >
      <span className="truncate">{label}</span>
      {mark !== '' && <span className="shrink-0 text-accent-bright">{mark}</span>}
    </button>
  );
}

/** 끌기를 시작한 순간의 열 너비 — 끄는 동안 여기서부터 잰다(움직일 때마다 쌓으면 어긋난다) */
interface ColDragStart {
  widths: XLogColWidths;
  measured: Partial<Record<XLogColKey, number>>;
}

/**
 * 열 머리 오른쪽 끝의 손잡이 — 끌면 경계가 커서를 따라오고, 두 번 누르면 그 열을 기본 너비로.
 *
 * 포인터 캡처를 쓴다(`Divider` 와 같은 이유 — 끄는 중에 다른 칸 위를 지나도 안 끊긴다).
 * 선 자체는 칸의 오른쪽 테두리다. 손잡이는 잡기 쉽게 그보다 넓고, 올리면 선이 밝아진다.
 */
function ColResizer({
  onDrag,
  onReset,
  snapshot,
}: {
  onDrag: (delta: number, at: ColDragStart) => void;
  onReset: () => void;
  snapshot: () => ColDragStart;
}) {
  const startRef = useRef<{ x: number; at: ColDragStart } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('열 너비')}
      title={t('끌어서 열 너비를 바꿉니다 · 두 번 누르면 기본 너비')}
      tabIndex={0}
      className="group absolute inset-y-0 -right-[5px] z-10 w-[9px] cursor-col-resize touch-none focus-visible:outline-none"
      onPointerDown={e => {
        e.preventDefault();
        e.stopPropagation();
        startRef.current = { x: e.clientX, at: snapshot() };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        const st = startRef.current;
        if (!st || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        onDrag(e.clientX - st.x, st.at);
      }}
      onPointerUp={e => {
        startRef.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onDoubleClick={e => { e.stopPropagation(); onReset(); }}
      // 키보드로도 — 포인터만 되면 접근이 막힌다
      onKeyDown={e => {
        const step = e.shiftKey ? 40 : 10;
        if (e.key === 'ArrowLeft') { e.preventDefault(); onDrag(-step, snapshot()); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); onDrag(step, snapshot()); }
      }}
    >
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-transparent transition-colors group-hover:bg-accent/60 group-focus-visible:bg-accent"
      />
    </div>
  );
}

function XLogTable({
  xlogs,
  searchHits,
  agentMap,
  activeXlog,
  getCached,
  textVersion,
  onRowClick,
  yAxisMode,
  sort,
  onSort,
  colWidths,
  onColWidthsChange,
}: XLogTableProps) {
  // 서버 열에 적을 이름을 정하는 데 쓴다. 프롭으로 내리지 않는 이유는
  // 설정이 모듈 저장소에 한 벌만 있고, 거쳐 가는 곧마다 빠뜨릴 자리가 생기기 때문이다.
  const { groupRule } = useViewOptions();
  // Elapsed 축이면 목록의 Elapsed 가 곧 점 높이라 더 보여줄 것이 없다.
  const showY = yAxisMode !== 'elapsed';
  const colKeys = useMemo(() => visibleCols(showY), [showY]);
  const gridStyle = useMemo<React.CSSProperties>(
    () => ({ gridTemplateColumns: gridTemplate(colWidths, showY) }),
    [colWidths, showY],
  );
  const headRef = useRef<HTMLDivElement>(null);
  /** 열마다 지금 **그려진** 너비 — 끌기는 여기서 시작한다 (안 정한 열이 튀지 않게) */
  const measureCols = useCallback((): Partial<Record<XLogColKey, number>> => {
    const out: Partial<Record<XLogColKey, number>> = {};
    const cells = headRef.current?.children;
    if (!cells) return out;
    colKeys.forEach((k, i) => {
      const el = cells.item(i);
      if (el) out[k] = el.getBoundingClientRect().width;
    });
    return out;
  }, [colKeys]);
  // 촘촘한 구간을 고르면 수천 건이 잡힌다. 시간 순으로 앞에서 500건을 자르면
  // **가장 오래된 500건**만 남는다 — 1ms 짜리 잡음이다.
  // 구간을 드래그하는 이유는 "무엇이 느렸나" 이므로 느린 순으로 자른다.
  //
  // **자르는 기준과 보는 기준은 다르다.** 500건을 고르는 기준은 언제나 «느린 순» 이고
  // (시간순으로 앞에서 자르면 1ms 짜리 잡음만 남는다), 그 위에 사용자가 고른 기준으로
  // 다시 늘어놓는다. 잘렸으면 머리에 그렇게 적는다 — 안 적으면 «이게 전부» 로 읽힌다.
  const picked = useMemo(
    () => pickTableRows(xlogs, searchHits, XLOG_TABLE_LIMIT),
    [xlogs, searchHits],
  );

  const sortNames = useMemo<SortNames>(
    () => ({
      server: h => agentMap.get(h) ?? `[0x${h.toString(16)}]`,
      url: h => getCached('service', h) ?? `[0x${h.toString(16)}]`,
      yValue: x => Y_AXIS_CONFIGS[yAxisMode].valueExtractor(x),
    }),
    // 텍스트 캐시가 채워지면 이름이 달라지므로 그때 다시 세운다.
    [agentMap, getCached, yAxisMode, textVersion],
  );

  const shown = useMemo(
    () => sortXLogs(picked.rows, sort, sortNames),
    [picked.rows, sort, sortNames],
  );
  /** 잘라 내기 전의 수. 상한 이하면 0 — 머리에 적어야 «이게 전부» 로 안 읽힌다 */
  const cut = picked.matched > XLOG_TABLE_LIMIT ? picked.matched : 0;

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* **잘랐으면 잘랐다고 적는다.** 정렬을 바꿔도 화면에 있는 것은 여전히
          «느린 상위 500건» 이라, 안 적으면 «시간순 전부» 로 읽힌다. */}
      {cut > 0 && (
        <p className="shrink-0 border-b border-line bg-warn/10 px-3 py-1 text-micro text-warn">
          {t('느린 순으로 고른')} {XLOG_TABLE_LIMIT.toLocaleString()}{t('건')} / {cut.toLocaleString()}
          {t('건')}
        </p>
      )}

      {/* 선택 개수와 해제 버튼은 Pane 타이틀바로 올렸다 — 머리가 둘이면 목록이 그만큼 짧아진다 */}
      {/* 행은 왼쪽에 2px 표시 막대(에러·선택)를 둔다 — 머리도 같은 자리를 비워야 열 경계선이 이어진다 */}
      <div
        ref={headRef}
        style={gridStyle}
        className={`${XLOG_GRID} ${XLOG_CELLS} shrink-0 border-b border-l-2 border-b-line-table border-l-transparent px-3 text-micro font-medium tracking-wide text-fg-faint uppercase`}
      >
        {colKeys.map((k, i) => (
          <div key={k} className="relative flex items-center py-1">
            {k === 'time' && <SortHead sort={sort} onSort={onSort} col="time" label={t('시간')} />}
            {k === 'server' && <SortHead sort={sort} onSort={onSort} col="server" label={t('서버')} />}
            {k === 'url' && <SortHead sort={sort} onSort={onSort} col="url" label="URL" />}
            {k === 'ip' && <SortHead sort={sort} onSort={onSort} col="ip" label="IP" />}
            {k === 'elapsed' && <SortHead sort={sort} onSort={onSort} col="elapsed" label="Elapsed" align="right" />}
            {/* 지금 점 높이가 무엇인지 — 축 이름을 그대로 쓴다 */}
            {k === 'y' && (
              <SortHead
                sort={sort}
                onSort={onSort}
                col="y"
                label={yAxisShortLabel(yAxisMode)}
                align="right"
                tone="text-accent-bright normal-case"
                title={t('차트 Y축이 그리는 값입니다')}
              />
            )}
            {i < colKeys.length - 1 && (
              <ColResizer
                onDrag={(delta, at) => onColWidthsChange(resizeAt(at.widths, colKeys, i, delta, at.measured))}
                onReset={() => onColWidthsChange(resetAt(colWidths, colKeys, i))}
                snapshot={() => ({ widths: colWidths, measured: measureCols() })}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex-1 divide-y divide-line-table/50 overflow-y-auto">
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
          // **전체 경로가 아니라 인스턴스 부분만.** 그룹으로 묶어 보면 서비스 이름이
          // 줄마다 반복된다 — 줄에서 알고 싶은 것은 «넷 중 어느 Task 인가» 다.
          // 전체 이름은 title 에 남겨 둔다.
          const fullName = agentMap.get(x.objHash) ?? `[0x${x.objHash.toString(16)}]`;
          const agentName = instanceLabel(fullName, groupRule);
          const isActive = activeXlog?.txid === x.txid;
          const hasErr = x.error !== 0;
          const hit = searchHits?.get(x.txid);
          return (
            <div
              key={i}
              onClick={() => onRowClick(x)}
              className={[
                'cursor-pointer border-l-2 px-3 text-body',
                isActive
                  ? 'border-l-accent bg-accent/12'
                  : hasErr
                    ? 'border-l-danger bg-danger/5 hover:bg-danger/10'
                    : 'border-l-transparent hover:bg-hover/60',
              ].join(' ')}
            >
              <div style={gridStyle} className={`${XLOG_GRID} ${XLOG_CELLS} [&>*]:py-1`}>
                <span className="tnum truncate font-mono text-micro text-fg-dim">
                  {formatTimeMs(x.endTime)}
                </span>
                <span className="truncate text-fg-muted" title={fullName}>
                  {agentName}
                </span>
                <span className="flex items-center gap-1.5">
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
                <span className={`tnum truncate text-right font-mono ${durationTone(x.elapsed)}`}>
                  {x.elapsed.toLocaleString()}ms
                </span>
                {showY && (
                  <span className="tnum truncate text-right font-mono text-accent-bright">
                    {formatYValue(yAxisMode, x)}
                  </span>
                )}
              </div>

              {/* **왜 걸렸는지 보여준다.** 목록만 좁혀 놓으면 검색어가 어디에 맞았는지
                  알 수 없어 매번 상세를 열어 봐야 한다. */}
              {hit && (
                <div className="flex min-w-0 items-baseline gap-1.5 px-2 pb-1">
                  <span className="shrink-0 rounded-sm bg-accent/15 px-1 font-mono text-micro text-accent-bright">
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
  rows,
  since,
  connected,
  onClear,
  agentMap,
}: {
  /** 앱이 쥐고 있는 하나의 버퍼. 여기서 따로 구독하면 배지와 어긋난다 */
  alerts: AlertPack[];
  /** `alerts` 를 서비스 단위로 묶은 것 (alertGroups.ts) — 그리는 것은 이쪽이다 */
  rows: AlertRow[];
  since: number | null;
  connected: boolean;
  onClear: () => void;
  /** objHash → objName. 에이전트 열에 **이름**을 적는다 */
  agentMap: Map<number, string>;
}) {
  // 경과 시간 문구가 멈춰 있으면 화면이 얼어붙은 것처럼 보인다.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => setTick(t => t + 1), 10_000);
    return () => clearInterval(id);
  }, [connected]);
  /** 펼친 묶음. 열쇠는 서비스 + 첫 알림 시각 — 새 알림이 붙어도 같은 묶음이면 펼친 채다 */
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((key: string) => {
    setOpen(prev => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

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
        {rows.map((r, i) => {
          if (r.kind === 'single') {
            return <AlertLine key={`a${i}`} alert={r.alert} agentMap={agentMap} stripe={i % 2 === 1} />;
          }
          const key = `${r.service}@${r.from}`;
          return (
            <AlertBurstLine
              key={key}
              burst={r}
              agentMap={agentMap}
              stripe={i % 2 === 1}
              expanded={open.has(key)}
              onToggle={() => toggle(key)}
            />
          );
        })}
      </div>
    </div>
  );
}

const alertRowStyle = (stripe: boolean): React.CSSProperties => ({
  // 색은 토큰으로 — 어두운 색을 박아 두었을 때 라이트 테마에서 행마다 검은 줄이 그어졌다
  display: 'flex', alignItems: 'flex-start', padding: '5px 14px', borderBottom: `1px solid ${T.borderTable}`,
  fontSize: F.body, gap: 8, background: stripe ? T.bgRaised : 'transparent',
});
const alertChipStyle = (color: string): React.CSSProperties => ({
  background: color, color: T.text, fontSize: F.micro, fontWeight: 700, padding: '2px 5px', borderRadius: 3, letterSpacing: 0.5,
});
const alertAgentStyle: React.CSSProperties = {
  width: 110, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.textMuted,
};

function AlertLine({ alert: a, agentMap, stripe }: { alert: AlertPack; agentMap: Map<number, string>; stripe: boolean }) {
  return (
    <div style={alertRowStyle(stripe)}>
      <span style={{ width: 74, flexShrink: 0, color: T.textDim }}>{formatTime(a.time)}</span>
      <span style={{ width: 60, flexShrink: 0 }}>
        <span style={alertChipStyle(alertLevelColor(a.level))}>{alertLevelLabel(a.level)}</span>
      </span>
      {/* 예전에는 종류(`linux`)를 적었다 — 같은 종류가 여럿이면 어느 서버의 알림인지
          알 수 없다. 이름을 적고, 이름을 아직 모르면 종류로 물러선다. */}
      <span style={alertAgentStyle} title={`${agentMap.get(a.obj_hash) ?? `[${a.obj_hash}]`} · ${a.obj_type}`}>
        {agentMap.has(a.obj_hash) ? shortName(agentMap.get(a.obj_hash) ?? '') : a.obj_type}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</div>
        {a.message && <div style={{ color: T.textDim, fontSize: F.micro, wordBreak: 'break-all', marginTop: 2 }}>{a.message}</div>}
      </div>
    </div>
  );
}

/**
 * 한 서비스의 Task 생명주기 알림 묶음 — 한 줄로 말하고, 누르면 펼친다.
 *
 * **교체는 흐리게, 장애는 빨갛게.** 재배포는 날마다 있는 일이라 눈에 띄면 안 되고,
 * 서비스가 통째로 내려간 것은 다른 어떤 알림보다 먼저 보여야 한다.
 */
function AlertBurstLine({
  burst: b,
  agentMap,
  stripe,
  expanded,
  onToggle,
}: {
  burst: AlertBurst;
  agentMap: Map<number, string>;
  stripe: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const down = b.status === 'down';
  const span = b.from === b.to ? formatTime(b.to) : `${formatTime(b.from)}~${formatTime(b.to)}`;
  const tasks = [...new Set(b.alerts.map(a => shortName(agentMap.get(a.obj_hash) ?? `[${a.obj_hash}]`)))];
  // 교체된 것과 홀로 내려간 것이 섞이면 갈라 적는다 — «내려감 3» 이면 정상 교체된 것까지 장애로 읽힌다
  const mixed = b.replaced > 0 && b.lost > 0;
  const counts = [
    mixed ? `${t('교체')} ${b.replaced}` : '',
    mixed ? `${t('대신 받을 Task 없이 내려감')} ${b.lost}` : '',
    !mixed && b.down > 0 ? `${t('내려감')} ${b.down}` : '',
    b.up > 0 ? `${t('올라옴')} ${b.up}` : '',
  ].filter(Boolean).join(' · ');
  return (
    <div style={{ ...alertRowStyle(stripe), flexDirection: 'column', gap: 2, cursor: 'pointer', opacity: down ? 1 : 0.7 }} onClick={onToggle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%' }}>
        <span style={{ width: 74, flexShrink: 0, color: T.textDim }} title={span}>{formatTime(b.to)}</span>
        <span style={{ width: 60, flexShrink: 0 }}>
          <span style={alertChipStyle(down ? T.error : T.textFaint)}>{down ? t('장애') : t('교체')}</span>
        </span>
        <span style={alertAgentStyle} title={t('서비스')}>{b.service}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: down ? T.error : T.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {expanded ? '▾ ' : '▸ '}
            {down ? t('살아 있는 Task 없음') : t('Task 교체')}
            {b.recovered && <span style={{ color: T.textDim }}> · {t('지금은 살아 있는 Task 가 있습니다')}</span>}
            <span style={{ color: T.textDim }}> — {counts} · {span}</span>
          </div>
          <div style={{ color: T.textDim, fontSize: F.micro, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {tasks.join(', ')}
          </div>
        </div>
      </div>
      {expanded && (
        <div style={{ paddingLeft: 82, width: '100%' }}>
          {b.alerts.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, fontSize: F.micro, color: T.textDim, padding: '1px 0' }}>
              <span style={{ width: 64, flexShrink: 0 }}>{formatTime(a.time)}</span>
              <span style={{ width: 120, flexShrink: 0 }}>{a.title}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {agentMap.get(a.obj_hash) ?? `[${a.obj_hash}]`}
              </span>
            </div>
          ))}
        </div>
      )}
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

// ─── 도우미 ───────────────────────────────────────────────────

/**
 * 해시들의 종류를 겹치지 않게, **이름순으로** 모은다.
 *
 * 순서를 고정하는 이유: 부제에 «SHOP-JVM · ORDER-JVM» 처럼 적히는데, 고른 순서를 따르면
 * 서버를 하나 더 고를 때마다 글자 순서가 바뀐다.
 */
function typesOf(hashes: readonly number[], typeOf: ReadonlyMap<number, string>): string[] {
  const out = new Set<string>();
  for (const h of hashes) {
    const t = typeOf.get(h);
    if (t) out.add(t);
  }
  return [...out].sort();
}

// ─── 상수 ─────────────────────────────────────────────────────

const TAB_LABELS: Record<TabId, string> = {
  xlog: 'XLog',
  active: 'Active',
  visualize: 'Visualize',
  counter: 'Counter',
  alert: 'Alert',
};

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

/** 내리지 않고 숨겨 두는 탭 (Counter — 쌓아 둔 카운터 표본을 지킨다) */
const HIDDEN_TAB_STYLE: React.CSSProperties = { display: 'none' };

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

