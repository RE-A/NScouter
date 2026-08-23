// src/features/xlog/types/xlog.ts

import { XLOG_BACKGROUND, XLOG_COLORS } from '../utils/colorPalette';

/** Rust XLogPack 직렬화 구조 (txid/caller/gxid는 string) */
export interface XLogPack {
  end_time: number;
  obj_hash: number;
  service: number;        // hash (resolve_texts로 조회)
  txid: string;           // i64 → string
  caller: string;
  gxid: string;
  elapsed: number;        // ms
  error: number;          // hash (0=정상)
  cpu: number;            // ms
  sql_count: number;
  sql_time: number;       // ms
  ipaddr: string;
  kbytes: number;
  status: number;
  userid: number;
  user_agent: number;
  referer: number;
  group: number;
  apicall_count: number;
  apicall_time: number;   // ms
  country_code: string;
  city: number;
  x_type: number;
  login: number;
  desc: number;
  web_hash: number;
  web_time: number;
  has_dump: number;
  thread_name_hash: number;
  text1: string;
  text2: string;
  queuing_host_hash: number;
  queuing_time: number;
  queuing2nd_host_hash: number;
  queuing2nd_time: number;
  text3: string;
  text4: string;
  text5: string;
  profile_count: number;
  b3_mode: boolean;
  profile_size: number;
  discard_type: number;
  ignore_global_consequent_sampling: boolean;
}

/** 렌더링에 필요한 핵심 필드만 추린 내부 타입 */
export interface SXLog {
  txid: string;
  gxid: string;
  /** 부모 트랜잭션의 txid. 0 이면 이 요청의 시작점이다 */
  caller: string;
  endTime: number;
  elapsed: number;        // ms
  objHash: number;
  service: number;        // hash
  error: number;
  xType: number;
  cpu: number;
  sqlCount: number;
  sqlTime: number;
  apiCallCount: number;
  apiCallTime: number;
  ipAddr: string;
  allocKBytes: number;
  threadNameHash: number;
}

export function xlogPackToSXLog(p: XLogPack): SXLog {
  return {
    txid: p.txid,
    gxid: p.gxid,
    caller: p.caller,
    endTime: p.end_time,
    elapsed: p.elapsed,
    objHash: p.obj_hash,
    service: p.service,
    error: p.error,
    xType: p.x_type,
    cpu: p.cpu,
    sqlCount: p.sql_count,
    sqlTime: p.sql_time,
    apiCallCount: p.apicall_count,
    apiCallTime: p.apicall_time,
    ipAddr: p.ipaddr,
    allocKBytes: p.kbytes,
    threadNameHash: p.thread_name_hash,
  };
}

// ─── 차트 설정 ────────────────────────────────────────────────

export type YAxisMode =
  | 'elapsed'
  | 'cpu'
  | 'sqlTime'
  | 'sqlCount'
  | 'apiCallTime'
  | 'apiCallCount'
  | 'heapUsed';

export interface YAxisModeConfig {
  label: string;
  defaultMax: number;
  unit: string;
  valueExtractor: (x: SXLog) => number;
}

export const Y_AXIS_CONFIGS: Record<YAxisMode, YAxisModeConfig> = {
  elapsed:      { label: 'Elapsed(sec)',      defaultMax: 9,    unit: 'sec', valueExtractor: x => x.elapsed / 1000 },
  cpu:          { label: 'CPU(ms)',           defaultMax: 100,  unit: 'ms',  valueExtractor: x => x.cpu },
  sqlTime:      { label: 'SQL Time(sec)',     defaultMax: 9,    unit: 'sec', valueExtractor: x => x.sqlTime / 1000 },
  sqlCount:     { label: 'SQL Count',         defaultMax: 50,   unit: '',    valueExtractor: x => x.sqlCount },
  apiCallTime:  { label: 'ApiCall Time(sec)', defaultMax: 9,    unit: 'sec', valueExtractor: x => x.apiCallTime / 1000 },
  apiCallCount: { label: 'ApiCall Count',     defaultMax: 50,   unit: '',    valueExtractor: x => x.apiCallCount },
  heapUsed:     { label: 'Heap Used(KB)',     defaultMax: 5000, unit: 'KB',  valueExtractor: x => x.allocKBytes },
};

