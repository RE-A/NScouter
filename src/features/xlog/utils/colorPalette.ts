// src/features/xlog/utils/colorPalette.ts
// ASIS XLogViewPainter.drawXPerfData() 의 **색상 규칙**을 포팅한다.
//
// 규칙(에이전트별 색 순환 / 에러는 빨강 / xType 3·4 는 흐리게)은 그대로지만
// **색값은 다르다.** ASIS 는 흰 배경 위에 그렸다.
// 앱 전체가 다크인데 차트만 흰 판이면 그 자체로 시선을 뺏고,
// 흰 배경용으로 고른 어두운 채도색(RoyalBlue, DarkViolet, SeaGreen …)은
// #0d0d1a 위에서 서로 구분되지 않는다. 다크 배경용으로 다시 고른다.
//
// Canvas 는 var() 를 못 읽어 실제 색 문자열이 필요하다.
// 이건 의미색이 아니라 **분류색**이라 tokens.css 가 아니라 여기에 둔다 (SERIES 와 같은 취급).

export const XLOG_COLORS = {
  /** 에러는 다른 어떤 점과도 헷갈리면 안 된다 — 아래 팔레트에서 붉은 계열을 뺐다 */
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
} as const;

/** 차트 판 색 — 패널 본문보다 한 단 낮춰 눌린 면으로 읽히게 한다 */
export const XLOG_BACKGROUND = '#0d0d1a';

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
    const idx = Math.abs(objHash) % AGENT_COLORS.length;
    color = AGENT_COLORS[idx];
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
