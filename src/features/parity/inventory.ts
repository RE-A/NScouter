// Scouter → NScouter 이관 인벤토리
//
// **분모는 추정치가 아니라 소스에서 센 값이다.**
//   카운터: scouter.common .../counters.xml
//   기능:   scouter.client/plugin.xml, PerspectiveService.java, util/MenuUtil.java
//   정리:   docs/asis/15-inventory-source-of-truth.md 5.2
//
// status 를 손으로 올리지 말 것. implemented/partial 로 바꾸면
// parity.test.ts 가 evidence 를 요구하고, 그 테스트가 실재하는지까지 확인한다.

export type ParityStatus = 'implemented' | 'partial' | 'not-started' | 'out-of-scope';

export interface ParityItem {
  /** 'counter.javaee.TPS', 'feature.xlog.realtime' */
  id: string;
  category: 'counter' | 'feature';
  /** Scouter 표시명 */
  name: string;
  status: ParityStatus;
  /** implemented / partial 이면 필수. 'L1:<파일경로>' 또는 'L2|L3|L4:<테스트명>' */
  evidence?: string[];
  /** out-of-scope 사유, 또는 partial 의 미흡한 부분 */
  note?: string;
}

/** 프로젝트 목표 */
export const PARITY_GOAL = 0.9;

/**
 * 현재 달성 수준. 테스트의 하한선이다.
 *
 * 목표(90%)를 처음부터 하한으로 두면 CI 가 계속 빨개서 신호가 무뎌진다.
 * 기능을 옮길 때마다 이 값을 올린다. 내려가면 테스트가 잡는다.
 */
export const PARITY_RATCHET = 0.93;

const L1_COUNTER = 'L1:src/features/xlog/types/counter.test.ts';
const L1_MAPPER = 'L1:src/features/xlog/engine/CoordinateMapper.test.ts';
const L1_STORE = 'L1:src/features/xlog/store/XLogDataStore.test.ts';
const L4_XLOG = 'L4:live_xlog_stream';
const L4_OBJECT = 'L4:live_object_list';
const L4_COUNTER = 'L4:live_counter_real_time_all';

// ─── 카운터 (46) ──────────────────────────────────────────────
// counters.xml 의 host 24 + javaee 19 + datasource 3.
// 프로토콜은 카운터명만 바꾸면 어떤 카운터든 받을 수 있으나(F-15),
// **화면에 표시되는 것만** implemented 로 센다.

const L1_COUNTER_META = 'L1:src/features/xlog/types/counter.test.ts';
const L4_HOST = 'L4:live_host_counters';
const L4_HOST_5MIN = 'L4:live_host_five_min_counters';
const L1_FIVE_MIN = 'L1:src/features/xlog/components/fiveMinSeries.test.ts';

/**
 * 호스트 에이전트(Test/agent-host)를 붙여 실측한 것들.
 *
 * `live_host_counters` 가 24개를 전부 요청하고 무엇이 오는지 찍는다.
 * 값이 0 인 카운터도 오므로(TcpStatEST 등), **안 오는 건 수집 자체가 없는 것**이다.
 */
const hostReceived = (n: string, disp: string): ParityItem => ({
  id: `counter.host.${n}`,
  category: 'counter',
  name: disp,
  status: 'implemented',
  evidence: [L4_HOST, L1_COUNTER_META],
});

