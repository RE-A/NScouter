// src/features/xlog/api/scouterApi.ts
// Tauri invoke/listen 래퍼

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { XLogPack, AgentObject } from '../types/xlog';
import type { XLogProfilePack } from '../types/profile';
import type { CounterName, CounterUpdate } from '../types/counter';
import type { AlertPack } from '../types/alert';
import type { ConfigView } from '../types/config';
import type { ErrorSummaryRow, SummaryKind, SummaryRow } from '../types/summary';
import type { InteractionRow } from '../types/interaction';
import type {
  ActiveService,
  ClassListPage,
  DumpFile,
  EnvEntry,
  HeapHistoRow,
  SocketInfo,
  ThreadInfo,
  TypeActiveServices,
} from '../types/object';

export interface ConnectParams {
  host: string;
  port: number;
  user: string;
  pass: string;
}

// ─── 연결 ─────────────────────────────────────────────────────

export async function connectScouter(params: ConnectParams): Promise<void> {
  await invoke<void>('connect_scouter', {
    host: params.host,
    port: params.port,
    user: params.user,
    pass: params.pass,
  });
}

export async function disconnectScouter(): Promise<void> {
  await invoke<void>('disconnect_scouter');
}

// ─── XLog 스트리밍 ────────────────────────────────────────────

export async function startXLogStream(objHashes: number[]): Promise<void> {
  await invoke<void>('start_xlog_stream', { objHashes });
}

export async function stopXLogStream(): Promise<void> {
  await invoke<void>('stop_xlog_stream');
}

export async function startMockStream(): Promise<void> {
  await invoke<void>('start_mock_stream');
}

// ─── XLog 상세 조회 ───────────────────────────────────────────

/** txid에 해당하는 XLog 프로파일(Step 목록) 조회 */
export async function getXLogProfile(
  txid: string,
  date: string,
  objHash: number,
): Promise<XLogProfilePack> {
  return invoke<XLogProfilePack>('get_xlog_profile', { txid, date, objHash });
}

/**
 * 상한 없는 프로파일.
 *
 * `TRANX_PROFILE` 은 콜렉터가 `max` 요청값으로 자를 수 있지만 FULL 은 `-1` 고정이다.
 * 실측(스텝 202개)에서는 둘의 결과가 같았고, 긴 트랜잭션에서만 갈린다 (F-30).
 */
export async function getXLogFullProfile(
  txid: string,
  date: string,
  objHash: number,
): Promise<XLogProfilePack> {
  return invoke<XLogProfilePack>('get_xlog_full_profile', { txid, date, objHash });
}

/** txid로 단건 XLog 상세 조회 */
export async function getXLogDetail(
  txid: string,
  date: string,
): Promise<XLogPack> {
  return invoke<XLogPack>('get_xlog_detail', { txid, date });
}

/**
 * 같은 분산 트랜잭션(gxid)에 속한 XLog 전부.
 *
 * 요청 하나가 여러 앱을 거치면 XLog 도 앱마다 따로 남는다.
 * 목록에서는 남남으로 보이는 것들을 이걸로 다시 하나로 묶는다.
 */
export async function loadXLogByGxid(
  gxid: string,
  date: string,
): Promise<XLogPack[]> {
  return invoke<XLogPack[]>('load_xlog_by_gxid', { gxid, date });
}

// ─── 딕셔너리 조회 ────────────────────────────────────────────

export async function resolveTexts(
  typeKey: string,
  hashes: number[],
): Promise<Record<number, string>> {
  return invoke<Record<number, string>>('resolve_texts', { typeKey, hashes });
}

// ─── 프로파일 본문 검색 ───────────────────────────────────────

/** 검색 대상 한 건 */
export interface SearchTarget {
  txid: string;
  obj_hash: number;
  /** "yyyyMMdd" */
  date: string;
}

/** 프로파일 안에서 걸린 스텝 */
export interface StepHit {
  /** 프로파일 안에서의 순번 */
  index: number;
  /** sql / sql-param / apicall / apicall-addr / method / message / socket / error / threadcall */
  kind: string;
  snippet: string;
}

export interface ProfileHit {
  txid: string;
  /** 이 트랜잭션에서 걸린 스텝 수 */
  count: number;
  first: StepHit;
}

export interface SearchBatch {
  hits: ProfileHit[];
  /** 프로파일을 못 가져온 건수 */
  failed: number;
}

/**
 * 프로파일 본문에서 텍스트를 찾는다.
 *
 * **한 번에 다 넘기지 않는다.** 트랜잭션 한 건이 요청 하나라 수백 건이면 몇 초가 걸린다 —
 * 호출부가 묶음으로 잘라 부르며 진행률을 보이고 중간에 멈춘다.
 * 프로파일 자체는 오지 않는다(한 건이 수십 KB). 걸린 것만 온다.
 */
