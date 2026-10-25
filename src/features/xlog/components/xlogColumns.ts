// XLog 트랜잭션 표의 열 너비 — 끌어서 바꾸고, 껐다 켜도 남는다.
//
// **URL 열은 남는 자리를 다 먹는다**(`1fr`). 그래서 URL 의 너비는 따로 들지 않는다 —
// 들면 창 폭이 바뀔 때 표가 창보다 넓어지거나 오른쪽이 빈다.
//
// 그러면 «URL 오른쪽 경계» 를 끌 때 무엇을 바꾸나: **경계 건너편 열**이다. URL 오른쪽 경계를
// 왼쪽으로 끌면 IP 가 그만큼 넓어지고 URL 이 그만큼 준다 — 경계가 커서를 따라온다.
// URL 왼쪽의 경계는 그 왼쪽 열을 바꾼다. 어느 경계를 끌든 **잡은 선이 커서 밑에 남는다.**
//
// 열 너비를 안 정한 열은 지금까지의 기본 배치를 그대로 쓴다(시간 열은 글자 배율을 따른다).

/** 표의 열. 화면 순서다 */
export type XLogColKey = 'time' | 'server' | 'url' | 'ip' | 'elapsed' | 'y';

/** 너비를 들 수 있는 열 — URL 은 남는 자리다 */
export type FixedColKey = Exclude<XLogColKey, 'url'>;

export type XLogColWidths = Partial<Record<FixedColKey, number>>;

const FIXED: readonly FixedColKey[] = ['time', 'server', 'ip', 'elapsed', 'y'];

/** 열을 이보다 좁히면 머리 글자도 안 보인다 */
export const MIN_COL_W = 36;
/** URL 은 목록에서 가장 먼저 읽는 칸이다 — 다른 열을 넓혀도 이만큼은 남긴다 (예전 최소폭 96 + 여백) */
export const MIN_URL_W = 112;
/** 이보다 넓으면 남의 값이거나 손으로 잘못 적은 것이다 */
const MAX_COL_W = 2000;

/**
 * 칸 안쪽 여백(좌우 합). 칸 경계선을 그으려고 열 사이 간격 대신 칸마다 여백을 둔다 —
 * 기본 너비는 **글자가 들어갈 자리 + 이 여백**이다. 빼먹으면 시간 열의 밀리초가 잘린다(실제로 잘렸다).
 */
export const CELL_PAD_X = 16;

/** 안 정한 열의 기본 배치. 글자 자리는 예전 `XLOG_COLS` 그대로다 */
const DEFAULT_TRACK: Record<FixedColKey, string> = {
  // `HH:mm:ss.SSS`(12자, 고정폭)가 다 들어가야 한다. 글자 배율을 따라야 해서 글자 크기로 잡는다.
  // 7.6em 이던 것은 고정폭 글꼴에 따라 한 글자가 모자랐다(≈0.64em/자) — 예전에는 열 사이 간격으로
  // 넘쳐 보여서 몰랐고, 칸이 글자를 자르게 되자 끝자리가 «…» 가 됐다
  time: `calc(var(--fs-micro)*8 + ${CELL_PAD_X}px)`,
  server: `minmax(0,${104 + CELL_PAD_X}px)`,
  ip: `minmax(0,${96 + CELL_PAD_X}px)`,
  elapsed: `${74 + CELL_PAD_X}px`,
  y: `${74 + CELL_PAD_X}px`,
};

export function visibleCols(showY: boolean): XLogColKey[] {
  return showY
    ? ['time', 'server', 'url', 'ip', 'elapsed', 'y']
    : ['time', 'server', 'url', 'ip', 'elapsed'];
}

/** `grid-template-columns` 값 */
export function gridTemplate(widths: XLogColWidths, showY: boolean): string {
  return visibleCols(showY)
    .map(k => {
      if (k === 'url') return `minmax(${MIN_URL_W}px,1fr)`;
      const w = widths[k];
      return w === undefined ? DEFAULT_TRACK[k] : `${w}px`;
    })
    .join(' ');
}

/**
 * 경계 하나를 끌었다.
 *
 * @param boundary 왼쪽에서 몇 번째 경계인가 — 0 이면 시간|서버 사이
 * @param delta    누른 뒤로 커서가 움직인 거리(px). 오른쪽이 +
 * @param measured 누른 순간 열마다 **그려진** 너비(px). 안 정한 열도 실제 너비에서 시작해야
 *                 끌자마자 열이 튀지 않는다
 * @returns 바뀐 너비들. 끌 수 없는 경계면 그대로
 */
export function resizeAt(
  widths: XLogColWidths,
  cols: readonly XLogColKey[],
  boundary: number,
  delta: number,
  measured: Readonly<Partial<Record<XLogColKey, number>>>,
): XLogColWidths {
  if (boundary < 0 || boundary >= cols.length - 1) return widths;
  const urlAt = cols.indexOf('url');
  // URL 왼쪽 경계는 왼쪽 열을, 오른쪽 경계는 오른쪽 열을 바꾼다 (맨 위 주석)
  const before = boundary < urlAt;
  const target = cols[before ? boundary : boundary + 1];
  if (target === 'url') return widths;
  const start = measured[target];
  if (start === undefined) return widths;
  const grow = before ? delta : -delta;
  // 넓히는 만큼 URL 이 준다 — URL 이 바닥이면 더는 못 넓힌다
  const room = Math.max(0, (measured.url ?? MIN_URL_W) - MIN_URL_W);
  const next = Math.round(Math.min(Math.max(start + Math.min(grow, room), MIN_COL_W), MAX_COL_W));
  if (widths[target] === next) return widths;
  return { ...widths, [target]: next };
}

/** 한 열을 기본 너비로 되돌린다 (경계를 두 번 누르면) */
export function resetAt(widths: XLogColWidths, cols: readonly XLogColKey[], boundary: number): XLogColWidths {
  if (boundary < 0 || boundary >= cols.length - 1) return widths;
  const urlAt = cols.indexOf('url');
  const target = cols[boundary < urlAt ? boundary : boundary + 1];
  if (target === 'url' || widths[target] === undefined) return widths;
  const next = { ...widths };
  delete next[target];
  return next;
}

/** 설정 파일에서 온 것을 쓸 수 있는 것만 남긴다 — 모르는 열·이상한 값은 버린다 */
export function normalizeColWidths(v: unknown): XLogColWidths {
  if (typeof v !== 'object' || v === null) return {};
  const o = v as Record<string, unknown>;
  const out: XLogColWidths = {};
  for (const k of FIXED) {
    const n = o[k];
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
      out[k] = Math.round(Math.min(Math.max(n, MIN_COL_W), MAX_COL_W));
    }
  }
  return out;
}
