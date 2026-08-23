// 스트림 상태 판정 (순수 함수)

export type StreamStatusKind = 'idle' | 'waiting' | 'live' | 'stale';

export interface StreamStatus {
  kind: StreamStatusKind;
  /** 화면에 그대로 띄울 문구 */
  message: string;
  /** stale 일 때 마지막 수신 후 경과 초 */
  silentForSec?: number;
}

export interface StreamStatusInput {
  connected: boolean;
  /** 마지막으로 데이터를 받은 시각(epoch ms). 한 번도 없으면 null */
  lastReceivedAt: number | null;
  now: number;
  /** 이 시간 넘게 못 받으면 stale */
  staleAfterMs: number;
}

export function deriveStreamStatus(input: StreamStatusInput): StreamStatus {
  const { connected, lastReceivedAt, now, staleAfterMs } = input;

  if (!connected) {
    return { kind: 'idle', message: '연결 후 사용 가능합니다.' };
  }
  if (lastReceivedAt === null) {
    return { kind: 'waiting', message: '수신 대기 중…' };
  }

  const silentMs = now - lastReceivedAt;
  if (silentMs > staleAfterMs) {
    const silentForSec = Math.floor(silentMs / 1000);
    return {
      kind: 'stale',
      // "고장"이 아니라 "안 오고 있다"는 걸 분명히 한다.
      message: `${silentForSec}초째 수신 없음 — 트래픽이 없거나 에이전트가 멈췄습니다`,
      silentForSec,
    };
  }

  return { kind: 'live', message: '수신 중' };
}
