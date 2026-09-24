// 접속 한 벌 — 연결만 한다
//
// **예전에는 여기서 XLog 스트림까지 열었다.** 연결 → 오브젝트 목록 → 목록 전체로
// 스트림. 그런데 화면은 «고른 서버» 것만 받는 규칙이라(App 의 스트림 effect),
// 붙자마자 **두 번** 대량 수신이 일어났다:
//
//   1. 여기서 전체 오브젝트로 열어 최근 XLog 를 통째로 받고
//   2. 곧이어 App 이 고른 서버로 다시 열어 또 한 번 받는다
//      (스트림을 다시 열면 커서가 처음으로 돌아가 최신 만 건을 새로 준다)
//
// 실측 — 테스트 환경(오브젝트 5개, 고른 것 1대)에서 `XLog 스트리밍 시작: 1 오브젝트`
// 뒤에 `5 오브젝트` 가 이어졌다. 운영은 오브젝트가 160개가 넘으므로, 보지도 않을
// 서버의 XLog 를 접속할 때마다 한 번 다 받고 버린 셈이다. 접속이 무거웠던 까닭이다.
//
// **스트림은 App 이 연다.** 무엇을 받을지는 «지금 고른 서버» 가 정하고, 그건 접속
// 시점에 여기서 알 수 없다(설정에서 복원되거나 사용자가 그 뒤에 고른다).
// 그래서 이 함수는 연결까지만 책임진다 — 오브젝트 목록도 App 이 따로 받는다.

import {
  connectScouter,
  disconnectScouter,
  stopXLogStream,
  type ConnectParams,
} from './scouterApi';

/** 붙는다. 스트림·오브젝트 목록은 부르는 쪽(App)이 이어서 한다 */
export async function connectToServer(params: ConnectParams): Promise<void> {
  await connectScouter(params);
}

/**
 * 다른 서버로 갈아탄다.
 *
 * **끊는 쪽 실패는 삼킨다.** 이미 끊겼거나 세션이 만료된 상태에서 갈아타는 일이 흔한데,
 * 거기서 멈추면 «끊긴 채로 아무 데도 못 붙는» 자리에 갇힌다. 붙는 쪽 실패만 올린다.
 *
 * 스트림은 **끊기 전에 세워 둔다.** 앞 서버로 열어 둔 것이 남아 있으면 새 서버에
 * 붙은 뒤에도 옛 연결이 폴링을 계속한다.
 */
export async function switchToServer(params: ConnectParams): Promise<void> {
  try {
    await stopXLogStream();
  } catch {
    // 스트림이 이미 죽어 있을 수 있다
  }
  try {
    await disconnectScouter();
  } catch {
    // 연결이 이미 끊겨 있을 수 있다
  }
  return connectToServer(params);
}
