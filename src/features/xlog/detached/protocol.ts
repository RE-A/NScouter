// 메인 창 ↔ 떼어 낸 XLog 창 주고받기.
//
// **떼어 낸 창은 제 탭의 주인이다.** 메인 창과 같은 앱(App)이 XLog 화면만 띄운 것이라, 서버 고르기·툴바·
// 차트·트랜잭션 목록·상세를 저마다 한다. 메인 창이 맡는 것은 셋뿐이다:
//   · 창을 연다 (떼기 요청은 어느 창에서 오든 메인 창이 받아 연다)
//   · 창마다 무엇을 띄웠는지 적어 두고 **설정 파일에 남긴다** — 켜면 같은 자리에 다시 연다
//   · 합치면 그 탭들을 들인다
//
//   뗀 창 → 메인  hello    (떴다 — 띄울 탭을 달라)
//   메인  → 뗀 창 init     (탭들 · 분할)
//   뗀 창 → 메인  snapshot (탭·분할·창 자리가 바뀌었다 — 저장해 달라)
//   뗀 창 → 메인  merge    (이 탭들을 메인 창으로 — `close` 면 창째로 합친다)
//   뗀 창 → 메인  closed   (사용자가 창을 닫았다 — 적어 둔 것을 지운다)
//   아무 창 → 메인 detach  (이 탭들로 새 창을 열어 달라)
//
// 스트림은 Rust 가 창마다 받고 싶은 오브젝트를 합쳐 연다(`restart_xlog_stream`).

import type { XLogSplitPrefs, XLogTabPrefs } from '../api/scouterApi';

export const EV_HELLO = 'xlogwin-hello';
export const EV_INIT = 'xlogwin-init';
export const EV_SNAPSHOT = 'xlogwin-snapshot';
export const EV_MERGE = 'xlogwin-merge';
export const EV_CLOSED = 'xlogwin-closed';
export const EV_DETACH = 'xlogwin-detach';

/** 뗀 창 주소의 질의 이름. 값은 창 이름이다 */
export const WINDOW_QUERY = 'xlogwin';

/** 창 이름의 꼴. Tauri 창 이름은 영숫자와 `-/:_` 만 된다 */
const LABEL_RE = /^xlogwin-\d+$/;

export function isWindowLabel(v: unknown): v is string {
  return typeof v === 'string' && LABEL_RE.test(v);
}

/** 이 창이 뗀 창이면 그 창 이름, 메인 창이면 null */
export function windowLabelFrom(search: string): string | null {
  const v = new URLSearchParams(search).get(WINDOW_QUERY);
  return isWindowLabel(v) ? v : null;
}

/** 창 자리·크기 (논리 좌표) */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowContent {
  tabs: XLogTabPrefs[];
  split: XLogSplitPrefs;
}

export interface InitMessage extends WindowContent {
  label: string;
}

export interface SnapshotMessage extends WindowContent {
  label: string;
  bounds: WindowBounds | null;
}

export interface MergeMessage {
  label: string;
  tabs: XLogTabPrefs[];
  /** 창째로 합친다 — 메인 창이 적어 둔 것도 지운다 */
  close: boolean;
}

export interface DetachMessage {
  tabs: XLogTabPrefs[];
  /** 창 밖에 끌어 놓은 화면 좌표. 없으면 기본 자리 */
  at?: { x: number; y: number };
}
