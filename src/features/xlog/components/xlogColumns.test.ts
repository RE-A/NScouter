// 트랜잭션 표 열 너비의 계약
//
//   · 안 정한 열은 예전 배치(+칸 여백)다
//   · 어느 경계를 끌든 잡은 선이 커서를 따라온다 — URL 왼쪽은 왼쪽 열, 오른쪽은 오른쪽 열이 바뀐다
//   · 끌기는 그려진 너비에서 시작한다(안 정한 열이 튀지 않는다)
//   · URL 은 바닥(112px) 밑으로 안 준다. 다른 열도 36px 밑으로 안 준다
//   · 두 번 누르면 그 열만 기본으로

import { describe, expect, it } from 'vitest';
import {
  MIN_COL_W,
  MIN_URL_W,
  gridTemplate,
  normalizeColWidths,
  resetAt,
  resizeAt,
  visibleCols,
} from './xlogColumns';

const cols = visibleCols(false); // time server url ip elapsed
const colsY = visibleCols(true);
const measured = { time: 90, server: 104, url: 400, ip: 96, elapsed: 74, y: 74 };

describe('gridTemplate', () => {
  it('안 정한 열은 예전 배치에 칸 여백을 더한 것이다', () => {
    expect(gridTemplate({}, false)).toBe(
      `calc(var(--fs-micro)*8 + 16px) minmax(0,120px) minmax(${MIN_URL_W}px,1fr) minmax(0,112px) 90px`,
    );
  });

  it('정한 열은 px 로, URL 은 늘 남는 자리다', () => {
    expect(gridTemplate({ server: 200, y: 90 }, true)).toBe(
      `calc(var(--fs-micro)*8 + 16px) 200px minmax(${MIN_URL_W}px,1fr) minmax(0,112px) 90px 90px`,
    );
  });
});

describe('resizeAt', () => {
  it('URL 왼쪽 경계는 왼쪽 열을 넓힌다 — 서버|URL 을 오른쪽으로 끌면 서버가 넓어진다', () => {
    expect(resizeAt({}, cols, 1, 30, measured)).toEqual({ server: 134 });
  });

  it('URL 오른쪽 경계는 오른쪽 열을 바꾼다 — URL|IP 를 왼쪽으로 끌면 IP 가 넓어진다', () => {
    expect(resizeAt({}, cols, 2, -40, measured)).toEqual({ ip: 136 });
    // 오른쪽으로 끌면 IP 가 준다
    expect(resizeAt({}, cols, 2, 40, measured)).toEqual({ ip: 56 });
  });

  it('끝 쪽 경계도 오른쪽 열이 바뀐다 — Elapsed|Y 를 왼쪽으로 끌면 Y 가 넓어진다', () => {
    expect(resizeAt({}, colsY, 4, -20, measured)).toEqual({ y: 94 });
  });

  it('그려진 너비에서 시작한다 — 저장해 둔 값이 아니라', () => {
    expect(resizeAt({ server: 300 }, cols, 1, 10, measured)).toEqual({ server: 114 });
  });

  it('URL 은 바닥 밑으로 안 준다', () => {
    const narrowUrl = { ...measured, url: 150 };
    expect(resizeAt({}, cols, 1, 500, narrowUrl)).toEqual({ server: 104 + (150 - MIN_URL_W) });
  });

  it('열은 최소 너비 밑으로 안 준다', () => {
    expect(resizeAt({}, cols, 0, -500, measured)).toEqual({ time: MIN_COL_W });
  });

  it('없는 경계는 그대로다', () => {
    const w = { server: 120 };
    expect(resizeAt(w, cols, -1, 10, measured)).toBe(w);
    expect(resizeAt(w, cols, cols.length - 1, 10, measured)).toBe(w);
  });
});

describe('resetAt', () => {
  it('그 경계가 바꾸는 열만 기본으로', () => {
    expect(resetAt({ server: 200, ip: 150 }, cols, 2)).toEqual({ server: 200 });
    expect(resetAt({ server: 200, ip: 150 }, cols, 1)).toEqual({ ip: 150 });
  });
});

describe('normalizeColWidths', () => {
  it('모르는 열·이상한 값은 버리고, 범위 밖은 민다', () => {
    expect(normalizeColWidths({ server: 150, url: 300, ip: -3, time: 'x', elapsed: 5, y: 9999 })).toEqual({
      server: 150,
      elapsed: MIN_COL_W,
      y: 2000,
    });
    expect(normalizeColWidths(null)).toEqual({});
  });
});
