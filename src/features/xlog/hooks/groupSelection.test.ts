// 그룹 선택의 계약
//
// **고른 것은 그룹 이름이지 그 순간의 해시가 아니다.** 고를 때의 해시를 집어넣으면
// ECS 에서 Task 가 갈릴 때마다 틀어진다 — 새 Task 는 안 들어오고 죽은 Task 는 남는다.
// 해시는 명단이 갱신될 때마다 **다시 푼다.**
//
// 여기서 지키려는 것:
//   · 새 Task 가 뜨면 다시 안 골라도 들어온다
//   · 죽은 Task 는 조회 대상에 안 넣는다 (콜렉터가 매번 빈손을 돌려준다)
//   · 그룹과 낱개를 같이 골라도 두 번 세지 않는다
//   · 고른 그룹이 통째로 사라진 것과 «아무것도 안 골랐다» 는 다른 일이다

import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  pickTask,
  resolveSelection,
  selectionState,
  toggleHash,
  toggleService,
} from './groupSelection';
import { DEFAULT_GROUP_RULE } from '../components/instanceGroup';
import type { AgentObject } from '../types/xlog';

function task(n: number, alive = true, svc = 'SAFS'): AgentObject {
  return {
    obj_hash: n,
    obj_type: 'tomcat',
    obj_name: `/CJFW/${svc}-ip-10-0-0-${n}`,
    address: '',
    version: '',
    alive,
    wakeup: 0,
    tags: [],
  };
}

const RULE = DEFAULT_GROUP_RULE;

describe('그룹을 고른다', () => {
  it('그 그룹의 Task 가 전부 대상이 된다', () => {
    const sel = toggleService(EMPTY_SELECTION, 'SAFS');
    const got = resolveSelection(sel, [task(1), task(2)], RULE);
    expect([...got].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('새 Task 가 뜨면 다시 안 골라도 들어온다 — ECS 에서는 Task 가 계속 갈린다', () => {
    const sel = toggleService(EMPTY_SELECTION, 'SAFS');
    expect(resolveSelection(sel, [task(1), task(2)], RULE).size).toBe(2);
    expect(resolveSelection(sel, [task(1), task(2), task(3)], RULE).size).toBe(3);
  });

  it('죽은 Task 는 안 넣는다 — 콜렉터가 매번 빈손을 돌려준다', () => {
    const sel = toggleService(EMPTY_SELECTION, 'SAFS');
    const got = resolveSelection(sel, [task(1), task(2, false)], RULE);
    expect([...got]).toEqual([1]);
  });

  it('한 번 더 누르면 풀린다', () => {
    const sel = toggleService(toggleService(EMPTY_SELECTION, 'SAFS'), 'SAFS');
    expect(resolveSelection(sel, [task(1)], RULE).size).toBe(0);
  });
});

describe('낱개로 고른다', () => {
  it('펼쳐서 특정 Task 만 고를 수 있다', () => {
    const sel = toggleHash(EMPTY_SELECTION, 2);
    expect([...resolveSelection(sel, [task(1), task(2)], RULE)]).toEqual([2]);
  });

  it('그룹과 낱개를 같이 골라도 두 번 세지 않는다', () => {
    const sel = toggleHash(toggleService(EMPTY_SELECTION, 'SAFS'), 1);
    expect(resolveSelection(sel, [task(1), task(2)], RULE).size).toBe(2);
  });

  it('목록에서 사라진 낱개는 빠진다 — 없는 것을 조회하면 매번 빈손이다', () => {
    const sel = toggleHash(EMPTY_SELECTION, 9);
    expect(resolveSelection(sel, [task(1)], RULE).size).toBe(0);
  });

  it('죽은 Task 를 낱개로 골라도 조회하지는 않는다', () => {
    const sel = toggleHash(EMPTY_SELECTION, 1);
    expect(resolveSelection(sel, [task(1, false)], RULE).size).toBe(0);
  });
});

describe('고른 상태가 무엇을 뜻하나', () => {
  it('아무것도 안 골랐으면 none', () => {
    expect(selectionState(EMPTY_SELECTION, [task(1)], RULE)).toBe('none');
  });

  it('골랐는데 살아 있는 Task 가 없으면 empty-group — «안 골랐다» 와 다른 일이다', () => {
    const sel = toggleService(EMPTY_SELECTION, 'SAFS');
    expect(selectionState(sel, [task(1, false)], RULE)).toBe('empty-group');
  });

  it('살아 있는 것이 있으면 ok', () => {
    const sel = toggleService(EMPTY_SELECTION, 'SAFS');
    expect(selectionState(sel, [task(1)], RULE)).toBe('ok');
  });

  it('고른 서비스가 목록에서 통째로 사라져도 empty-group — 비었다고 말해야 한다', () => {
    const sel = toggleService(EMPTY_SELECTION, 'GONE');
    expect(selectionState(sel, [task(1)], RULE)).toBe('empty-group');
  });
});

describe('그룹을 펼쳐 특정 Task 만 고른다', () => {
  const three = [task(1), task(2), task(3)];

  it('그룹이 켜진 채로 한 대를 끄면 그 대만 빠진다', () => {
    const sel = pickTask(toggleService(EMPTY_SELECTION, 'SAFS'), task(2), three, RULE);
    expect([...resolveSelection(sel, three, RULE)].sort((a, b) => a - b)).toEqual([1, 3]);
  });

  it('끄고 나면 그 서비스는 더 이상 자동으로 안 따라간다 — 낱개를 고른 것이다', () => {
    const sel = pickTask(toggleService(EMPTY_SELECTION, 'SAFS'), task(2), three, RULE);
    const grown = [...three, task(4)];
    expect(resolveSelection(sel, grown, RULE).has(4)).toBe(false);
  });

  it('그룹을 안 켠 상태면 그냥 낱개 토글이다', () => {
    const sel = pickTask(EMPTY_SELECTION, task(1), three, RULE);
    expect([...resolveSelection(sel, three, RULE)]).toEqual([1]);
  });
});
