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
  /** 누를 수 있는 것의 경계. 구분선(`border`)과 **역할이 다르다** — tokens.css 참고 */
  borderControl: 'var(--border-control)',
  /** 표의 칸·행 경계 — 패널 구분선보다 또렷하다 (tokens.css) */
  borderTable: 'var(--border-table)',

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
 * **그래서 베껴 두지 않고 실행 시점에 읽는다.** 예전에는 tokens.css 의 값을 여기에
 * 손으로 복제하고 테스트로 일치를 지켰는데, 테마가 생기면 그 방법이 무너진다 —
 * 테마마다 한 벌씩 베껴 두면 다섯 벌이 어긋날 자리가 된다.
 * `refreshCanvasTokens()` 가 문서 뿌리의 계산값을 읽어 이 객체를 채운다.
 *
 * 여기 적힌 값은 **그 전에 그려질 때의 기본값**이다 (기본 테마와 같다).
 */
export const CANVAS = {
  bgSurface: '#0d0d1a',
  bgBase: '#08080f',
  border: '#1e1e3a',
  textMuted: '#b6b6d4',
  textDim: '#9a9ac0',
  accent: '#4f72ff',
  success: '#3dd68c',
  warn: '#f5a623',
  error: '#ff4d4f',
  /**
   * 천장에 붙은 점이 앉는 띠.
   *
   * 옅어야 한다 — 점을 덮으면 어느 서버인지 못 읽는다. «여기는 눈금이 아니다» 만
   * 말하면 된다. 테마의 `--warn` 에서 만들어 낸다.
   */
  overflowBand: 'rgba(245, 166, 35, 0.12)',
};

/** CANVAS 의 각 자리가 어느 토큰에서 오는가. `overflowBand` 만 파생이라 빠져 있다 */
const CANVAS_SOURCE: Record<Exclude<keyof typeof CANVAS, 'overflowBand'>, string> = {
  bgSurface: '--bg-surface',
  bgBase: '--bg-base',
  border: '--border',
  textMuted: '--text-muted',
  textDim: '--text-dim',
  accent: '--accent',
  success: '--success',
  warn: '--warn',
  error: '--error',
};

/**
 * 카운터 차트의 계열 색 (에이전트별). Canvas 용이라 실제 색 문자열이다.
 *
 * 의미색(성공/경고/에러)과 목적이 다르다 — 여기선 **서로 구분되기만** 하면 된다.
 * 순서를 바꾸면 기존 화면의 선 색이 바뀐다. CANVAS 와 같이 실행 시점에 채워진다.
 */
export const SERIES: string[] = [
  '#4f72ff', '#3dd68c', '#ff4d4f', '#f5a623', '#9b59b6', '#1abc9c',
];

/** `#rrggbb` 를 `rgba(r, g, b, a)` 로. 테마가 바뀌면 띠 색도 그 테마의 경고색에서 나온다 */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * 문서 뿌리의 계산값을 읽어 Canvas 용 색을 채운다.
 *
 * **테마를 바꾼 뒤에 불러야 한다.** 차트는 이 객체를 그릴 때마다 읽으므로,
 * 채워 넣은 다음 다시 그리게만 하면 따라온다 (`useThemeEpoch`).
 */
export function refreshCanvasTokens(): void {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return;
  const cs = getComputedStyle(document.documentElement);
  // jsdom 등에서는 빈 문자열이 온다. 그때는 **건드리지 않는다** — 기본값이 남는 쪽이 낫다.
  const read = (name: string): string => cs.getPropertyValue(name).trim();

  for (const [key, name] of Object.entries(CANVAS_SOURCE)) {
    const v = read(name);
    if (v !== '') CANVAS[key as keyof typeof CANVAS_SOURCE] = v;
  }
  CANVAS.overflowBand = withAlpha(CANVAS.warn, 0.12);

  for (let i = 0; i < SERIES.length; i++) {
    const v = read(`--series-${i + 1}`);
    if (v !== '') SERIES[i] = v;
  }
}
