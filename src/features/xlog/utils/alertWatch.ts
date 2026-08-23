// 알림 화면의 빈 상태 문구 (순수 함수)
//
// XLog·카운터는 계속 흘러야 정상이라 `deriveStreamStatus` 로 "N초째 수신 없음" 을 띄운다.
// **알림은 그 반대다.** 임계치를 넘을 때만 오므로 한 시간 조용한 게 정상이고,
// 거기에 같은 문구를 쓰면 멀쩡한 시스템을 고장 났다고 말하게 된다.
//
// 그래도 "알림 없음" 한 줄로는 감시가 살아 있는지 알 수 없다.
// **얼마나 지켜봤는지**를 함께 말해 주면 침묵이 결과라는 게 드러난다.

export interface AlertWatchInput {
  connected: boolean;
  /** 알림 구독을 시작한 시각(epoch ms). 아직이면 null */
  since: number | null;
  now: number;
}

/** 초 단위를 사람이 읽는 길이로. 분 미만은 초로 둔다 — 시작 직후 "0분" 은 멈춘 것처럼 보인다 */
function elapsedLabel(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}초`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분`;
  return `${Math.floor(min / 60)}시간 ${min % 60}분`;
}

/** 알림이 하나도 없을 때 띄울 문구 */
export function alertWatchMessage(input: AlertWatchInput): string {
  const { connected, since, now } = input;

  if (!connected) return '연결 후 사용 가능합니다.';
  if (since === null) return '알림 감시를 시작하는 중…';

  return `${elapsedLabel(now - since)}째 지켜보는 중 · 알림은 임계치를 넘을 때만 옵니다`;
}
