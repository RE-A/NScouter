// 렌더 파이프라인 성능 측정
//
//   npm run bench
//
// 이 프로젝트의 존재 이유가 "Java 클라이언트가 느려서" 이므로 수치를 남긴다.
// **Canvas 렌더 자체는 여기서 못 잰다** (jsdom 에 2d 컨텍스트가 없다).
// 잴 수 있는 건 그 앞단의 순수 계산이다 — 좌표 변환, 충돌 감지, 윈도우 관리.
//
// 측정 결과는 docs/perf-baseline.md 에 기록한다.

import { bench, describe } from 'vitest';
import { CoordinateMapper, rollingWindow } from './CoordinateMapper';
import { PointMap } from './PointMap';
import { XLogDataStore } from '../store/XLogDataStore';
import { DEFAULT_CHART_CONFIG, buildLayout } from '../types/xlog';
import type { SXLog } from '../types/xlog';

const W = 1920;
const H = 1080;
const NOW = 1_700_000_000_000;

function makeXLogs(n: number): SXLog[] {
  const out: SXLog[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = {
      txid: String(i),
      // 실제 스토어처럼 오래된 것부터 오름차순
      endTime: NOW - n + i,
      objHash: (i % 4) - 2,
      service: i % 100,
      elapsed: (i * 37) % 5000,
      error: i % 50 === 0 ? 1 : 0,
      cpu: 0,
      sqlCount: i % 10,
      sqlTime: i % 100,
      ipaddr: '10.0.0.1',
      kbytes: 0,
      status: 200,
      userid: 0,
      xType: 0,
      gxid: '0',
      caller: '0',
      apicallCount: 0,
      apicallTime: 0,
    } as unknown as SXLog;
  }
  return out;
}

const layout = buildLayout(W, H);

describe('좌표 변환', () => {
  const data = makeXLogs(100_000);
  const mapper = new CoordinateMapper(layout, DEFAULT_CHART_CONFIG, rollingWindow(NOW, DEFAULT_CHART_CONFIG.timeRangeMs));

  bench('100,000건 dataToPixel', () => {
    for (let i = 0; i < data.length; i++) {
      const v = mapper.extractValue(data[i]);
      mapper.dataToPixel(data[i].endTime, v);
    }
  });
});

describe('충돌 감지 (PointMap)', () => {
  bench('100,000회 set + has — O(1) 이어야 한다', () => {
    const pm = new PointMap(W, H);
    for (let i = 0; i < 100_000; i++) {
      const x = i % W;
      const y = (i * 7) % H;
      if (!pm.has(x, y)) pm.set(x, y, 5);
    }
  });
});

describe('데이터 윈도우 (XLogDataStore)', () => {
  // 데이터 생성 비용이 측정에 섞이지 않도록 밖에서 한 번만 만든다.
  const batch = makeXLogs(100_000);

  bench('100,000건 addBatch', () => {
    const store = new XLogDataStore();
    store.addBatch(batch, NOW);
  });

  // prune 은 앞에서부터 잘라내므로 O(n) 이어야 한다. O(n²) 로 퇴화하면 여기서 드러난다.
  bench('100,000건 중 절반 prune', () => {
    const store = new XLogDataStore();
    store.addBatch(batch, NOW);
    store.prune(NOW, 50_000);
  });
});
