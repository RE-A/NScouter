// 실시간 트래픽 차트 — 자리 계산 (순수 로직)
//
// **왜 Active 탭에 트래픽 차트가 필요한가.** 이 탭이 보여 주는 것은 «지금 안 끝나고
// 있는 것» 의 **순간 스냅샷**이다. 2초마다 한 번 물으므로 2초 안에 끝나는 요청은 두 번의
// 조회 사이에 나타났다 사라져 **한 번도 안 보인다.** 그래서 화면은 «한가하다» 로
// 읽히는데 실제로는 초당 수십 건이 돌고 있을 수 있다. 목록 위에 흐르는 점을 얹으면
// 그 둘이 한 화면에서 갈린다 — 점은 빽빽한데 목록이 비었으면 «빠르게 잘 돌고 있다» 다.
//
// **새로 묻지 않는다.** 점은 이미 도는 XLog 실시간 스트림에서 온다(App 이 고른 서버로
// 열어 둔다). 이 화면을 연다고 콜렉터·에이전트에 요청이 늘지 않는다.
//
// XLog 탭의 스캐터와 겹치지 않는가 — 겹치지 않는다. 저기는 **끝난 것**을 넓은 창(10분·
// 30분)에 놓고 고르는 화면이고, 여기는 **지금 실행 중인 것과 방금 끝난 것**을 짧은
// 창(1분)에 겹쳐 놓는 화면이다. 실행 중인 점은 XLog 에 아직 없다(끝나야 생긴다).

import type { SXLog } from '../xlog/types/xlog';
import type { ActiveService } from '../xlog/types/object';
import { stepOf, type SpeedStep } from './activeModel';

/** 세로축 최소 상한. 이보다 낮추면 빠른 요청이 전부 바닥에 붙어 못 읽는다 */
export const MIN_Y_MS = 1_000;

/** 화면에 놓을 점 하나 */
export interface TrafficPoint {
  /** 0~1. 창의 왼쪽이 0, 오른쪽(지금)이 1 */
  tx: number;
  /** 0~1. 바닥이 0, 상한이 1 */
  ty: number;
  step: SpeedStep;
  /** 실패한 트랜잭션인가 — 색이 갈린다 */
  failed: boolean;
  /** 아직 돌고 있는가. 끝난 점과 모양을 달리한다 */
  running: boolean;
  /** 눌렀을 때 열 것 */
  done: SXLog | null;
  live: ActiveService | null;
}

/**
 * 보기 좋은 올림값 — 1·2·5 배수.
 *
 * 축 눈금이 `1,234ms` 같은 수면 읽는 데 한 박자가 든다. 장애 중에는 그 한 박자가
 * 아깝다.
 */
export function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  for (const m of [1, 2, 5]) {
    if (v <= m * base) return m * base;
  }
  return 10 * base;
}

/**
 * 다음 세로축 상한.
 *
 * **쉽게 내리지 않는다.** 필요한 값이 줄 때마다 상한을 따라 내리면, 느린 요청 하나가
 * 지나갈 때마다 축이 오르내려 **점 전체가 위아래로 춤춘다** — 그러면 «무엇이 느려지고
 * 있나» 를 눈으로 좇을 수 없다. 올릴 때는 즉시(안 그러면 점이 천장 밖으로 나간다),
 * 내릴 때는 절반 아래로 내려갔을 때만.
 */
export function nextYMax(current: number, needed: number): number {
  const want = Math.max(MIN_Y_MS, niceCeil(needed));
  if (want > current) return want;
  if (want <= current / 2) return want;
  return current;
}

export interface TrafficInput {
  /** 최근 창 안에서 끝난 트랜잭션 */
  done: readonly SXLog[];
  /** 지금 돌고 있는 것 (액티브 목록) */
  live: readonly ActiveService[];
  /** 창의 오른쪽 끝 = 지금 */
  now: number;
  windowMs: number;
  yMax: number;
  /** 고른 서버. 비었으면 «전부» 다 (화면의 다른 곳과 같은 규칙) */
  picked: ReadonlySet<number>;
}

