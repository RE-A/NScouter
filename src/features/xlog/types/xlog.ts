// src/features/xlog/types/xlog.ts

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
  backgroundColor: '#ffffff',
  gridColor: 'rgb(220, 228, 255)',
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

export interface XLogFilterState {
  minElapsed: number;
  errorOnly: boolean;
  objHashSet: Set<number>;
}

export const DEFAULT_FILTER: XLogFilterState = {
  minElapsed: 0,
  errorOnly: false,
  objHashSet: new Set(),
};

// ─── 에이전트(Object) ─────────────────────────────────────────

/** Rust ObjectPack 직렬화 구조 */
export interface AgentObject {
  obj_hash: number;
  obj_type: string;
  obj_name: string;
  address: string;
  version: string;
  alive: boolean;
}
