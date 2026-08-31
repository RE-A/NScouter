// 성능 회귀 가드
//
// 정밀 측정은 `npm run bench` 가 한다. 여기 있는 건 **O(n²) 퇴화 감지**용이다.
//
// 임계값 200ms 는 실측(1.5~2.2ms)의 100배다. 과하게 느슨해 보이지만 의도적이다.
// 빌드와 동시에 돌렸을 때 79ms 까지 튄 적이 있고, **흔들리는 테스트는 무시당한다.**
// 잡으려는 대상인 O(n²) 퇴화는 실측 14,000ms 였으므로 70배 여유로도 확실히 걸린다.
//
// 기준선: docs/perf-baseline.md

import { describe, it, expect } from 'vitest';
import { CoordinateMapper, rollingWindow } from './CoordinateMapper';
import { PointMap } from './PointMap';
import { DEFAULT_MAX_ITEMS, XLogDataStore } from '../store/XLogDataStore';
import { DEFAULT_CHART_CONFIG, buildLayout } from '../types/xlog';
import type { SXLog } from '../types/xlog';

const W = 1920;
const H = 1080;
const NOW = 1_700_000_000_000;
const N = 100_000;
/** O(n²) 퇴화만 잡으면 되므로 넉넉히. 위 주석 참조 */
const BUDGET_MS = 200;

function makeXLogs(n: number): SXLog[] {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = {
      txid: String(i),
      // 실제 스토어처럼 오래된 것부터 오름차순. 그래야 prune 이 앞에서부터 자른다.
      endTime: NOW - n + i,
      objHash: (i % 4) - 2,
      service: i % 100,
      elapsed: (i * 37) % 5000,
      error: i % 50 === 0 ? 1 : 0,
      cpu: 0, sqlCount: i % 10, sqlTime: i % 100,
      ipaddr: '10.0.0.1', kbytes: 0, status: 200, userid: 0,
      xType: 0, gxid: '0', caller: '0', apicallCount: 0, apicallTime: 0,
    };
  }
  return out as SXLog[];
}

function elapsedMs(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe('성능 회귀 가드 (100,000건)', () => {
  const layout = buildLayout(W, H);
  const data = makeXLogs(N);

  // 실측 2.1ms
  it('좌표 변환이 선형 시간이다', () => {
    const mapper = new CoordinateMapper(layout, DEFAULT_CHART_CONFIG, rollingWindow(NOW, DEFAULT_CHART_CONFIG.timeRangeMs));
    const ms = elapsedMs(() => {
      for (let i = 0; i < data.length; i++) {
        mapper.dataToPixel(data[i].endTime, mapper.extractValue(data[i]));
      }
    });
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  // 실측 2.2ms.
  // PointMap 이 배열이 아니라 선형 탐색으로 바뀌면 여기서 터진다.
  it('충돌 감지가 O(1)이다', () => {
    const ms = elapsedMs(() => {
      const pm = new PointMap(W, H);
      for (let i = 0; i < N; i++) {
        const x = i % W;
        const y = (i * 7) % H;
        if (!pm.has(x, y)) pm.set(x, y, 5);
      }
    });
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  // 실측 1.5ms.
  // prune 이 splice 반복이나 filter 재생성으로 바뀌면 O(n²) 가 된다.
  it('윈도우 정리가 선형 시간이다', () => {
    const store = new XLogDataStore();
    store.addBatch(data, NOW);
    // 절반이 실제로 잘려야 측정에 의미가 있다.
    const ms = elapsedMs(() => store.prune(NOW, N / 2));
    expect(store.size).toBeCloseTo(N / 2, -3);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('상한을 넘겨도 보관량이 무한히 늘지 않는다', () => {
    const store = new XLogDataStore();
    for (let k = 0; k < 3; k++) {
      store.addBatch(makeXLogs(50_000), NOW);
      store.prune(NOW, 400_000);
    }
    expect(store.size).toBeLessThanOrEqual(DEFAULT_MAX_ITEMS);
  });
});
