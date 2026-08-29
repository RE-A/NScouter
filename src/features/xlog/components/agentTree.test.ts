// 에이전트 목록 묶기·찾기
//
// 실환경 161개를 다루는 화면이라 **정렬이 흔들리지 않는 것**이 기능만큼 중요하다.
// 10초마다 목록을 다시 받는데 그때마다 순서가 바뀌면 누르려던 항목이 도망간다.

import { describe, it, expect } from 'vitest';
import { groupAgents, groupNameOf, shortName } from './agentTree';
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

describe('shortName', () => {
  it('경로의 마지막 마디를 쓴다', () => {
    expect(shortName('/CJFW/PRD-FSCP/FDMKT-BO')).toBe('FDMKT-BO');
    expect(shortName('shop-app')).toBe('shop-app');
  });

  it('경로만 있어도 빈 문자열을 내지 않는다', () => {
    // 빈 이름은 화면에서 클릭할 수 없는 행이 된다
    expect(shortName('/')).toBe('/');
  });
});

describe('groupAgents', () => {
  const list = [
    agent('/CJFW/PRD-FSCP/FDMKT-BO', 'CJFW'),
    agent('/CJFW/PRD-FSCP/SMARTRS_BO', 'CJFW', false),
    agent('/host/fwpwmswas02', 'linux'),
    agent('/pool/iammanager_jdbc', 'datasource'),
    agent('/CJFW_QA/FRESHN_QA', 'CJFW_QA'),
  ];

  it('타입으로 묶는다', () => {
    const groups = groupAgents(list, '');
    expect(groups.map(g => g.type)).toEqual(['CJFW', 'CJFW_QA', 'datasource', 'linux']);
    expect(groups[0].agents).toHaveLength(2);
  });

  it('그룹은 이름순이다 — 살아있는 수로 정렬하면 10초마다 목록이 춤춘다', () => {
    const groups = groupAgents(list, '');
    const sorted = [...groups.map(g => g.type)].sort((a, b) => a.localeCompare(b));
    expect(groups.map(g => g.type)).toEqual(sorted);
  });

  it('그룹 안은 살아있는 것이 먼저다', () => {
    const [cjfw] = groupAgents(list, '');
    expect(cjfw.agents.map(a => a.alive)).toEqual([true, false]);
    expect(cjfw.aliveCount).toBe(1);
  });

  it('이름 일부로 찾는다 (대소문자 무시)', () => {
    const groups = groupAgents(list, 'fdmkt');
    expect(groups).toHaveLength(1);
    expect(groups[0].agents.map(a => shortName(a.obj_name))).toEqual(['FDMKT-BO']);
  });

  it('경로 중간 마디로도 찾는다', () => {
    // 짧은 이름만 보면 `/PRD-FSCP/` 같은 마디로는 못 찾는다
    const groups = groupAgents(list, 'prd-fscp');
    expect(groups[0].agents).toHaveLength(2);
  });

  it('타입으로 찾으면 그 묶음이 통째로 나온다', () => {
    const groups = groupAgents(list, 'cjfw');
    expect(groups.map(g => g.type)).toEqual(['CJFW', 'CJFW_QA']);
  });

  it('빈 검색어는 전부다', () => {
    expect(groupAgents(list, '   ').reduce((n, g) => n + g.agents.length, 0)).toBe(list.length);
  });

  it('못 찾으면 빈 목록이다', () => {
    expect(groupAgents(list, '없는이름')).toEqual([]);
  });

  it('타입이 비어 있어도 묶음을 만든다', () => {
    // 화면에서 사라지면 그 오브젝트는 영영 못 고른다
    const groups = groupAgents([agent('/x/y', '')], '');
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe('(unknown)');
  });
});

describe('groupNameOf', () => {
  it('첫 마디(호스트)가 그룹이다', () => {
    // Scouter 의 이름 규칙이 `/{host}/{name}` 이다. ASIS 도 같은 자리를 자른다.
    expect(groupNameOf('/CJFW/PRD-FSCP/FDMKT-BO')).toBe('/CJFW');
    expect(groupNameOf('/order-app/order-app')).toBe('/order-app');
  });

  it('**앱과 그 앱의 datasource 가 한 묶음이다**', () => {
    // 부모 경로로 자르면 이 둘이 갈라져 1개짜리 묶음만 생긴다(화면에서 확인했다)
    expect(groupNameOf('/order-app/order-app')).toBe(
      groupNameOf('/order-app/order-app/HikariPool-1'),
    );
  });

  it('호스트가 다르면 다른 묶음이다', () => {
    expect(groupNameOf('/order-app/order-app')).not.toBe(groupNameOf('/shop-app/shop-app'));
  });

  it('마디가 하나뿐이면 속한 곳이 없다', () => {
    // ASIS 는 여기서 substring(0, -1) 로 터진다
    expect(groupNameOf('/solo')).toBe('(그룹 없음)');
    expect(groupNameOf('solo')).toBe('(그룹 없음)');
    expect(groupNameOf('')).toBe('(그룹 없음)');
  });

  it('슬래시가 겹쳐도 같다', () => {
    expect(groupNameOf('/A/B/C/')).toBe('/A');
    expect(groupNameOf('//A//B//C')).toBe('/A');
  });
});

describe('groupAgents — 묶는 기준', () => {
  const agents = [
    agent('/CJFW/PRD-FSCP/FDMKT-BO', 'tomcat'),
    agent('/CJFW/PRD-FSCP/FDMKT-FO', 'tomcat'),
    agent('/CJFW/PRD-ORD/ORDER-BO', 'tomcat'),
    agent('/CJFW/PRD-ORD/ORDER-BO', 'datasource'),
  ];

  it('타입으로 묶으면 종류별이다', () => {
    const g = groupAgents(agents, '', 'type');
    expect(g.map(x => x.type)).toEqual(['datasource', 'tomcat']);
    expect(g.find(x => x.type === 'tomcat')!.agents).toHaveLength(3);
  });

  it('그룹으로 묶으면 호스트별이다', () => {
    const g = groupAgents(agents, '', 'group');
    expect(g.map(x => x.type)).toEqual(['/CJFW']);
    // 같은 호스트면 타입이 달라도 한 묶음이다 — 그게 이 기준의 요점이다
    expect(g[0].agents).toHaveLength(4);
  });

  it('기준을 안 주면 예전처럼 타입이다', () => {
    expect(groupAgents(agents, '').map(x => x.type)).toEqual(
      groupAgents(agents, '', 'type').map(x => x.type),
    );
  });

  it('검색은 기준과 무관하게 걸린다', () => {
    const g = groupAgents(agents, 'ORDER', 'group');
    expect(g).toHaveLength(1);
    expect(g[0].agents).toHaveLength(2);
  });
});
