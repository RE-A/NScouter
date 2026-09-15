// 커넥션 풀 계산 — **모르는 것을 여유로운 것으로 만들지 않는가.**

import { describe, expect, it } from 'vitest';
import {
  buildPools,
  parentObjName,
  poolLevel,
  poolShortName,
  poolsOfServer,
  usagePct,
  type PoolCounters,
} from './poolModel';

function c(active: number | null, idle: number | null, max: number | null): PoolCounters {
  return { active, idle, max };
}

describe('풀과 WAS 잇기', () => {
  it('마지막 마디를 떼면 부모다', () => {
    // 에이전트가 objName + "/" + 풀이름 으로 짓는다 (TomcatJMXPerf 바이트코드).
    expect(parentObjName('/shop-app/shop-app/HikariPool-1')).toBe('/shop-app/shop-app');
    expect(poolShortName('/shop-app/shop-app/HikariPool-1')).toBe('HikariPool-1');
  });

  it('뗄 것이 없으면 부모를 지어내지 않는다', () => {
    expect(parentObjName('HikariPool-1')).toBe('');
    expect(parentObjName('/HikariPool-1')).toBe('');
  });

  it('부모 이름으로 그 서버의 풀만 고른다', () => {
    const pools = buildPools(
      [
        { objHash: 1, objName: '/shop-app/shop-app/HikariPool-1' },
        { objHash: 2, objName: '/order-app/order-app/HikariPool-1' },
      ],
      new Map(),
    );
    expect(poolsOfServer(pools, '/shop-app/shop-app').map(p => p.objHash)).toEqual([1]);
  });
});

describe('소진율', () => {
  it('활성/상한이다', () => {
    expect(usagePct(c(5, 5, 10))).toBe(50);
  });

  it('상한을 모르면 0이 아니라 «모른다» 다', () => {
    // 0% 는 «여유롭다» 로 읽힌다. 모르는 것과 여유로운 것은 정반대일 수 있다.
    expect(usagePct(c(5, null, null))).toBeNull();
    expect(poolLevel(c(5, null, null))).toBe('unknown');
  });

  it('상한이 0이면 나누지 않는다', () => {
    expect(usagePct(c(0, 0, 0))).toBeNull();
  });

  it('상한을 넘겨도 100 을 넘지 않는다', () => {
    // 막대가 칸 밖으로 삐져나가면 레이아웃이 깨진다.
    expect(usagePct(c(12, 0, 10))).toBe(100);
  });

  it('70%·90% 에서 단계가 올라간다', () => {
    expect(poolLevel(c(6, 4, 10))).toBe('ok');
    expect(poolLevel(c(7, 3, 10))).toBe('warn');
    expect(poolLevel(c(9, 1, 10))).toBe('full');
  });
});

describe('목록', () => {
  it('소진율 높은 것부터 놓는다', () => {
    // 열 개 중 하나만 찬 상황에서 그 하나가 가운데 묻히면 안 된다.
    const pools = buildPools(
      [
        { objHash: 1, objName: '/a/a/pool' },
        { objHash: 2, objName: '/b/b/pool' },
      ],
      new Map([
        [1, c(1, 9, 10)],
        [2, c(9, 1, 10)],
      ]),
    );
    expect(pools.map(p => p.objHash)).toEqual([2, 1]);
  });

  it('값이 아직 안 온 풀은 뒤로 보내되 버리지 않는다', () => {
    // 사라지면 «풀이 없다» 로 읽힌다.
    const pools = buildPools(
      [
        { objHash: 1, objName: '/a/a/pool' },
        { objHash: 2, objName: '/b/b/pool' },
      ],
      new Map([[2, c(1, 9, 10)]]),
    );
    expect(pools.map(p => p.objHash)).toEqual([2, 1]);
    expect(pools[1].max).toBeNull();
  });

  it('같은 소진율이면 순서가 흔들리지 않는다', () => {
    const entries = [
      { objHash: 1, objName: '/b/b/pool' },
      { objHash: 2, objName: '/a/a/pool' },
    ];
    const counters = new Map([
      [1, c(5, 5, 10)],
      [2, c(5, 5, 10)],
    ]);
    expect(buildPools(entries, counters).map(p => p.objName)).toEqual(['/a/a/pool', '/b/b/pool']);
    expect(buildPools([...entries].reverse(), counters).map(p => p.objName)).toEqual([
      '/a/a/pool',
      '/b/b/pool',
    ]);
  });
});
