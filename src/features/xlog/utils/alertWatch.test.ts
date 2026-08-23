import { describe, expect, it } from 'vitest';
import { alertWatchMessage } from './alertWatch';

const NOW = 1_000_000_000;

describe('alertWatchMessage', () => {
  it('연결 전에는 연결하라고 말한다', () => {
    expect(alertWatchMessage({ connected: false, since: null, now: NOW })).toBe(
      '연결 후 사용 가능합니다.',
    );
  });

  it('구독 시각을 아직 모르면 시작 중이라고 말한다', () => {
    expect(alertWatchMessage({ connected: true, since: null, now: NOW })).toBe(
      '알림 감시를 시작하는 중…',
    );
  });

  it('침묵을 고장이 아니라 결과로 말한다', () => {
    const msg = alertWatchMessage({ connected: true, since: NOW - 30_000, now: NOW });
    // 카운터/XLog 의 "수신 없음" 문구를 쓰면 멀쩡한 시스템이 고장으로 읽힌다.
    expect(msg).not.toContain('수신 없음');
    expect(msg).toContain('임계치');
  });

  it('1분 미만은 초로 센다', () => {
    expect(alertWatchMessage({ connected: true, since: NOW - 5_000, now: NOW })).toContain('5초째');
  });

  it('1분이 넘으면 분으로 센다', () => {
    expect(alertWatchMessage({ connected: true, since: NOW - 185_000, now: NOW })).toContain('3분째');
  });

  it('1시간이 넘으면 시간과 분을 함께 센다', () => {
    const msg = alertWatchMessage({ connected: true, since: NOW - 3 * 3_600_000 - 300_000, now: NOW });
    expect(msg).toContain('3시간 5분째');
  });

  it('시계가 거꾸로 가도 음수를 쓰지 않는다', () => {
    expect(alertWatchMessage({ connected: true, since: NOW + 10_000, now: NOW })).toContain('0초째');
  });
});
