import { describe, expect, it } from 'vitest';
import { KPI_IDS } from './kpi';
import { DEFAULT_THRESHOLDS, type ThresholdMap } from './threshold';
import {
  draftState,
  parse,
  rowError,
  rowIncomplete,
  toDraft,
  toMap,
  type Draft,
  type DraftMap,
} from './thresholdDraft';

const row = (over: Partial<Draft> = {}): Draft => ({
  enabled: true,
  warn: '70',
  danger: '90',
  ...over,
});

/** 나머지 줄은 문제없는 값으로 채운 초안 */
function draftWith(over: Partial<DraftMap>): DraftMap {
  const out = {} as DraftMap;
  for (const id of KPI_IDS) out[id] = over[id] ?? row();
  return out;
}

describe('parse', () => {
  it('빈 칸은 수가 아니다', () => {
    expect(parse('')).toBeNull();
    expect(parse('   ')).toBeNull();
  });

  it('음수는 받지 않는다', () => {
    expect(parse('-1')).toBeNull();
  });

  it('0 은 받는다', () => {
    // 에러율 임계 0 은 «한 건이라도 나면 알린다» 라서 뜻이 있다.
    expect(parse('0')).toBe(0);
  });

  it('소수도 받는다', () => {
    expect(parse('0.5')).toBe(0.5);
  });

  it('숫자가 아니면 null', () => {
    expect(parse('abc')).toBeNull();
  });
});

describe('toDraft', () => {
  it('켜 둔 지표는 값을 그대로 채운다', () => {
    expect(toDraft(DEFAULT_THRESHOLDS).cpu).toEqual({ enabled: true, warn: '70', danger: '90' });
  });

  it('기본 임계가 있는 지표는 꺼져 있어도 칸을 채워 둔다', () => {
    // 체크만 하면 바로 쓸 수 있어야 한다.
    const d = toDraft({ ...DEFAULT_THRESHOLDS, cpu: null }).cpu;
    expect(d).toEqual({ enabled: false, warn: '70', danger: '90' });
  });

  it('기본 임계가 없는 지표는 빈 칸이다', () => {
    // 사이트마다 정상 범위가 달라 우리가 채워 넣을 수가 없다.
    expect(toDraft(DEFAULT_THRESHOLDS).tps).toEqual({ enabled: false, warn: '', danger: '' });
  });
});

describe('rowIncomplete — 빈 칸은 틀린 게 아니다', () => {
  it('켜 두고 안 적었으면 미완성이다', () => {
    expect(rowIncomplete(row({ warn: '', danger: '' }))).toBe(true);
    expect(rowIncomplete(row({ warn: '10', danger: '' }))).toBe(true);
  });

  it('꺼 둔 줄은 비어 있어도 미완성이 아니다', () => {
    expect(rowIncomplete(row({ enabled: false, warn: '', danger: '' }))).toBe(false);
  });

  it('다 적었으면 미완성이 아니다', () => {
    expect(rowIncomplete(row())).toBe(false);
  });
});

describe('rowError — 무엇이 틀렸는가', () => {
  it('빈 칸에는 빨간 글씨를 띄우지 않는다', () => {
    // 체크하자마자 나무라면 아무것도 잘못하지 않은 사람을 탓하는 꼴이다.
    expect(rowError(row({ warn: '', danger: '' }))).toBeNull();
  });

  it('적다 만 한 칸도 아직은 틀린 게 아니다', () => {
    expect(rowError(row({ warn: '100', danger: '' }))).toBeNull();
  });

  it('숫자가 아닌 글자는 틀린 것이다', () => {
    expect(rowError(row({ warn: 'abc' }))).toBe('0 이상의 수를 넣어 주세요');
    expect(rowError(row({ danger: '-5' }))).toBe('0 이상의 수를 넣어 주세요');
  });

  it('주의가 위험보다 크면 틀린 것이다', () => {
    // 파일을 읽을 때는 바꿔 끼우지만(toThresholds), 창에서는 그러지 않는다 —
    // 방금 친 두 수가 말없이 자리를 바꾸면 무엇이 저장됐는지 알 수 없다.
    expect(rowError(row({ warn: '90', danger: '70' }))).toBe('주의가 위험보다 클 수 없습니다');
  });

  it('같은 값은 받는다', () => {
    expect(rowError(row({ warn: '80', danger: '80' }))).toBeNull();
  });

  it('꺼 둔 줄은 무엇이 들어 있어도 따지지 않는다', () => {
    expect(rowError(row({ enabled: false, warn: 'abc', danger: '-1' }))).toBeNull();
  });
});

describe('draftState', () => {
  it('아무 문제 없으면 저장이 열린다', () => {
    expect(draftState(draftWith({})).blocked).toBe(false);
  });

  it('켜 두고 안 적은 줄이 있으면 막는다', () => {
    const s = draftState(draftWith({ tps: row({ warn: '', danger: '' }) }));
    expect(s).toEqual({ wrong: false, unfinished: true, blocked: true });
  });

  it('틀린 줄이 있으면 막는다', () => {
    const s = draftState(draftWith({ cpu: row({ warn: '90', danger: '70' }) }));
    expect(s).toEqual({ wrong: true, unfinished: false, blocked: true });
  });

  it('꺼 둔 빈 줄은 막지 않는다', () => {
    // 기본 상태(TPS·액티브가 꺼진 채 비어 있음)에서 바로 저장할 수 있어야 한다.
    expect(draftState(toDraft(DEFAULT_THRESHOLDS)).blocked).toBe(false);
  });
});

describe('toMap', () => {
  it('적은 값을 그대로 옮긴다', () => {
    expect(toMap(draftWith({ cpu: row({ warn: '50', danger: '80' }) })).cpu).toEqual({
      warn: 50,
      danger: 80,
    });
  });

  it('꺼 둔 줄은 임계 없음이다', () => {
    expect(toMap(draftWith({ cpu: row({ enabled: false }) })).cpu).toBeNull();
  });

  it('켜 뒀지만 안 적은 줄에 0 을 지어내지 않는다', () => {
    expect(toMap(draftWith({ tps: row({ warn: '', danger: '' }) })).tps).toBeNull();
  });

  it('썼다 읽으면 그대로다', () => {
    const mine: ThresholdMap = {
      ...DEFAULT_THRESHOLDS,
      tps: { warn: 200, danger: 400 },
      cpu: null,
    };
    expect(toMap(toDraft(mine))).toEqual(mine);
  });
});
