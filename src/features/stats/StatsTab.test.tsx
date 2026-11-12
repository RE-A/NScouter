// 통계 탭 — 지난 결과를 열면 비교 표가 나빠진 순으로 뜨고, 줄을 누르면 그 서비스를 펼친다

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import type { JobInfo, StatsRequest, StatsResult, StatsSummary } from './statsApi';
import { StatsTab } from './StatsTab';

const s = (over: Partial<StatsSummary> = {}): StatsSummary => ({
  count: 1000, errors: 0, error_rate: 0, tps: 1, avg_ms: 200, p50_ms: 150, p90_ms: 400, p95_ms: 500, p99_ms: 900,
  max_ms: 2000, sql_count_avg: 3, sql_ms_avg: 50, api_count_avg: 1, api_ms_avg: 20, cpu_ms_avg: 5,
  series: [], dist: [], slowest: [], errored: [], ...over,
});

const req: StatsRequest = {
  title: 'shop 오전', groups: ['shop-app'], servers: [],
  current: { stime: 1_000_000, etime: 4_600_000 }, baselines: [{ stime: 1, etime: 3_600_001 }],
  services: [], service_include: [], service_exclude: [], ip_include: [], ip_exclude: [], tz_offset_ms: 0, raw: true,
};
const job: JobInfo = { id: '1-0', title: 'shop 오전', status: 'done', started_at: 10, finished_at: 20, request: req, progress: null, services: 2 };
const result: StatsResult = {
  id: '1-0', request: req, started_at: 10, finished_at: 20, status: 'done', message: null, collectors: ['A'],
  ranges: [], raw_path: '/x/exports/raw.csv', raw_rows: 2000, raw_error: null,
  services: [
    { service: '/same', current: s({ count: 5000 }), baseline: s() },
    { service: '/slow', current: s({ avg_ms: 900 }), baseline: s() },
  ],
};

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case 'stats_jobs': return [job];
      case 'stats_result': return result;
      case 'stats_service': return result.services[1];
      default: throw new Error(cmd);
    }
  });
});

describe('StatsTab', () => {
  it('지난 결과를 열면 나빠진 것이 위로, 줄을 누르면 펼친다', async () => {
    render(<StatsTab connected groups={['shop-app']} servers={[]} onOpenTxid={() => {}} />);
    fireEvent.click(await screen.findByText('shop 오전'));
    await screen.findByText('/slow');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0].textContent).toContain('/slow');
    expect(rows[0].textContent).toContain('느려짐');
    // 원본 CSV 를 남긴 작업은 단추가 뜬다
    expect(screen.getByText('원본 CSV')).toBeTruthy();
    fireEvent.click(rows[0]);
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith('stats_service', { id: '1-0', service: '/slow' }));
  });

  it('대상과 기준 구간이 없으면 시작하지 못한다', async () => {
    render(<StatsTab connected groups={['shop-app']} servers={[]} onOpenTxid={() => {}} />);
    expect(screen.getByText('대상을 고르세요')).toBeTruthy();
    expect((screen.getByText('통계 시작') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('묶음 이름'), { target: { value: 'shop-app' } });
    expect(screen.getByText('기준 구간을 하나 이상 넣으세요')).toBeTruthy();
    fireEvent.click(screen.getByText('+ 어제 같은 시각'));
    expect((screen.getByText('통계 시작') as HTMLButtonElement).disabled).toBe(false);
  });
});
