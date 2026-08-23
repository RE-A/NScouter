// Tauri 이벤트 구독을 effect 정리와 안전하게 묶는다.
//
// `listen()` 은 해지 함수를 **Promise 로** 준다. 흔한 작성법
//
//   let off = null;
//   listen(...).then(fn => { off = fn; });
//   return () => off?.();
//
// 은 정리가 Promise 보다 먼저 돌면 `off` 가 아직 null 이라 **아무것도 해지하지 않는다.**
// 리스너는 살아남고, 다음 마운트가 하나를 더 건다 → 이벤트가 두 번 처리된다.
//
// 실제로 이 때문에 모든 XLog 가 저장소에 두 번 들어갔다. 화면에서는
// 똑같은 시각·똑같은 Elapsed 의 행이 쌍으로 보였고, 개수도 두 배였다.
// StrictMode 가 드러나게 했을 뿐, 의존성이 빠르게 두 번 바뀌면 운영에서도 같은 일이 난다.

import type { UnlistenFn } from '@tauri-apps/api/event';

/**
 * 구독들을 한 번에 정리하는 함수를 돌려준다.
 *
 * 정리가 먼저 불려도 뒤늦게 도착한 해지 함수를 **그 자리에서** 호출하므로
 * 리스너가 새어 나가지 않는다.
 */
export function subscribe(...pending: Promise<UnlistenFn>[]): () => void {
  let cancelled = false;
  const live: UnlistenFn[] = [];

  for (const p of pending) {
    p.then(fn => {
      if (cancelled) fn();
      else live.push(fn);
    }).catch(() => {
      // 구독 실패는 화면에서 할 수 있는 게 없다. 정리 경로만 깨지지 않으면 된다.
    });
  }

  return () => {
    cancelled = true;
    for (const fn of live) fn();
    live.length = 0;
  };
}