const HOST_COUNTERS: ParityItem[] = [
  // 실측 수신 18개 — 차트로 표시한다 (counter.ts HOST_CHART_COUNTERS)
  ...([
    ['Cpu', 'CPU'], ['SysCpu', 'CPU | Sys'], ['UserCpu', 'CPU | User'],
    ['Mem', 'Memory'], ['MemA', 'Memory | Avaliable'], ['MemU', 'Memory | ActualUsed'],
    ['MemT', 'Memory | Total'],
    ['PageIn', 'Swap | PageIn'], ['PageOut', 'Swap | PageOut'], ['Swap', 'Swap'],
    ['SwapT', 'Swap | Total'], ['SwapU', 'Swap | Used'],
    ['NetInBound', 'Net | InBound'], ['NetOutBound', 'Net | OutBound'],
    ['TcpStatEST', 'Net | ESTABLISHED'], ['TcpStatTIM', 'Net | TIME_WAIT'],
    ['TcpStatFIN', 'Net | FIN_WAIT'], ['TcpStatCLS', 'Net | CLOSE_WAIT'],
  ] as [string, string][]).map(([n, d]) => hostReceived(n, d)),

  // 실시간 팩에는 없고 **5분 집계 팩에만** 있는 2개.
  // 스트림으로 아무리 물어도 안 오던 것이라 오래 미수신으로 남아 있었다 (F-42).
  ...([
    ['TcpStatSynSent', 'Net | SYN_SENT'],
    ['TcpStatSynReceive', 'Net | SYN_RECEIVE'],
  ] as [string, string][]).map(([n, d]) => ({
    id: `counter.host.${n}`,
    category: 'counter' as const,
    name: d,
    status: 'implemented' as const,
    evidence: [L4_HOST_5MIN, L1_FIVE_MIN],
  })),

  // 에이전트가 **어떤 팩에도 싣지 않는** 4개.
  //
  // 클라이언트가 못 옮긴 게 아니라 받을 것이 없다. ASIS 이클립스 클라이언트도
  // 같은 이유로 이 넷을 못 그린다 — 분모에 두면 영원히 못 채우는 빚이 된다.
  ...([
    ['NetRxBytes', 'Net | RX Bytes'],
    ['NetTxBytes', 'Net | TX Bytes'],
    ['DiskReadBytes', 'Disk | ReadBytes'],
    ['DiskWriteBytes', 'Disk | WriteBytes'],
  ] as [string, string][]).map(([n, d]) => ({
    id: `counter.host.${n}`,
    category: 'counter' as const,
    name: d,
    status: 'out-of-scope' as const,
    note:
      '에이전트 2.21.3 이 값을 계산해 static 필드에 넣기만 하고 그 getter 를 읽는 코드가 없다. '
      + '실시간 0건, 5분 집계 0포인트 (F-42, L4:live_host_five_min_counters)',
  })),
];