export async function searchProfiles(
  targets: SearchTarget[],
  query: string,
): Promise<SearchBatch> {
  return invoke<SearchBatch>('search_profiles', { targets, query });
}

// ─── 오브젝트(에이전트) 목록 ──────────────────────────────────

/** 연결된 에이전트 목록 조회 */
export async function getObjectList(): Promise<AgentObject[]> {
  return invoke<AgentObject[]>('get_object_list');
}

// ─── 오브젝트 단건 명령 ───────────────────────────────────────
// 콜렉터가 에이전트로 중계한다. 파라미터가 틀리면 에러가 아니라 빈 결과가 온다 (F-15).

/** 에이전트 JVM 의 시스템 프로퍼티 */
export async function getObjectEnv(objHash: number): Promise<EnvEntry[]> {
  return invoke<EnvEntry[]>('get_object_env', { objHash });
}

/** 에이전트 JVM 의 스레드 목록 */
export async function getObjectThreadList(objHash: number): Promise<ThreadInfo[]> {
  return invoke<ThreadInfo[]>('get_object_thread_list', { objHash });
}

/** 힙 히스토그램 (클래스별 인스턴스 수·점유 바이트) */
export async function getObjectHeapHistogram(objHash: number): Promise<HeapHistoRow[]> {
  return invoke<HeapHistoRow[]>('get_object_heap_histogram', { objHash });
}

/**
 * 에이전트 설정 — 파일 원문 + key/value/default 표.
 *
 * 호스트 에이전트도 답한다 (실측 41개). JVM 전용이 아니다.
 */
export async function getAgentConfig(objHash: number): Promise<ConfigView> {
  return invoke<ConfigView>('get_agent_config', { objHash });
}

/**
 * 구간 요약 — 서비스 / SQL / API / IP / UA.
 *
 * `objHash` 0 이면 타입 전체다. `id` 는 해시이므로 사전으로 풀어야 한다
 * (IP 만 예외 — 정수에 담긴 IPv4 다).
 */
export async function getSummary(
  kind: SummaryKind,
  date: string,
  stime: number,
  etime: number,
  objType: string,
  objHash = 0,
): Promise<SummaryRow[]> {
  return invoke<SummaryRow[]>('get_summary', { kind, date, stime, etime, objType, objHash });
}

/** 에러 요약. 대표 txid 가 있어 그 트랜잭션을 바로 열 수 있다 */
export async function getErrorSummary(
  date: string,
  stime: number,
  etime: number,
  objType: string,
  objHash = 0,
): Promise<ErrorSummaryRow[]> {
  return invoke<ErrorSummaryRow[]>('get_error_summary', { date, stime, etime, objType, objHash });
}

/**
 * 인터랙션(토폴로지) — 누가 누구를 부르나.
 *
 * **에이전트가 기본으로 수집하지 않는다** (`counter_interaction_enabled`, F-40).
 * 꺼져 있으면 에러가 아니라 0건이다.
 */
export async function getInteraction(objType: string): Promise<InteractionRow[]> {
  return invoke<InteractionRow[]>('get_interaction', { objType });
}

/** 콜렉터 설정. 오브젝트와 무관하다 */
export async function getServerConfig(): Promise<ConfigView> {
  return invoke<ConfigView>('get_server_config');
}

/**
 * 스레드 덤프를 **만든다** — 에이전트에 파일이 생긴다.
 * 부수효과가 있으므로 호출 전에 사용자 확인을 받을 것.
 */
export type DumpKind = 'threaddump' | 'activeservice' | 'threadlist' | 'heaphisto';

/**
 * 덤프를 **만든다** — 에이전트에 파일이 생긴다.
 *
 * 네 종류가 같은 응답(파일명 하나)을 쓴다 (F-35).
 * 부수효과가 있으므로 호출 전에 사용자 확인을 받을 것.
 */
export async function triggerDump(objHash: number, kind: DumpKind): Promise<string> {
  return invoke<string>('trigger_dump', { objHash, kind });
}

/**
 * 에이전트 JVM 에 Full GC.
 *
 * **콜렉터가 성공 여부를 주지 않는다** (F-35) — "요청했다"까지만 말할 수 있다.
 */
export async function objectSystemGc(objHash: number): Promise<void> {
  await invoke<void>('object_system_gc', { objHash });
}

/** 에이전트의 텍스트 캐시를 비운다. 해시→이름 사전이 어긋났을 때 */
export async function objectResetCache(objHash: number): Promise<void> {
  await invoke<void>('object_reset_cache', { objHash });
}

/** 스택 샘플링 켜기(지속 시간 지정)/끄기(생략) */
export async function objectStackSampling(
  objHash: number,
  durationMs?: number,
): Promise<void> {
  await invoke<void>('object_stack_sampling', { objHash, durationMs: durationMs ?? null });
}

