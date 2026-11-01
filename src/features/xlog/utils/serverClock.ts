// 콜렉터 시계 — 실시간 화면의 «지금» 은 이 PC 가 아니라 콜렉터의 시각이다.
//
// **PC 시계가 틀린 곳이 있다.** 시계가 1분 빠른 PC 에서는 차트 오른쪽 1분이 늘 비었고,
// 늦은 PC 에서는 막 끝난 트랜잭션이 창 밖(미래)에 놓여 안 그려졌다. 화면은 «데이터 시각이
// 이 PC 보다 n초 뒤처집니다» 라고 말만 하고 고칠 방법이 없었다.
//
// 콜렉터는 로그인 응답에 제 시각(`time`)을 준다(F-5). 그때 잰 차(콜렉터 − PC)를 더해 «지금» 을
// 잡는다 — ASIS 클라이언트도 로그인 때 같은 차를 재서 실시간 XLog 창을 그린다.
// 접속할 때와 연결 새로고침(F5) 때 다시 잰다.
//
// **모듈 저장소다** (`agentNames.ts` 와 같은 이유) — 창 하나에 콜렉터 하나다.

let offsetMs = 0;
let known = false;

/** 콜렉터 시계 − PC 시계를 정한다. 모르면(null) 0 으로 — PC 시계를 그대로 쓴다 */
export function setServerClockOffset(ms: number | null | undefined): void {
  known = typeof ms === 'number' && Number.isFinite(ms);
  offsetMs = known ? (ms as number) : 0;
}

/** 콜렉터 시계 − PC 시계 (ms). 모르면 null */
export function serverClockOffset(): number | null {
  return known ? offsetMs : null;
}

/** 콜렉터 기준 «지금» (epoch ms) */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/**
 * 판 머리에 «PC 시계가 n초 다르다» 를 적을 문턱. 이보다 작으면 말하지 않는다 —
 * 왕복 지연·초 단위 반올림만으로도 1~2초는 늘 어긋난다.
 */
export const CLOCK_NOTICE_MS = 5_000;
