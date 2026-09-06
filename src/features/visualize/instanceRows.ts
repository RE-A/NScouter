// 격자에 놓을 줄 — «어느 서버가 이상한가». **순수 함수다.**
//
// 지표 줄(`KpiStrip`)은 전부를 접은 값이라 «전체가 견디고 있나» 에만 답한다.
// 열 대 중 한 대만 힙이 차 있으면 접은 값은 멀쩡해 보이고, 카운터 차트에서는
// 선 열 개가 겹쳐 어느 선이 그 한 대인지 색으로 가려내야 한다.
// 여기서는 **한 대가 한 칸**이라 그 한 대가 그냥 보인다.
//
// **나쁜 것부터 앞에 놓는다.** 백 대가 붙어 있어도 봐야 할 것이 첫 줄에 온다 —
// 이름순으로 두면 백 대짜리 격자에서 빨간 칸 하나를 눈으로 찾아야 한다.

import { shortName } from '../xlog/components/agentTree';
import { KPI_DEFS, type KpiDef, type KpiId } from './kpi';
import { grade, type Grade, type Threshold, type ThresholdMap } from './threshold';

/** 한 오브젝트가 지금 들고 있는 지표 값들 */
export type InstanceValues = Partial<Record<KpiId, number>>;

export interface WorstKpi {
  def: KpiDef;
  value: number;
  grade: Grade;
}

export interface InstanceRow {
  objHash: number;
  /** 화면에 적을 짧은 이름 */
  name: string;
  /** 마우스를 올렸을 때 보여줄 전체 이름 */
  fullName: string;
  values: InstanceValues;
  /**
   * 이 칸의 색을 정하는 지표. 받은 지표가 하나도 없으면 null.
   *
   * **등급이 같으면 임계에 더 다가간 쪽**이다. 둘 다 노랑인데 하나는 71%,
   * 하나는 89% 면 뒤엣것이 이 칸의 이야기다.
   */
  worst: WorstKpi | null;
  grade: Grade;
  /** XLog 로 파고들 수 있는가. javaee 오브젝트만 트랜잭션이 있다 */
  drillable: boolean;
}

const RANK: Record<Grade, number> = { none: 0, ok: 1, warn: 2, danger: 3 };

/**
 * 임계까지 얼마나 다가갔는가.
 *
 * 임계가 없으면 잴 수 없다 — 그런 지표는 «가장 나쁜 것» 을 다투지 않는다.
 * 주의 임계가 0 이면(에러율 0 = 한 건이라도 나면 알린다) 나눌 수 없으므로,
 * 값이 있으면 그 값 자체를 크기로 쓴다.
 */
export function pressure(value: number, th: Threshold | null): number | null {
  if (th === null) return null;
  return th.warn > 0 ? value / th.warn : value;
}

/** 이 오브젝트에서 가장 나쁜 지표. 받은 지표가 없으면 null */
export function worstOf(values: InstanceValues, thresholds: ThresholdMap): WorstKpi | null {
  let best: WorstKpi | null = null;
  let bestPressure: number | null = null;

  for (const def of KPI_DEFS) {
    const value = values[def.id];
    if (value === undefined || !Number.isFinite(value)) continue;

    const th = thresholds[def.id];
    const g = grade(value, th);
    const p = pressure(value, th);

    if (best === null) {
      best = { def, value, grade: g };
      bestPressure = p;
      continue;
    }
    if (RANK[g] > RANK[best.grade]) {
      best = { def, value, grade: g };
      bestPressure = p;
      continue;
    }
    if (RANK[g] < RANK[best.grade]) continue;

    // 등급이 같다 — 임계에 더 다가간 쪽. 잴 수 없는 쪽은 지지 않고 자리를 지킨다
    // (임계 없는 지표가 임계 있는 지표를 밀어내면, 칸의 색과 적힌 지표가 어긋난다).
    if (p !== null && (bestPressure === null || p > bestPressure)) {
      best = { def, value, grade: g };
      bestPressure = p;
    }
  }

  return best;
}

export interface BuildInput {
  /** objHash → 지금 값들 */
  samples: ReadonlyMap<number, InstanceValues>;
  /** objHash → objName */
  agentMap: ReadonlyMap<number, string>;
  /** 트랜잭션이 있는 오브젝트들 */
  javaeeHashes: readonly number[];
  thresholds: ThresholdMap;
}

/**
 * 격자에 놓을 칸들.
 *
 * **값을 하나도 못 받은 오브젝트는 넣지 않는다.** 커넥션 풀(datasource)처럼
 * 여기 지표가 아예 없는 오브젝트를 빈 칸으로 깔면, 격자가 «수집이 안 되는 것» 으로 보인다.
 */
export function buildRows(input: BuildInput): InstanceRow[] {
  const { samples, agentMap, javaeeHashes, thresholds } = input;
  const javaee = new Set(javaeeHashes);
  const rows: InstanceRow[] = [];

  for (const [objHash, values] of samples) {
    const worst = worstOf(values, thresholds);
    if (worst === null) continue;
    const fullName = agentMap.get(objHash) ?? String(objHash);
    rows.push({
      objHash,
      name: shortName(fullName),
      fullName,
      values,
      worst,
      grade: worst.grade,
      drillable: javaee.has(objHash),
    });
  }

  return sortRows(rows);
}

/**
 * 나쁜 것부터. 같은 등급이면 이름순.
 *
 * 이름순을 뒤에 두는 이유는 **자리가 튀지 않게** 하기 위해서다 — 등급이 같은데
 * 값으로 다시 줄을 세우면 2초마다 칸들이 서로 자리를 바꿔 읽을 수가 없다.
 */
export function sortRows(rows: readonly InstanceRow[]): InstanceRow[] {
  return [...rows].sort((a, b) => {
    const byGrade = RANK[b.grade] - RANK[a.grade];
    if (byGrade !== 0) return byGrade;
    return a.name.localeCompare(b.name);
  });
}

/** 등급별 칸 수. 격자 머리글에 «위험 2 · 주의 5» 로 적는다 */
export function countByGrade(rows: readonly InstanceRow[]): Record<Grade, number> {
  const out: Record<Grade, number> = { none: 0, ok: 0, warn: 0, danger: 0 };
  for (const r of rows) out[r.grade] += 1;
  return out;
}
