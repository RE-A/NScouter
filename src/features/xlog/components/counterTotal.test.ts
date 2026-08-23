import { describe, expect, it } from 'vitest';
import { aggregate, totalMode } from './counterTotal';

describe('totalMode', () => {
  it('% 카운터는 평균이다', () => {
    // 두 대가 각각 50% 인데 100% 라고 그리면 거짓말이다.
    expect(totalMode('Cpu')).toBe('avg');
    expect(totalMode('Mem')).toBe('avg');
    expect(totalMode('ErrorRate')).toBe('avg');
  });

  it('응답시간은 단위가 ms 여도 평균이다', () => {
    // 두 서버가 각각 100ms 인 것과 한 서버가 200ms 인 것은 전혀 다른데 합계는 같다.
    expect(totalMode('ElapsedTime')).toBe('avg');
    expect(totalMode('Elapsed90%')).toBe('avg');
  });

  it('양을 세는 카운터는 합계다', () => {
    expect(totalMode('TPS')).toBe('sum');
    expect(totalMode('ServiceCount')).toBe('sum');
    expect(totalMode('HeapUsed')).toBe('sum');
    expect(totalMode('ConnActive')).toBe('sum');
  });
});

describe('aggregate', () => {
  it('합계는 더한다', () => {
    expect(aggregate([1, 2, 3], 'sum')).toBe(6);
  });

  it('평균은 오브젝트 수로 나눈다', () => {
    expect(aggregate([40, 60], 'avg')).toBe(50);
  });

  it('값이 없으면 0이 아니라 null 이다', () => {
    // 0은 "전부 멈췄다"는 뜻이라 수집이 안 된 구간과 구별되지 않는다.
    expect(aggregate([], 'sum')).toBeNull();
    expect(aggregate([], 'avg')).toBeNull();
  });

  it('오브젝트가 하나면 그 값 그대로다', () => {
    expect(aggregate([7], 'sum')).toBe(7);
    expect(aggregate([7], 'avg')).toBe(7);
  });
});
