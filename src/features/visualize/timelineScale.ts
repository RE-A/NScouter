// 스택 타임라인의 자 — 시간·값을 화면 좌표로. **순수 함수다.**
//
// Counter 탭의 차트 40장은 **저마다 자기 x축**을 쓴다. 그래서 «TPS 가 튄 그 순간
// 힙도 튀었나» 를 눈으로 맞출 수 없다 — 두 그림에서 같은 시각이 다른 자리에 있다.
// 여기서는 x축 하나를 여러 줄이 나눠 쓴다. 세로선 하나가 전부를 관통한다.
//
// **y축은 공유하지 않는다.** TPS 23 과 Heap 74% 를 같은 자에 놓으면 둘 중 하나가
// 바닥에 눕는다. 줄마다 자기 범위를 쓰고, 공유하는 것은 시간뿐이다.

export interface Range {
  stime: number;
  etime: number;
}

/** 한 줄이 차지하는 세로 자리 */
export interface Row {
  /** 줄 위쪽 y */
  y: number;
  height: number;
}

/**
 * 줄들을 위에서 아래로 나눠 놓는다.
 *
 * 줄 사이를 띄우지 않는다 — 붙여 놓아야 같은 x 를 눈으로 따라 내려갈 수 있다.
 * 대신 줄마다 위쪽에 이름을 적을 자리(`labelH`)를 남긴다.
 */
export function rowLayout(count: number, top: number, height: number): Row[] {
  if (count <= 0 || height <= 0) return [];
  const each = height / count;
  return Array.from({ length: count }, (_, i) => ({ y: top + each * i, height: each }));
}

/** 시각 → x. 구간 밖이면 구간 밖 좌표가 나온다 (자르는 것은 그리는 쪽 몫) */
export function timeToX(t: number, range: Range, plotX: number, plotW: number): number {
  const span = range.etime - range.stime;
  if (span <= 0) return plotX;
  return plotX + ((t - range.stime) / span) * plotW;
}

/** x → 시각. 크로스헤어가 어느 시각을 가리키는지 */
export function xToTime(x: number, range: Range, plotX: number, plotW: number): number {
  if (plotW <= 0) return range.stime;
  const ratio = (x - plotX) / plotW;
  return range.stime + ratio * (range.etime - range.stime);
}

/**
 * 값 → y. **0 이 바닥이다.**
 *
 * 최솟값을 바닥으로 잡으면 40~42 사이를 오가는 CPU 가 화면 가득 출렁여
 * 아무 일도 없는데 큰일이 난 것처럼 보인다.
 */
export function valueToY(v: number, max: number, row: Row, pad: number): number {
  const usable = row.height - pad * 2;
  if (usable <= 0 || max <= 0) return row.y + row.height - pad;
  const clamped = Math.max(0, Math.min(v, max));
  return row.y + pad + usable - (clamped / max) * usable;
}

/**
 * 축 위쪽 값. 1·2·5 × 10ⁿ 계단으로 올린다.
 *
 * 실제 최댓값을 그대로 쓰면 값이 23↔24 로 오갈 때마다 자가 바뀌어 선 전체가
 * 위아래로 출렁인다 — 변화를 읽으려고 보는 그림에서 가장 나쁜 일이다.
 */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * base) return step * base;
  }
  return 10 * base;
}

/** 여러 시계열의 최댓값. 없으면 0. `null`(그 시각 수집 없음)은 세지 않는다 */
export function maxOf(series: readonly { values: readonly (number | null)[] }[]): number {
  let max = 0;
  for (const s of series) {
    for (const v of s.values) {
      if (v !== null && Number.isFinite(v) && v > max) max = v;
    }
  }
  return max;
}

/**
 * 시간 눈금.
 *
 * **개수가 아니라 간격을 고른다.** 개수를 맞추면 눈금이 10:03·10:18 처럼 어중간한
 * 시각에 서고, 그러면 «몇 시쯤이었나» 를 읽는 데 계산이 필요하다.
 * 사람이 시계에서 읽는 간격(1·2·5·10·15·30분, 1·2·3·6·12시간)만 쓴다.
 */
const TICK_STEPS_MS: readonly number[] = [
  60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000,
  3_600_000, 2 * 3_600_000, 3 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000,
  86_400_000,
];

/**
 * @param minGapPx 눈금 사이 최소 픽셀. 이보다 좁으면 글자가 겹친다
 */
export function timeTicks(range: Range, plotW: number, minGapPx = 90): number[] {
  const span = range.etime - range.stime;
  if (span <= 0 || plotW <= 0) return [];

  const maxTicks = Math.max(2, Math.floor(plotW / minGapPx));
  const step =
    TICK_STEPS_MS.find(s => span / s <= maxTicks) ?? TICK_STEPS_MS[TICK_STEPS_MS.length - 1];

  // **눈금은 그 간격의 배수 자리에 선다.** 구간 시작에서 세면 10:03 부터 시작한다.
  const first = Math.ceil(range.stime / step) * step;
  const out: number[] = [];
  for (let t = first; t <= range.etime; t += step) out.push(t);
  return out;
}

/**
 * 이 시각에 가장 가까운 표본의 자리. 없으면 -1.
 *
 * **가장 가까운 것**이지 «이전 것» 이 아니다. 크로스헤어는 마우스가 가리키는
 * 눈금에 붙어야 하는데, 이전 것만 고르면 표본 사이에서 늘 왼쪽으로 끌린다.
 * `times` 는 오름차순이어야 한다.
 */
export function nearestIndex(times: readonly number[], t: number): number {
  if (times.length === 0) return -1;

  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  // lo 는 t 이상인 첫 자리. 그 앞과 견준다.
  if (lo > 0 && Math.abs(times[lo - 1] - t) <= Math.abs(times[lo] - t)) return lo - 1;
  return lo;
}

/** `HH:MM`. 초는 적지 않는다 — 눈금 간격이 분 단위 이상이다 */
export function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
