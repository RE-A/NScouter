// 응답시간 분포 — **화면이 거짓말을 하지 않는가.**
//
// 집계는 Rust 가, 파생값은 `distribution.ts` 가 검증한다.
// 여기서 보는 것은 그 값이 화면에 어떻게 적히는가 하나다:
//   · 0건에 «평균 0ms» 를 적지 않는가
//   · 잘렸다는 사실을 말하는가
//   · 상한에 눌린 백분위를 «그 값» 이라고 단정하지 않는가

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ElapsedHistogram } from './ElapsedHistogram';
import type { ElapsedDistribution } from '../xlog/api/scouterApi';

function dist(over: Partial<ElapsedDistribution> = {}): ElapsedDistribution {
  const bounds = [100, 300, 500, 1_000, 3_000, 5_000, 10_000, null];
  return {
    buckets: bounds.map(lt => ({ lt_ms: lt, count: 0, error: 0 })),
    total: 0,
    error: 0,
    sum_ms: 0,
    max_ms: 0,
    p50_ms: 0,
    p90_ms: 0,
    p99_ms: 0,
    percentile_cap_ms: 30_000,
    truncated: false,
    ...over,
  };
}

/** 첫 칸에 n 건을 넣은 분포 */
function withRows(n: number, over: Partial<ElapsedDistribution> = {}): ElapsedDistribution {
  // 평균(50ms)과 p50(40ms)을 일부러 다르게 둔다 — 같으면 어느 칸을 읽었는지 알 수 없다.
  const d = dist({ total: n, sum_ms: n * 50, max_ms: 90, p50_ms: 40, p90_ms: 80, p99_ms: 90, ...over });
  d.buckets[0] = { ...d.buckets[0], count: n };
  return d;
}

describe('ElapsedHistogram', () => {
  it('아직 안 받았을 때와 받았는데 없을 때를 다르게 말한다', () => {
    // 같은 말로 적으면 «조회가 안 됐다» 와 «그 시간에 트래픽이 없었다» 가 구별되지 않는다.
    const { unmount } = render(<ElapsedHistogram data={null} loading={false} />);
    expect(screen.getByText('아직 받지 않았습니다')).toBeTruthy();
    unmount();

    render(<ElapsedHistogram data={dist()} loading={false} />);
    expect(screen.getByText('이 구간에 트랜잭션이 없습니다')).toBeTruthy();
  });

  it('건수·평균·백분위를 적는다', () => {
    render(<ElapsedHistogram data={withRows(100)} loading={false} />);
    // 요약 줄만 본다 — 아래 막대에도 같은 수가 나온다.
    const summary = within(screen.getByLabelText('요약'));
    expect(summary.getByText('100')).toBeTruthy();
    expect(summary.getByText('50ms')).toBeTruthy(); // 평균 = 5000/100
    expect(summary.getByText('80ms')).toBeTruthy(); // p90
  });

  it('에러가 0 이면 에러 칸을 만들지 않는다', () => {
    // «에러 0» 이 늘 붙어 있으면 그 자리를 안 읽게 된다.
    render(<ElapsedHistogram data={withRows(10)} loading={false} />);
    expect(screen.queryByText('에러')).toBeNull();
  });

  it('상한에 눌린 백분위는 «이상» 으로 적는다', () => {
    // Rust 가 30초보다 느린 건을 30초로 눌러 센다. 30초라고 단정하면 거짓말이다.
    render(
      <ElapsedHistogram
        data={withRows(10, { p99_ms: 30_000, max_ms: 120_000 })}
        loading={false}
      />,
    );
    expect(screen.getByText('≥30s')).toBeTruthy();
    // 최댓값은 눌리지 않는다 — 그건 정확히 알 수 있다.
    expect(screen.getByText('120s')).toBeTruthy();
  });

  it('잘렸다는 사실을 화면이 말한다', () => {
    // 조용히 두면 «이 구간에 이만큼뿐» 으로 읽힌다.
    render(<ElapsedHistogram data={withRows(10, { truncated: true })} loading={false} />);
    expect(screen.getByText(/상한에 걸려/)).toBeTruthy();
  });

  it('칸이 여덟 개다 — 빈 칸도 자리를 지킨다', () => {
    // 빈 칸을 지우면 «10초 넘는 건 아예 없다» 를 볼 수 없다.
    render(<ElapsedHistogram data={withRows(3)} loading={false} />);
    expect(screen.getByText('~100ms')).toBeTruthy();
    expect(screen.getByText('10s+')).toBeTruthy();
  });
});
