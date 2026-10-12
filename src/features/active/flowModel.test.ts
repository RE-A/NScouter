// 흐르는 트래픽 — **들어오고, 머물고, 빠져나가는가.**
//
// 화면에 있는 점은 지금 돌고 있는 것뿐이다. 그래서 «사라졌다» 를 어떻게 다루느냐가
// 이 그림의 전부다 — 끝난 것은 오른쪽으로 내보내고, 다 나간 뒤에 지운다.

import { describe, expect, it } from 'vitest';
import {
  advanceTracks,
  elapsedNow,
  holdingCount,
  holdX,
  neededYMax,
  nextYMax,
  niceCeil,
  pickNearest,
  settleTracks,
  toDot,
  ENTER_MS,
  LEAVE_MS,
  MIN_Y_MS,
  type Track,
} from './flowModel';
import type { ActiveService } from '../xlog/types/object';

const NOW = 1_700_000_000_000;

function row(id: number, elapsed: number, o: Partial<ActiveService> = {}): ActiveService {
  return {
    obj_hash: 1,
    id,
    name: `exec-${id}`,
    service: '/shop',
    stat: 'RUNNABLE',
    elapsed,
    cpu: 0,
    ip: '',
    login: '',
    sql: '',
    subcall: '',
    txid: `tx${id}`,
    ...o,
  };
}

const EMPTY = new Map<string, Track>();

describe('들어오기', () => {
  it('처음 보는 것은 왼쪽 밖에서 시작한다', () => {
    const tracks = advanceTracks(EMPTY, [row(1, 100)], NOW, NOW);
    const [t] = [...tracks.values()];
    expect(t.phase).toBe('entering');
    expect(toDot(t, NOW, 10_000).tx).toBeLessThan(0); // 화면 밖
  });

  it('들어오는 동안 제자리로 다가가며 또렷해진다', () => {
    const tracks = advanceTracks(EMPTY, [row(1, 100)], NOW, NOW);
    const [t] = [...tracks.values()];
    const early = toDot(t, NOW + ENTER_MS * 0.2, 10_000);
    const late = toDot(t, NOW + ENTER_MS * 0.9, 10_000);
    expect(late.tx).toBeGreaterThan(early.tx);
    expect(late.alpha).toBeGreaterThan(early.alpha);
  });

  it('다 들어오면 머무름으로 넘어간다', () => {
    let tracks = advanceTracks(EMPTY, [row(1, 100)], NOW, NOW);
    tracks = settleTracks(tracks, NOW + ENTER_MS);
    expect([...tracks.values()][0].phase).toBe('holding');
  });
});

describe('머무르기', () => {
  it('같은 트랜잭션은 늘 같은 자리다 — 머무는 동안 떨리지 않는다', () => {
    expect(holdX('a:1:tx1')).toBe(holdX('a:1:tx1'));
    expect(holdX('a:1:tx1')).toBeGreaterThanOrEqual(0.38);
    expect(holdX('a:1:tx1')).toBeLessThanOrEqual(0.62);
  });

  it('여러 건이 한 줄에 뭉치지 않는다', () => {
    // 전부 가운데 한 점에 서면 몇 건인지 안 보인다.
    const xs = new Set(['a:1:t1', 'a:2:t2', 'a:3:t3', 'b:4:t4'].map(holdX));
    expect(xs.size).toBeGreaterThan(1);
  });

  it('조회가 멈춰 있어도 경과 시간은 계속 는다', () => {
    // 안 더하면 점이 2초마다 한 칸씩 뛰고 그 사이에는 멈춘다.
    const t: Track = { key: 'k', row: row(1, 1_000), phase: 'holding', since: NOW, polledAt: NOW };
    expect(elapsedNow(t, NOW + 1_500)).toBe(2_500);
    expect(toDot(t, NOW + 4_000, 10_000).ty).toBeGreaterThan(toDot(t, NOW, 10_000).ty);
  });

  it('조회가 다시 와도 들어오기를 되풀이하지 않는다', () => {
    let tracks = advanceTracks(EMPTY, [row(1, 100)], NOW, NOW);
    tracks = settleTracks(tracks, NOW + ENTER_MS);
    tracks = advanceTracks(tracks, [row(1, 2_100)], NOW + 2_000, NOW + 2_000);
    const [t] = [...tracks.values()];
    expect(t.phase).toBe('holding');
    expect(t.row.elapsed).toBe(2_100); // 새 값으로 갱신된다
  });
});

