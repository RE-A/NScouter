import { describe, expect, it } from 'vitest';
import type { KpiThresholdPrefs } from '../xlog/api/scouterApi';
import { KPI_IDS } from './kpi';
import {
  DEFAULT_THRESHOLDS,
  fromThresholds,
  grade,
  toThresholds,
  type ThresholdMap,
} from './threshold';

describe('기본 임계', () => {
  it('지표마다 자리가 있다', () => {
    // 빠진 지표가 있으면 그 타일만 색이 없는데, 이유가 화면에 안 보인다.
    for (const id of KPI_IDS) {
      expect(DEFAULT_THRESHOLDS).toHaveProperty(id);
    }
  });

  it('TPS·액티브는 기본으로 색을 쓰지 않는다', () => {
    // 200이 평시인 곳도 있고 20이 비상인 곳도 있다. 기본으로 칠하면
    // 어느 현장에서는 켜자마자 빨갛다.
    expect(DEFAULT_THRESHOLDS.tps).toBeNull();
    expect(DEFAULT_THRESHOLDS.active).toBeNull();
  });

  it('응답시간은 액티브 서비스 막대와 같은 자를 쓴다', () => {
    // activeSpeed 의 단계가 1초 미만 / 1~3초 / 3초 이상이다.
    // 자가 갈리면 노란색이 화면을 옮길 때마다 다른 뜻이 된다.
    expect(DEFAULT_THRESHOLDS.elapsed).toEqual({ warn: 1_000, danger: 3_000 });
  });
});

describe('grade', () => {
  const th = { warn: 70, danger: 90 };

  it('임계 미만은 괜찮다', () => {
    expect(grade(69, th)).toBe('ok');
  });

  it('경계는 이상으로 본다', () => {
    // 미만으로 잡으면 딱 임계에 걸린 값이 괜찮다로 읽혀 임계를 정한 이유가 사라진다.
    expect(grade(70, th)).toBe('warn');
    expect(grade(90, th)).toBe('danger');
  });

  it('위험이 주의를 이긴다', () => {
    expect(grade(95, th)).toBe('danger');
  });

  it('임계를 안 정했으면 등급이 없다', () => {
    // «괜찮다» 와 다르다 — 안 정한 것을 초록으로 칠하면 확인했다는 뜻이 된다.
    expect(grade(9999, null)).toBe('none');
  });

  it('값이 없으면 등급이 없다', () => {
    expect(grade(null, th)).toBe('none');
    expect(grade(NaN, th)).toBe('none');
  });
});

describe('toThresholds — 저장본 읽기', () => {
  const row = (
    id: string,
    warn: number,
    danger: number,
    enabled = true,
  ): KpiThresholdPrefs => ({ id, warn, danger, enabled });

  it('없으면 전부 기본값이다', () => {
    expect(toThresholds(undefined)).toEqual(DEFAULT_THRESHOLDS);
  });

  it('적어 둔 값을 읽는다', () => {
    const m = toThresholds([row('cpu', 50, 80)]);
    expect(m.cpu).toEqual({ warn: 50, danger: 80 });
  });

  it('안 적은 지표는 기본값이 남는다', () => {
    const m = toThresholds([row('cpu', 50, 80)]);
    expect(m.heap).toEqual(DEFAULT_THRESHOLDS.heap);
  });

  it('꺼 둔 지표는 색을 쓰지 않는다', () => {
    // 줄을 빼는 것과 다르다 — 빠진 줄은 기본값이 되살아난다.
    expect(toThresholds([row('cpu', 70, 90, false)]).cpu).toBeNull();
  });

  it('임계를 정한 지표를 켤 수 있다', () => {
    expect(toThresholds([row('tps', 500, 800)]).tps).toEqual({ warn: 500, danger: 800 });
  });

  it('뒤집혀 있으면 바꿔 끼운다', () => {
    // 두 칸을 반대로 적는 실수는 흔하다. 기본값으로 되돌리면 적어 둔 두 수가 다 사라진다.
    expect(toThresholds([row('cpu', 90, 70)]).cpu).toEqual({ warn: 70, danger: 90 });
  });

  it('모르는 이름은 버린다', () => {
    const m = toThresholds([row('gc', 1, 2), row('cpu', 50, 80)]);
    expect(m).not.toHaveProperty('gc');
    expect(m.cpu).toEqual({ warn: 50, danger: 80 });
  });

  it('못 쓸 수가 든 줄은 그 지표만 기본값으로 둔다', () => {
    // 파일은 사람이 여는 곳이라 숫자 자리에 글자가 들어와 있을 수 있다.
    const bad = { id: 'cpu', warn: 'abc', danger: 80, enabled: true } as unknown as KpiThresholdPrefs;
    const m = toThresholds([bad, row('heap', 60, 85)]);
    expect(m.cpu).toEqual(DEFAULT_THRESHOLDS.cpu);
    expect(m.heap).toEqual({ warn: 60, danger: 85 });
  });

  it('음수는 받지 않는다', () => {
    const m = toThresholds([row('cpu', -1, 80)]);
    expect(m.cpu).toEqual(DEFAULT_THRESHOLDS.cpu);
  });

  it('배열이 아닌 것이 와도 죽지 않는다', () => {
    expect(toThresholds({ cpu: 70 } as unknown as KpiThresholdPrefs[])).toEqual(DEFAULT_THRESHOLDS);
  });
});

describe('fromThresholds — 저장본 쓰기', () => {
  it('꺼 둔 지표도 줄을 남긴다', () => {
    // 빼면 다음에 읽을 때 기본값이 되살아나 꺼 둔 색이 다시 켜진다.
    const rows = fromThresholds({ ...DEFAULT_THRESHOLDS, cpu: null });
    const cpu = rows.find(r => r.id === 'cpu');
    expect(cpu?.enabled).toBe(false);
  });

  it('지표를 하나도 빠뜨리지 않는다', () => {
    expect(fromThresholds(DEFAULT_THRESHOLDS).map(r => r.id)).toEqual([...KPI_IDS]);
  });

  it('썼다 읽으면 그대로다', () => {
    const mine: ThresholdMap = {
      ...DEFAULT_THRESHOLDS,
      tps: { warn: 500, danger: 800 },
      cpu: null,
    };
    expect(toThresholds(fromThresholds(mine))).toEqual(mine);
  });
});
