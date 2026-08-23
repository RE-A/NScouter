import { describe, expect, it } from 'vitest';
import { CoordinateMapper, rollingWindow } from './CoordinateMapper';
import { passesFilter, selectInRect } from './rectSelect';
import { buildLayout, DEFAULT_CHART_CONFIG, DEFAULT_FILTER, hasActiveFilter } from '../types/xlog';
import type { SXLog } from '../types/xlog';

const layout = buildLayout(800, 600);
const config = { ...DEFAULT_CHART_CONFIG, timeRangeMs: 60_000, yMax: 9 };
const now = 1_000_000;
const mapper = new CoordinateMapper(layout, config, rollingWindow(now, config.timeRangeMs));

let seq = 0;
function xlog(over: Partial<SXLog> = {}): SXLog {
  seq += 1;
  return {
    txid: String(seq),
    gxid: '0',
    caller: '0',
    endTime: now - 30_000,
    elapsed: 1000,
    objHash: 1,
    service: 1,
    error: 0,
    xType: 0,
    cpu: 0,
    sqlCount: 0,
    sqlTime: 0,
    apiCallCount: 0,
    apiCallTime: 0,
    ipAddr: '10.0.0.1',
    allocKBytes: 0,
    threadNameHash: 0,
    ...over,
  };
}

/** 어떤 XLog 든 담는 넉넉한 사각형 */
const WHOLE_PLOT = {
  x1: layout.plotAreaX,
  y1: layout.plotAreaY,
  x2: layout.plotAreaX + layout.plotAreaWidth,
  y2: layout.plotAreaY + layout.plotAreaHeight,
};

describe('selectInRect', () => {
  it('같은 자리에 겹친 트랜잭션도 전부 선택된다', () => {
    // 이게 이 모듈이 존재하는 이유다. 픽셀 지도로 고르면 겹친 건 1건만 남는다.
    const same = { endTime: now - 30_000, elapsed: 1000 };
    const rows = [xlog(same), xlog(same), xlog(same)];
    expect(selectInRect(rows, WHOLE_PLOT, mapper, DEFAULT_FILTER)).toHaveLength(3);
  });

  it('사각형 밖의 트랜잭션은 빠진다', () => {
    const inside = xlog({ endTime: now - 30_000, elapsed: 1000 });
    const outside = xlog({ endTime: now - 5_000, elapsed: 1000 });

    const p = mapper.dataToPixel(inside.endTime, mapper.extractValue(inside));
    const rect = { x1: p.x - 3, y1: p.y - 3, x2: p.x + 3, y2: p.y + 3 };

    const got = selectInRect([inside, outside], rect, mapper, DEFAULT_FILTER);
    expect(got.map(x => x.txid)).toEqual([inside.txid]);
  });

  it('드래그 방향이 반대여도 결과가 같다', () => {
    const rows = [xlog(), xlog()];
    const flipped = {
      x1: WHOLE_PLOT.x2,
      y1: WHOLE_PLOT.y2,
      x2: WHOLE_PLOT.x1,
      y2: WHOLE_PLOT.y1,
    };
    expect(selectInRect(rows, flipped, mapper, DEFAULT_FILTER)).toHaveLength(2);
  });

  it('필터에 걸린 트랜잭션은 그려지지 않으므로 선택되지도 않는다', () => {
    const rows = [xlog({ error: 0 }), xlog({ error: 7 })];
    const got = selectInRect(rows, WHOLE_PLOT, mapper, { ...DEFAULT_FILTER, errorOnly: true });
    expect(got.map(x => x.error)).toEqual([7]);
  });

  it('시간 구간을 벗어난 트랜잭션은 빠진다', () => {
    // 롤링 윈도우보다 오래된 건은 플롯 영역 왼쪽 밖으로 나간다
    const old = xlog({ endTime: now - 120_000 });
    expect(selectInRect([old], WHOLE_PLOT, mapper, DEFAULT_FILTER)).toEqual([]);
  });

  it('원본 순서를 유지한다', () => {
    const rows = [
      xlog({ endTime: now - 40_000, elapsed: 500 }),
      xlog({ endTime: now - 30_000, elapsed: 3000 }),
      xlog({ endTime: now - 20_000, elapsed: 1500 }),
    ];
    const got = selectInRect(rows, WHOLE_PLOT, mapper, DEFAULT_FILTER);
    expect(got.map(x => x.txid)).toEqual(rows.map(x => x.txid));
  });
});

