// src/features/xlog/types/counter.ts
// 성능 카운터 타입 정의
//
// 근거: docs/verified-facts.md F-15 (실서버 실측)
//       카운터명 원본: docs/asis/15-inventory-source-of-truth.md 1.1

/** 카운터 1개에 대한 한 시점의 전 오브젝트 값 (Rust CounterUpdate) */
export interface CounterUpdate {
  /** 수집 시각 (epoch ms) */
  time: number;
  /** counters.xml 표기 그대로의 카운터명 */
  counter: CounterName;
  values: CounterValue[];
}

export interface CounterValue {
  obj_hash: number;
  value: number;
  /**
   * 쌍으로 오는 카운터의 총량(상한). 스칼라 카운터에는 없다 (F-33).
   *
   * `HeapTotUsage` = [총량, 사용량], `FdUsage` = [상한, 열린 수] 처럼
   * 값이 2원소 리스트로 오는 카운터가 있다. 예전에는 이런 행을 통째로 버려
   * 해당 차트가 **조용히 비어 있었다.**
   */
  total?: number | null;
}

/**
 * javaee Family 카운터 19개.
 *
 * **표기를 바꾸면 안 된다.** Collector 는 이 이름을 그대로 받고,
 * 틀리면 에러 없이 0건을 돌려준다 (F-15).
 */
export const JAVAEE_COUNTERS = {
  RecentUser: { disp: 'Recent User', unit: 'cnt' },
  HeapTotUsage: { disp: 'Heap Total Usage', unit: 'MB' },
  GcCount: { disp: 'GC Count', unit: 'cnt' },
  ServiceCount: { disp: 'Service Count', unit: 'cnt/min' },
  ErrorRate: { disp: 'Error Rate', unit: '%' },
  HeapUsed: { disp: 'Heap Used', unit: 'MB' },
  HeapTotal: { disp: 'Heap Total', unit: 'MB' },
  ElapsedTime: { disp: 'Elapsed Time', unit: 'ms' },
  SqlTimeByService: { disp: 'SQL Time by service', unit: 'ms' },
  ApiTimeByService: { disp: 'API Time by service', unit: 'ms' },
  'Elapsed90%': { disp: 'Elapsed 90%', unit: 'ms' },
  QueuingTime: { disp: 'Queuing Time', unit: 'ms' },
  ActiveService: { disp: 'Active Service', unit: 'cnt' },
  GcTime: { disp: 'GC Time', unit: 'ms' },
  TPS: { disp: 'TPS', unit: 'tps' },
  ProcCpu: { disp: 'ProcessCpu', unit: '%' },
  PermUsed: { disp: 'Perm Used', unit: 'MB' },
  PermPercent: { disp: 'Perm %', unit: '%' },
  FdUsage: { disp: 'File Descriptor', unit: 'cnt' },
} as const;

/**
 * host Family 카운터 24개 (counters.xml `<Family name="host">`).
 *
 * 자바 에이전트가 아니라 **호스트 에이전트**(scouter.host)가 보낸다.
 * javaee 와 Family 가 달라서 tomcat 오브젝트에 `Cpu` 를 물으면 0건이 온다 (F-15).
 */
export const HOST_COUNTERS = {
  Cpu: { disp: 'CPU', unit: '%' },
  SysCpu: { disp: 'CPU | Sys', unit: '%' },
  UserCpu: { disp: 'CPU | User', unit: '%' },
  Mem: { disp: 'Memory', unit: '%' },
  MemA: { disp: 'Memory | Available', unit: 'MB' },
  MemU: { disp: 'Memory | ActualUsed', unit: 'MB' },
  MemT: { disp: 'Memory | Total', unit: 'MB' },
  PageIn: { disp: 'Swap | PageIn', unit: 'cnt' },
  PageOut: { disp: 'Swap | PageOut', unit: 'cnt' },
  Swap: { disp: 'Swap', unit: '%' },
  SwapT: { disp: 'Swap | Total', unit: 'MB' },
  SwapU: { disp: 'Swap | Used', unit: 'MB' },
  NetInBound: { disp: 'Net | InBound', unit: 'B/s' },
  NetOutBound: { disp: 'Net | OutBound', unit: 'B/s' },
  TcpStatSynSent: { disp: 'Net | SYN_SENT', unit: 'cnt' },
  TcpStatSynReceive: { disp: 'Net | SYN_RECEIVE', unit: 'cnt' },
  TcpStatEST: { disp: 'Net | ESTABLISHED', unit: 'cnt' },
  TcpStatTIM: { disp: 'Net | TIME_WAIT', unit: 'cnt' },
  TcpStatFIN: { disp: 'Net | FIN_WAIT', unit: 'cnt' },
  TcpStatCLS: { disp: 'Net | CLOSE_WAIT', unit: 'cnt' },
  NetRxBytes: { disp: 'Net | RX Bytes', unit: 'B/s' },
  NetTxBytes: { disp: 'Net | TX Bytes', unit: 'B/s' },
  DiskReadBytes: { disp: 'Disk | ReadBytes', unit: 'B/s' },
  DiskWriteBytes: { disp: 'Disk | WriteBytes', unit: 'B/s' },
} as const;