const JAVAEE_COUNTER_ITEMS: ParityItem[] = [
  // 화면에 띄우는 4개 (App.tsx COUNTER_CHARTS)
  {
    id: 'counter.javaee.TPS', category: 'counter', name: 'TPS',
    status: 'implemented', evidence: [L4_COUNTER, L1_COUNTER],
  },
  {
    id: 'counter.javaee.ElapsedTime', category: 'counter', name: 'Elapsed Time',
    status: 'implemented', evidence: ['L4:live_javaee_counter_values', L1_COUNTER],
    note: '차트 표시됨. 평균 응답시간. 90분위(Elapsed90%)와 함께 실측 기록',
  },
  {
    id: 'counter.javaee.ActiveService', category: 'counter', name: 'Active Service',
    status: 'implemented', evidence: ['L4:live_javaee_counter_values', L1_COUNTER],
    note: '차트 표시됨. 실행 중 트랜잭션 수',
  },
  {
    id: 'counter.javaee.HeapUsed', category: 'counter', name: 'Heap Used',
    status: 'implemented', evidence: ['L4:live_javaee_counter_values', L1_COUNTER],
    note: '차트 표시됨. HeapTotal 이하임을 실측 확인. 쌍 카운터(HeapTotUsage)의 사용량과도 일치',
  },
  // 나머지 15개 — MULTI 요청으로 함께 받아 차트로 표시한다 (App.tsx COUNTER_CHARTS)
  // 값이 2원소 리스트로 오는 쌍 카운터. 예전에는 파서가 이 행을 버려
  // **차트가 조용히 비어 있었다** (F-33). 이제 실측 회귀 테스트가 지킨다.
  ...[
    ['HeapTotUsage', 'Heap Total Usage'],
    ['FdUsage', 'File Descriptor'],
  ].map(([n, d]): ParityItem => ({
    id: `counter.javaee.${n}`, category: 'counter', name: d,
    status: 'implemented',
    evidence: ['L4:live_pair_counters_are_not_dropped', L1_COUNTER],
    note: '쌍 카운터([총량, 사용량]). 사용량을 그리고 총량은 기준선 또는 "상한" 표기',
  })),

  ...[
    ['RecentUser', 'Recent User'],
    ['GcCount', 'GC Count'], ['ServiceCount', 'Service Count'],
    ['ErrorRate', 'Error Rate'], ['HeapTotal', 'Heap Total'],
    ['SqlTimeByService', 'SQL Time by service'], ['ApiTimeByService', 'API Time by service'],
    ['Elapsed90%', 'Elapsed 90%'], ['QueuingTime', 'Queuing Time'],
    ['GcTime', 'GC Time'],
    ['PermUsed', 'Perm Used'],
  ].map(([n, d]): ParityItem => ({
    id: `counter.javaee.${n}`, category: 'counter', name: d,
    status: 'implemented',
    evidence: ['L4:live_counter_multi', 'L4:live_javaee_counter_values', L1_COUNTER],
    // 값이 "온다"가 아니라 **말이 되는가**를 본다. 서로 다른 경로로 수집된 카운터끼리
    // 교차 검증한다 — ServiceCount/60 과 TPS 가 실측 3% 안에서 일치했다.
    note: '차트 표시됨. 값 범위와 교차 검증 실측 완료',
  })),

  // Java 17 탓이 아니라 **JVM 옵션** 문제였다.
  // 에이전트 PermGen 태스크는 Metaspace 풀도 잡지만, PermPercent 만
  // `usage.getMax() != -1` 로 걸러진다 — 기본값이 상한 없음이라 안 왔다 (F-43).
  {
    id: 'counter.javaee.PermPercent', category: 'counter', name: 'Perm %',
    status: 'implemented',
    evidence: ['L4:live_perm_percent_needs_metaspace_cap', L1_COUNTER],
    note: '앱 JVM 에 -XX:MaxMetaspaceSize 가 있어야 온다. Test/apps/*/Containerfile 에 반영',
  },
  {
    id: 'counter.javaee.ProcCpu', category: 'counter', name: 'ProcessCpu',
    status: 'out-of-scope',
    note:
      '에이전트 2.21.3 에 수집 태스크가 없다. HeapUsed→HeapUsage, PermUsed→PermGen 처럼 '
      + '짝이 되는 클래스가 없고, jar 안에서 "ProcCpu" 를 쓰는 곳은 테스트용 ObjectRush 뿐이다 (F-43)',
  },
];

const DATASOURCE_COUNTERS: ParityItem[] = [
  ['ConnIdle', 'Conn Idle'], ['ConnActive', 'Conn Active'], ['ConnMax', 'Conn Max'],
].map(([n, d]): ParityItem => ({
  id: `counter.datasource.${n}`, category: 'counter', name: d,
  status: 'implemented',
  evidence: ['L4:live_datasource_counters', L1_COUNTER],
  // 부모(tomcat)와 **별개 오브젝트**(objType=datasource)로 올라온다. 관문이 둘이라
  // 하나만 열면 조용히 0건이다 (F-41).
  note: '커넥션 풀. 활성+유휴 ≤ 상한을 실측 확인. 앱 register-mbeans 와 에이전트 jmx_counter_enabled 를 모두 켜야 수집된다',
}));

// ─── 기능 (39) ────────────────────────────────────────────────

