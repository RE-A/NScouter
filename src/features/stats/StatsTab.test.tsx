// 통계 탭 — 지난 결과를 열면 비교 표가 나빠진 순으로 뜨고, 줄을 누르면 그 서비스를 펼친다

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import type { JobInfo, StatsRequest, StatsResult, StatsSummary } from './statsApi';
import { StatsTab } from './StatsTab';

// 창 닫기 — 닫으려는 순간의 처리기를 잡아 두고 시험에서 부른다
const win = vi.hoisted(() => ({
  onClose: null as null | ((e: { preventDefault: () => void }) => void),
  destroy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: (fn: (e: { preventDefault: () => void }) => void) => {
      win.onClose = fn;
      return Promise.resolve(() => {});
    },
    destroy: win.destroy,
  }),
}));

const s = (over: Partial<StatsSummary> = {}): StatsSummary => ({
  count: 1000, errors: 0, error_rate: 0, tps: 1, avg_ms: 200, p50_ms: 150, p90_ms: 400, p95_ms: 500, p99_ms: 900,
  max_ms: 2000, sql_count_avg: 3, sql_ms_avg: 50, api_count_avg: 1, api_ms_avg: 20, cpu_ms_avg: 5,
  series: [], dist: [], slowest: [], errored: [], ...over,
});

const req: StatsRequest = {
  title: 'shop 오전', groups: ['shop-app'], servers: [], task_patterns: [],
  current: { stime: 1_000_000, etime: 4_600_000 }, baselines: [{ stime: 1, etime: 3_600_001 }],
  services: [], service_include: [], service_exclude: [], ip_include: [], ip_exclude: [], tz_offset_ms: 0, raw: true,
};
const job: JobInfo = { id: '1-0', title: 'shop 오전', status: 'done', started_at: 10, finished_at: 20, request: req, progress: null, services: 2 };
const result: StatsResult = {
  id: '1-0', request: req, started_at: 10, finished_at: 20, status: 'done', message: null, collectors: ['A'],
  ranges: [], raw_path: '/x/exports/raw.csv', raw_rows: 2000, raw_error: null, raw_files: 1, folded: 0,
  services: [
    { service: '/same', current: s({ count: 5000 }), baseline: s() },
    { service: '/slow', current: s({ avg_ms: 2000 }), baseline: s() },
    { service: '/old', current: null, baseline: s() },
  ],
};

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case 'stats_jobs': return [job];
      case 'stats_result': return result;
      case 'stats_service': return result.services[1];
      case 'get_config': return { stats_rules: [{ name: 'shop', patterns: ['shop-app-*'] }] };
      case 'stats_save_rules': return null;
      default: throw new Error(cmd);
    }
  });
});

