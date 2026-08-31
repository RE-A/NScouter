// 콜렉터 시각과 이 PC 시각의 차
//
// 차트의 오른쪽 끝은 **이 PC 의 «지금»** 이다. 두 시계가 몇 분 어긋난 환경에서는
// 스트림이 멀쩡해도 점이 창 밖에 놓여 «사라진 것»처럼 보인다.
// 그걸 화면이 말해 주지 못하면 원인을 찾을 길이 없다.

import { describe, expect, it } from 'vitest';
import { XLogDataStore } from './XLogDataStore';
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
