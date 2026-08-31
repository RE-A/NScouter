// 콜렉터 시각과 이 PC 시각의 차
//
// 차트의 오른쪽 끝은 **이 PC 의 «지금»** 이다. 두 시계가 몇 분 어긋난 환경에서는
// 스트림이 멀쩡해도 점이 창 밖에 놓여 «사라진 것»처럼 보인다.
// 그걸 화면이 말해 주지 못하면 원인을 찾을 길이 없다.

import { describe, expect, it } from 'vitest';
import {
  clampMaxItems,
  DEFAULT_MAX_ITEMS,
  DEFAULT_MAX_ITEMS as MAX_ITEMS,
  LIMIT_MAX_ITEMS,
  MIN_MAX_ITEMS,
  XLogDataStore,
} from './XLogDataStore';
import type { SXLog } from '../types/xlog';

const at = (endTime: number): SXLog =>
  ({ txid: String(endTime), endTime, elapsed: 1, objHash: 1, service: 1, error: 0 }) as SXLog;

describe('XLogDataStore.clockSkewMs', () => {
  it('한 건도 못 받았으면 모른다', () => {
    expect(new XLogDataStore().clockSkewMs).toBeNull();
  });

  it('데이터가 앞서면 양수다', () => {
    const s = new XLogDataStore();
    s.addBatch([at(1_000_180_000)], 1_000_000_000);
    expect(s.clockSkewMs).toBe(180_000);
  });

  it('데이터가 뒤처지면 음수다', () => {
    const s = new XLogDataStore();
    s.addBatch([at(1_000_000_000 - 90_000)], 1_000_000_000);
    expect(s.clockSkewMs).toBe(-90_000);
  });

  it('한 묶음에서는 가장 최근 것으로 잰다', () => {
    // 오래된 것이 섞여 와도 시계 차가 아니다 — 늦게 끝난 트랜잭션일 뿐이다.
    const s = new XLogDataStore();
    s.addBatch([at(1_000_000_000 - 60_000), at(1_000_001_000), at(999_999_000)], 1_000_000_000);
    expect(s.clockSkewMs).toBe(1_000);
  });

  it('빈 묶음은 값을 흔들지 않는다', () => {
    const s = new XLogDataStore();
    s.addBatch([at(1_000_005_000)], 1_000_000_000);
    s.addBatch([], 1_000_010_000);
    expect(s.clockSkewMs).toBe(5_000);
  });
});

describe('XLogDataStore — 버퍼 상한', () => {
  it('상한을 넘으면 오래된 것부터 버리고, 버린 것을 센다', () => {
    // 조용히 버리면 «데이터가 유실된다» 로 읽힌다. 화면이 말할 수 있어야 한다.
    const s = new XLogDataStore();
    const now = 1_000_000_000;
    const over = 10;
    s.addBatch(
      Array.from({ length: MAX_ITEMS + over }, (_, i) => at(now - MAX_ITEMS - over + i)),
      now,
    );

    // 창은 넉넉히 잡는다 — 여기서 보려는 것은 **시간이 아니라 개수**로 잘리는 자리다.
    s.prune(now, 10 * 60 * 60 * 1000);

    expect(s.size).toBeLessThanOrEqual(MAX_ITEMS);
    expect(s.droppedCount).toBeGreaterThan(0);
    expect(s.lastDropAtMs).toBe(now);
  });

  it('상한에 안 걸리면 아무것도 안 버린다', () => {
    const s = new XLogDataStore();
    const now = 1_000_000_000;
    s.addBatch([at(now - 1000), at(now)], now);
    s.prune(now, 60_000);

    expect(s.droppedCount).toBe(0);
    expect(s.lastDropAtMs).toBeNull();
  });

  it('창 밖으로 나가 지운 것은 상한으로 세지 않는다', () => {
    // 둘은 다른 일이다 — 창 밖은 «지나간 것», 상한은 «담지 못한 것».
    const s = new XLogDataStore();
    const now = 1_000_000_000;
    s.addBatch([at(now - 600_000), at(now)], now);
    s.prune(now, 60_000);

    expect(s.size).toBe(1);
    expect(s.droppedCount).toBe(0);
  });
});

describe('XLogDataStore — 상한을 설정에서 바꾼다', () => {
  it('생성할 때 받은 값으로 자른다', () => {
    const s = new XLogDataStore(MIN_MAX_ITEMS);
    expect(s.maxItemCount).toBe(MIN_MAX_ITEMS);
  });

  it('못 쓸 값은 기본값·범위로 다듬는다', () => {
    // config.json 은 사람이 여는 파일이다. 0 이면 한 건도 못 담는다.
    expect(clampMaxItems(0)).toBe(DEFAULT_MAX_ITEMS);
    expect(clampMaxItems('abc')).toBe(DEFAULT_MAX_ITEMS);
    expect(clampMaxItems(5)).toBe(MIN_MAX_ITEMS);
    expect(clampMaxItems(9_999_999)).toBe(LIMIT_MAX_ITEMS);
    expect(clampMaxItems(250_000)).toBe(250_000);
  });

  it('바꿔도 이미 받아 둔 점은 남는다', () => {
    // 저장소를 새로 만들면 상한을 올리려다 화면을 비우는 꼴이 된다.
    const s = new XLogDataStore(MIN_MAX_ITEMS);
    const now = 1_000_000_000;
    s.addBatch([at(now - 2000), at(now - 1000), at(now)], now);

    s.setMaxItems(500_000);

    expect(s.maxItemCount).toBe(500_000);
    expect(s.size).toBe(3);
  });

  it('줄이면 다음 prune 에서 오래된 것부터 잘린다', () => {
    const s = new XLogDataStore(500_000);
    const now = 1_000_000_000;
    const over = 5;
    s.addBatch(
      Array.from({ length: MIN_MAX_ITEMS + over }, (_, i) => at(now - MIN_MAX_ITEMS - over + i)),
      now,
    );

    s.setMaxItems(MIN_MAX_ITEMS);
    s.prune(now, 10 * 60 * 60 * 1000);

    expect(s.size).toBe(MIN_MAX_ITEMS);
    expect(s.droppedCount).toBe(over);
    // 남은 것 중 가장 오래된 것이 앞에서 잘린 만큼 밀려 있다
    expect(s.getAll()[0].endTime).toBe(now - MIN_MAX_ITEMS);
  });

  it('너무 작은 값은 최소치로 올린다 — 한 건도 못 담으면 화면이 빈다', () => {
    const s = new XLogDataStore(500_000);
    s.setMaxItems(2);
    expect(s.maxItemCount).toBe(MIN_MAX_ITEMS);
  });
});
