// 디자인 토큰 — TS 인라인 스타일용
//
// 실제 값은 tokens.css 에 있다. 여기는 `var(--x)` 문자열 미러다.
// 값을 두 벌로 두지 않으려는 것이고, 2단계에서 Tailwind 테마가
// **같은 CSS 변수**를 참조하므로 팔레트가 갈라지지 않는다.
//
// 컴포넌트에 `#rrggbb` 를 직접 쓰지 말 것.

/** 색상 */
export const T = {
  // 표면
  bgBase: 'var(--bg-base)',
  bgSurface: 'var(--bg-surface)',
  bgRaised: 'var(--bg-raised)',
  bgOverlay: 'var(--bg-overlay)',
  bgInput: 'var(--bg-input)',
  bgHover: 'var(--bg-hover)',

  // 테두리
  border: 'var(--border)',
  borderStrong: 'var(--border-strong)',

  // 글자
  text: 'var(--text)',
  textMuted: 'var(--text-muted)',
  textDim: 'var(--text-dim)',
  textFaint: 'var(--text-faint)',

  // 의미
  accent: 'var(--accent)',
  accentSoft: 'var(--accent-soft)',
  success: 'var(--success)',
  warn: 'var(--warn)',
  error: 'var(--error)',
  errorSoft: 'var(--error-soft)',
} as const;

/**
 * 카테고리색 — 프로파일 스텝 종류, 알람 레벨.
 *
 * 의미색(accent/success/…)과 구분한다. 이건 "분류"지 "상태"가 아니다.
 */
export const CAT = {
  method: 'var(--cat-method)',
  sql: 'var(--cat-sql)',
  api: 'var(--cat-api)',
  socket: 'var(--cat-socket)',
  msg: 'var(--cat-msg)',
  rowOk: 'var(--row-ok)',
  rowErr: 'var(--row-err)',
  rowApi: 'var(--row-api)',
  rowNeutral: 'var(--row-neutral)',
} as const;

/** 폰트 크기 */
export const F = {
  micro: 'var(--fs-micro)',
  small: 'var(--fs-small)',
  body: 'var(--fs-body)',
  base: 'var(--fs-base)',
  title: 'var(--fs-title)',
} as const;

/** 간격 */
export const S = {
  x1: 'var(--sp-1)',
  x2: 'var(--sp-2)',
  x3: 'var(--sp-3)',
  x4: 'var(--sp-4)',
} as const;

export const RADIUS = 'var(--radius)';
export const RADIUS_LG = 'var(--radius-lg)';

export const FONT_UI = 'var(--font-ui)';
export const FONT_MONO = 'var(--font-mono)';

/**
 * Canvas 는 `var()` 를 못 쓴다. 실제 색 문자열이 필요하다.
 *
 * tokens.css 와 **값이 같아야 한다.** 한쪽만 바꾸면 차트와 UI 색이 갈라진다.
 * 테스트(`tokens.test.ts`)가 이 일치를 검증한다.
 */
export const CANVAS = {
  bgSurface: '#0d0d1a',
  bgBase: '#08080f',
  border: '#1e1e3a',
  textMuted: '#9090b0',
  textDim: '#606080',
  accent: '#4f72ff',
  success: '#3dd68c',
  warn: '#f5a623',
  error: '#ff4d4f',
} as const;

/**
 * 카운터 차트의 계열 색 (에이전트별). Canvas 용이라 실제 색 문자열이다.
 *
 * 의미색(성공/경고/에러)과 목적이 다르다 — 여기선 **서로 구분되기만** 하면 된다.
 * 순서를 바꾸면 기존 화면의 선 색이 바뀐다.
 */
export const SERIES: readonly string[] = [
  '#4f72ff', '#3dd68c', '#ff4d4f', '#f5a623', '#9b59b6', '#1abc9c',
];
