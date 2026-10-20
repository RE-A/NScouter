// 인스턴스 묶기의 계약
//
// ECS 에서는 같은 애플리케이션이 Task 여러 개로 뜬다. 이름을 유니크하게 나누고 나면
// 이번엔 **같은 서비스가 여러 줄로 흩어진다** — 전체 상황을 한눈에 볼 수가 없다.
// 그래서 물리 인스턴스(Task) 위에 논리 서비스를 얹는다.
//
// 여기서 지키려는 것:
//   · 우선순위 — **명시적 태그 > 이름 규칙** (태그가 있으면 그게 사실이다)
//   · 규칙에 안 걸리면 **조용히 묶지 않는다** (묶인 척하면 어느 서비스인지 거짓이 된다)
//   · 설정 파일이 깨져 있어도 던지지 않는다
//   · **한 대짜리는 그룹을 만들지 않는다** — 묶을 것이 없는데 깊이만 한 겹 는다

import { describe, expect, it } from 'vitest';
import { DEFAULT_GROUP_RULE, groupByService, instanceLabel, serviceNameOf } from './instanceGroup';
import type { AgentObject } from '../types/xlog';

function agent(obj_name: string, tags: [string, string][] = [], alive = true): AgentObject {
  return {
    obj_hash: Math.abs(hash(obj_name)),
    obj_type: 'tomcat',
    obj_name,
    address: '',
    version: '',
    alive,
    wakeup: 0,
    tags,
  };
}

/** 시험용 해시 — 이름이 다르면 해시도 달라야 묶음 수를 셀 수 있다 */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

describe('논리 서비스 이름', () => {
  it('태그가 있으면 태그가 이긴다 — 에이전트가 직접 말한 것이 가장 정확하다', () => {
    const a = agent('SAFS-ip-10-75-113-103', [['service', 'SAFS-API']]);
    expect(serviceNameOf(a, DEFAULT_GROUP_RULE)).toBe('SAFS-API');
  });

  it('태그가 없으면 이름 규칙으로 뽑는다', () => {
    const a = agent('/CJFW_QA/SAFS-ip-10-75-113-103.ap-northeast-2.compute.internal');
    expect(serviceNameOf(a, DEFAULT_GROUP_RULE)).toBe('SAFS');
  });

  it('규칙에 안 걸리면 null — 묶이지 않았다는 것이 드러나야 한다', () => {
    expect(serviceNameOf(agent('/CJFW/jdbc_SAFS_R'), DEFAULT_GROUP_RULE)).toBeNull();
  });

  it('빈 태그 값은 없는 것으로 본다 — 빈 이름으로 묶으면 전부 한 덩어리가 된다', () => {
    const a = agent('/CJFW/SAFS-ip-10-0-0-1', [['service', '  ']]);
    expect(serviceNameOf(a, DEFAULT_GROUP_RULE)).toBe('SAFS');
  });

  it('정규식이 깨져 있어도 던지지 않는다 — 설정 파일은 사람이 여는 곳이다', () => {
    expect(serviceNameOf(agent('SAFS-ip-1'), { tagKey: 'service', pattern: '([' })).toBeNull();
  });

  it('캡처 그룹이 없는 규칙이면 묶지 않는다 — 무엇을 이름으로 쓸지 모른다', () => {
    expect(serviceNameOf(agent('SAFS-ip-1'), { tagKey: 'service', pattern: 'SAFS' })).toBeNull();
  });
});

describe('서비스로 묶기', () => {
  it('같은 서비스의 여러 Task 를 한 묶음으로 센다', () => {
    const g = groupByService(
      [agent('/CJFW/SAFS-ip-10-0-0-1'), agent('/CJFW/SAFS-ip-10-0-0-2')],
      DEFAULT_GROUP_RULE,
    );
    expect(g.get('SAFS')).toHaveLength(2);
  });

  it('한 대짜리는 그룹을 만들지 않는다 — 깊이만 한 겹 는다', () => {
    expect(groupByService([agent('/CJFW/SOLO-ip-10-0-0-1')], DEFAULT_GROUP_RULE).size).toBe(0);
  });

  it('규칙에 안 걸린 것은 묶음에 안 넣는다 — 부르는 쪽이 평평하게 보여준다', () => {
    const g = groupByService(
      [agent('/CJFW/jdbc_A'), agent('/CJFW/jdbc_B')],
      DEFAULT_GROUP_RULE,
    );
    expect(g.size).toBe(0);
  });

  it('죽은 Task 도 묶음에는 들어간다 — 조회 대상에서 빼는 것은 고르는 쪽 일이다', () => {
    const g = groupByService(
      [agent('/CJFW/SAFS-ip-10-0-0-1'), agent('/CJFW/SAFS-ip-10-0-0-2', [], false)],
      DEFAULT_GROUP_RULE,
    );
    expect(g.get('SAFS')).toHaveLength(2);
  });
});

describe('줄에 적을 인스턴스 이름', () => {
  it('서비스 부분을 뗀다 — 그룹으로 보면 줄마다 같은 말이 반복된다', () => {
    expect(
      instanceLabel('/CJFW_QA/SAFS-ip-10-75-113-103.ap-northeast-2.compute.internal', DEFAULT_GROUP_RULE),
    ).toBe('ip-10-75-113-103.ap-northeast-2.compute.internal');
  });

  it('묶이지 않은 것은 짧은 이름을 그대로 쓴다 — 빈 칸은 «못 받았다» 로 읽힌다', () => {
    expect(instanceLabel('/CJFW/jdbc_SAFS_R', DEFAULT_GROUP_RULE)).toBe('jdbc_SAFS_R');
  });

  it('떼고 나서 빈 이름이 되면 짧은 이름을 쓴다', () => {
    expect(instanceLabel('/CJFW/SAFS', { tagKey: 'x', pattern: '^(SAFS)' })).toBe('SAFS');
  });
});