describe('StatsTab', () => {
  it('지난 결과를 열면 나빠진 것이 위로, 줄을 누르면 펼친다', async () => {
    render(<StatsTab connected groups={['shop-app']} servers={[]} onOpenTxid={() => {}} />);
    fireEvent.click(await screen.findByText('shop 오전'));
    await screen.findByTitle('/slow');
    // 머리글이 두 줄이다
    const rows = screen.getAllByRole('row').slice(2);
    // 과거에만 있던 서비스는 기본으로 숨기고 «과거에만 있음» 칩을 눌러야 보인다
    expect(rows.length).toBe(2);
    expect(screen.queryByText('/old')).toBeNull();
    expect(rows[0].textContent).toContain('/slow');
    expect(rows[0].textContent).toContain('느려짐');
    // 원본 CSV 를 남긴 작업은 단추가 뜬다
    expect(screen.getByText('원본 CSV')).toBeTruthy();
    fireEvent.click(rows[0]);
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith('stats_service', { id: '1-0', service: '/slow' }));
  });

  it('대상과 과거 구간이 없으면 시작하지 못한다', async () => {
    render(<StatsTab connected groups={['shop-app']} servers={[]} onOpenTxid={() => {}} />);
    expect(screen.getByText('대상을 고르세요')).toBeTruthy();
    expect((screen.getByText('통계 시작') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('묶음 이름'), { target: { value: 'shop-app' } });
    expect(screen.getByText('과거 구간을 하나 이상 넣으세요')).toBeTruthy();
    fireEvent.click(screen.getByText('+ 어제 같은 시각'));
    expect((screen.getByText('통계 시작') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Task 이름 규칙 — 저장한 규칙을 불러오고, 지금 걸리는 서버를 보이고, 새 이름으로 저장한다', async () => {
    render(<StatsTab connected groups={[]} servers={['/h/shop-app-1', '/h/shop-app-2', '/h/order-1']} onOpenTxid={() => {}} />);
    fireEvent.click(screen.getByText('Task 이름 규칙'));
    const pick = await screen.findByLabelText('저장한 규칙');
    await waitFor(() => expect(screen.getByRole('option', { name: 'shop' })).toBeTruthy());
    fireEvent.change(pick, { target: { value: 'shop' } });
    expect((screen.getByPlaceholderText(/shop-app-\*/) as HTMLTextAreaElement).value).toBe('shop-app-*');
    expect(screen.getByText(/지금 걸리는 서버/).textContent).toMatch(/지금 걸리는 서버 2.*shop-app-1, shop-app-2$/);
    fireEvent.change(screen.getByPlaceholderText('규칙 이름 (저장할 때)'), { target: { value: 'shop2' } });
    fireEvent.click(screen.getByText('규칙 저장'));
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith('stats_save_rules', {
        rules: [{ name: 'shop2', patterns: ['shop-app-*'] }, { name: 'shop', patterns: ['shop-app-*'] }],
      }),
    );
  });

  it('돌고 있는 작업이 있으면 바로 닫지 않고 묻고, 닫기로 하면 저장을 기다린 뒤 닫는다', async () => {
    const runningJob: JobInfo = { ...job, id: '2-0', title: '도는 작업', status: 'running', progress: { phase: 'queue', slices_total: 0, slices_done: 0, scanned: 0, matched: 0, started_at: 0, eta_ms: null, paused: false } };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'stats_jobs') return [runningJob];
      if (cmd === 'stats_shutdown') return 1;
      return null;
    });
    render(<StatsTab connected groups={[]} servers={[]} onOpenTxid={() => {}} />);
    await screen.findByText('도는 작업');
    expect(screen.getByText('대기'), '앞 작업을 기다리는 중').toBeTruthy();
    const prevent = vi.fn();
    act(() => win.onClose?.({ preventDefault: prevent }));
    expect(prevent).toHaveBeenCalled();
    fireEvent.click(await screen.findByText('중단하고 닫기'));
    await waitFor(() => expect(win.destroy).toHaveBeenCalled());
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('stats_shutdown');
  });

  it('한 건도 못 받은 과거 구간은 알린다 — 보관 기간이 지나면 모든 서비스가 «기준에만 있음» 으로 뜬다', async () => {
    const empty: StatsResult = {
      ...result,
      ranges: [
        { kind: 'current', stime: 1_000_000, etime: 4_600_000, servers: ['/h/shop-1'], slices: 12, slices_done: 12, missing: [], scanned: 500 },
        { kind: 'baseline', stime: 1, etime: 3_600_001, servers: ['/h/shop-1'], slices: 12, slices_done: 12, missing: [], scanned: 0 },
      ],
    };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'stats_jobs') return [job];
      if (cmd === 'stats_result') return empty;
      return null;
    });
    render(<StatsTab connected groups={[]} servers={[]} onOpenTxid={() => {}} />);
    fireEvent.click(await screen.findByText('shop 오전'));
    expect((await screen.findByText(/데이터가 하나도 없는 구간/)).textContent).toContain('과거');
  });
});