/**
 * datasource Family — 커넥션 풀.
 *
 * 에이전트가 HikariCP JMX MBean 을 읽어 **별도 오브젝트**(objType=`datasource`)로 올린다.
 * 두 관문을 모두 열어야 온다 (F-41):
 *   앱 `spring.datasource.hikari.register-mbeans=true` · 에이전트 `jmx_counter_enabled=true`
 */
export const DATASOURCE_COUNTERS = {
  ConnActive: { disp: 'Conn Active', unit: 'cnt' },
  ConnIdle: { disp: 'Conn Idle', unit: 'cnt' },
  ConnMax: { disp: 'Conn Max', unit: 'cnt' },
} as const;

export type DatasourceCounterName = keyof typeof DATASOURCE_COUNTERS;

export const DATASOURCE_CHART_COUNTERS: readonly DatasourceCounterName[] = [
  'ConnActive', 'ConnIdle', 'ConnMax',
];

export type JavaeeCounterName = keyof typeof JAVAEE_COUNTERS;
export type HostCounterName = keyof typeof HOST_COUNTERS;
export type CounterName = JavaeeCounterName | HostCounterName | DatasourceCounterName;

/**
 * 실시간 스트림으로 그리는 host 카운터 18개.
 *
 * 24개를 다 띄우면 6개는 영영 "수신 없음" 으로 남는다.
 * 값이 0 인 카운터도 오므로(TcpStatEST 등), **안 오는 것은 수집 자체가 없는 것**이다.
 * 나머지 6개가 왜 빠지는지는 아래 두 상수에 갈라 적었다 (F-42).
 */
export const HOST_CHART_COUNTERS: readonly HostCounterName[] = [
  'Cpu', 'UserCpu', 'SysCpu',
  'Mem', 'MemU', 'MemA', 'MemT',
  'Swap', 'SwapU', 'SwapT', 'PageIn', 'PageOut',
  'NetInBound', 'NetOutBound',
  'TcpStatEST', 'TcpStatTIM', 'TcpStatFIN', 'TcpStatCLS',
];

/**
 * 실시간에는 없고 **5분 집계에만** 있는 host 카운터.
 *
 * 에이전트 `HostPerf` 가 카운터를 팩에 두 번 담는데, 두 묶음의 목록이 다르다 (F-42):
 *   `getPack(objName, TimeTypeEnum.REALTIME)` → 이 둘이 **없다**
 *   `getPack(objName, TimeTypeEnum.FIVE_MIN)` → 이 둘이 **있다**
 *
 * 그래서 실시간 스트림으로는 영원히 안 온다. `COUNTER_TODAY_ALL` 로 물어야 보인다.
 */
export const HOST_FIVE_MIN_COUNTERS: readonly HostCounterName[] = [
  'TcpStatSynSent', 'TcpStatSynReceive',
];

/**
 * 에이전트 2.21.3 이 **어떤 팩에도 싣지 않는** host 카운터 4개.
 *
 * `HostNetDiskPerf` 가 인터페이스·장치별 델타를 계산해 static 필드에 넣지만
 * 그 getter 를 읽는 코드가 에이전트 안에 없다 — 계산만 하고 버린다.
 * 실측으로도 실시간 0건, 5분 집계 0포인트다 (F-42).
 *
 * **클라이언트가 무엇을 해도 받을 수 없다.** 차트를 만들지 않는 근거이자,
 * 나중에 "왜 빠졌나"를 다시 조사하지 않기 위한 기록이다.
 */
export const HOST_UNCOLLECTED_COUNTERS: readonly HostCounterName[] = [
  'NetRxBytes', 'NetTxBytes', 'DiskReadBytes', 'DiskWriteBytes',
];

/**
 * 에이전트 2.21.3 이 **어떤 팩에도 싣지 않는** javaee 카운터.
 *
 * host 쪽 `HOST_UNCOLLECTED_COUNTERS` 와 같은 부류다 (F-42).
 * `ProcCpu` 는 counters.xml 과 CounterConstants 에 이름만 있고, 에이전트 jar 안에서
 * 이 문자열을 쓰는 곳이 **테스트용 `scouter/test/ObjectRush` 뿐**이다 —
 * `HeapUsed`→`HeapUsage`, `PermUsed`→`PermGen` 처럼 짝이 되는 수집 태스크가 없다 (F-43).
 */