/** 기본 화면 6 — PerspectiveService.createInitialLayout() */
const DEFAULT_VIEWS: ParityItem[] = [
  {
    id: 'feature.view.XLogRealTime', category: 'feature', name: 'RealTimeXLog',
    status: 'implemented', evidence: [L4_XLOG, L1_MAPPER, L1_STORE],
  },
  {
    id: 'feature.view.ObjectNavigation', category: 'feature', name: 'Objects',
    status: 'partial',
    evidence: [L4_OBJECT, 'L1:src/features/xlog/components/agentTree.test.ts'],
    note:
      '찾기 + 한 겹 묶기(타입 또는 호스트) + 우클릭 메뉴. '
      + 'ASIS 처럼 여러 겹으로 쌓지는 않는다 — 실물에서 이름의 깊이가 제각각이라 계층이 들쭉날쭉해진다(B-7)',
  },
  {
    id: 'feature.view.CounterRealTimeAll', category: 'feature', name: 'RealTimeAllCount',
    status: 'implemented', evidence: [L4_COUNTER, L1_COUNTER],
  },
  {
    id: 'feature.view.Alert', category: 'feature', name: 'Alert',
    status: 'partial', evidence: ['L4:live_alert_pack_fields'],
    note: '파싱은 실측 검증됨(N-6 수정). 화면 표시는 미확인, 임계치 알람은 F-16 으로 막힘',
  },
  {
    id: 'feature.view.CounterRealTimeTotal', category: 'feature', name: 'RealTimeTotalCount',
    status: 'implemented',
    evidence: [
      'L1:src/features/xlog/components/counterTotal.test.ts',
      'L1:src/features/xlog/components/CounterChart.test.tsx',
    ],
    note: 'counters.xml 의 total="false" 를 지킨다(host 는 전부 불가). 합/평균 구분도 ASIS 규칙 그대로',
  },
  {
    id: 'feature.view.EQ', category: 'feature', name: 'EQ',
    status: 'implemented',
    evidence: ['L1:src/features/xlog/components/activeSpeed.test.ts'],
    note: '오브젝트별 막대를 공통 눈금(getEqMaxValue)으로 재고 단계별 색으로 나눈다',
  },
];

/** objType 우클릭 10 — MenuUtil.addObjTypeSpecialMenu() JavaEE 분기 (기본화면 중복 2 제외) */
const L1_ACTIVE_SPEED = 'L1:src/features/xlog/components/activeSpeed.test.ts';
const L1_SERVICE_GROUP = 'L1:src/features/xlog/components/serviceGroup.test.ts';
const L4_OBJTYPE = 'L4:live_objtype_queries';

