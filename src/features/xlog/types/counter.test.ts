// 카운터 메타데이터 검증
//
// 근거: docs/asis/15-inventory-source-of-truth.md 1.1 / 1.2 (counters.xml 원본)

import { describe, it, expect } from 'vitest';
import {
  JAVAEE_COUNTERS,
  HOST_COUNTERS,
  HOST_CHART_COUNTERS,
  isJavaeeObjectType,
  isHostObjectType,
  counterFamily,
  counterMeta,
  isTotalCapable,
  DATASOURCE_CHART_COUNTERS,
} from './counter';

describe('isJavaeeObjectType', () => {
  it('tomcat 을 javaee 계열로 판정한다', () => {
    expect(isJavaeeObjectType('tomcat')).toBe(true);
  });

  it('counters.xml 의 javaee ObjectType 5종을 모두 판정한다', () => {
    for (const t of ['tomcat', 'java', 'jboss', 'jetty', 'resin']) {
      expect(isJavaeeObjectType(t)).toBe(true);
    }
  });

  // 호스트 에이전트가 함께 붙어 있을 때 이걸 골라버리면
  // TPS 요청이 조용히 0건이 된다 (verified-facts.md F-15).
  it('host 계열 ObjectType 을 javaee 로 판정하지 않는다', () => {
    for (const t of ['linux', 'windows', 'osx', 'host']) {
      expect(isJavaeeObjectType(t)).toBe(false);
    }
  });

  it('다른 Family 의 ObjectType 을 javaee 로 판정하지 않는다', () => {
    for (const t of ['batch', 'go', 'golang', 'aws', 'zipkin', 'cubridagent']) {
      expect(isJavaeeObjectType(t)).toBe(false);
    }
  });
});

describe('JAVAEE_COUNTERS', () => {
  it('counters.xml 의 javaee Family 카운터 19개를 담는다', () => {
    expect(Object.keys(JAVAEE_COUNTERS)).toHaveLength(19);
  });

  // Collector 는 이 이름을 그대로 받는다. 소문자로 보내면 0건이 온다
  // (live_collector.rs::live_counter_name_is_case_sensitive 로 실측 확인).
  it('카운터명이 counters.xml 표기와 정확히 일치한다', () => {
    expect(JAVAEE_COUNTERS).toHaveProperty('TPS');
    expect(JAVAEE_COUNTERS).toHaveProperty('ElapsedTime');
    expect(JAVAEE_COUNTERS).toHaveProperty('HeapUsed');
    expect(JAVAEE_COUNTERS).not.toHaveProperty('tps');
    expect(JAVAEE_COUNTERS).not.toHaveProperty('elapsed_avg');
  });
});

describe('isHostObjectType', () => {
  it('호스트 에이전트의 ObjectType 을 판정한다', () => {
    // Test/agent-host 는 obj_type=linux 로 붙는다 (live_host_counters 로 실측).
    for (const t of ['linux', 'windows', 'osx', 'aix', 'hpux', 'solaris']) {
      expect(isHostObjectType(t)).toBe(true);
    }
  });

  it('javaee 계열을 호스트로 판정하지 않는다', () => {
    for (const t of ['tomcat', 'java', 'jboss', 'jetty', 'resin']) {
      expect(isHostObjectType(t)).toBe(false);
    }
  });

  // 두 판정이 겹치면 같은 오브젝트에 양쪽 카운터를 요청하게 된다.
  it('javaee 판정과 겹치지 않는다', () => {
    for (const t of ['linux', 'windows', 'tomcat', 'java', 'batch', 'redis']) {
      expect(isHostObjectType(t) && isJavaeeObjectType(t)).toBe(false);
    }
  });
});