export const JAVAEE_UNCOLLECTED_COUNTERS: readonly JavaeeCounterName[] = ['ProcCpu'];

/**
 * 합계(Total) 화면을 만들 수 있는 카운터.
 *
 * **우리가 고른 목록이 아니다** — counters.xml 이 카운터마다 `total="false"` 로 못 박아 둔 것을
 * 뒤집은 것이다. ASIS 는 이 표시가 있는 카운터에는 Total 뷰 자체를 열어 주지 않는다
 * (`CounterEngine.getTotalCounterList`).
 *
 * host Family 는 **하나도 없다.** CPU 두 대를 더해 100% 라고 그리면 거짓이고,
 * Memory Total 을 더한 값은 아무 질문에도 답하지 않는다.
 *
 * 합계인지 평균인지는 별개 규칙이다 — `counterTotal.totalMode` (ErrorRate 는 합계 가능하지만 평균).
 */
const TOTAL_CAPABLE: readonly string[] = [
  // javaee — counters.xml 에 total 표시가 없는 것들
  'RecentUser', 'GcCount', 'ServiceCount', 'ErrorRate', 'ActiveService', 'TPS',
  // datasource — 셋 다 표시가 없다
  'ConnIdle', 'ConnActive', 'ConnMax',
];

export function isTotalCapable(counter: string): boolean {
  return TOTAL_CAPABLE.includes(counter);
}

export interface CounterMeta {
  disp: string;
  unit: string;
}

/**
 * 표시명과 단위. Family 를 가리지 않는다.
 *
 * 차트가 `meta.disp` 를 바로 읽으므로 **undefined 를 돌려주면 화면이 죽는다.**
 * 모르는 이름이면 이름 자체를 표시명으로 쓴다.
 */
export function counterMeta(name: CounterName): CounterMeta {
  if (name in JAVAEE_COUNTERS) return JAVAEE_COUNTERS[name as JavaeeCounterName];
  if (name in HOST_COUNTERS) return HOST_COUNTERS[name as HostCounterName];
  if (name in DATASOURCE_COUNTERS) return DATASOURCE_COUNTERS[name as DatasourceCounterName];
  return { disp: name, unit: '' };
}

/** 카운터가 어느 Family 인지. 모르는 이름은 null — 조용히 넘기면 0건의 원인을 못 찾는다. */
export function counterFamily(name: string): 'javaee' | 'host' | 'datasource' | null {
  if (name in JAVAEE_COUNTERS) return 'javaee';
  if (name in HOST_COUNTERS) return 'host';
  if (name in DATASOURCE_COUNTERS) return 'datasource';
  return null;
}

/**
 * javaee Family 에 속하는 ObjectType.
 *
 * 카운터는 Family 단위로 정의되므로 `TPS` 를 `linux` 오브젝트에 요청하면
 * 에러 없이 0건이 온다. **오브젝트 목록에서 첫 번째를 집으면 안 된다** —
 * 호스트 에이전트가 함께 붙어 있으면 순서를 보장할 수 없다.
 *
 * 원본: counters.xml `<Types>` 절
 */
export const JAVAEE_OBJECT_TYPES: readonly string[] = [
  'tomcat', 'java', 'jboss', 'jetty', 'resin',
];

export function isJavaeeObjectType(objType: string): boolean {
  return JAVAEE_OBJECT_TYPES.includes(objType);
}

/**
 * host Family 에 속하는 ObjectType.
 *
 * 호스트 에이전트는 OS 이름으로 붙는다 — 리눅스면 `linux`
 * (Test/agent-host 를 `live_host_counters` 로 실측 확인).
 */
export const HOST_OBJECT_TYPES: readonly string[] = [
  'linux', 'windows', 'osx', 'aix', 'hpux', 'solaris',
];

export function isHostObjectType(objType: string): boolean {
  return HOST_OBJECT_TYPES.includes(objType);
}

/**
 * datasource 서브오브젝트인가.
 *
 * 부모(tomcat)와 **별개의 오브젝트**로 등록되므로 javaee/host 어느 쪽도 아니다.
 * 이 판정이 없으면 오브젝트 목록에서 조용히 버려진다.
 */
export function isDatasourceObjectType(objType: string): boolean {
  return objType === 'datasource';
}

export const MAX_COUNTER_SAMPLES = 155; // 5분 / 2초 ≈ 150 + 여유
