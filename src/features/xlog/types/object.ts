// 오브젝트 단건 명령(OBJECT_*) 응답 타입
//
// Rust: src-tauri/src/scouter/object.rs
// 응답 구조는 실측으로 확인했다 (verified-facts.md F-24).

/** 에이전트 JVM 의 시스템 프로퍼티 한 줄 */
export interface EnvEntry {
  key: string;
  value: string;
}

/**
 * 에이전트 JVM 의 스레드 한 개.
 *
 * 트랜잭션을 처리 중인 스레드만 `service`/`txid`/`elapsed` 가 채워진다.
 * 유휴 스레드는 null 이다.
 */
export interface ThreadInfo {
  id: number;
  name: string;
  /** RUNNABLE / WAITING / TIMED_WAITING / BLOCKED */
  stat: string;
  /** 누적 CPU 시간(ms) */
  cpu: number;
  /** 처리 중인 트랜잭션의 경과 시간(ms) */
  elapsed: number | null;
  /** 서비스명 해시 */
  service: number | null;
  /** i64 라 문자열로 온다 (JS 정밀도 초과) */
  txid: string | null;
}

/**
 * 에이전트가 열고 있는 소켓 하나.
 *
 * `service`/`txid` 가 있으면 그 트랜잭션이 연 소켓이고,
 * null 이면 상시 연결(콜렉터, 커넥션 풀 등)이다.
 */
export interface SocketInfo {
  /** i64 라 문자열로 온다 */
  key: string;
  /** 상대 IPv4. 응답은 Blob 4바이트였던 것을 Rust 가 문자열로 바꿔 보낸다 */
  host: string;
  port: number;
  /** 같은 상대로 열린 소켓 수 */
  count: number;
  service: number | null;
  txid: string | null;
  stack: string;
}

/** 로드된 클래스 하나 */
export interface LoadedClass {
  index: number;
  name: string;
  super_class: string;
  interfaces: string;
  /** 어느 파일에서 왔는지. 같은 이름이 여러 jar 에 있을 때 이게 답이다 */
  resource: string;
}

/** 클래스 목록 한 페이지. 17,000개가 넘어 한 번에 오지 않는다 */
export interface ClassListPage {
  page: number;
  total_page: number;
  classes: LoadedClass[];
}

/**
 * 지금 이 순간 돌고 있는 트랜잭션 하나.
 *
 * 스레드 목록과 겹쳐 보이지만 **여기는 서비스명이 이미 텍스트**라 사전 조회가 없다.
 */
export interface ActiveService {
  /** 어느 오브젝트의 것인가. 타입 전체 조회에서는 이게 없으면 행이 뒤섞인다 */
  obj_hash: number;
  /** 스레드 ID */
  id: number;
  /** 스레드 이름 */
  name: string;
  /** 서비스명. 해시가 아니라 텍스트 */
  service: string;
  stat: string;
  elapsed: number;
  cpu: number;
  ip: string;
  login: string;
  /** 실행 중인 SQL. 없으면 빈 문자열 */
  sql: string;
  /** 호출 중인 외부 API. 없으면 빈 문자열 */
  subcall: string;
  /** Hexa32 를 푼 i64 를 문자열로 (XLog txid 와 같은 표기) */
  txid: string | null;
}

/** 힙 히스토그램 한 줄 — 클래스별 인스턴스 수와 점유 바이트 */
export interface HeapHistoRow {
  rank: number;
  instances: number;
  bytes: number;
  class_name: string;
}

/** 에이전트에 쌓인 덤프 파일 하나 */
export interface DumpFile {
  name: string;
  size: number;
  /** epoch ms */
  last_modified: number;
}

/** 스레드가 지금 트랜잭션을 처리 중인가 */
export function isBusy(t: ThreadInfo): boolean {
  return t.elapsed !== null;
}

/**
 * 상태별 색.
 *
 * BLOCKED 는 락 경합이라 항상 눈에 띄어야 한다 — 스레드 목록을 여는 이유의 절반이 이것이다.
 */
export function threadStatTone(stat: string): string {
  switch (stat) {
    case 'RUNNABLE':
      return 'text-ok';
    case 'BLOCKED':
      return 'text-danger';
    case 'WAITING':
    case 'TIMED_WAITING':
      return 'text-fg-faint';
    default:
      return 'text-fg-muted';
  }
}

/** 타입 전체의 액티브 서비스 */
export interface TypeActiveServices {
  rows: ActiveService[];
  /**
   * 끝까지 응답하지 못한 오브젝트.
   *
   * 조용히 적게 보여주면 "지금 한가하다"로 오해한다.
   */
  incomplete: number[];
}
