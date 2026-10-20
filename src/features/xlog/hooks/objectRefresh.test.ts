// 오브젝트 목록 합치기의 계약
//
// ECS 에서는 Task 가 재배포·오토스케일로 수시로 뜨고 진다. 명단을 사진처럼 한 번 찍어
// 두면 금방 틀어지므로 주기적으로 다시 읽는데, **읽은 것을 그대로 갈아 끼우면** 재배포
// 중 몇 초 비는 사이에 화면에서 서버가 통째로 사라진다 — 그건 «장애» 로 읽힌다.
//
// 여기서 지키려는 것:
//   · 새 Task 는 바로 들어온다
//   · 사라진 Task 는 **잠시 죽은 채로** 남는다 (바로 지우지 않는다)
//   · 그래도 영원히 쌓이지는 않는다
//   · 되돌아오면 다시 살아난다

import { describe, expect, it } from 'vitest';
import { mergeObjects, TERMINATED_KEEP_MS } from './objectRefresh';
import type { AgentObject } from '../types/xlog';

const NOW = 1_700_000_000_000;

function agent(obj_hash: number, alive = true, wakeup = NOW): AgentObject {
  return {
    obj_hash,
    obj_type: 'tomcat',
    obj_name: `/CJFW/SAFS-ip-10-0-0-${obj_hash}`,
    address: '',
    version: '',
    alive,
    wakeup,
    tags: [],
  };
}

describe('오브젝트 목록 합치기', () => {
  it('새 Task 는 바로 들어온다', () => {
    const out = mergeObjects([agent(1)], [agent(1), agent(2)], NOW, TERMINATED_KEEP_MS);
    expect(out.map(a => a.obj_hash).sort()).toEqual([1, 2]);
  });

  it('사라진 Task 는 잠시 죽은 채로 남는다 — 재배포 중 몇 초를 장애로 읽으면 안 된다', () => {
    const out = mergeObjects([agent(1), agent(2)], [agent(1)], NOW + 1_000, TERMINATED_KEEP_MS);
    const gone = out.find(a => a.obj_hash === 2);
    expect(gone).toBeDefined();
    expect(gone?.alive).toBe(false);
  });

  it('오래 지난 것은 버린다 — 안 그러면 명단이 영원히 는다', () => {
    const out = mergeObjects(
      [agent(1), agent(2)],
      [agent(1)],
      NOW + TERMINATED_KEEP_MS + 1,
      TERMINATED_KEEP_MS,
    );
    expect(out.map(a => a.obj_hash)).toEqual([1]);
  });

  it('되돌아온 Task 는 다시 살아난다', () => {
    const once = mergeObjects([agent(1), agent(2)], [agent(1)], NOW + 1_000, TERMINATED_KEEP_MS);
    const back = mergeObjects(once, [agent(1), agent(2)], NOW + 2_000, TERMINATED_KEEP_MS);
    expect(back.find(a => a.obj_hash === 2)?.alive).toBe(true);
  });

  it('새로 받은 값이 이긴다 — 이름이 바뀌었으면 바뀐 이름을 쓴다', () => {
    const renamed = { ...agent(1), obj_name: '/CJFW/SAFS-ip-10-0-0-9' };
    const out = mergeObjects([agent(1)], [renamed], NOW, TERMINATED_KEEP_MS);
    expect(out[0].obj_name).toBe('/CJFW/SAFS-ip-10-0-0-9');
  });

  it('죽은 채로 받은 것도 그대로 둔다 — 콜렉터가 알려 준 상태다', () => {
    const out = mergeObjects([], [agent(3, false)], NOW, TERMINATED_KEEP_MS);
    expect(out[0].alive).toBe(false);
  });
});
