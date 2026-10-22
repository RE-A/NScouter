// 오브젝트 기록의 계약
//
// 알림 판정(교체냐 장애냐)과 과거 조회(그때 어떤 Task 가 있었나)가 이 기록에 기댄다.
//   · 처음 받은 목록의 것은 «원래 있던 것»(firstSeen 0) — 언제 떴는지 모른다
//   · 그 뒤에 나타난 것은 나타난 때를 적는다
//   · 죽은 것의 lastAlive 는 콜렉터의 wakeup(마지막 하트비트)이다
//   · 목록에서 사라져도(정리) 지우지 않는다

import { beforeEach, describe, expect, it } from 'vitest';
import { asAgent, clearObjectHistory, objectHistory, observeObjects } from './objectTimeline';
import type { AgentObject } from '../types/xlog';

function obj(hash: number, alive: boolean, wakeup = 0, name = `/vm/safs-ip-10-0-0-${hash}`): AgentObject {
  return { obj_hash: hash, obj_type: 'tomcat', obj_name: name, address: '', version: '', alive, wakeup, tags: [] };
}

beforeEach(() => clearObjectHistory());

describe('objectTimeline', () => {
  it('처음 받은 목록의 것은 firstSeen 이 0 이다 — 이 앱이 보기 전부터 있었다', () => {
    observeObjects([obj(1, true)], 1_000);
    expect(objectHistory().get(1)?.firstSeen).toBe(0);
  });

  it('나중에 나타난 것은 나타난 때를 적는다', () => {
    observeObjects([obj(1, true)], 1_000);
    observeObjects([obj(1, true), obj(2, true)], 5_000);
    expect(objectHistory().get(2)?.firstSeen).toBe(5_000);
    // 이미 본 것의 firstSeen 은 안 바뀐다
    observeObjects([obj(1, true), obj(2, true)], 9_000);
    expect(objectHistory().get(2)?.firstSeen).toBe(5_000);
  });

  it('살아 있으면 lastAlive 는 본 시각, 죽으면 콜렉터의 wakeup 이다', () => {
    observeObjects([obj(1, true)], 1_000);
    expect(objectHistory().get(1)?.lastAlive).toBe(1_000);
    observeObjects([obj(1, false, 1_500)], 3_000);
    expect(objectHistory().get(1)?.lastAlive).toBe(1_500);
    expect(objectHistory().get(1)?.alive).toBe(false);
  });

  it('죽은 뒤 wakeup 이 0 으로 와도 알던 lastAlive 를 잃지 않는다', () => {
    observeObjects([obj(1, true)], 1_000);
    observeObjects([obj(1, false, 0)], 3_000);
    expect(objectHistory().get(1)?.lastAlive).toBe(1_000);
  });

  it('목록에서 사라져도 지우지 않는다 — 정리된 Task 도 그날 판정에 필요하다', () => {
    observeObjects([obj(1, true), obj(2, true)], 1_000);
    observeObjects([obj(2, true)], 2_000);
    expect(objectHistory().has(1)).toBe(true);
  });

  it('빈 이름으로 덮지 않는다', () => {
    observeObjects([obj(1, true)], 1_000);
    observeObjects([obj(1, true, 0, '')], 2_000);
    expect(objectHistory().get(1)?.obj_name).toBe('/vm/safs-ip-10-0-0-1');
  });

  it('비우면 다음 목록이 다시 «처음 받은 목록» 이다', () => {
    observeObjects([obj(1, true)], 1_000);
    clearObjectHistory();
    observeObjects([obj(2, true)], 9_000);
    expect(objectHistory().has(1)).toBe(false);
    expect(objectHistory().get(2)?.firstSeen).toBe(0);
  });

  it('asAgent 는 마지막 상태를 오브젝트 모양으로 돌려준다', () => {
    observeObjects([obj(1, false, 700)], 1_000);
    const a = asAgent(objectHistory().get(1)!);
    expect(a).toMatchObject({ obj_hash: 1, alive: false, wakeup: 700, obj_name: '/vm/safs-ip-10-0-0-1' });
  });
});
