// 테마 — 어느 색 벌을 쓸 것인가.
//
// 값은 전부 `tokens.css` 에 있고 여기는 **고르는 일만** 한다. 문서 뿌리에
// `data-theme` 를 걸면 CSS 쪽은 그것으로 끝난다. 끝나지 않는 쪽이 Canvas 다 —
// `var()` 를 못 읽으므로 계산값을 따로 읽어 가야 하고(`refreshCanvasTokens`),
// 이미 그려 둔 차트는 스스로 다시 그리지 않으므로 신호를 줘야 한다(`themeEpoch`).

import { refreshCanvasTokens } from './tokens';

export type ThemeId = 'dark' | 'light' | 'slate' | 'warm' | 'contrast';

/**
 * 고를 수 있는 테마. **순서가 곧 설정 창의 순서다.**
 *
 * 설명은 «무엇이 다른가» 가 아니라 «언제 쓰나» 를 적는다 —
 * 색 이름을 적어 두면 골라 보기 전에는 뜻이 없다.
 */
export const THEMES: ReadonlyArray<{ id: ThemeId; label: string; hint: string }> = [
  { id: 'dark', label: '다크', hint: '기본. 어두운 보랏빛' },
  { id: 'light', label: '라이트', hint: '밝은 사무실·문서 캡처용' },
  { id: 'slate', label: '슬레이트', hint: '중립 회색. 색으로 떠들지 않아 위험만 눈에 띈다' },
  { id: 'warm', label: '웜', hint: '푸른빛을 뺀 갈색조. 야간 당직용' },
  { id: 'contrast', label: '고대비', hint: '순흑 바탕. 상황실·벽면 모니터용' },
];

export const DEFAULT_THEME: ThemeId = 'dark';

/** 설정 파일을 손으로 고쳐 모르는 값이 와도 화면이 깨지면 안 된다 */
export function toTheme(v: unknown): ThemeId {
  return THEMES.some(t => t.id === v) ? (v as ThemeId) : DEFAULT_THEME;
}

/**
 * 테마가 바뀐 횟수.
 *
 * **차트는 `CANVAS` 를 그릴 때 읽는다.** 값만 갈아 끼우면 다음에 그릴 일이 생길 때까지
 * 옛 색으로 남아 있다 — 멈춰 있는 과거 조회 화면이 그렇다. 이 번호를 구독해 다시 그린다.
 */
let epoch = 0;
const listeners = new Set<(n: number) => void>();

export function themeEpoch(): number {
  return epoch;
}

export function subscribeTheme(fn: (n: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 테마를 건다.
 *
 * 기본 테마도 **속성을 적어 둔다** — 비워 두면 `:root[data-theme='dark']` 같은
 * 규칙을 나중에 더했을 때 기본 테마만 조용히 빠진다.
 */
export function applyTheme(id: ThemeId): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = id;
  }
  // 속성을 건 **다음에** 읽어야 새 테마 값이 나온다.
  refreshCanvasTokens();
  epoch += 1;
  for (const fn of listeners) fn(epoch);
}