export interface XLogChartConfig {
  yAxisMode: YAxisMode;
  timeRangeMs: number;        // 기본 300_000 (5분)
  yMax: number;
  showIgnoreArea: boolean;
  ignoreThresholdMs: number;
  backgroundColor: string;
  gridColor: string;
}

export const DEFAULT_CHART_CONFIG: XLogChartConfig = {
  yAxisMode: 'elapsed',
  timeRangeMs: 300_000,
  yMax: 9,
  showIgnoreArea: false,
  ignoreThresholdMs: 0,
  // 값은 colorPalette.ts 하나에만 둔다 (여기와 두 벌이 되면 그리드만 흰 배경용으로 남는다).
  backgroundColor: XLOG_BACKGROUND,
  gridColor: XLOG_COLORS.GRID,
};

export interface ChartLayout {
  canvasWidth: number;
  canvasHeight: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  plotAreaX: number;
  plotAreaY: number;
  plotAreaWidth: number;
  plotAreaHeight: number;
}

export function buildLayout(w: number, h: number): ChartLayout {
  const paddingTop = 10;
  const paddingRight = 10;
  const paddingBottom = 30;
  const paddingLeft = 60;
  return {
    canvasWidth: w,
    canvasHeight: h,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    plotAreaX: paddingLeft,
    plotAreaY: paddingTop,
    plotAreaWidth: w - paddingLeft - paddingRight,
    plotAreaHeight: h - paddingTop - paddingBottom,
  };
}

/**
 * 문자열 조건. **포함과 제외를 같은 칸에서 뒤집는다.**
 *
 * 두 칸(포함용/제외용)으로 나누면 "shop 을 포함하면서 shop 을 제외" 같은
 * 앞뒤가 안 맞는 상태를 만들 수 있다. 한 칸에 방향 스위치를 둔다.
 *
 * `text` 가 비면 **방향과 무관하게 조건이 없다** — 빈 문자열을 제외 조건으로 읽으면
 * 모든 행이 사라진다.
 */
export interface TextFilter {
  text: string;
  /** true 면 **일치하지 않는 것만** 통과 */
  exclude: boolean;
}

export interface XLogFilterState {
  /**
   * 응답시간 임계(ms). **0 이면 방향과 무관하게 조건이 없다** —
   * 0 을 "미만" 으로 읽으면 아무것도 통과하지 못한다.
   */
  elapsedMs: number;
  /** true 면 임계 **미만**만 통과 (제외) */
  elapsedExclude: boolean;
  errorOnly: boolean;
  objHashSet: Set<number>;
  /** 서비스명(URL) 부분 일치. 대소문자를 가리지 않는다 */
  service: TextFilter;
  /** 호출자 IP 부분 일치 */
  ip: TextFilter;
}

export const DEFAULT_FILTER: XLogFilterState = {
  elapsedMs: 0,
  elapsedExclude: false,
  errorOnly: false,
  objHashSet: new Set(),
  service: { text: '', exclude: false },
  ip: { text: '', exclude: false },
};

/** 조건이 하나라도 걸려 있는가 — "왜 비었지"를 화면이 설명할 근거 */
export function hasActiveFilter(f: XLogFilterState): boolean {
  return (
    f.errorOnly ||
    f.elapsedMs > 0 ||
    f.service.text.trim() !== '' ||
    f.ip.text.trim() !== '' ||
    f.objHashSet.size > 0
  );
}

// ─── 에이전트(Object) ─────────────────────────────────────────

/** Rust ObjectPack 직렬화 구조 */
export interface AgentObject {
  obj_hash: number;
  obj_type: string;
  obj_name: string;
  address: string;
  version: string;
  alive: boolean;
  /** 에이전트가 마지막으로 살아 있음을 알린 시각 (epoch ms). 0이면 알린 적 없음 */
  wakeup: number;
  /**
   * 에이전트가 붙여 보내는 부가 정보. **키는 에이전트 종류·버전마다 다르다.**
   * 실측: tomcat 은 `ADC/counter/detected`, linux 는 `hostName/podName/kubeSeq` 등.
   * 고정 스키마로 다루면 없는 환경에서 조용히 빈다 — 온 대로 편다.
   */
  tags: [string, string][];
}