const OBJTYPE_MENU: ParityItem[] = [
  {
    id: 'feature.objtype.ActiveSpeed', category: 'feature', name: 'ActiveSpeed',
    status: 'implemented', evidence: [L1_ACTIVE_SPEED, L4_OBJTYPE],
    note: 'ACTIVESPEED_REAL_TIME_GROUP — 타입 전체 act1/act2/act3 + TPS. Counter 탭 상단',
  },
  {
    id: 'feature.objtype.VerticalEQ', category: 'feature', name: 'Vertical EQ',
    status: 'partial', evidence: [L1_ACTIVE_SPEED, L4_OBJTYPE],
    note: 'ACTIVESPEED_REAL_TIME — 오브젝트별 단계 막대. ASIS 의 세로 이퀄라이저 애니메이션은 없다',
  },
  {
    id: 'feature.objtype.TodayServiceCount', category: 'feature', name: 'Today Service Count',
    status: 'implemented',
    evidence: [
      L1_ACTIVE_SPEED,
      'L1:src/features/xlog/components/ActiveServicePanel.test.tsx',
      L4_OBJTYPE,
      'L4:live_past_date_counter',
    ],
    note:
      '하루 누적 288포인트를 스파크라인으로. 날짜를 고르면 COUNTER_PAST_DATE_ALL 로 그날 것을 본다 — '
      + '오늘을 날짜로 물어도 COUNTER_TODAY_ALL 과 값이 같은 것을 실측했다(live_past_date_counter). '
      + '방문자(VISITOR_REALTIME_TOTAL)에는 날짜가 없어 지난 날에는 내놓지 않는다',
  },
  {
    id: 'feature.objtype.UniqueTotalVisitor', category: 'feature', name: 'Unique Total Visitor',
    status: 'implemented', evidence: [L4_OBJTYPE],
    note: 'VISITOR_REALTIME_TOTAL — Pack 이 아닌 Value 응답이라 read_single_value 추가 (F-32)',
  },
  // 0건이던 이유는 수집이 아니라 **파라미터**였다.
  // objType 이 아니라 objHash 목록으로 물어야 한다 (F-44).
  {
    id: 'feature.objtype.ServiceGroupTPS', category: 'feature', name: 'Service Group TPS',
    status: 'implemented',
    evidence: ['L4:live_service_group_needs_objhash_list', L1_SERVICE_GROUP],
  },
  {
    id: 'feature.objtype.ServiceGroupElapsed', category: 'feature', name: 'Service Group Elapsed',
    status: 'implemented',
    evidence: ['L4:live_service_group_needs_objhash_list', L1_SERVICE_GROUP],
    note: 'TPS 와 같은 응답에 elapsed 가 함께 온다 — 한 표에 나란히 둔다',
  },
  {
    id: 'feature.objtype.HeapMemoryPair', category: 'feature', name: 'Heap Memory (pair chart)',
    status: 'partial',
    evidence: ['L4:live_pair_counters_are_not_dropped', 'L1:src/features/xlog/components/counterGeometry.test.ts'],
    note: 'HeapTotUsage 쌍을 사용량 선 + 총량 기준선으로. ASIS 처럼 오브젝트별 2선을 겹쳐 그리지는 않는다',
  },
  {
    id: 'feature.objtype.FdUsagePair', category: 'feature', name: 'File Descriptor (pair chart)',
    status: 'partial',
    evidence: ['L4:live_pair_counters_are_not_dropped', 'L1:src/features/xlog/components/counterGeometry.test.ts'],
    note: '상한이 사용량의 3만 배라 같은 축에 못 그린다. 사용량 추세 + "상한" 숫자 표기',
  },
  {
    id: 'feature.objtype.ActiveServiceList', category: 'feature', name: 'Active Service List',
    status: 'implemented',
    evidence: [
      L4_OBJTYPE,
      'L4:live_thread_detail_contract',
      'L1:src/features/xlog/components/threadDetail.test.ts',
    ],
    note:
      'objType 한 번의 요청으로 타입 전체 (F-34). 느린 순 30건 + 미완 오브젝트 경고. '
      + '행을 누르면 OBJECT_THREAD_DETAIL 로 **스택 트레이스**를 연다 — 응답 키가 '
      + '"Service Name" 처럼 공백이 든 이름이고, Blocked/Waited Time 의 -1 은 0이 아니라 측정 꺼짐이다 (F-46)',
  },
  {
    id: 'feature.objtype.TypeSummary', category: 'feature', name: 'Type Summary',
    status: 'partial',
    evidence: ['L4:live_summary_shapes', 'L1:src/features/xlog/components/summaryRows.test.ts'],
    note: '6종(서비스/SQL/API/IP/UA/에러) + 구간(1·6·24시간) + 정렬 4가지. 커맨드가 파라미터를 공유한다(F-38). 에러 탭은 대표 txid 로 트랜잭션을 바로 연다(F-39). ASIS 의 내보내기(EXPORT_APP_SUMMARY)는 없다. 알림 요약(LOAD_ALERT_SUMMARY)은 커맨드가 응답은 하는데 이 환경에서는 늘 빈 목록이라 화면을 만들지 않았다(F-57 — 값이 안 오는 커맨드로 화면을 만들면 비어 있음이 정상인지 알 수 없다)',
  },
];

/** 오브젝트 우클릭 14 — MenuUtil.addObjectContextMenu() JavaEE 분기 */
const L4_SIDE_EFFECT = 'L4:live_object_side_effects';

