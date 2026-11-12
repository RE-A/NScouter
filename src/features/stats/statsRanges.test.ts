import { describe, expect, it } from 'vitest';
import { addRanges, lastWeek, offHours, overlaps, recentDays, yesterday } from './statsRanges';

const H = 3600 * 1000;
const D = 24 * H;
const cur = { stime: 100 * D + 10 * H, etime: 100 * D + 11 * H };

describe('기준 구간 빠른 추가', () => {
  it('어제·지난주·최근 n일 같은 시각', () => {
    expect(yesterday(cur)).toEqual([{ stime: cur.stime - D, etime: cur.etime - D }]);
    expect(lastWeek(cur)[0].stime).toBe(cur.stime - 7 * D);
    expect(recentDays(cur, 3).map(r => (cur.stime - r.stime) / D)).toEqual([1, 2, 3]);
  });

  it('같은 구간은 한 번만, 최근 것부터', () => {
    const a = addRanges([], yesterday(cur));
    const b = addRanges(a, recentDays(cur, 2));
    expect(b.length).toBe(2);
    expect(b[0].stime).toBeGreaterThan(b[1].stime);
  });

  it('겹침 — 끝과 시작이 맞닿으면 겹치지 않는다', () => {
    expect(overlaps(cur, { stime: cur.stime - H, etime: cur.stime })).toBe(false);
    expect(overlaps(cur, { stime: cur.stime - H, etime: cur.stime + 1 })).toBe(true);
  });

  it('시각대나 길이가 다르면 알린다', () => {
    expect(offHours(cur, yesterday(cur)[0], 0)).toBe(false);
    expect(offHours(cur, { stime: cur.stime - D + H, etime: cur.etime - D + H }, 0)).toBe(true);
    expect(offHours(cur, { stime: cur.stime - D, etime: cur.etime - D + H }, 0)).toBe(true);
  });
});
