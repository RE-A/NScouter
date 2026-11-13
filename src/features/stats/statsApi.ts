// 통계 비교 — Rust `stats` 모듈과 짝인 타입과 호출

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** 구간 (epoch ms, `[stime, etime)`) */
export interface StatsRange {
  stime: number;
  etime: number;
}

/** 통계 비교 요청 — Rust `StatsRequest` */
export interface StatsRequest {
  title: string;
  /** 서비스 묶음 이름들 (완전 일치) */
  groups: string[];
  /** 서버 이름에 든 글자 — 예전 결과를 읽으려고 남김. 지금 화면은 `task_patterns` */
  servers: string[];
  /** Task 이름 규칙. `*` 가 있으면 그 모양 그대로, 없으면 «포함» (대소문자 무시) */
  task_patterns: string[];
  current: StatsRange;
  /** 기준(과거) 구간들 — 하나의 기준으로 합친다 */
  baselines: StatsRange[];
  /** 직접 지정한 서비스. 비면 기준 구간에 찍힌 서비스 전부 */
  services: string[];
  service_include: string[];
  service_exclude: string[];
  ip_include: string[];
  ip_exclude: string[];
  tz_offset_ms: number;
  /** 통계에 들어간 트랜잭션을 원본 CSV 로도 남긴다 (내보내기 폴더) */
  raw: boolean;
}

export interface Sample {
  txid: string;
  date: string;
  end_time: number;
  elapsed: number;
  error: boolean;
  obj_hash: number;
}

export interface SeriesPoint {
  t: number;
  count: number;
  errors: number;
  avg_ms: number;
  max_ms: number;
}

/** 서비스 하나의 한쪽 요약 — Rust `Summary`. 비교 표용 결과에서는 series·dist 가 빈다 */
export interface StatsSummary {
  count: number;
  errors: number;
  /** 0~1 */
  error_rate: number;
  tps: number;
  avg_ms: number;
  p50_ms: number;
  p90_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  sql_count_avg: number;
  sql_ms_avg: number;
  api_count_avg: number;
  api_ms_avg: number;
  cpu_ms_avg: number;
  series: SeriesPoint[];
  /** (칸 위쪽 끝 ms, 건수) */
  dist: [number, number][];
  slowest: Sample[];
  errored: Sample[];
}

export interface ServiceStats {
  service: string;
  current: StatsSummary | null;
  baseline: StatsSummary | null;
}

export interface RangeCoverage {
  kind: 'current' | 'baseline';
  stime: number;
  etime: number;
  servers: string[];
  slices: number;
  slices_done: number;
  missing: [number, number][];
  scanned: number;
}

export interface StatsResult {
  id: string;
  request: StatsRequest;
  started_at: number;
  finished_at: number;
  status: 'done' | 'cancelled' | 'failed';
  message: string | null;
  collectors: string[];
  ranges: RangeCoverage[];
  services: ServiceStats[];
  /** 원본 CSV 경로 — 남기기로 했을 때만 */
  raw_path: string | null;
  raw_rows: number;
  raw_error: string | null;
  /** 원본 CSV 파일 수 — 100만 줄마다 나눈다(엑셀 한 시트 한계) */
  raw_files: number;
  /** 서비스 수 상한을 넘어 «기타» 로 합친 건수 */
  folded: number;
}

export interface StatsProgress {
  /** queue: 앞 작업이 끝나길 기다리는 중 (한 번에 하나만 돈다) */
  phase: 'queue' | 'plan' | 'scan' | 'done';
  slices_total: number;
  slices_done: number;
  scanned: number;
  matched: number;
  started_at: number;
  eta_ms: number | null;
  paused: boolean;
}

export interface JobInfo {
  id: string;
  title: string;
  status: 'running' | 'done' | 'cancelled' | 'failed';
  started_at: number;
  finished_at: number;
  request: StatsRequest;
  progress: StatsProgress | null;
  services: number;
}

export interface Estimate {
  ranges: { kind: 'current' | 'baseline'; stime: number; etime: number; servers: string[]; count: number }[];
  total: number;
}

export function statsEstimate(request: StatsRequest): Promise<Estimate> {
  return invoke<Estimate>('stats_estimate', { request });
}

export function statsStart(request: StatsRequest): Promise<string> {
  return invoke<string>('stats_start', { request });
}

export function statsControl(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<void> {
  return invoke<void>('stats_control', { id, action });
}

export function statsJobs(): Promise<JobInfo[]> {
  return invoke<JobInfo[]>('stats_jobs');
}

/** 비교 표용 결과 — 서비스마다 5분 추이·분포를 뺀 것 */
export function statsResult(id: string): Promise<StatsResult> {
  return invoke<StatsResult>('stats_result', { id });
}

/** 서비스 하나의 전부 (추이·분포 포함) */
export function statsService(id: string, service: string): Promise<ServiceStats> {
  return invoke<ServiceStats>('stats_service', { id, service });
}

/** 이름 붙여 저장한 Task 이름 규칙 */
export interface StatsTaskRule {
  name: string;
  patterns: string[];
}

/** 저장한 규칙 목록을 통째로 갈아 끼운다 (config.json) */
export function statsSaveRules(rules: StatsTaskRule[]): Promise<void> {
  return invoke<void>('stats_save_rules', { rules });
}

/** 앱을 닫기 전에 — 돌거나 기다리는 작업을 취소하고 그때까지 모은 것이 저장될 때까지 기다린다 */
export function statsShutdown(): Promise<number> {
  return invoke<number>('stats_shutdown');
}

/** 판정 기준 — Rust `StatsJudgePrefs` (config.json) */
export interface StatsJudgePrefs {
  slow_ratio: number;
  slow_min_ms: number;
  error_ratio: number;
  /** %p */
  error_min_pp: number;
  /** % */
  volume_pct: number;
  min_count: number;
  use_p99: boolean;
  /** «느려짐» 을 볼 지표. 비면 평균·p90(+use_p99) — 예전 설정 */
  slow_metrics?: string[];
}

/** 통계 탭 설정 — Rust `StatsPrefs` */
export interface StatsPrefs {
  judge: StatsJudgePrefs;
  /** 결과 보관 일수. 0 이면 지우지 않는다 */
  keep_days: number;
  /** 조건 묶음 (`statsPresets.ts` 모양) */
  presets: unknown[];
  /** 비교 표의 열 너비(px) — 끌어서 정한 것만 */
  col_widths?: Record<string, number>;
}

export function statsSavePrefs(prefs: StatsPrefs): Promise<void> {
  return invoke<void>('stats_save_prefs', { prefs });
}

/** HTML 보고서를 내보내기 폴더에 남긴다. 경로를 돌려준다 */
export function statsSaveReport(name: string, stamp: string, html: string): Promise<string> {
  return invoke<string>('stats_save_report', { name, stamp, html });
}

export function statsDelete(id: string): Promise<void> {
  return invoke<void>('stats_delete', { id });
}

export function onStatsProgress(handler: (id: string, p: StatsProgress) => void): Promise<UnlistenFn> {
  return listen<{ id: string; progress: StatsProgress }>('stats-progress', e => handler(e.payload.id, e.payload.progress));
}

export function onStatsDone(handler: (id: string, status: string, message: string | null) => void): Promise<UnlistenFn> {
  return listen<{ id: string; status: string; message: string | null }>('stats-done', e =>
    handler(e.payload.id, e.payload.status, e.payload.message),
  );
}
