// 흐르는 트래픽 — **들어와서 머물다가 빠져나간다** (순수 로직)
//
// 세 번 갈아엎고 여기 왔다. 끝난 XLog 를 점으로 찍어 보고(XLog 탭의 축소판이었다),
// 건수를 면으로 쌓아 보고(지금 돌고 있다는 느낌이 없었다), 시간축 스캐터로도 그려
// 봤다(여전히 «끝난 것» 이 화면의 대부분이었다). 운영자가 이 화면에서 보려는 것은
// 지나간 기록이 아니라 **지금 이 순간 무엇이 돌고 있는가** 다.
//
// 그래서 화면에 있는 점은 **지금 실행 중인 트랜잭션뿐**이고, 가로축은 시간이 아니라
// **일의 흐름**이다:
//
//   왼쪽에서 날아 들어온다   — 방금 들어온 요청
//   가운데에 머문다          — 지금 처리 중. 오래 걸릴수록 **위로** 뜬다
//   오른쪽으로 빠져나간다    — 끝났다
//
// 들어오는 양과 빠지는 양이 눈으로 견줘진다. 왼쪽이 붐비는데 오른쪽으로 나가는 것이
// 없으면 그게 적체다 — 가운데에 점이 쌓이고 위로 올라간다.
//
// **완료는 «목록에서 사라졌다» 로 안다.** 액티브 조회에 있던 것이 다음 조회에 없으면
// 끝난 것이다. 다만 콜렉터가 그 서버에 못 닿아도 똑같이 사라지므로(F-34 의 빈 팩),
// 부르는 쪽이 «못 받은 서버» 의 행은 빼고 넘긴다 — 그 경우는 화면 위 배너가 말한다.

import type { ActiveService } from '../xlog/types/object';
import { rowKey, stepOf, type SpeedStep } from './activeModel';

/** 세로축 최소 상한. 이보다 낮추면 빠른 요청이 전부 바닥에 붙어 못 읽는다 */
export const MIN_Y_MS = 3_000;

/** 왼쪽 밖에서 제자리까지 날아 들어오는 시간 */
export const ENTER_MS = 650;
/** 제자리에서 오른쪽 밖으로 빠져나가는 시간 */
export const LEAVE_MS = 850;

export type Phase = 'entering' | 'holding' | 'leaving';

/** 추적 중인 트랜잭션 하나 */
export interface Track {
  key: string;
  row: ActiveService;
  phase: Phase;
  /** 지금 단계가 시작된 시각 */
  since: number;
  /** 이 행을 받은 조회 시각 — 경과 시간을 여기서부터 이어 센다 */
  polledAt: number;
}

export interface FlowDot {
  key: string;
  /** 0~1 이 화면 안. 들어오는 중이면 음수, 나가는 중이면 1 을 넘는다 */
  tx: number;
  /** 0~1. 바닥이 0, 상한이 1 */
  ty: number;
  step: SpeedStep;
  phase: Phase;
  /** 서서히 나타나고 사라지게 — 0~1 */
  alpha: number;
  row: ActiveService;
}

/**
 * 돌고 있는 것의 **지금** 경과 시간.
 *
 * 조회가 알려 준 값에 그 뒤로 흐른 시간을 더한다. 안 더하면 점이 2초마다 한 칸씩
 * 뛰어오르고 그 사이에는 멈춘다 — 화면이 죽은 것처럼 보인다.
 */
export function elapsedNow(t: Track, now: number): number {
  return t.row.elapsed + Math.max(0, now - t.polledAt);
}

/**
 * 조회 결과를 추적표에 반영한다.
 *
 * · 처음 보는 것 → 왼쪽에서 들어오기 시작
 * · 계속 있는 것 → 머무름 (경과 시간만 새 값으로)
 * · 없어진 것   → 오른쪽으로 빠져나가기 시작
 * · 다 빠져나간 것 → 표에서 지운다
 *
 * **들어오는 중에 끝나도 괜찮다.** 그때는 있던 자리에서 바로 나가기로 바뀐다 —
 * 짧은 요청은 들어오자마자 나가는 모습이 되는데, 그게 사실이다.
 */
export function advanceTracks(
  prev: ReadonlyMap<string, Track>,
  rows: readonly ActiveService[],
  polledAt: number,
  now: number,
): Map<string, Track> {
  const next = new Map<string, Track>();
  const seen = new Set<string>();

  for (const row of rows) {
    const key = rowKey(row);
    seen.add(key);
    const was = prev.get(key);
    if (was && was.phase !== 'leaving') {
      next.set(key, { ...was, row, polledAt });
    } else {
      next.set(key, { key, row, phase: 'entering', since: now, polledAt });
    }
  }

  for (const [key, t] of prev) {
    if (seen.has(key)) continue;
    if (t.phase === 'leaving') {
      // 다 빠져나갔으면 버린다.
      if (now - t.since < LEAVE_MS) next.set(key, t);
      continue;
    }
    next.set(key, { ...t, phase: 'leaving', since: now });
  }

  return next;
}