const OBJECT_MENU: ParityItem[] = [
  {
    id: 'feature.object.ThreadList', category: 'feature', name: 'Thread List',
    status: 'implemented',
    evidence: ['L4:live_object_thread_list', 'L1:src-tauri/src/scouter/object.rs'],
    note:
      '조회 스냅샷. 스레드 상세(OBJECT_THREAD_DETAIL)도 구현했다 — 실측 검증 live_thread_detail_contract. '
      + '중지(OBJECT_THREAD_CONTROL)는 미구현: 돌고 있는 스레드를 끊는 일이라 화면에 두려면 별도 판단이 필요하다',
  },
  {
    id: 'feature.object.Env', category: 'feature', name: 'Agent Env',
    status: 'implemented',
    evidence: ['L4:live_object_env', 'L1:src-tauri/src/scouter/object.rs'],
  },
  {
    id: 'feature.object.Socket', category: 'feature', name: 'Socket',
    status: 'implemented',
    evidence: ['L4:live_object_sockets', 'L1:src-tauri/src/scouter/object.rs'],
    note: 'host 가 Blob 4바이트(IPv4)로 온다',
  },
  {
    id: 'feature.object.LoadedClassList', category: 'feature', name: 'Loaded Class List',
    status: 'implemented',
    evidence: ['L4:live_object_class_list_paginates', 'L1:src-tauri/src/scouter/object.rs'],
    note: '페이지 단위(100건×171). 검색은 현재 페이지 안에서만. 클래스 재정의(REDEFINE_CLASSES)는 미구현',
  },
  {
    id: 'feature.object.HeapHistogram', category: 'feature', name: 'Heap Histogram',
    status: 'implemented',
    evidence: ['L4:live_object_heap_histogram', 'L1:src-tauri/src/scouter/object.rs'],
    note: 'jmap -histo 텍스트를 열로 파싱. 앱 컨테이너가 JDK 여야 한다 (F-25)',
  },
  {
    id: 'feature.object.ActiveServiceList', category: 'feature',
    name: 'Active Service List (object)',
    status: 'implemented',
    evidence: ['L4:live_object_active_services', 'L1:src-tauri/src/scouter/object.rs'],
    note: 'service 는 텍스트, txid 는 Hexa32 로 온다',
  },
  {
    id: 'feature.object.ThreadDump', category: 'feature', name: 'Thread Dump',
    status: 'implemented',
    evidence: ['L4:live_thread_dump_roundtrip', 'L1:src-tauri/src/scouter/object.rs'],
    note: '생성→목록→내용 3단계. 내용만 blob 청크 스트림 (F-26). 앱 컨테이너가 JDK 여야 한다',
  },
  // 부수효과가 있는 명령들. 되돌릴 수 없어 화면이 한 번 더 되묻는다 (F-35).
  {
    id: 'feature.object.SystemGc', category: 'feature', name: 'System GC',
    status: 'implemented', evidence: [L4_SIDE_EFFECT],
    note: '콜렉터가 성공 여부를 주지 않는다 — 화면은 "요청했다"까지만 말하고 Heap 카운터로 확인하도록 안내',
  },
  {
    id: 'feature.object.ResetTextCache', category: 'feature', name: 'Reset Text Cache',
    status: 'implemented', evidence: [L4_SIDE_EFFECT],
    note: '응답 없음. 위와 동일',
  },
  {
    id: 'feature.object.HeapDump', category: 'feature', name: 'Heap Dump (실행/목록)',
    status: 'partial', evidence: [L4_SIDE_EFFECT],
    note: 'fName/time 을 함께 보내야 동작한다(F-35 — 오랜 빈 응답의 원인). 10초 제한 메시지도 그대로 보여준다. 생성된 .hprof 를 내려받는 경로(OBJECT_DOWNLOAD_HEAP_DUMP)는 미구현',
  },
  {
    id: 'feature.object.FileDump', category: 'feature', name: 'File Dump',
    status: 'implemented', evidence: [L4_SIDE_EFFECT],
    note: '4종(스레드 덤프/액티브/스레드 목록/힙 히스토그램)을 파일로. 간헐적 빈 응답은 재시도 안내',
  },
  {
    id: 'feature.object.StackAnalyzer', category: 'feature', name: 'Stack Analyzer',
    status: 'implemented',
    evidence: [L4_SIDE_EFFECT, 'L4:live_stack_analyzer_readback'],
    note:
      '샘플링 켜기(5분)/끄기 + **모인 스택 조회**. 목록은 GET_STACK_INDEX(raw long 응답), '
      + '원문은 GET_STACK_ANALYZER 로 한 장씩(StackPack 62, 본문 GZIP) — 하루치가 6.4MB 라 '
      + '한 번에 싣지 않는다 (F-45). ASIS 의 스택 집계·분류(MainProcessor)는 없다',
  },
  {
    id: 'feature.object.AgentConfigure', category: 'feature', name: 'Agent Configure',
    status: 'implemented',
    evidence: [
      'L4:live_agent_config',
      'L4:live_agent_config_save_roundtrip',
      'L1:src/features/xlog/components/configFilter.test.ts',
    ],
    note:
      '조회(원문 + key/value/default 표, 바뀐 것 강조)와 저장. 호스트 에이전트도 답한다(실측 41개). '
      + '저장은 파일을 통째로 덮어쓰므로 원문 전체를 보내고 확인을 한 번 더 받는다 (F-40, F-47). '
      + '클래스 재정의(REDEFINE_CLASSES)는 이 화면이 아니라 «로드된 클래스» 쪽 기능이다',
  },
  {
    id: 'feature.object.Properties', category: 'feature', name: 'Set Color / Properties',
    status: 'partial',
    evidence: [
      'L1:src/features/xlog/components/objectProperties.test.ts',
      'L4:live_object_pack_tail_fields',
    ],
    note: '조회만. ASIS 와 같은 고정 8줄 + tags 전개. 색 **변경**(Set Color)은 미구현',
  },
];

