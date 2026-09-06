// 임계값 — 숫자를 «괜찮다 / 주의 / 위험» 으로 읽는 자. **순수 함수다.**
//
// 값만 크게 띄우면 그 수가 정상인지 아닌지는 보는 사람이 안다는 뜻이 된다.
// 새로 온 사람은 모르고, 아는 사람도 새벽 세 시에는 헷갈린다. **화면이 말해야 한다.**
//
// 사이트마다 다르므로 `config.json` 에 둔다. 코드에 박으면 어느 현장에서는 늘 빨갛고
// 어느 현장에서는 영영 조용하다 — 둘 다 아무것도 알려 주지 않는다.

import type { KpiThresholdPrefs } from '../xlog/api/scouterApi';
import { KPI_IDS, type KpiId } from './kpi';

/** `none` 은 «임계를 안 정했다» 다. «괜찮다»(ok) 와 다르다 */
export type Grade = 'none' | 'ok' | 'warn' | 'danger';

export interface Threshold {
  /** 이 값 이상이면 주의 */
  warn: number;
  /** 이 값 이상이면 위험 */
  danger: number;
}

/** 지표별 임계. `null` 이면 색을 쓰지 않는다 */
export type ThresholdMap = Record<KpiId, Threshold | null>;

export const DEFAULT_THRESHOLDS: ThresholdMap = {
  // TPS·액티브는 **사이트마다 정상 범위가 다르다.** 200이 평시인 곳도 있고 20이 비상인
  // 곳도 있다. 기본으로 색을 칠하면 어느 현장에서는 켜자마자 빨갛다 —
  // 쓸 사람이 정하기 전까지는 색을 쓰지 않는다.
  tps: null,
  active: null,
  // 응답시간은 **액티브 서비스 막대와 같은 자**를 쓴다 (`activeSpeed.ts` 의 1초/3초 단계).
  // 화면마다 자가 다르면 노란색이 화면을 옮길 때마다 다른 뜻이 된다.
  elapsed: { warn: 1_000, danger: 3_000 },
  error: { warn: 1, danger: 5 },
  cpu: { warn: 70, danger: 90 },
  heap: { warn: 70, danger: 90 },
};

/**
 * 값의 등급.
 *
 * 경계는 **이상**이다 — CPU 임계 70에 정확히 70이면 주의다. 미만으로 잡으면
 * 딱 임계에 걸린 값이 «괜찮다» 로 읽혀, 임계를 정한 이유가 사라진다.
 */
export function grade(value: number | null, th: Threshold | null): Grade {
  if (th === null || value === null || !Number.isFinite(value)) return 'none';
  if (value >= th.danger) return 'danger';
  if (value >= th.warn) return 'warn';
  return 'ok';
}

/** 0 이상의 쓸 만한 수인가. 아니면 null */
function positive(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * 저장해 둔 값 → 화면 값.
 *
 * **읽어 온 값을 그대로 믿지 않는다.** 설정 파일은 사람이 여는 곳이다 (`uiState.ts` 와 같은 규칙).
 * 못 쓸 수가 들어오면 그 지표만 기본값으로 두고, 나머지는 살린다.
 */
export function toThresholds(saved: KpiThresholdPrefs[] | undefined): ThresholdMap {
  const map: ThresholdMap = { ...DEFAULT_THRESHOLDS };
  if (!Array.isArray(saved)) return map;

  for (const row of saved) {
    if (typeof row !== 'object' || row === null) continue;
    const id = row.id as KpiId;
    // 모르는 이름은 버린다. 지표를 지웠다 되살리는 사이에 남은 줄일 수 있다.
    if (!KPI_IDS.includes(id)) continue;

    if (row.enabled === false) {
      map[id] = null;
      continue;
    }

    const warn = positive(row.warn);
    const danger = positive(row.danger);
    if (warn === null || danger === null) continue;

    // **뒤집혀 있으면 바꿔 끼운다.** 두 칸을 반대로 적는 실수는 흔하고,
    // 기본값으로 되돌리면 적어 둔 두 수가 통째로 사라진다.
    map[id] = warn <= danger ? { warn, danger } : { warn: danger, danger: warn };
  }

  return map;
}

/**
 * 화면 값 → 저장할 값.
 *
 * 임계를 안 쓰는 지표도 줄을 남긴다 — 빠진 줄과 «안 쓰기로 정한 줄» 을 가르지 못하면
 * 다음에 읽을 때 기본값이 되살아나 꺼 둔 색이 다시 켜진다.
 */
export function fromThresholds(map: ThresholdMap): KpiThresholdPrefs[] {
  return KPI_IDS.map(id => {
    const th = map[id];
    return th === null
      ? { id, warn: 0, danger: 0, enabled: false }
      : { id, warn: th.warn, danger: th.danger, enabled: true };
  });
}
