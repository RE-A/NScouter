import { describe, expect, it } from 'vitest';
import { initialDraft } from './StatsForm';
import { applyPreset, parsePresets, toPreset } from './statsPresets';
import { recentDays } from './statsRanges';

const D = 86_400_000;

describe('조건 묶음', () => {
  it('과거 구간을 기준 구간에서 떨어진 만큼으로 남겨, 다른 날 불러도 같은 모양이 된다', () => {
    const d0 = initialDraft(100 * D + 10 * 3600_000);
    const saved = toPreset(' 매일 오전 ', { ...d0, target: 'shop', serviceExclude: '/health', baselines: recentDays(d0.current, 3) });
    expect(saved.name).toBe('매일 오전');
    expect(saved.baselineOffsets).toEqual([[-D, -D], [-2 * D, -2 * D], [-3 * D, -3 * D]]);

    const later = initialDraft(130 * D + 15 * 3600_000);
    const d1 = applyPreset(later, saved);
    expect(d1.current).toEqual(later.current);
    expect(d1.baselines).toEqual(recentDays(later.current, 3));
    expect(d1.target).toBe('shop');
    expect(d1.serviceExclude).toBe('/health');
  });

  it('설정 파일의 깨진 항목은 버린다', () => {
    const ok = toPreset('a', initialDraft(D));
    expect(parsePresets([ok, null, { name: '' }, { name: 'b', baselineOffsets: [[1, 'x'], [2, 3]] }, 3])).toEqual([
      ok,
      { ...toPreset('b', initialDraft(D)), baselineOffsets: [[2, 3]] },
    ]);
    expect(parsePresets('nope')).toEqual([]);
  });
});
