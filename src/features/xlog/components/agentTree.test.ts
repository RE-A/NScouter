// 에이전트 목록 묶기·찾기
//
// 실환경 161개를 다루는 화면이라 **정렬이 흔들리지 않는 것**이 기능만큼 중요하다.
// 10초마다 목록을 다시 받는데 그때마다 순서가 바뀌면 누르려던 항목이 도망간다.

import { describe, it, expect } from 'vitest';
import { groupAgents, shortName } from './agentTree';
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
