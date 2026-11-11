// F5 — 오류가 있으면 처음부터 다시 붙는다

import { describe, expect, it } from 'vitest';
import type { CollectorStatus, ConnectionInfo } from '../api/scouterApi';
import { needsRestart } from './reloadPlan';

const c = (over: Partial<CollectorStatus> = {}): CollectorStatus => ({
  name: 'A',
  host: 'h',
  port: 6100,
  server_id: 'S',
  connected: true,
  error: null,
  warning: null,
  ...over,
});
const info = (...collectors: CollectorStatus[]): ConnectionInfo => ({ connected: true, server_id: 'S', clock_offset_ms: 0, collectors });

describe('needsRestart', () => {
  it('오류가 없으면 가벼운 새로고침', () => {
    expect(needsRestart(info(c(), c({ name: 'B' })), null)).toBe(false);
  });

  it('못 붙은 콜렉터가 있으면 처음부터', () => {
    expect(needsRestart(info(c(), c({ name: 'B', connected: false, error: '연결 실패' })), null)).toBe(true);
  });

  it('붙어는 있는데 최근 조회가 실패한 콜렉터가 있으면 처음부터 — 콜렉터 하나여도', () => {
    expect(needsRestart(info(c({ warning: 'XLog 스트리밍 오류' })), null)).toBe(true);
  });

  it('바로 앞의 새로고침이 실패했으면 처음부터', () => {
    expect(needsRestart(info(c()), '연결 실패')).toBe(true);
  });

  it('상태를 못 읽었으면 처음부터', () => {
    expect(needsRestart(null, null)).toBe(true);
  });

  it('콜렉터 목록이 없으면(데모) 가벼운 새로고침', () => {
    expect(needsRestart({ connected: true, server_id: 'DEMO', clock_offset_ms: null }, null)).toBe(false);
  });
});
