// 접속이 바뀌면 받아 둔 XLog 를 버린다.
//
// **«서버를 바꿨는데 이전 서버의 점이 한참 남는다».** 원인은 둘이 겹친 것이었다.
//
//   1. 끊길 때 상세·에이전트 목록은 비웠지만 **XLog 저장소는 안 비웠다.** 저장소는
//      5초마다 시간 창 밖만 잘라낸다 — 창이 5분이면 5분 동안 남는다.
//   2. 화면은 고른 서버로 거르는데, **objHash 는 이름에서 만들어진다**
//      (에이전트 `Configure`: `objHash = HashUtil.hash(objName)`). 개발·운영 콜렉터가
//      같은 서비스 이름을 쓰면 해시가 같아서, 이전 콜렉터의 점이 선택 필터를 그대로 통과한다.
//
// 끊김을 보고 비우기만 하면 끊김과 재연결이 한 렌더에 묶였을 때 놓친다. 그래서
// **연결할 때마다 올라가는 번호**를 같이 본다 — 번호가 바뀌었으면 다른 접속이다.

import { useEffect, useRef } from 'react';

/**
 * @param connected 지금 붙어 있는가. 끊기는 순간 비운다 — 전환하는 동안 이전 점이 보이지 않게
 * @param epoch 연결할 때마다 올라가는 번호. 바뀌면 다른 접속이므로 비운다
 * @param reset 받아 둔 것을 버린다
 * @param reconnected 새 접속에서 다시 받아야 할 것이 있으면 (과거 구간 등)
 */
export function useConnectionReset(
  connected: boolean,
  epoch: number,
  reset: () => void,
  reconnected?: () => void,
): void {
  const epochRef = useRef(epoch);
  const connectedRef = useRef(connected);
  // 콜백은 렌더마다 새로 만들어질 수 있다. 판단은 connected·epoch 로만 한다.
  const resetRef = useRef(reset);
  const reconnectedRef = useRef(reconnected);
  resetRef.current = reset;
  reconnectedRef.current = reconnected;

  useEffect(() => {
    const wasConnected = connectedRef.current;
    const lastEpoch = epochRef.current;
    connectedRef.current = connected;
    epochRef.current = epoch;

    if (wasConnected && !connected) {
      resetRef.current();
      return;
    }
    if (epoch !== lastEpoch) {
      resetRef.current();
      reconnectedRef.current?.();
    }
  }, [connected, epoch]);
}