/** 힙 덤프를 만든다. 힙 크기만 한 파일이 에이전트 디스크에 생긴다 */
export async function objectHeapDump(objHash: number): Promise<string> {
  return invoke<string>('object_heap_dump', { objHash });
}

/** 에이전트에 쌓인 덤프 파일 목록 (최신순) */
export async function getDumpFileList(objHash: number): Promise<DumpFile[]> {
  return invoke<DumpFile[]>('get_dump_file_list', { objHash });
}

/** 덤프 파일 내용 */
export async function getDumpFileContent(objHash: number, name: string): Promise<string> {
  return invoke<string>('get_dump_file_content', { objHash, name });
}

/** 지금 돌고 있는 트랜잭션 목록 (순간 스냅샷) */
export async function getObjectActiveServices(objHash: number): Promise<ActiveService[]> {
  return invoke<ActiveService[]>('get_object_active_services', { objHash });
}

/** 에이전트가 열고 있는 소켓 목록 */
export async function getObjectSockets(objHash: number): Promise<SocketInfo[]> {
  return invoke<SocketInfo[]>('get_object_sockets', { objHash });
}

/** 로드된 클래스 목록. **페이지 단위다** — total_page 를 보고 넘긴다 */
export async function getObjectClassList(
  objHash: number,
  page: number,
): Promise<ClassListPage> {
  return invoke<ClassListPage>('get_object_class_list', { objHash, page });
}

// ─── objType 단위 조회 ────────────────────────────────────────
// 지금까지의 카운터는 오브젝트 하나가 기준이었다. 이것들은 **타입 전체**가 기준이다.

/** 액티브 서비스 단계별 수. act1 미만 1초 / act2 1~3초 / act3 3초 이상 */
export interface ActiveSpeed {
  obj_hash: number;
  act1: number;
  act2: number;
  act3: number;
  /** 타입 전체 TPS. 합계 응답에만 있다 */
  tps: number;
}

export interface CounterSeries {
  obj_hash: number;
  times: number[];
  values: number[];
}

/** 타입 전체 합계 + TPS */
export async function getActiveSpeed(objType: string): Promise<ActiveSpeed> {
  return invoke<ActiveSpeed>('get_active_speed', { objType });
}

/** 오브젝트별 액티브 서비스 */
export async function getActiveSpeedByObject(objType: string): Promise<ActiveSpeed[]> {
  return invoke<ActiveSpeed[]>('get_active_speed_by_object', { objType });
}

/** 오늘 누적 카운터. date 를 주면 그날 것 */
export async function getTodayCounter(
  counter: string,
  objType: string,
  date?: string,
): Promise<CounterSeries[]> {
  return invoke<CounterSeries[]>('get_today_counter', { counter, objType, date: date ?? null });
}

/**
 * 타입 전체의 액티브 서비스 (지금 돌고 있는 트랜잭션).
 *
 * 요청 한 번으로 그 타입의 모든 오브젝트를 받는다 (F-34).
 */
export async function getTypeActiveServices(objType: string): Promise<TypeActiveServices> {
  return invoke<TypeActiveServices>('get_type_active_services', { objType });
}

/** 오늘 방문자 수 */
/**
 * 에이전트 설정 저장.
 *
 * **원문 전체를 보내야 한다** — 에이전트가 파일을 통째로 덮어쓰기 때문에
 * 일부만 보내면 나머지 설정이 사라진다 (F-40).
 */
export async function saveAgentConfig(objHash: number, text: string): Promise<void> {
  return invoke<void>('save_agent_config', { objHash, text });
}

/**
 * 실행 중인 트랜잭션 한 건의 상세.
 *
 * `blocked_time`/`waited_time` 이 **null 이면 0이 아니라 "측정 꺼짐"이다** —
 * 콜렉터가 -1 로 준 것을 눕히지 않고 그대로 구분해 온다 (F-46).
 */
export interface ThreadDetail {
  thread_id: number;
  thread_name: string;
  state: string;
  service_name: string;
  service_txid: string;
  service_elapsed: number;
  cpu_time: number;
  user_time: number;
  blocked_count: number;
  blocked_time: number | null;
  waited_count: number;
  waited_time: number | null;
  lock_name: string;
  lock_owner_id: number | null;
  lock_owner_name: string;
  sql: string;
  sql_bind_var: string;
  subcall: string;
  stack_trace: string;
}

/**
 * **순간 상태다.** 여는 사이에 트랜잭션이 끝나면 null 이 온다 — 오류가 아니다.
 */
export async function getThreadDetail(
  objHash: number,
  threadId: number,
  txid: string,
): Promise<ThreadDetail | null> {
  return invoke<ThreadDetail | null>('get_thread_detail', { objHash, threadId, txid });
}

