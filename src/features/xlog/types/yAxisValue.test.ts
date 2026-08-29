// Y축 값 표기
//
// **점 높이와 목록의 숫자가 다른 값을 보고 있으면 «왜 3초짜리가 맨 밑에 있나» 가 된다.**
// 실제로 그렇게 헷갈렸다 (Y축 SQL Time · elapsed 3,004ms · sqlTime 0ms).

import { describe, expect, it } from 'vitest';
import { formatYValue, yAxisShortLabel } from './xlog';
import type { SXLog } from './xlog';

const x = {
  elapsed: 3004,
  cpu: 12,
  sqlTime: 0,
  sqlCount: 0,
  apiCallTime: 3003,
  apiCallCount: 2,
  allocKBytes: 4096,
} as SXLog;

describe('formatYValue', () => {
  it('초 단위 축은 ms 로 적는다 — 목록의 Elapsed 와 같은 단위여야 견줄 수 있다', () => {
    expect(formatYValue('elapsed', x)).toBe('3,004ms');
    expect(formatYValue('sqlTime', x)).toBe('0ms');
    expect(formatYValue('apiCallTime', x)).toBe('3,003ms');
  });

  it('건수 축은 단위가 없다', () => {
    expect(formatYValue('sqlCount', x)).toBe('0');
    expect(formatYValue('apiCallCount', x)).toBe('2');
  });

  it('그 밖의 축은 제 단위를 붙인다', () => {
    expect(formatYValue('cpu', x)).toBe('12ms');
    expect(formatYValue('heapUsed', x)).toBe('4,096KB');
  });

  it('**3초짜리가 SQL Time 축에서 0 인 것이 맞다**', () => {
    // 다른 앱을 3초 기다렸고 SQL 은 한 건도 안 썼다 — 버그가 아니다
    expect(formatYValue('elapsed', x)).toBe('3,004ms');
    expect(formatYValue('sqlTime', x)).toBe('0ms');
  });
});

describe('yAxisShortLabel', () => {
  it('단위 괄호를 뗀다', () => {
    expect(yAxisShortLabel('sqlTime')).toBe('SQL Time');
    expect(yAxisShortLabel('elapsed')).toBe('Elapsed');
    expect(yAxisShortLabel('apiCallTime')).toBe('ApiCall Time');
  });

  it('괄호가 없으면 그대로다', () => {
    expect(yAxisShortLabel('sqlCount')).toBe('SQL Count');
  });
});
