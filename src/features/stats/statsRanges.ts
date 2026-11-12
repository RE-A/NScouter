// 기준 구간 빠른 추가 — «평소» 는 대개 같은 시간대다
//
// 오전 10~11시를 하루 전체와 비교하면 피크와 한가한 시간이 섞여 «느려짐» 이 잘못 뜬다.
// 그래서 현재 구간과 **같은 시각**의 지난날을 단추 하나로 넣게 한다.

import type { StatsRange } from './statsApi';

const DAY = 24 * 3600 * 1000;

/** 현재 구간을 `days` 일 앞으로 옮긴 것 */
export function shiftDays(r: StatsRange, days: number): StatsRange {
  return { stime: r.stime - days * DAY, etime: r.etime - days * DAY };
}

/** 어제 같은 시각 */
export function yesterday(r: StatsRange): StatsRange[] {
  return [shiftDays(r, 1)];
}

/** 지난주 같은 요일·시각 */
export function lastWeek(r: StatsRange): StatsRange[] {
  return [shiftDays(r, 7)];
}

/** 최근 n 일 같은 시각 (어제부터 n 일 전까지) */
export function recentDays(r: StatsRange, n: number): StatsRange[] {
  return Array.from({ length: n }, (_, i) => shiftDays(r, i + 1));
}

/** 같은 구간은 한 번만 — 단추를 두 번 눌러도 겹쳐 넣지 않는다 */
export function addRanges(list: readonly StatsRange[], more: readonly StatsRange[]): StatsRange[] {
  const out = [...list];
  for (const m of more) {
    if (!out.some(x => x.stime === m.stime && x.etime === m.etime)) out.push(m);
  }
  return out.sort((a, b) => b.stime - a.stime);
}

/** 하루 안 시각(분)이 현재 구간과 다른 기준 구간 — 시간대가 달라 피크가 섞일 수 있다 */
export function offHours(current: StatsRange, base: StatsRange, tzOffsetMs: number): boolean {
  const mod = (t: number) => (((t + tzOffsetMs) % DAY) + DAY) % DAY;
  const len = (r: StatsRange) => r.etime - r.stime;
  return len(base) !== len(current) || mod(base.stime) !== mod(current.stime);
}
