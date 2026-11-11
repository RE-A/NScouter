// F5 가 무엇을 할지 — 연결만 새로 맺나, 처음부터 다시 붙나
//
// 평소의 F5 는 가볍다: 붙어 있던 연결 묶음은 두고 소켓만 새로 맺은 뒤 지금 화면을 다시 받는다.
// **오류가 있을 때는 그걸로 안 풀리는 일이 많다** — 콜렉터가 다시 뜨며 세션·사전이 바뀌었거나, 스트림·조회가
// 계속 실패하는 경우다. 그때는 붙어 있던 콜렉터들에 접속부터 새로 한다(Rust `restart_collectors`).

import type { ConnectionInfo } from '../api/scouterApi';

/**
 * 처음부터 다시 붙어야 하나.
 *
 * @param info 지금 접속 상태. 못 읽었으면 null — 상태를 모르는 것 자체가 이상하므로 다시 붙는다
 * @param lastRefreshError 바로 앞의 새로고침이 실패한 까닭. 없으면 null
 */
export function needsRestart(info: ConnectionInfo | null, lastRefreshError: string | null): boolean {
  if (lastRefreshError !== null) return true;
  if (info === null) return true;
  // 못 붙은 콜렉터, 붙어는 있는데 최근 조회(스트림·주기 조회)가 실패한 콜렉터
  return (info.collectors ?? []).some(c => !c.connected || !!c.warning);
}
