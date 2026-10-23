// src/features/xlog/utils/colorPalette.ts
// ASIS XLogViewPainter.drawXPerfData() 의 **색상 규칙**을 포팅한다.
//
// 규칙(에이전트별 색 순환 / 에러는 빨강 / xType 3·4 는 흐리게)는 그대로지만
// **색값은 다르다.** ASIS 는 흰 배경 위에 그렸다.
//
// **판·눈금·글자는 테마를 따른다.** 예전에는 여기 다크 전용 색을 박아 두어,
// 테마를 바꿔도 XLog 차트만 검은 판으로 남았다. Canvas 는 `var()` 를 못 읽으므로
// `refreshXLogColors()` 가 문서 뿌리의 계산값을 읽어 채운다 (CANVAS 와 같은 방식).
//
// 다만 **에이전트별 순환색은 테마와 무관하게 고정**이다. 그건 의미색이 아니라
// **분류색**이라, 테마를 바꿨다고 «어제 파랑이던 서버» 가 초록이 되면 안 된다.

export const XLOG_COLORS = {
  /** 에러는 다른 어떤 점과도 헷갈리면 안 된다 — 아래 팔레트에서 붉은 계열을 미리 뺀다 */
  ERROR:        '#ff4d4f',
  ERROR_LIGHT:  '#8f3436',
  NORMAL_LIGHT: '#454563',
  GRID:         '#1a1a30',
  GRID_WIDE:    '#252542',
  IGNORE_AREA:  'rgba(255,255,255,0.035)',
  BORDER:       '#252542',
  META_TEXT:    '#606080',
  SELECT_FILL:  'rgba(79, 114, 255, 0.18)',
  SELECT_STROKE:'rgba(79, 114, 255, 0.9)',
};

/** 차트 판 색 — 패널 본문보다 한 단 낮춰 눌린 면으로 읽히게 한다 */
export const XLOG_PLATE = { bg: '#0d0d1a' };

/** CSS 변수 이름 → 위 자리. 테마마다 tokens.css 가 정한다 */
const FROM_TOKEN: Record<string, keyof typeof XLOG_COLORS> = {
  '--xlog-grid': 'GRID',
  '--xlog-grid-wide': 'GRID_WIDE',
  '--xlog-border': 'BORDER',
  '--xlog-meta': 'META_TEXT',
  '--xlog-dim': 'NORMAL_LIGHT',
  '--xlog-dim-error': 'ERROR_LIGHT',
  '--xlog-ignore': 'IGNORE_AREA',
};

/** `#rrggbb` → `rgba(r, g, b, a)` */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * 문서 뿌리의 계산값을 읽어 채운다. **테마를 걸은 뒤에 불러야 한다.**
 *
 * 값이 비면 건드리지 않는다 — jsdom 에서는 빈 문자열이 오고,
 * 그때는 기본값이 남는 쪽이 낫다.
 */
export function refreshXLogColors(): void {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return;
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string): string => cs.getPropertyValue(name).trim();

  for (const [token, key] of Object.entries(FROM_TOKEN)) {
    const v = read(token);
    if (v !== '') XLOG_COLORS[key] = v;
  }
  const bg = read('--xlog-bg');
  if (bg !== '') XLOG_PLATE.bg = bg;

  // 의미색은 테마의 것을 그대로 따른다 — 목록·배지와 같은 빨강이어야 짚어 볼 수 있다.
  const err = read('--error');
  if (err !== '') XLOG_COLORS.ERROR = err;

  const accent = read('--accent');
  if (accent !== '') {
    XLOG_COLORS.SELECT_FILL = withAlpha(accent, 0.18);
    XLOG_COLORS.SELECT_STROKE = withAlpha(accent, 0.9);
  }
}

// 에이전트별 색상 팔레트 (objHash 기반 순환 할당).
// 다크 배경에서 서로 구분되는 밝은 색만 쓴다. 붉은 계열은 에러 전용이라 제외.
const AGENT_COLORS: readonly string[] = [
  '#5b8cff', // blue
  '#3dd68c', // green
  '#ffa53d', // orange
  '#c77dff', // violet
  '#2fd4d4', // teal
  '#e8c547', // gold
  '#8b93ff', // periwinkle
  '#4ade80', // lime
  '#38bdf8', // sky
  '#7fe3d4', // aqua
  '#a78bfa', // purple
  '#f0abfc', // orchid
];

const agentColorMap = new Map<number, string>();

/**
 * 색을 오브젝트가 아니라 **무리**로 정할 때 쓰는 열쇠. `null` 이면 오브젝트마다 따로다.
 *
 * ECS 에서 서비스로 묶어 볼 때는 Task 가 재배포마다 바뀐다 — Task 마다 색을 주면
 * 같은 서비스가 배포할 때마다 다른 색이 되고, 4대짜리 서비스가 네 색으로 흩어진다.
 * 그때는 서비스 이름으로 색을 정한다(App 이 서버 목록의 묶기에 맞춰 건다).
 */
let colorKeyOf: ((objHash: number) => string | null) | null = null;

/** 무리 열쇠를 건다. **캐시도 비운다** — 안 비우면 옛 기준의 색이 남는다 */
export function setAgentColorKey(fn: ((objHash: number) => string | null) | null): void {
  colorKeyOf = fn;
  agentColorMap.clear();
}

/** 문자열 → 색. Java `String.hashCode` 와 같은 식이라 재시작해도 같은 이름은 같은 색이다 */
export function keyColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return AGENT_COLORS[Math.abs(h) % AGENT_COLORS.length];
}

export function getDotColor(objHash: number, xType: number, hasError: boolean): string {
  const isLight = xType === 3 || xType === 4;
  if (hasError) return isLight ? XLOG_COLORS.ERROR_LIGHT : XLOG_COLORS.ERROR;
  if (isLight) return XLOG_COLORS.NORMAL_LIGHT;
  return getAgentColor(objHash);
}

/**
 * 오브젝트에 고정 배정되는 색.
 *
 * **objHash 로만 정한다** — 목록 순서로 정하면 에이전트가 하나 붙고 빠질 때마다
 * 모든 오브젝트의 색이 밀린다. 산점도와 속성 창이 같은 색을 써야 서로 짚어 볼 수 있다.
 */
export function getAgentColor(objHash: number): string {
  let color = agentColorMap.get(objHash);
  if (!color) {
    const key = colorKeyOf?.(objHash) ?? null;
    color = key !== null ? keyColor(key) : AGENT_COLORS[Math.abs(objHash) % AGENT_COLORS.length];
    agentColorMap.set(objHash, color);
  }
  return color;
}

export function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * 밀리초까지 — `14:14:11.245`
 *
 * **한 트랜잭션을 들여다보는 자리에서는 초로는 부족하다.** 같은 초에 수십 건이
 * 끝나므로 «어느 것이 먼저였나» 를 초 단위로는 못 가른다. 시작·끝을 초로만 적으면
 * 3,975ms 짜리가 «11초 → 15초» 로 보여 실제 4초와 어긋나 보이기도 한다.
 *
 * 축 눈금(GridCalculator)에는 쓰지 않는다 — 거기서는 자리만 먹는다.
 */
export function formatTimeMs(ms: number): string {
  return `${formatTime(ms)}.${Math.floor(ms % 1000).toString().padStart(3, '0')}`;
}
