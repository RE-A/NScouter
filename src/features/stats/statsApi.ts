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
  /** 서버 이름·종류에 든 글자 (묶음과 OR) */
  servers: string[];
  current: StatsRange;
  /** 기준(평소) 구간들 — 하나의 기준으로 합친다 */
  baselines: StatsRange[];
  /** 직접 지정한 서비스. 비면 현재 구간에 찍힌 서비스 전부 */
  services: string[];
  service_include: string[];
  service_exclude: string[];
  ip_include: string[];
  ip_exclude: string[];
  tz_offset_ms: number;
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
}

export interface StatsProgress {
  phase: 'plan' | 'scan' | 'done';
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
