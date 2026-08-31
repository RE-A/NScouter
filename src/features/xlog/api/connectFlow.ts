// 접속 한 벌 — 연결 → 오브젝트 목록 → XLog 스트림
//
// **세 단계가 한 벌이다.** 연결만 하고 스트림을 안 켜면 화면이 조용히 비고,
// 오브젝트 목록을 건너뛰면 스트림에 넘길 대상이 없다.
// 접속 창과 서버 갈아타기가 **같은 순서**를 써야 «창으로 붙을 때와 갈아탈 때가 다르다» 가
// 생기지 않는다.

import {
  connectScouter,
  disconnectScouter,
  getObjectList,
  startXLogStream,
  stopXLogStream,
  type ConnectParams,
} from './scouterApi';

/** 붙는다. 돌려주는 값은 이 서버의 오브젝트 해시 목록이다 */
export async function connectToServer(params: ConnectParams): Promise<number[]> {
  await connectScouter(params);
  const objects = await getObjectList();
  const hashes = objects.map(o => o.obj_hash);
  // 오브젝트가 하나도 없어도 스트림은 연다 — `[0]` 은 «전부» 를 뜻한다.
  // 안 열면 에이전트가 나중에 떠도 화면이 영영 비어 있다.
  await startXLogStream(hashes.length > 0 ? hashes : [0]);
  return hashes;
}

/**
 * 다른 서버로 갈아탄다.
 *
 * **끊는 쪽 실패는 삼킨다.** 이미 끊겼거나 세션이 만료된 상태에서 갈아타는 일이 흔한데,
 * 거기서 멈추면 «끊긴 채로 아무 데도 못 붙는» 자리에 갇힌다. 붙는 쪽 실패만 올린다.
 */
export async function switchToServer(params: ConnectParams): Promise<number[]> {
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
