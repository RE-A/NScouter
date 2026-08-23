// 스트림 상태 판정
//
// "비어 있음"이 고장인지 데이터가 없는 건지 구분하려고 만든다.
// 실제로 이걸 구분 못 해서 로그·컨테이너·TPS 를 전부 뒤진 적이 있다.
//
// ASIS 는 setActive()/setInactive() 로 아이콘만 바꾼다
// (CounterRealTimeAllView:312, ScouterViewPart:65).

import { describe, it, expect } from 'vitest';
import { deriveStreamStatus } from './streamStatus';

const NOW = 1_700_000_000_000;

describe('deriveStreamStatus', () => {
  it('연결 전이면 idle', () => {
    const s = deriveStreamStatus({
      connected: false, lastReceivedAt: null, now: NOW, staleAfterMs: 10_000,
    });
    expect(s.kind).toBe('idle');
  });

  // 연결 직후엔 아직 아무것도 안 온 게 정상이다. 이걸 고장처럼 보이면 안 된다.
  it('연결됐지만 아직 한 건도 못 받았으면 waiting', () => {
    const s = deriveStreamStatus({
      connected: true, lastReceivedAt: null, now: NOW, staleAfterMs: 10_000,
    });
    expect(s.kind).toBe('waiting');
  });

  it('최근에 받았으면 live', () => {
    const s = deriveStreamStatus({
      connected: true, lastReceivedAt: NOW - 1_000, now: NOW, staleAfterMs: 10_000,
    });
    expect(s.kind).toBe('live');
  });

  // 받다가 끊긴 것 — 부하가 멈췄거나 에이전트가 죽었거나.
  it('받은 적은 있지만 오래됐으면 stale', () => {
    const s = deriveStreamStatus({
      connected: true, lastReceivedAt: NOW - 30_000, now: NOW, staleAfterMs: 10_000,
    });
    expect(s.kind).toBe('stale');
  });

  it('경계값(staleAfterMs 정확히)은 아직 live', () => {
    const s = deriveStreamStatus({
      connected: true, lastReceivedAt: NOW - 10_000, now: NOW, staleAfterMs: 10_000,
    });
    expect(s.kind).toBe('live');
  });

  it('stale 이면 마지막 수신 경과 시간을 초 단위로 준다', () => {
    const s = deriveStreamStatus({
      connected: true, lastReceivedAt: NOW - 42_000, now: NOW, staleAfterMs: 10_000,
    });
    expect(s.kind).toBe('stale');
    expect(s.silentForSec).toBe(42);
  });

  it('연결이 끊기면 받은 적이 있어도 idle', () => {
    const s = deriveStreamStatus({
      connected: false, lastReceivedAt: NOW - 1_000, now: NOW, staleAfterMs: 10_000,
    });
    expect(s.kind).toBe('idle');
  });

  it('상태마다 화면에 띄울 문구가 있다', () => {
    for (const c of [false, true]) {
      for (const last of [null, NOW - 1_000, NOW - 30_000]) {
        const s = deriveStreamStatus({
          connected: c, lastReceivedAt: last, now: NOW, staleAfterMs: 10_000,
        });
        expect(s.message.length).toBeGreaterThan(0);
      }
    }
  });
});