describe('passesFilter', () => {
  it('응답시간 임계 미만은 뺀다', () => {
    const f = { ...DEFAULT_FILTER, elapsedMs: 500 };
    expect(passesFilter(xlog({ elapsed: 100 }), f)).toBe(false);
    expect(passesFilter(xlog({ elapsed: 500 }), f)).toBe(true);
  });

  it('제외로 뒤집으면 임계 미만만 남는다', () => {
    // "3초 이상"의 반대는 "3초 미만"이지 "조건 없음"이 아니다.
    const f = { ...DEFAULT_FILTER, elapsedMs: 500, elapsedExclude: true };
    expect(passesFilter(xlog({ elapsed: 100 }), f)).toBe(true);
    expect(passesFilter(xlog({ elapsed: 500 }), f)).toBe(false);
  });

  it('임계 0 은 제외로 걸어도 조건이 없다', () => {
    // 0 을 미만으로 읽으면 아무것도 통과하지 못해 화면이 통째로 빈다.
    const f = { ...DEFAULT_FILTER, elapsedMs: 0, elapsedExclude: true };
    expect(passesFilter(xlog({ elapsed: 0 }), f)).toBe(true);
    expect(passesFilter(xlog({ elapsed: 9999 }), f)).toBe(true);
  });

  it('에이전트를 고르지 않았으면 전부 통과다', () => {
    expect(passesFilter(xlog({ objHash: 99 }), DEFAULT_FILTER)).toBe(true);
  });

  it('고른 에이전트만 통과한다', () => {
    const filter = { ...DEFAULT_FILTER, objHashSet: new Set([1]) };
    expect(passesFilter(xlog({ objHash: 1 }), filter)).toBe(true);
    expect(passesFilter(xlog({ objHash: 2 }), filter)).toBe(false);
  });

  it('IP 를 부분 일치로 거른다', () => {
    const f = { ...DEFAULT_FILTER, ip: { text: '10.89.2', exclude: false } };
    expect(passesFilter(xlog({ ipAddr: '10.89.2.13' }), f)).toBe(true);
    expect(passesFilter(xlog({ ipAddr: '192.168.0.1' }), f)).toBe(false);
  });

  it('IP 제외는 그 IP 만 뺀다', () => {
    const f = { ...DEFAULT_FILTER, ip: { text: '10.89.2.13', exclude: true } };
    expect(passesFilter(xlog({ ipAddr: '10.89.2.13' }), f)).toBe(false);
    expect(passesFilter(xlog({ ipAddr: '10.89.2.14' }), f)).toBe(true);
  });

  it('빈 조건은 제외로 걸어도 전부 통과다', () => {
    // 빈 제외 조건이 전부를 지우면 칸을 비우는 순간 화면이 사라진다.
    const f = { ...DEFAULT_FILTER, ip: { text: '  ', exclude: true } };
    expect(passesFilter(xlog({ ipAddr: '10.89.2.13' }), f)).toBe(true);
  });

  it('서비스명은 해석된 이름으로 거른다', () => {
    const names = new Map([[7, '/shop/lab/jitter<GET>'], [8, '/order/list<GET>']]);
    const name = (h: number) => names.get(h);
    const f = { ...DEFAULT_FILTER, service: { text: 'shop', exclude: false } };
    expect(passesFilter(xlog({ service: 7 }), f, name)).toBe(true);
    expect(passesFilter(xlog({ service: 8 }), f, name)).toBe(false);
  });

  it('대소문자를 가리지 않는다', () => {
    const name = () => '/Shop/Lab/Jitter';
    const f = { ...DEFAULT_FILTER, service: { text: 'SHOP', exclude: false } };
    expect(passesFilter(xlog({ service: 7 }), f, name)).toBe(true);
  });

  it('아직 못 푼 해시는 이름 없음으로 본다', () => {
    // 판단을 보류하고 통과시키면 포함 조건인데 엉뚱한 점이 섞여 보인다.
    const none = () => undefined;
    const include = { ...DEFAULT_FILTER, service: { text: 'shop', exclude: false } };
    const exclude = { ...DEFAULT_FILTER, service: { text: 'shop', exclude: true } };
    expect(passesFilter(xlog({ service: 7 }), include, none)).toBe(false);
    expect(passesFilter(xlog({ service: 7 }), exclude, none)).toBe(true);
  });

  it('조건이 여럿이면 모두 만족해야 한다', () => {
    const name = () => '/shop/lab/jitter';
    const f = {
      ...DEFAULT_FILTER,
      elapsedMs: 1000,
      service: { text: 'shop', exclude: false },
      ip: { text: '10.', exclude: false },
    };
    expect(passesFilter(xlog({ elapsed: 2000, ipAddr: '10.0.0.1' }), f, name)).toBe(true);
    // 응답시간만 어긋나도 빠진다
    expect(passesFilter(xlog({ elapsed: 500, ipAddr: '10.0.0.1' }), f, name)).toBe(false);
  });
});

describe('hasActiveFilter', () => {
  it('기본값은 조건이 없다', () => {
    expect(hasActiveFilter(DEFAULT_FILTER)).toBe(false);
  });

  it('공백만 든 조건은 조건이 아니다', () => {
    // 공백을 조건으로 세면 "필터 때문에 비었다"는 잘못된 안내가 뜬다.
    expect(hasActiveFilter({ ...DEFAULT_FILTER, ip: { text: '   ', exclude: true } })).toBe(false);
  });

  it('하나라도 걸리면 true 다', () => {
    expect(hasActiveFilter({ ...DEFAULT_FILTER, errorOnly: true })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_FILTER, elapsedMs: 1 })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_FILTER, service: { text: 'a', exclude: false } })).toBe(true);
  });
});
