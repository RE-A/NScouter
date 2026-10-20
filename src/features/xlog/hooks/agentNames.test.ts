// 오브젝트 이름 캐시의 계약
//
// 이름은 **목록보다 오래 살아야 한다.** 오브젝트가 목록에서 사라져도 그 오브젝트가 남긴
// XLog 는 화면에 그대로 있다 — 그때 이름을 못 풀면 `#해시` 로 덮인다.
//
// 콜렉터는 죽은 오브젝트를 영원히 들고 있지만(F-60), 비활성 정리를 하면 지워진다.
// 정리는 `ObjectWR`(오늘자 오브젝트 DB)까지 건드려서 **오늘 받은 XLog 의 이름이 끊긴다.**
// ASIS 가 `TextProxy.object.putText` 로 이름만 따로 영구 보관하는 이유가 그것이다.
//
// 여기서 지키려는 것:
//   · 한 번 본 이름은 목록에서 사라져도 남는다
//   · 콜렉터를 갈아타면 비운다 — 해시는 이름의 해시라 서버가 달라도 겹친다 (F-35)

import { beforeEach, describe, expect, it } from 'vitest';
import { clearNames, nameOf, rememberNames } from './agentNames';
import type { AgentObject } from '../types/xlog';

function agent(obj_hash: number, obj_name: string): AgentObject {
  return {
    obj_hash,
    obj_type: 'tomcat',
    obj_name,
    address: '',
    version: '',
    alive: true,
    wakeup: 0,
    tags: [],
  };
}

beforeEach(() => clearNames());

describe('이름 캐시', () => {
  it('한 번 본 이름은 목록에서 사라져도 남는다', () => {
    rememberNames([agent(1, '/CJFW/SAFS-ip-10-0-0-1')]);
    // 다음 갱신에서 그 오브젝트가 빠졌다 (정리했거나 콜렉터가 버렸다)
    rememberNames([agent(2, '/CJFW/SAFS-ip-10-0-0-2')]);
    expect(nameOf(1)).toBe('/CJFW/SAFS-ip-10-0-0-1');
  });

  it('모르는 해시는 undefined — 지어내지 않는다', () => {
    expect(nameOf(99)).toBeUndefined();
  });

  it('이름이 바뀌면 새 이름으로 갱신한다', () => {
    rememberNames([agent(1, '/CJFW/OLD')]);
    rememberNames([agent(1, '/CJFW/NEW')]);
    expect(nameOf(1)).toBe('/CJFW/NEW');
  });

  it('빈 이름은 담지 않는다 — 빈 칸으로 덮으면 있던 이름까지 잃는다', () => {
    rememberNames([agent(1, '/CJFW/SAFS')]);
    rememberNames([agent(1, '')]);
    expect(nameOf(1)).toBe('/CJFW/SAFS');
  });

  it('콜렉터를 갈아타면 비운다 — 해시는 이름의 해시라 서버가 달라도 겹친다 (F-35)', () => {
    rememberNames([agent(1, '/DEV/SAFS')]);
    clearNames();
    expect(nameOf(1)).toBeUndefined();
  });
});