describe('HOST_COUNTERS', () => {
  it('counters.xml 의 host Family 카운터 24개를 담는다', () => {
    expect(Object.keys(HOST_COUNTERS)).toHaveLength(24);
  });

  it('카운터명이 counters.xml 표기와 정확히 일치한다', () => {
    expect(HOST_COUNTERS).toHaveProperty('Cpu');
    expect(HOST_COUNTERS).toHaveProperty('MemU');
    expect(HOST_COUNTERS).toHaveProperty('NetInBound');
    expect(HOST_COUNTERS).not.toHaveProperty('cpu');
    expect(HOST_COUNTERS).not.toHaveProperty('CPU');
  });

  // 24개를 다 띄우면 6개는 영영 "수신 없음" 으로 남는다.
  // live_host_counters 실측에서 값이 온 18개만 화면에 올린다.
  it('화면에 올리는 건 실측으로 값이 확인된 18개다', () => {
    expect(HOST_CHART_COUNTERS).toHaveLength(18);
  });

  it('화면 목록은 전부 실재하는 카운터명이다', () => {
    for (const c of HOST_CHART_COUNTERS) {
      expect(HOST_COUNTERS).toHaveProperty(c);
    }
  });

  // 이 환경에서 값이 오지 않은 것들 — 넣으면 빈 차트가 생긴다.
  it('값이 오지 않는 카운터는 화면 목록에서 뺀다', () => {
    for (const c of ['NetRxBytes', 'NetTxBytes', 'DiskReadBytes', 'DiskWriteBytes']) {
      expect(HOST_CHART_COUNTERS).not.toContain(c);
    }
  });
});

describe('counterMeta', () => {
  it('두 Family 어느 쪽이든 표시명과 단위를 준다', () => {
    expect(counterMeta('TPS')).toEqual({ disp: 'TPS', unit: 'tps' });
    expect(counterMeta('Cpu')).toEqual({ disp: 'CPU', unit: '%' });
  });

  // 차트가 meta.disp 를 바로 읽으므로 undefined 가 나오면 화면이 죽는다.
  it('모르는 이름에도 죽지 않고 이름 자체를 돌려준다', () => {
    expect(counterMeta('NoSuchCounter' as never)).toEqual({ disp: 'NoSuchCounter', unit: '' });
  });
});

describe('counterFamily', () => {
  it('카운터가 어느 Family 인지 알려준다', () => {
    expect(counterFamily('TPS')).toBe('javaee');
    expect(counterFamily('Cpu')).toBe('host');
  });

  // 모르는 이름을 조용히 javaee 로 넘기면 0건 응답의 원인을 못 찾는다.
  it('모르는 카운터는 null 이다', () => {
    expect(counterFamily('NoSuchCounter')).toBeNull();
  });
});

// counters.xml 의 `total="false"` 를 옮긴 것이다. 우리가 고른 목록이 아니므로
// 여기 값을 바꾸려면 counters.xml 을 근거로 대야 한다.
describe('isTotalCapable', () => {
  it('host Family 는 하나도 합계를 만들 수 없다', () => {
    // CPU 두 대를 더해 100% 라고 그리면 거짓이다. counters.xml 이 전부 total="false" 다.
    for (const c of HOST_CHART_COUNTERS) {
      expect(isTotalCapable(c), c).toBe(false);
    }
    expect(isTotalCapable('TcpStatSynSent')).toBe(false);
  });

  it('javaee 는 6개만 합계를 만들 수 있다', () => {
    const capable = Object.keys(JAVAEE_COUNTERS).filter(isTotalCapable);
    expect(capable.sort()).toEqual(
      ['ActiveService', 'ErrorRate', 'GcCount', 'RecentUser', 'ServiceCount', 'TPS'],
    );
  });

  it('커넥션 풀은 셋 다 가능하다', () => {
    for (const c of DATASOURCE_CHART_COUNTERS) {
      expect(isTotalCapable(c), c).toBe(true);
    }
  });

  it('모르는 이름은 가능하다고 하지 않는다', () => {
    expect(isTotalCapable('NoSuchCounter')).toBe(false);
  });
});