/** XLog 계열 뷰 8 — plugin.xml xlog 패키지 (RealTime 중복 제외) */
const XLOG_VIEWS: ParityItem[] = [
  {
    id: 'feature.xlog.Selection', category: 'feature', name: 'XLog List',
    status: 'implemented',
    evidence: [
      L1_STORE,
      L4_XLOG,
      'L1:src/features/xlog/engine/rectSelect.test.ts',
      'L1:src/features/xlog/components/stepSearch.test.ts',
      'L4:live_profile_text_search',
    ],
    note:
      '드래그 선택은 픽셀이 아니라 데이터를 훑는다(겹친 점을 세면 10분의 1로 준다). '
      + '**ASIS 에 없는 것 둘을 더했다** — 서비스명·IP·응답시간 필터(각각 포함/제외로 뒤집힌다)와, '
      + '선택 구간의 프로파일 본문 텍스트 검색(SQL·바인딩값·예외·URL). '
      + '검색은 트랜잭션 한 건이 요청 하나라 선택 구간으로 범위를 묶고 묶음 단위로 진행·중단한다. '
      + '걸린 행을 열면 프로파일에서 **그 스텝**으로 데려가 강조하고, 여러 군데면 «‹ 1/2 ›» 로 '
      + '오갈 수 있다 — 스텝이 수백 개라 "이 트랜잭션이 걸렸다"까지만 알려주면 처음부터 훑어야 한다. '
      + '상세 쪽 적중 판정은 이미 받아 둔 프로파일로 화면에서 직접 한다(같은 것을 두 번 받지 않는다)',
  },
  {
    id: 'feature.xlog.Profile', category: 'feature', name: 'XLog Profile',
    status: 'implemented', evidence: ['L4:live_xlog_profile_steps'],
    note:
      'Step 6종(Method/HashedMessage/Sql3/Message/ApiCall/ThreadCall) 실측 검증. '
      + 'Span·SpanCall 과 요약(*_SUM) 계열은 ASIS 소스 그대로 **자리만 맞춰 소비**한다 — '
      + '화면에는 안 낸다. 안 읽으면 그 뒤 스텝이 전부 깨져서다(L2 합성 blob 검증)',
  },
  {
    id: 'feature.xlog.LoadTime', category: 'feature', name: 'LoadTimeXLog',
    status: 'implemented',
    evidence: [
      'L4:live_past_xlog_paginates',
      'L1:src/features/xlog/api/pastXLog.test.ts',
      'L1:src/features/xlog/types/timeRange.test.ts',
    ],
    note: '구간 선택 + 페이지 반복 조회. 하루를 걸치는 구간은 미지원(콜렉터가 날짜 단위 저장)',
  },
  {
    id: 'feature.xlog.ZoomTime', category: 'feature', name: 'LoadZoomTimeXLog',
    status: 'implemented',
    evidence: ['L1:src/features/xlog/types/timeRange.test.ts'],
    note: '휠=확대(커서 고정), Shift+휠=이동. 드래그는 트랜잭션 선택으로 유지. 받아온 구간 안쪽이면 재조회 없음',
  },
  {
    id: 'feature.xlog.FullProfile',
    category: 'feature',
    name: 'XLog Full Profile',
    status: 'partial',
    evidence: [
      'L1:src/features/xlog/components/profileSummary.test.ts',
      'L1:src/features/xlog/components/SavedProfileDialog.test.tsx',
      'L2:profile_store::tests',
      'L4:live_full_profile_matches_profile',
    ],
    note:
      'TRANX_PROFILE_FULL(max=-1, blob 청크) 로 상세 패널 조회. 요약(횟수·합계·평균, 3종 정렬) 구현. '
      + '파일 저장/열기는 **JSON 한 파일**로 구현했다 — 텍스트를 푼 채로 담아 접속 없이도 열린다. '
      + 'ASIS 의 xlog.xlog+xlog.prof(와이어 포맷)와는 호환되지 않는다. 페이지 이동은 미구현',
  },
  {
    id: 'feature.xlog.ThreadProfile', category: 'feature', name: 'XLog Thread Profile',
    status: 'implemented',
    evidence: ['L4:live_thread_call_steps', 'L1:src-tauri/src/scouter/profile.rs'],
    note: 'ThreadCallPossibleStep(14) 을 제대로 파싱해 txid 를 살렸다. 프로파일에서 그 스텝을 누르면 이어진 스레드의 트랜잭션이 열린다. threaded=false 면 링크로 만들지 않는다',
  },
  {
    id: 'feature.xlog.ApiCall',
    category: 'feature',
    name: 'XLogApiCallView',
    status: 'implemented',
    evidence: [
      'L1:src/features/xlog/trace/callTree.test.ts',
      'L4:live_xlog_by_gxid',
    ],
    note: 'XLOG_READ_BY_GXID(date+gxid) 로 연관 XLog 를 모아 caller 로 트리 구성. 상세 패널의 "호출 흐름". ASIS 는 Zest 그래프, 여기서는 시간축 목록',
  },
  {
    id: 'feature.xlog.Flow',
    category: 'feature',
    name: 'XLogFlowView',
    status: 'partial',
    evidence: [
      'L1:src/features/xlog/trace/flowTree.test.ts',
      'L4:live_flow_apicall_links_child_xlog',
      'L4:live_flow_threadcall_links_child_xlog',
    ],
    note: '사용자 IP → 서비스 → SQL/API 호출 트리. ApiCall·ThreadCall 스텝의 txid 로 호출된 앱·스레드를 잇고, 못 찾으면 잎으로 남긴다(실측 확인). 같은 대상은 접어 횟수·시간 누적, SQL/API 토글. Dispatch·ThreadSubmit·Span 계열은 이 환경에 스텝 자체가 오지 않아 트리에 넣지 않았다(F-48) — 파싱은 자리를 맞춰 소비한다. ASIS 는 Zest 그래프, 여기서는 들여쓰기 트리',
  },
];

