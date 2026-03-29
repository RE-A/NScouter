// src/features/xlog/api/scouterApi.ts
// Tauri invoke/listen 래퍼

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { XLogPack, AgentObject } from '../types/xlog';
import type { XLogProfilePack } from '../types/profile';
import type { PerfCounterPack } from '../types/counter';
import type { AlertPack } from '../types/alert';

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

/** txid로 단건 XLog 상세 조회 */
export async function getXLogDetail(
  txid: string,
  date: string,
): Promise<XLogPack> {
  return invoke<XLogPack>('get_xlog_detail', { txid, date });
}

// ─── 딕셔너리 조회 ────────────────────────────────────────────

export async function resolveTexts(
  typeKey: string,
  hashes: number[],
): Promise<Record<number, string>> {
  return invoke<Record<number, string>>('resolve_texts', { typeKey, hashes });
}

// ─── 오브젝트(에이전트) 목록 ──────────────────────────────────

/** 연결된 에이전트 목록 조회 */
export async function getObjectList(): Promise<AgentObject[]> {
  return invoke<AgentObject[]>('get_object_list');
}

// ─── 카운터 스트리밍 ──────────────────────────────────────────

/** 실시간 성능 카운터 스트리밍 시작 (2초 폴링) */
export async function startCounterStream(objHashes: number[]): Promise<void> {
  await invoke<void>('start_counter_stream', { objHashes });
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

export function onCounterData(handler: (pack: PerfCounterPack) => void): Promise<UnlistenFn> {
  return listen<PerfCounterPack>('counter-data', e => handler(e.payload));
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
}

export async function getConfig(): Promise<AppConfig> {
  return invoke<AppConfig>('get_config');
}

export async function saveConfig(newConfig: AppConfig): Promise<void> {
  return invoke<void>('save_config', { newConfig });
}
