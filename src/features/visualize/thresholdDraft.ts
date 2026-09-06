// 임계값 창에서 «고치는 중» 인 값. **순수 함수다.**
//
// 창과 나눠 둔 이유는 규칙이 눈으로 확인하기 어려운 종류이기 때문이다 —
// 빈 칸과 틀린 값을 가르는 자리, 뒤집힌 두 수를 창에서는 바꿔 끼우지 않는다는 자리가
// 그렇다. 화면을 띄우지 않고는 못 보는 코드로 두면 손댈 때마다 도박이 된다.

import { KPI_DEFS, type KpiId } from './kpi';
import { DEFAULT_THRESHOLDS, type ThresholdMap } from './threshold';

/**
 * 고치는 동안의 한 줄. **문자열로 든다.**
 *
 * 숫자로 들면 `70` 을 지우고 `100` 을 치는 사이에 빈 칸이 0 으로 바뀌어
 * 커서 뒤에 0 이 따라붙는다.
 */
export interface Draft {
  enabled: boolean;
  warn: string;
  danger: string;
}

export type DraftMap = Record<KpiId, Draft>;

export function toDraft(map: ThresholdMap): DraftMap {
  const out = {} as DraftMap;
  for (const def of KPI_DEFS) {
    const th = map[def.id];
    if (th !== null) {
      out[def.id] = { enabled: true, warn: String(th.warn), danger: String(th.danger) };
      continue;
    }
    // 꺼 둔 줄에도 기본 임계가 있으면 채워 둔다 — 체크만 하면 바로 쓸 수 있다.
    // TPS·액티브는 기본이 없어 빈 칸으로 남는데, 그건 틀린 게 아니라
    // **아직 안 정한 것**이다 (`rowError` 참고).
    const fallback = DEFAULT_THRESHOLDS[def.id];
    out[def.id] = {
      enabled: false,
      warn: fallback === null ? '' : String(fallback.warn),
      danger: fallback === null ? '' : String(fallback.danger),
    };
  }
  return out;
}

/** 쓸 만한 수인가. 아니면 null */
export function parse(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const isBlank = (text: string): boolean => text.trim() === '';

/**
 * 아직 다 안 적은 줄인가.
 *
 * **빈 칸은 틀린 게 아니다.** TPS 를 체크하는 순간 두 칸이 비어 있는데, 거기에 대고
 * «값을 넣어라» 는 빨간 글씨를 띄우면 아무것도 잘못하지 않은 사람을 나무라는 꼴이다.
 * 다 적을 때까지 저장만 막는다.
 */
export function rowIncomplete(d: Draft): boolean {
  return d.enabled && (isBlank(d.warn) || isBlank(d.danger));
}

/** 이 줄이 왜 **틀렸는가.** 문제없으면 null */
export function rowError(d: Draft): string | null {
  if (!d.enabled) return null;

  // 적다 만 것은 여기서 말하지 않는다 (`rowIncomplete`).
  for (const text of [d.warn, d.danger]) {
    if (!isBlank(text) && parse(text) === null) return '0 이상의 수를 넣어 주세요';
  }

  const warn = parse(d.warn);
  const danger = parse(d.danger);
  if (warn === null || danger === null) return null;
  // 손으로 고친 파일은 읽을 때 바꿔 끼우지만(`threshold.toThresholds`), 창에서는 그러지 않는다 —
  // 방금 친 두 수가 말없이 자리를 바꾸면 무엇이 저장됐는지 알 수 없다.
  if (warn > danger) return '주의가 위험보다 클 수 없습니다';
  return null;
}

export interface DraftState {
  /** 틀린 줄이 있다 */
  wrong: boolean;
  /** 켜 두고 안 적은 줄이 있다 */
  unfinished: boolean;
  /** 저장을 막아야 하는가 */
  blocked: boolean;
}

export function draftState(draft: DraftMap): DraftState {
  const wrong = KPI_DEFS.some(d => rowError(draft[d.id]) !== null);
  const unfinished = KPI_DEFS.some(d => rowIncomplete(draft[d.id]));
  return { wrong, unfinished, blocked: wrong || unfinished };
}

/**
 * 저장할 값으로.
 *
 * 켜 뒀지만 안 적은 줄은 «임계 없음» 이다 — 여기까지 오려면 저장이 열려야 하고,
 * 저장이 열렸다는 건 그런 줄이 없다는 뜻이다(`draftState`). 그래도 0 을 지어내지는 않는다.
 */
export function toMap(draft: DraftMap): ThresholdMap {
  const out = {} as ThresholdMap;
  for (const def of KPI_DEFS) {
    const row = draft[def.id];
    const warn = parse(row.warn);
    const danger = parse(row.danger);
    out[def.id] = row.enabled && warn !== null && danger !== null ? { warn, danger } : null;
  }
  return out;
}
