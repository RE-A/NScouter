// src/features/xlog/utils/colorPalette.ts
// ASIS XLogViewPainter.drawXPerfData() 색상 규칙 포팅

export const XLOG_COLORS = {
  ERROR:        '#FF0000',
  ERROR_LIGHT:  '#FF9999',
  NORMAL_LIGHT: '#AAAAAA',
  GRID:         'rgb(220, 228, 255)',
  GRID_WIDE:    'rgb(200, 208, 255)',
  IGNORE_AREA:  'rgb(234, 234, 234)',
  BORDER:       '#888888',
  META_TEXT:    '#333333',
  SELECT_FILL:  'rgba(0, 100, 255, 0.15)',
  SELECT_STROKE:'rgba(0, 100, 255, 0.8)',
} as const;

// 에이전트별 색상 팔레트 (objHash 기반 순환 할당)
const AGENT_COLORS: readonly string[] = [
  '#4169E1', // RoyalBlue
  '#32CD32', // LimeGreen
  '#FF8C00', // DarkOrange
  '#9400D3', // DarkViolet
  '#008B8B', // DarkCyan
  '#B8860B', // DarkGoldenrod
  '#6A5ACD', // SlateBlue
  '#2E8B57', // SeaGreen
  '#DC143C', // Crimson
  '#1E90FF', // DodgerBlue
  '#FF1493', // DeepPink
  '#00CED1', // DarkTurquoise
];

const agentColorMap = new Map<number, string>();

export function getDotColor(objHash: number, xType: number, hasError: boolean): string {
  const isLight = xType === 3 || xType === 4;
  if (hasError) return isLight ? XLOG_COLORS.ERROR_LIGHT : XLOG_COLORS.ERROR;
  if (isLight) return XLOG_COLORS.NORMAL_LIGHT;
  return getAgentColor(objHash);
}

function getAgentColor(objHash: number): string {
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
