import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { claudeCodeCommand, cursorConfig, mcpUrl, McpSection } from './McpSection';

const TOKEN = 'ab'.repeat(24);

vi.mock('../xlog/api/scouterApi', () => ({
  mcpSync: () =>
    Promise.resolve({
      enabled: true, running: true, port: 7200, token: 'ab'.repeat(24), bind_values: false, error: null,
      limits: { list_max: 500, detail_max: 5, max_minutes: 360, scan_max_rows: 200000, profile_fetch_max: 2000, profile_budget_sec: 15, profile_searches: 2 },
    }),
  mcpConfigure: () => Promise.reject(new Error('not used')),
  mcpRegenerateToken: () => Promise.reject(new Error('not used')),
  mcpSetLimits: () => Promise.reject(new Error('not used')),
}));

describe('AI 연결 (MCP)', () => {
  it('Claude Code 명령은 http 전송·주소·토큰 머리를 한 줄에 담는다', () => {
    expect(claudeCodeCommand(7165, TOKEN)).toBe(
      `claude mcp add --transport http nscouter http://127.0.0.1:7165/mcp --header "Authorization: Bearer ${TOKEN}"`,
    );
  });

  it('조회 한도는 접혀 있다가 펼치면 지금 값이 보인다', async () => {
    render(<McpSection />);
    const btn = await screen.findByText('조회 한도 (건수·시간)');
    fireEvent.click(btn);
    expect(screen.getByDisplayValue('2000')).toBeTruthy();
    expect(screen.getByDisplayValue('15')).toBeTruthy();
  });

  it('Cursor 설정은 그대로 붙여 넣을 수 있는 JSON 이다', () => {
    const v = JSON.parse(cursorConfig(7165, TOKEN)) as {
      mcpServers: { nscouter: { url: string; headers: Record<string, string> } };
    };
    expect(v.mcpServers.nscouter.url).toBe(mcpUrl(7165));
    expect(v.mcpServers.nscouter.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('켜져 있으면 주소와 붙이는 방법을 보여 준다', async () => {
    render(<McpSection />);
    expect(await screen.findByText(claudeCodeCommand(7200, TOKEN))).toBeTruthy();
    expect(screen.getByText(/http:\/\/127\.0\.0\.1:7200\/mcp/, { selector: 'span' })).toBeTruthy();
  });
});