/**
 * 점들의 자리를 0~1 로 낸다.
 *
 * 픽셀이 아니라 비율로 내는 이유: 폭·높이는 캔버스가 알고, 여기서는 **무엇이 어디에
 * 놓이는가**만 정한다. 그래야 크기와 무관하게 테스트할 수 있다.
 *
 * **창 밖의 점은 버린다.** 왼쪽으로 흘러 나간 것을 0 에 붙여 두면 왼쪽 끝에 점이
 * 쌓여 «저기서 뭔가 계속 일어난다» 로 읽힌다.
 */
export function layoutTraffic(input: TrafficInput): TrafficPoint[] {
  const { done, live, now, windowMs, yMax, picked } = input;
  const start = now - windowMs;
  const out: TrafficPoint[] = [];

  for (const x of done) {
    if (picked.size > 0 && !picked.has(x.objHash)) continue;
    if (x.endTime < start || x.endTime > now) continue;
    out.push({
      tx: (x.endTime - start) / windowMs,
      ty: Math.min(1, x.elapsed / yMax),
      step: stepOf(x.elapsed),
      failed: x.error !== 0,
      running: false,
      done: x,
      live: null,
    });
  }

  // 실행 중인 것은 **오른쪽 끝**이다. 아직 안 끝났으니 끝난 시각이 없다 —
  // 지금 이 순간 «여기까지 왔다» 를 세로 자리로 말한다.
  for (const r of live) {
    if (picked.size > 0 && !picked.has(r.obj_hash)) continue;
    out.push({
      tx: 1,
      ty: Math.min(1, r.elapsed / yMax),
      step: stepOf(r.elapsed),
      failed: false,
      running: true,
      done: null,
      live: r,
    });
  }

  return out;
}

/** 창 안에서 가장 오래 걸린 값 — 세로축 상한을 정하는 근거 */
export function neededYMax(input: Omit<TrafficInput, 'yMax'>): number {
  const { done, live, now, windowMs, picked } = input;
  const start = now - windowMs;
  let max = 0;
  for (const x of done) {
    if (picked.size > 0 && !picked.has(x.objHash)) continue;
    if (x.endTime < start || x.endTime > now) continue;
    if (x.elapsed > max) max = x.elapsed;
  }
  for (const r of live) {
    if (picked.size > 0 && !picked.has(r.obj_hash)) continue;
    if (r.elapsed > max) max = r.elapsed;
  }
  return max;
}

/**
 * 누른 자리에서 가장 가까운 점.
 *
 * **비율이 아니라 픽셀로 견준다.** 창이 가로로 길고 세로로 짧아서, 비율로 재면
 * 가로로 멀리 있는 점이 «가깝다» 고 나온다.
 *
 * 같은 거리면 **실행 중인 것**을 고른다. 겹쳐 있을 때 사람이 누르려는 것은 대개
 * «지금 걸려 있는 것» 이다.
 */
export function pickNearest(
  points: readonly TrafficPoint[],
  px: number,
  py: number,
  w: number,
  h: number,
  radiusPx = 8,
): TrafficPoint | null {
  let best: TrafficPoint | null = null;
  let bestD = radiusPx * radiusPx;

  for (const p of points) {
    const dx = p.tx * w - px;
    const dy = (1 - p.ty) * h - py;
    const d = dx * dx + dy * dy;
    if (d < bestD || (d === bestD && p.running && best !== null && !best.running)) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** 세로축에 적을 눈금 — 상한과 그 절반. 셋 넘게 적으면 작은 차트가 글자로 덮인다 */
export function yTicks(yMax: number): number[] {
  return [yMax, yMax / 2];
}

/** `1,200ms` · `12.4초` — 목록과 같은 표기를 쓴다 */
export function formatTick(ms: number): string {
  return ms >= 1_000 ? `${(ms / 1_000).toLocaleString()}초` : `${Math.round(ms)}ms`;
}