/** 들어오기가 끝난 점을 머무름으로 넘긴다 — 그리기 전에 한 번 훑는다 */
export function settleTracks(
  tracks: ReadonlyMap<string, Track>,
  now: number,
): Map<string, Track> {
  const next = new Map(tracks);
  for (const [key, t] of tracks) {
    if (t.phase === 'entering' && now - t.since >= ENTER_MS) {
      next.set(key, { ...t, phase: 'holding', since: now });
    }
  }
  return next;
}

/** 0~1 사이로 자르기 */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 부드럽게 — 시작과 끝을 눅인다 */
function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * 머무는 자리.
 *
 * **키로 흩뜨린다.** 전부 한 줄에 서면 가운데가 막대 하나로 뭉쳐 몇 건인지 안 보인다.
 * 같은 트랜잭션은 늘 같은 자리라, 머무는 동안 점이 떨리지 않는다.
 */
export function holdX(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return 0.38 + (Math.abs(h) % 1000) / 1000 * 0.24; // 0.38 ~ 0.62
}

/** 지금 그릴 점 하나. 화면 밖으로 나간 것은 부르는 쪽이 걸러낸다 */
export function toDot(t: Track, now: number, yMax: number): FlowDot {
  const home = holdX(t.key);
  let tx = home;
  let alpha = 1;

  if (t.phase === 'entering') {
    const p = clamp01((now - t.since) / ENTER_MS);
    // 왼쪽 밖(-0.1)에서 제자리로
    tx = -0.1 + (home + 0.1) * ease(p);
    alpha = clamp01(p * 2);
  } else if (t.phase === 'leaving') {
    const p = clamp01((now - t.since) / LEAVE_MS);
    // 제자리에서 오른쪽 밖(1.12)으로
    tx = home + (1.12 - home) * ease(p);
    alpha = 1 - clamp01(p * 1.2);
  }

  const e = elapsedNow(t, now);
  return {
    key: t.key,
    tx,
    ty: Math.min(1, e / yMax),
    step: stepOf(e),
    phase: t.phase,
    alpha,
    row: t.row,
  };
}

/** 보기 좋은 올림값 — 1·2·5 배수 */
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
 * **쉽게 내리지 않는다.** 느린 요청 하나가 지나갈 때마다 축이 오르내리면 점 전체가
 * 위아래로 춤춰서 무엇이 오래 걸리는지 눈으로 좇을 수 없다.
 */
export function nextYMax(current: number, needed: number): number {
  const want = Math.max(MIN_Y_MS, niceCeil(needed));
  if (want > current) return want;
  if (want <= current / 2) return want;
  return current;
}

/** 지금 떠 있는 것 중 가장 오래 걸린 값 — 축 상한의 근거 */
export function neededYMax(tracks: ReadonlyMap<string, Track>, now: number): number {
  let max = 0;
  for (const t of tracks.values()) {
    const e = elapsedNow(t, now);
    if (e > max) max = e;
  }
  return max;
}

/** 머무는 중인(= 실제로 돌고 있는) 건수. 나가는 중인 것은 이미 끝난 것이다 */
export function holdingCount(tracks: ReadonlyMap<string, Track>): number {
  let n = 0;
  for (const t of tracks.values()) {
    if (t.phase !== 'leaving') n++;
  }
  return n;
}

/**
 * 누른 자리에서 가장 가까운 점.
 *
 * **비율이 아니라 픽셀로 견준다** — 창이 가로로 길어서 비율로 재면 가로로 멀리 있는
 * 점이 «가깝다» 고 나온다. 나가는 중인 것은 고르지 않는다: 이미 끝난 트랜잭션이라
 * 눌러도 보여 줄 것이 없다.
 */
export function pickNearest(
  dots: readonly FlowDot[],
  px: number,
  py: number,
  w: number,
  h: number,
  radiusPx = 10,
): FlowDot | null {
  let best: FlowDot | null = null;
  let bestD = radiusPx * radiusPx;

  for (const d of dots) {
    if (d.phase === 'leaving') continue;
    const dx = d.tx * w - px;
    const dy = (1 - d.ty) * h - py;
    const dist = dx * dx + dy * dy;
    if (dist < bestD) {
      best = d;
      bestD = dist;
    }
  }
  return best;
}

/** 세로축에 적을 눈금 — 상한과 절반 */
export function yTicks(yMax: number): number[] {
  return [yMax, yMax / 2];
}

/** `1,200ms` · `12.4초` — 목록과 같은 표기 */
export function formatTick(ms: number): string {
  return ms >= 1_000 ? `${(ms / 1_000).toFixed(ms >= 10_000 ? 0 : 1)}초` : `${Math.round(ms)}ms`;
}
