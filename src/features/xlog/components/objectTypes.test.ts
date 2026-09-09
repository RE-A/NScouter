// 오브젝트 종류 식별
//
// 여기서 지키려는 것은 두 가지다.
//   1. **콜렉터가 준 값만 쓴다** — 이름을 파서 종류를 추측하지 않는다
//   2. **한 종류뿐이면 아무 말도 하지 않는다** — 모든 줄에 같은 글자를 붙이는 건 정보가 아니다

import { describe, expect, it } from 'vitest';
import { objectFamily, shouldShowTypes, typeCounts, typeLabel, typeTone, UNKNOWN_TYPE } from './objectTypes';
import type { AgentObject } from '../types/xlog';

function agent(name: string, type: string, alive = true): AgentObject {
  return {
    obj_hash: name.length * 31 + type.length,
    obj_name: name,
    obj_type: type,
    address: '10.0.0.1',
    version: '2.21.3',
    alive,
    wakeup: 0,
    tags: [],
  };
}

describe('objectFamily', () => {
  it('counters.xml 의 Family 로 가른다', () => {
    expect(objectFamily('tomcat')).toBe('javaee');
    expect(objectFamily('jboss')).toBe('javaee');
    expect(objectFamily('linux')).toBe('host');
    expect(objectFamily('datasource')).toBe('datasource');
  });

  it('처음 보는 종류는 null 이다', () => {
    // 현장은 objType 자리에 시스템 이름을 넣어 쓰기도 한다(CJFW · PRD-ORD).
    // 그걸 억지로 어느 Family 에 넣으면 **틀린 색**이 붙는다 — 모른다고 두는 편이 낫다.
    expect(objectFamily('CJFW')).toBeNull();
    expect(objectFamily('reqproc')).toBeNull();
  });
});

describe('typeCounts', () => {
  it('이름순으로 고정한다', () => {
    // 개수순으로 정렬하면 10초마다 목록을 다시 받을 때 칩이 자리를 바꾼다.
    const rows = typeCounts([
      agent('/h/a', 'tomcat'),
      agent('/h/b', 'linux'),
      agent('/h/c', 'tomcat'),
      agent('/h/d', 'datasource'),
    ]);
    expect(rows.map(r => r.type)).toEqual(['datasource', 'linux', 'tomcat']);
    expect(rows.find(r => r.type === 'tomcat')?.count).toBe(2);
  });

  it('죽은 것도 세되 활성과 나눠 센다', () => {
    const rows = typeCounts([agent('/h/a', 'tomcat'), agent('/h/b', 'tomcat', false)]);
    expect(rows[0]).toEqual({ type: 'tomcat', count: 2, aliveCount: 1 });
  });

  it('objType 이 비어 와도 목록에서 사라지지 않는다', () => {
    // 목록에는 떠 있는데 칩에서만 빠지면 «칩을 다 켰는데 왜 저게 남나» 가 된다.
    const rows = typeCounts([agent('/h/a', '')]);
    expect(rows.map(r => r.type)).toEqual([UNKNOWN_TYPE]);
    expect(typeLabel('')).toBe(UNKNOWN_TYPE);
  });
});

describe('shouldShowTypes', () => {
  it('한 종류뿐이면 말하지 않는다', () => {
    expect(shouldShowTypes([agent('/h/a', 'tomcat'), agent('/h/b', 'tomcat')])).toBe(false);
    expect(shouldShowTypes([])).toBe(false);
  });

  it('둘 이상이면 말한다', () => {
    expect(shouldShowTypes([agent('/h/a', 'tomcat'), agent('/h/b', 'linux')])).toBe(true);
  });
});

describe('typeTone', () => {
  it('Family 마다 다른 색을 준다', () => {
    const tones = new Set([typeTone('tomcat'), typeTone('linux'), typeTone('datasource')]);
    expect(tones.size).toBe(3);
  });

  it('모르는 종류도 색이 없어지지 않는다', () => {
    // 클래스가 비면 배지 글자가 부모 색을 그대로 받아 이름과 구별되지 않는다.
    expect(typeTone('CJFW')).not.toBe('');
  });
});