describe('빠져나가기', () => {
  it('목록에서 사라지면 오른쪽으로 나간다', () => {
    let tracks = advanceTracks(EMPTY, [row(1, 100)], NOW, NOW);
    tracks = advanceTracks(tracks, [], NOW + 2_000, NOW + 2_000);
    const [t] = [...tracks.values()];
    expect(t.phase).toBe('leaving');

    const mid = toDot(t, NOW + 2_000 + LEAVE_MS * 0.9, 10_000);
    expect(mid.tx).toBeGreaterThan(0.9); // 오른쪽 끝 너머로
    expect(mid.alpha).toBeLessThan(0.3); // 흐려지면서
  });

  it('다 나가면 표에서 지운다', () => {
    let tracks = advanceTracks(EMPTY, [row(1, 100)], NOW, NOW);
    tracks = advanceTracks(tracks, [], NOW + 1_000, NOW + 1_000);
    tracks = advanceTracks(tracks, [], NOW + 1_000 + LEAVE_MS + 1, NOW + 1_000 + LEAVE_MS + 1);
    expect(tracks.size).toBe(0);
  });

  it('들어오는 중에 끝나도 그 자리에서 바로 나간다', () => {
    // 짧은 요청은 들어오자마자 나가는 모습이 된다 — 그게 사실이다.
    let tracks = advanceTracks(EMPTY, [row(1, 50)], NOW, NOW);
    tracks = advanceTracks(tracks, [], NOW + 100, NOW + 100);
    expect([...tracks.values()][0].phase).toBe('leaving');
  });

  it('같은 키가 다시 들어오면 새로 들어온다', () => {
    // 나가는 중이던 것이 되살아나면 «머무름» 이 아니라 새 요청으로 본다.
    let tracks = advanceTracks(EMPTY, [row(1, 100)], NOW, NOW);
    tracks = advanceTracks(tracks, [], NOW + 500, NOW + 500);
    tracks = advanceTracks(tracks, [row(1, 100)], NOW + 700, NOW + 700);
    expect([...tracks.values()][0].phase).toBe('entering');
  });
});

describe('세기와 축', () => {
  it('나가는 중인 것은 «돌고 있는 수» 에서 뺀다', () => {
    let tracks = advanceTracks(EMPTY, [row(1, 100), row(2, 200)], NOW, NOW);
    tracks = advanceTracks(tracks, [row(1, 2_100)], NOW + 2_000, NOW + 2_000);
    expect(tracks.size).toBe(2); // 하나는 아직 나가는 중
    expect(holdingCount(tracks)).toBe(1);
  });

  it('세로축은 1·2·5 배수로 올리고 쉽게 내리지 않는다', () => {
    expect(niceCeil(1_234)).toBe(2_000);
    expect(nextYMax(10_000, 6_000)).toBe(10_000);
    expect(nextYMax(10_000, 1_500)).toBe(MIN_Y_MS);
  });

  it('축 상한은 자란 길이까지 본다', () => {
    const tracks = advanceTracks(EMPTY, [row(1, 30_000)], NOW, NOW);
    expect(neededYMax(tracks, NOW + 10_000)).toBe(40_000);
  });
});

describe('점 고르기', () => {
  it('나가는 중인 것은 고르지 않는다 — 이미 끝나 보여 줄 것이 없다', () => {
    let tracks = advanceTracks(EMPTY, [row(1, 5_000)], NOW, NOW);
    tracks = advanceTracks(tracks, [], NOW + 100, NOW + 100);
    const dots = [...tracks.values()].map(t => toDot(t, NOW + 100, 10_000));
    expect(pickNearest(dots, dots[0].tx * 200, (1 - dots[0].ty) * 100, 200, 100)).toBeNull();
  });

  it('머무는 점은 고른다', () => {
    let tracks = advanceTracks(EMPTY, [row(1, 5_000)], NOW, NOW);
    tracks = settleTracks(tracks, NOW + ENTER_MS);
    const dots = [...tracks.values()].map(t => toDot(t, NOW + ENTER_MS, 10_000));
    const hit = pickNearest(dots, dots[0].tx * 200, (1 - dots[0].ty) * 100, 200, 100);
    expect(hit?.row.id).toBe(1);
  });
});
