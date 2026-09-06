import { describe, expect, it } from 'vitest';
import {
  buildRows,
  countByGrade,
  pressure,
  sortRows,
  worstOf,
  type InstanceRow,
  type InstanceValues,
} from './instanceRows';
import { DEFAULT_THRESHOLDS, type ThresholdMap } from './threshold';

const TH: ThresholdMap = DEFAULT_THRESHOLDS;

const agentMap = new Map<number, string>([
  [11, '/test-host/shop-app'],
  [22, '/test-host/order-app'],
  [33, '/test-host/test-host'],
]);

describe('pressure — 임계에 얼마나 다가갔나', () => {
  it('주의 임계로 나눈 비율이다', () => {
    expect(pressure(35, { warn: 70, danger: 90 })).toBeCloseTo(0.5, 6);
    expect(pressure(89, { warn: 70, danger: 90 })).toBeCloseTo(1.271, 3);
  });

  it('임계가 없으면 잴 수 없다', () => {
    expect(pressure(9999, null)).toBeNull();
  });

  it('주의 임계가 0 이면 값 자체를 크기로 쓴다', () => {
    // 에러율 임계 0 은 «한 건이라도 나면 알린다» 라서 뜻이 있다. 나눌 수는 없다.
    expect(pressure(3, { warn: 0, danger: 5 })).toBe(3);
  });
});

describe('worstOf', () => {
  it('받은 지표가 없으면 null', () => {
    expect(worstOf({}, TH)).toBeNull();
  });

  it('나쁜 등급이 이긴다', () => {
    // CPU 95 = 위험, Heap 75 = 주의
    const w = worstOf({ cpu: 95, heap: 75 }, TH);
    expect(w?.def.id).toBe('cpu');
    expect(w?.grade).toBe('danger');
  });

  it('등급이 같으면 임계에 더 다가간 쪽이다', () => {
    // 둘 다 주의(70~90)인데 89 가 71 보다 할 말이 많다.
    const w = worstOf({ cpu: 71, heap: 89 }, TH);
    expect(w?.def.id).toBe('heap');
    expect(w?.value).toBe(89);
  });

  it('임계가 없는 지표는 임계가 있는 지표를 밀어내지 않는다', () => {
    // TPS 는 기본 임계가 없어 «none» 이다. CPU 20 은 «ok» 라서 등급이 더 높다.
    const w = worstOf({ tps: 9999, cpu: 20 }, TH);
    expect(w?.def.id).toBe('cpu');
  });

  it('임계 없는 지표뿐이면 그것이라도 고른다', () => {
    // 아무것도 안 고르면 그 칸이 격자에서 통째로 사라진다.
    const w = worstOf({ tps: 23 }, TH);
    expect(w?.def.id).toBe('tps');
    expect(w?.grade).toBe('none');
  });

  it('값이 없는 지표는 건너뛴다', () => {
    const values = { cpu: undefined, heap: 75 } as InstanceValues;
    expect(worstOf(values, TH)?.def.id).toBe('heap');
  });

  it('숫자가 아닌 값은 건너뛴다', () => {
    expect(worstOf({ cpu: NaN, heap: 10 }, TH)?.def.id).toBe('heap');
  });
});

describe('buildRows', () => {
  const samples = new Map<number, InstanceValues>([
    [11, { tps: 20, heap: 95 }],
    [22, { tps: 10, heap: 40 }],
    [33, { cpu: 75 }],
  ]);

  it('오브젝트마다 한 칸을 만든다', () => {
    const rows = buildRows({ samples, agentMap, javaeeHashes: [11, 22], thresholds: TH });
    expect(rows.map(r => r.objHash).sort()).toEqual([11, 22, 33]);
  });

  it('짧은 이름을 쓰고 전체 이름도 남긴다', () => {
    const rows = buildRows({ samples, agentMap, javaeeHashes: [11, 22], thresholds: TH });
    const shop = rows.find(r => r.objHash === 11);
    expect(shop?.name).toBe('shop-app');
    expect(shop?.fullName).toBe('/test-host/shop-app');
  });

  it('이름을 모르면 해시를 그대로 쓴다', () => {
    const rows = buildRows({
      samples: new Map([[99, { tps: 1 }]]),
      agentMap,
      javaeeHashes: [],
      thresholds: TH,
    });
    expect(rows[0].name).toBe('99');
  });

  it('javaee 오브젝트만 파고들 수 있다', () => {
    // 호스트 오브젝트에는 트랜잭션이 없다 — 데려가 봐야 빈 화면이다.
    const rows = buildRows({ samples, agentMap, javaeeHashes: [11, 22], thresholds: TH });
    expect(rows.find(r => r.objHash === 11)?.drillable).toBe(true);
    expect(rows.find(r => r.objHash === 33)?.drillable).toBe(false);
  });

  it('값을 하나도 못 받은 오브젝트는 칸을 만들지 않는다', () => {
    // 빈 칸을 깔면 격자가 «수집이 안 되는 것» 으로 보인다.
    const rows = buildRows({
      samples: new Map([[11, { tps: 20 }], [44, {}]]),
      agentMap,
      javaeeHashes: [],
      thresholds: TH,
    });
    expect(rows.map(r => r.objHash)).toEqual([11]);
  });

  it('나쁜 것이 앞에 온다', () => {
    const rows = buildRows({ samples, agentMap, javaeeHashes: [11, 22], thresholds: TH });
    expect(rows[0].objHash).toBe(11); // heap 95 = 위험
    expect(rows[1].objHash).toBe(33); // cpu 75 = 주의
  });
});

describe('sortRows', () => {
  const row = (name: string, grade: InstanceRow['grade']): InstanceRow => ({
    objHash: name.length,
    name,
    fullName: name,
    values: {},
    worst: null,
    grade,
    drillable: false,
  });

  it('위험 → 주의 → 정상 → 등급 없음', () => {
    const sorted = sortRows([
      row('a', 'none'),
      row('b', 'ok'),
      row('c', 'danger'),
      row('d', 'warn'),
    ]);
    expect(sorted.map(r => r.name)).toEqual(['c', 'd', 'b', 'a']);
  });

  it('등급이 같으면 이름순이다', () => {
    // 값으로 다시 줄을 세우면 2초마다 칸들이 자리를 바꿔 읽을 수가 없다.
    const sorted = sortRows([row('zeta', 'warn'), row('alpha', 'warn')]);
    expect(sorted.map(r => r.name)).toEqual(['alpha', 'zeta']);
  });

  it('원본을 건드리지 않는다', () => {
    const input = [row('b', 'ok'), row('a', 'danger')];
    sortRows(input);
    expect(input.map(r => r.name)).toEqual(['b', 'a']);
  });
});

describe('countByGrade', () => {
  it('등급별로 센다', () => {
    const rows = buildRows({
      samples: new Map<number, InstanceValues>([
        [11, { heap: 95 }],
        [22, { heap: 75 }],
        [33, { cpu: 10 }],
      ]),
      agentMap,
      javaeeHashes: [],
      thresholds: TH,
    });
    expect(countByGrade(rows)).toEqual({ none: 0, ok: 1, warn: 1, danger: 1 });
  });
});
