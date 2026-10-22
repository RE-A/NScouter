// 과거 후보 — 구간이 걸친 날짜와, 그날 목록을 오브젝트 모양으로 바꾸는 규칙

import { describe, expect, it } from 'vitest';
import { dailyToAgent, datesOf } from './usePastCandidates';

const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe('datesOf', () => {
  it('하루 안의 구간은 그날 하나다', () => {
    expect(datesOf({ stime: at(2026, 10, 22, 9), etime: at(2026, 10, 22, 15) })).toEqual(['20261022']);
  });

  it('자정을 걸치면 두 날짜다 — 어제 Task 와 오늘 Task 를 다 찾아야 한다', () => {
    expect(datesOf({ stime: at(2026, 10, 21, 22), etime: at(2026, 10, 22, 2) })).toEqual(['20261021', '20261022']);
  });
});

describe('dailyToAgent', () => {
  it('그날 목록의 것은 살아 있지 않은 것으로 둔다 — 실시간 고르기에 섞여도 조회 대상이 안 된다', () => {
    const a = dailyToAgent({ obj_hash: 7, obj_type: 'tomcat', obj_name: '/vm/safs-ip-10-0-0-1' });
    expect(a).toMatchObject({ obj_hash: 7, alive: false, tags: [], obj_name: '/vm/safs-ip-10-0-0-1' });
  });
});
