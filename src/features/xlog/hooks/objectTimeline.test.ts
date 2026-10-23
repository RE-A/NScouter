// 오브젝트 기록의 계약
//
// 알림 판정(교체냐 장애냐)과 과거 조회(그때 어떤 Task 가 있었나)가 이 기록에 기댄다.
//   · 처음 받은 목록의 것은 «원래 있던 것»(firstSeen 0) — 언제 떴는지 모른다
//   · 그 뒤에 나타난 것은 나타난 때를 적는다
//   · 죽은 것의 lastAlive 는 콜렉터의 wakeup(마지막 하트비트)이다
//   · 목록에서 사라져도(정리) 지우지 않는다
//   · 파일에 남긴 것은 죽은 것으로 되살리고, 지금 본 것을 덮지 않는다

import { beforeEach, describe, expect, it } from 'vitest';
import {
  HISTORY_KEEP_MAX,
  HISTORY_KEEP_MS,
  asAgent,
  clearObjectHistory,
  objectHistory,
  observeObjects,
  persistableHistory,
  restoreObjectHistory,
} from './objectTimeline';
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

describe('껐다 켜도 남기기', () => {
  const DAY = 24 * 60 * 60_000;
  const NOW = 1_800_000_000_000;

  it('남긴 것을 되살리면 처음 본 때·마지막으로 살던 때가 그대로다 — 살아 있는지는 모르니 죽은 것으로', () => {
    observeObjects([obj(1, true)], NOW - 10_000);
    observeObjects([obj(1, true), obj(2, true)], NOW);
    const saved = JSON.parse(JSON.stringify(persistableHistory(NOW))) as unknown;

    clearObjectHistory();
    expect(restoreObjectHistory(saved)).toBe(2);
    expect(objectHistory().get(2)).toMatchObject({ firstSeen: NOW, lastAlive: NOW, alive: false });
    expect(objectHistory().get(1)).toMatchObject({ firstSeen: 0, alive: false });
  });

  it('되살린 뒤 목록에 다시 보이면 살리고, 처음 본 때는 남긴 것을 쓴다', () => {
    observeObjects([obj(1, true)], NOW - 10_000);
    observeObjects([obj(1, true), obj(2, true)], NOW);
    const saved = persistableHistory(NOW);

    clearObjectHistory();
    restoreObjectHistory(saved);
    observeObjects([obj(2, true), obj(3, true)], NOW + DAY);
    expect(objectHistory().get(2)).toMatchObject({ firstSeen: NOW, lastAlive: NOW + DAY, alive: true });
    // 파일에 없던 것은 첫 목록의 것 — «원래 있던 것» 이다
    expect(objectHistory().get(3)?.firstSeen).toBe(0);
  });

  it('지금 본 것은 파일이 덮지 않는다 — 목록이 파일보다 먼저 와도', () => {
    observeObjects([obj(1, true)], NOW);
    restoreObjectHistory([{ ...objectHistory().get(1), lastAlive: 5, alive: false }]);
    expect(objectHistory().get(1)).toMatchObject({ lastAlive: NOW, alive: true });
  });

  it('오래된 것은 안 남기고, 많으면 최근에 살던 것부터 자른다', () => {
    observeObjects([obj(1, true)], NOW - HISTORY_KEEP_MS - 1);
    observeObjects([obj(1, false, NOW - HISTORY_KEEP_MS - 1), obj(2, true)], NOW);
    expect(persistableHistory(NOW).map(s => s.obj_hash)).toEqual([2]);

    clearObjectHistory();
    observeObjects(Array.from({ length: HISTORY_KEEP_MAX + 10 }, (_, i) => obj(i + 1, false, NOW - i)), NOW);
    const kept = persistableHistory(NOW);
    expect(kept).toHaveLength(HISTORY_KEEP_MAX);
    expect(kept[0].obj_hash).toBe(1);
  });

  it('모양이 틀린 것은 건너뛴다', () => {
    expect(restoreObjectHistory(null)).toBe(0);
    expect(restoreObjectHistory({})).toBe(0);
    expect(restoreObjectHistory([
      { obj_hash: '1' },
      { obj_hash: 7, obj_name: 'x', obj_type: 't', firstSeen: 0, lastAlive: 1, tags: [['a', 'b'], ['bad']] },
    ])).toBe(1);
    expect(objectHistory().get(7)?.tags).toEqual([['a', 'b']]);
  });
});
