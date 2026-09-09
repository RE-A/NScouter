// 반원 게이지의 눈금과 기하 (순수 함수)
//
// 숫자는 «지금 몇» 을 말하지만 «그게 어디쯤인가» 는 말하지 않는다. 62.4 가 여유인지
// 코앞인지는 자를 알아야 답할 수 있고, 새벽 세 시에는 아는 사람도 헷갈린다.
// 게이지는 그 **자를 눈에 보이게** 하는 것이다.
//
// **눈금은 만들어 내지 않는다.** 게이지에서 가장 쉬운 거짓말이 «적당한 최대치» 를
// 정하는 것이다 — 200이 평시인 곳도 있고 20이 비상인 곳도 있는 TPS 에 100 을
// 박아 두면 화면이 늘 절반을 가리킨다. 그래서 눈금의 출처는 둘뿐이다:
//
//   1. **사람이 정한 임계** (`threshold.ts`). 구간 색이 여기서 나온다.
//   2. **최근 관측 최대** — 임계가 없을 때. 이건 상대 눈금이라 색을 쓰지 않고,
//      화면이 «최근 기준» 이라고 적는다.

import type { Grade, Threshold } from './threshold';

/** 반원. 왼쪽 끝(180°)에서 오른쪽 끝(0°)으로 간다 */
const START_DEG = 180;
const SWEEP_DEG = 180;

/** 눈금의 출처. 화면이 «이 자가 어디서 왔는지» 를 말해야 한다 */
export type ScaleKind = 'threshold' | 'observed';

export interface GaugeScale {
  /** 눈금의 끝 */
  max: number;
  kind: ScaleKind;
  /** 구간들. `observed` 눈금에는 없다 — 임계가 없으니 «주의» 도 없다 */
  zones: GaugeZone[];
}

export interface GaugeZone {
  /** 눈금 위의 위치 (0~1) */
  from: number;
  to: number;
  grade: Exclude<Grade, 'none'>;
}

/**
 * 눈금 끝으로 쓰기 좋은 수.
 *
 * 1 · 2 · 2.5 · 5 · 10 의 자릿수 배수만 쓴다. 아무 수나 쓰면 `4,500ms` 같은
 * 끝 눈금이 나와서, 바늘 위치를 읽으려면 매번 나눗셈을 해야 한다.
 */
export function niceMax(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5]) {
    if (v <= m * mag) return m * mag;
  }
  return 10 * mag;
}

/**
 * 임계에서 눈금을 만든다.
 *
 * 끝을 **위험의 1.5배**로 잡는다. 위험을 끝으로 두면 넘어선 순간 바늘이 벽에 붙어
 * «얼마나 넘었는지» 를 잃는다 — 장애 중에 제일 알고 싶은 것이 그것이다.
 *
 * **백분율은 100 을 넘지 않는다.** CPU 위험 90 에 1.5를 곱하면 135% 짜리 눈금이
 * 나오는데, 그런 CPU 는 없다.
 */
export function thresholdScale(th: Threshold, percent: boolean): GaugeScale {
  const raw = niceMax(th.danger * 1.5);
  const max = percent ? Math.min(100, raw) : raw;
  const at = (v: number) => Math.max(0, Math.min(1, v / max));

  const zones: GaugeZone[] = [];
  // 괜찮은 구간에도 자리는 있다. **색은 여기서 주지 않는다** — 칠하면 화면이 늘
  // 알록달록해서 정작 빨간 하나가 안 보인다 (`KpiTile` 과 같은 규칙).
  if (th.warn < max) zones.push({ from: at(th.warn), to: at(th.danger), grade: 'warn' });
  if (th.danger < max) zones.push({ from: at(th.danger), to: 1, grade: 'danger' });

  return { max, kind: 'threshold', zones };
}

/**
 * 임계가 없을 때의 눈금 — **최근 관측 최대**.
 *
 * 상대 눈금이라 바늘이 끝에 있어도 «위험» 이 아니라 «최근 중 제일 높다» 다.
 * 그래서 색을 쓰지 않고, 화면이 그 뜻을 따로 적는다.
 *
 * 표본이 없으면 `null` — 없는 자를 그려 놓고 바늘을 얹으면 그 자리가 통째로 거짓이다.
 */
export function observedScale(samples: readonly number[]): GaugeScale | null {
  let peak = 0;
  for (const v of samples) {
    if (Number.isFinite(v) && v > peak) peak = v;
  }
  if (peak <= 0) return null;
  return { max: niceMax(peak), kind: 'observed', zones: [] };
}

/**
 * 이 지표의 눈금.
 *
 * 임계가 있으면 그쪽이 이긴다 — 사람이 정한 자가 관측보다 앞선다.
 */
export function gaugeScale(
  th: Threshold | null,
  samples: readonly number[],
  percent: boolean,
): GaugeScale | null {
  return th !== null ? thresholdScale(th, percent) : observedScale(samples);
}

export interface Needle {
  /** 눈금 위의 위치 (0~1). 눈금 밖은 끝에 붙는다 */
  frac: number;
  /** 눈금을 넘었는가. **붙였다는 사실을 화면이 말해야 한다** */
  over: boolean;
}

/**
 * 값을 눈금 위 위치로.
 *
 * 눈금 밖은 **끝에 붙인다** (`yScale.clampToCeiling` 과 같은 규칙). 지워 버리면
 * 제일 큰 값일 때 바늘이 사라지고, 그건 «값이 없다» 로 읽힌다.
 */
export function needleAt(value: number | null, max: number): Needle | null {
  if (value === null || !Number.isFinite(value) || max <= 0) return null;
  const frac = value / max;
  if (frac > 1) return { frac: 1, over: true };
  return { frac: Math.max(0, frac), over: false };
}

/** 눈금 위 위치(0~1) → 반원 위의 좌표 */
export function polar(cx: number, cy: number, r: number, frac: number): { x: number; y: number } {
  const deg = START_DEG - SWEEP_DEG * Math.max(0, Math.min(1, frac));
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

/**
 * 반원 위의 호 하나 (SVG `d`).
 *
 * 채우지 않고 **선으로만** 그린다 — 채운 부채꼴은 같은 폭에서 훨씬 무거워 보여서,
 * 타일 여섯 개를 늘어놓으면 화면이 게이지 전시장이 된다.
 */
export function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);
  // 반원이라 어느 조각도 180°를 넘지 않는다 — large-arc 는 늘 0 이다.
  return `M ${round(a.x)} ${round(a.y)} A ${round(r)} ${round(r)} 0 0 1 ${round(b.x)} ${round(b.y)}`;
}

/** SVG 좌표는 소수 두 자리면 충분하다. 길면 DOM 만 커진다 */
function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 눈금 끝에 적을 글자. 자릿수가 길면 반원 밑이 넘친다 */
export function scaleLabel(max: number): string {
  if (max >= 1_000_000) return `${trim(max / 1_000_000)}M`;
  if (max >= 1_000) return `${trim(max / 1_000)}k`;
  return trim(max);
}

function trim(v: number): string {
  return String(Math.round(v * 10) / 10);
}
