// 콜렉터 시계의 계약 — 모르면 PC 시계 그대로, 알면 그만큼 민다
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverClockOffset, serverNow, setServerClockOffset } from './serverClock';

afterEach(() => { setServerClockOffset(null); vi.useRealTimers(); });

describe('serverClock', () => {
  it('모르면 PC 시계 그대로다', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    setServerClockOffset(null);
    expect(serverClockOffset()).toBeNull();
    expect(serverNow()).toBe(1_000_000);
  });

  it('PC 가 1분 빠르면(차 −60초) 콜렉터 시각은 그만큼 이르다', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    setServerClockOffset(-60_000);
    expect(serverClockOffset()).toBe(-60_000);
    expect(serverNow()).toBe(940_000);
  });
});