/**
 * 모인 스택의 시각 목록 (오름차순).
 *
 * 스택 분석기는 켜고 끄는 것만으로는 쓸모가 없다 — 이게 **읽는 쪽**이다 (F-45).
 * `objHash` 가 아니라 **objName** 으로 묻는다.
 */
export async function getStackIndex(
  objName: string,
  from: number,
  to: number,
): Promise<number[]> {
  return invoke<number[]>('get_stack_index', { objName, from, to });
}

/**
 * 스택 **한 장**의 원문.
 *
 * 구간 전체를 한 번에 받지 않는다 — 실측에서 하루치가 124장 6.4MB 였다.
 */
export async function getStackDump(objName: string, time: number): Promise<string> {
  return invoke<string>('get_stack_dump', { objName, time });
}

/**
 * 서비스 그룹 실시간 (ASIS ServiceGroup TPS / Elapsed).
 *
 * **objType 이 아니라 objHash 목록으로 묻는다** — objType 으로 물으면
 * 에러 없이 0건이 온다 (F-44).
 */
export interface ServiceGroupRow {
  name: string;
  /** 30초 구간의 누적 호출 수. TPS 로 보려면 30으로 나눈다 */
  count: number;
  /** 평균 응답시간(ms). **Float 으로 온다** — 정수로 다루면 소수점이 날아간다 (F-44) */
  elapsed: number;
  error: number;
}

export async function getServiceGroup(objHashes: number[]): Promise<ServiceGroupRow[]> {
  return invoke<ServiceGroupRow[]>('get_service_group', { objHashes });
}

export async function getTodayVisitor(objType: string): Promise<number> {
  return invoke<number>('get_today_visitor', { objType });
}

// ─── 카운터 스트리밍 ──────────────────────────────────────────

/**
 * 실시간 성능 카운터 스트리밍 시작 (2초 폴링).
 *
 * `COUNTER_REAL_TIME_ALL_MULTI` 로 카운터 전체를 요청 1회에 받는다.
 * F-1(연결당 명령 1개) 때문에 요청 수가 곧 TCP 연결 수다.
 * `counters` 는 counters.xml 표기 그대로여야 한다 (F-15).
 */
export async function startCounterStream(
  objHashes: number[],
  counters: CounterName[],
): Promise<void> {
  await invoke<void>('start_counter_stream', { objHashes, counters });
}

// ─── 알림 스트리밍 ────────────────────────────────────────────

/** 실시간 알림 스트리밍 시작 (2초 폴링) */
export async function startAlertStream(): Promise<void> {
  await invoke<void>('start_alert_stream');
}

// ─── 로그 레벨 ────────────────────────────────────────────────

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export async function setLogLevel(level: LogLevel): Promise<void> {
  await invoke<void>('set_log_level', { levelStr: level });
}

// ─── 이벤트 리스너 ────────────────────────────────────────────

export function onXLogData(handler: (xlog: XLogPack) => void): Promise<UnlistenFn> {
  return listen<XLogPack>('xlog-data', e => handler(e.payload));
}

export function onXLogError(handler: (msg: string) => void): Promise<UnlistenFn> {
  return listen<{ message: string }>('xlog-error', e => handler(e.payload.message));
}

export function onConnected(handler: (serverId: string) => void): Promise<UnlistenFn> {
  return listen<string>('scouter-connected', e => handler(e.payload));
}

export function onDisconnected(handler: () => void): Promise<UnlistenFn> {
  return listen<void>('scouter-disconnected', () => handler());
}

export function onCounterData(handler: (update: CounterUpdate) => void): Promise<UnlistenFn> {
  return listen<CounterUpdate>('counter-data', e => handler(e.payload));
}

export function onAlertData(handler: (pack: AlertPack) => void): Promise<UnlistenFn> {
  return listen<AlertPack>('alert-data', e => handler(e.payload));
}

// ─── 설정 ──────────────────────────────────────────────────────

export interface AppConfig {
  data_dir?: string | null;
  last_host?: string | null;
  last_port?: number | null;
  last_user?: string | null;
  /** 기동 시 마지막 접속 정보로 자동 연결 */
  auto_connect?: boolean;
  /** 자동 연결용 비밀번호. **config.json 에 평문 저장된다** */
  last_pass?: string | null;
  /**
   * SQL 바인딩 파라미터를 문장에 채워 보여줄지. 기본 true.
   *
   * 끄면 자리표시자(`?`)를 그대로 두고 값을 아래에 따로 적는다.
   */
  sql_bind_inline?: boolean;
}

export async function getConfig(): Promise<AppConfig> {
  return invoke<AppConfig>('get_config');
}

export async function saveConfig(newConfig: AppConfig): Promise<void> {
  return invoke<void>('save_config', { newConfig });
}
