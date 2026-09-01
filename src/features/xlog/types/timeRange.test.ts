// XLog 조회 구간 검사
//
// 이 프로토콜은 파라미터가 틀리면 에러 대신 **0건**을 준다 (F-15).
// 조회를 눌러 놓고 0건이 나오면 원인을 알 수 없으므로 먼저 거르고 이유를 말한다.

import { describe, it, expect } from 'vitest';
import {
  checkRange,
  defaultPastRange,
  fromLocalInput,
  MAX_PAST_SPAN_MS,
  MIN_PAST_SPAN_MS,
  panRange,
  toLocalInput,
  yyyymmdd,
  zoomRange,
} from './timeRange';

const NOW = new Date('2026-08-16T14:00:00').getTime();
const min = (n: number) => n * 60 * 1000;

describe('checkRange', () => {
  it('정상 구간은 통과한다', () => {
    const r = checkRange({ stime: NOW - min(10), etime: NOW }, NOW);
    expect(r.ok).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('끝이 시작보다 앞이면 막는다', () => {
    expect(checkRange({ stime: NOW, etime: NOW - min(1) }, NOW).ok).toBe(false);
  });

  it('시작과 끝이 같으면 막는다', () => {
    expect(checkRange({ stime: NOW, etime: NOW }, NOW).ok).toBe(false);
  });

  it('미래 구간은 막는다', () => {
    expect(checkRange({ stime: NOW + min(1), etime: NOW + min(2) }, NOW).ok).toBe(false);
  });

  // 6시간이면 수십만 건이라 화면과 메모리가 버티지 못한다.
  it('상한을 넘는 구간은 막는다', () => {
    const r = checkRange({ stime: NOW - MAX_PAST_SPAN_MS - 1, etime: NOW }, NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('6시간');
  });

  it('상한과 정확히 같으면 통과한다', () => {
    // 경계에서 막으면 "6시간 이내로" 라는 안내와 어긋난다.
    const start = new Date('2026-08-16T08:00:00').getTime();
    expect(checkRange({ stime: start, etime: start + MAX_PAST_SPAN_MS }, NOW).ok).toBe(true);
  });

  // 콜렉터는 날짜 디렉토리 단위로 저장한다 (F-18). 걸치면 한 번에 못 가져온다.
  it('날짜를 걸치는 구간은 막는다', () => {
    const s = new Date('2026-08-15T23:50:00').getTime();
    const e = new Date('2026-08-16T00:10:00').getTime();
    const r = checkRange({ stime: s, etime: e }, NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('하루');
  });

  it('잘못된 시각은 형식 문제로 알린다', () => {
    const r = checkRange({ stime: NaN, etime: NOW }, NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('형식');
  });
});

describe('datetime-local 변환', () => {
  it('왕복해도 분 단위까지 같다', () => {
    const t = new Date('2026-08-16T09:07:00').getTime();
    expect(fromLocalInput(toLocalInput(t))).toBe(t);
  });

  // UTC 로 바꾸면 KST 기준 오전이 전날로 밀린다.
  it('로컬 시각을 그대로 쓴다', () => {
    expect(toLocalInput(new Date('2026-08-16T00:30:00').getTime())).toBe('2026-08-16T00:30');
  });

  it('빈 값은 null 이다', () => {
    expect(fromLocalInput('')).toBeNull();
  });
});

describe('yyyymmdd', () => {
  it('한 자리 월·일을 0 으로 채운다', () => {
    expect(yyyymmdd(new Date('2026-03-05T10:00:00').getTime())).toBe('20260305');
  });

  // UTC 기준으로 계산하면 KST 오전 9시 이전이 전날이 된다.
  it('자정 직후도 그날이다', () => {
    expect(yyyymmdd(new Date('2026-08-16T00:10:00').getTime())).toBe('20260816');
  });
});

describe('defaultPastRange', () => {
  it('최근 10분이고 그대로 통과한다', () => {
    const r = defaultPastRange(NOW);
    expect(r.etime - r.stime).toBe(min(10));
    expect(checkRange(r, NOW).ok).toBe(true);
  });
});

// 드래그는 트랜잭션 선택으로 남긴다. 확대/이동은 휠이다.
describe('zoomRange', () => {
  const base = { stime: new Date('2026-08-16T12:00:00').getTime(), etime: new Date('2026-08-16T12:10:00').getTime() };

  it('확대하면 구간이 짧아진다', () => {
    const z = zoomRange(base, 0.5, 0.5);
    expect(z.etime - z.stime).toBe(min(5));
  });

  it('축소하면 구간이 길어진다', () => {
    const z = zoomRange(base, 0.5, 2);
    expect(z.etime - z.stime).toBe(min(20));
  });

  // 이게 핵심이다. 가운데 기준으로 잡으면 보고 있던 지점이 화면 밖으로 달아난다.
  it('커서 아래 시각이 커서 아래 그대로 남는다', () => {
    const ratio = 0.25;
    const anchor = base.stime + ratio * (base.etime - base.stime);
    const z = zoomRange(base, ratio, 0.4);
    const after = z.stime + ratio * (z.etime - z.stime);
    expect(after).toBeCloseTo(anchor, 0);
  });

  it('왼쪽 끝을 잡으면 시작이 고정된다', () => {
    const z = zoomRange(base, 0, 0.5);
    expect(z.stime).toBe(base.stime);
  });

  it('더 이상 좁아지지 않는 하한이 있다', () => {
    let r = base;
    for (let i = 0; i < 40; i++) r = zoomRange(r, 0.5, 0.5);
    expect(r.etime - r.stime).toBe(MIN_PAST_SPAN_MS);
  });

  it('상한을 넘게 축소하지 않는다', () => {
    let r = base;
    for (let i = 0; i < 40; i++) r = zoomRange(r, 0.5, 2);
    expect(r.etime - r.stime).toBeLessThanOrEqual(MAX_PAST_SPAN_MS);
    expect(checkRange(r, NOW).ok).toBe(true);
  });

  // 하루를 걸치면 조회 자체가 막힌다 (콜렉터가 날짜 단위 저장).
  it('축소해도 하루를 넘지 않는다', () => {
    const late = { stime: new Date('2026-08-16T23:30:00').getTime(), etime: new Date('2026-08-16T23:50:00').getTime() };
    const z = zoomRange(late, 0.5, 8);
    expect(yyyymmdd(z.stime)).toBe('20260816');
    expect(yyyymmdd(z.etime)).toBe('20260816');
    expect(checkRange(z, NOW + 86400000).ok).toBe(true);
  });
});

describe('panRange', () => {
  const base = { stime: new Date('2026-08-16T12:00:00').getTime(), etime: new Date('2026-08-16T12:10:00').getTime() };

  it('길이를 유지한 채 민다', () => {
    const p = panRange(base, 0.5);
    expect(p.etime - p.stime).toBe(min(10));
    expect(p.stime).toBe(base.stime + min(5));
  });

  it('음수면 과거로 민다', () => {
    expect(panRange(base, -1).stime).toBe(base.stime - min(10));
  });

  it('하루 밖으로 나가지 않는다', () => {
    const early = { stime: new Date('2026-08-16T00:05:00').getTime(), etime: new Date('2026-08-16T00:15:00').getTime() };
    const p = panRange(early, -5);
    expect(yyyymmdd(p.stime)).toBe('20260816');
    expect(p.stime).toBeGreaterThanOrEqual(new Date('2026-08-16T00:00:00').getTime());
  });
});

// 확대는 이미 받아둔 데이터 안에서 일어난다. 휠마다 수만 건을 다시 받으면 못 쓴다.