/** 인터랙션(토폴로지) 1 — CounterConstants.INTR_* 10종을 기능 1개로 센다 */
const INTERACTION: ParityItem[] = [
  {
    id: 'feature.interaction.topology', category: 'feature', name: 'Interaction / Topology',
    status: 'partial',
    evidence: ['L4:probe_interaction_counter', 'L1:src/features/xlog/components/topologyGraph.test.ts'],
    note: '외부/앱/자원 3층 그래프를 캔버스로. 커맨드는 INTR_COUNTER_REAL_TIME_BY_OBJ 하나이고 응답은 InteractionCounterPack(65) 이다(F-40). **에이전트가 기본으로 수집하지 않아** counter_interaction_enabled 를 켜야 한다. 실시간만 — 종류(INTR_* 10종)별 필터와 과거 구간 조회는 없다',
  },
];

export const PARITY_INVENTORY: ParityItem[] = [
  ...HOST_COUNTERS,
  ...JAVAEE_COUNTER_ITEMS,
  ...DATASOURCE_COUNTERS,
  ...DEFAULT_VIEWS,
  ...OBJTYPE_MENU,
  ...OBJECT_MENU,
  ...XLOG_VIEWS,
  ...INTERACTION,
];

/** 이관율 = (implemented + partial×0.5) / (전체 − out-of-scope) */
export function parityRatio(items: ParityItem[]): number {
  const scoped = items.filter(i => i.status !== 'out-of-scope');
  if (scoped.length === 0) return 0;
  const score = scoped.reduce((sum, i) => {
    if (i.status === 'implemented') return sum + 1;
    if (i.status === 'partial') return sum + 0.5;
    return sum;
  }, 0);
  return score / scoped.length;
}
