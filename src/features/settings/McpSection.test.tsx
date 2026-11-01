import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { claudeCodeCommand, cursorConfig, mcpUrl, McpSection } from './McpSection';

const TOKEN = 'ab'.repeat(24);

vi.mock('../xlog/api/scouterApi', () => ({
  mcpSync: () =>
    Promise.resolve({ enabled: true, running: true, port: 7200, token: 'ab'.repeat(24), bind_values: false, error: null }),
  mcpConfigure: () => Promise.reject(new Error('not used')),
  mcpRegenerateToken: () => Promise.reject(new Error('not used')),
}));

describe('AI 연결 (MCP)', () => {
  it('Claude Code 명령은 http 전송·주소·토큰 머리를 한 줄에 담는다', () => {
    expect(claudeCodeCommand(7100, TOKEN)).toBe(
      `claude mcp add --transport http nscouter http://127.0.0.1:7100/mcp --header "Authorization: Bearer ${TOKEN}"`,
    );
  });

  it('Cursor 설정은 그대로 붙여 넣을 수 있는 JSON 이다', () => {
    const v = JSON.parse(cursorConfig(7100, TOKEN)) as {
      mcpServers: { nscouter: { url: string; headers: Record<string, string> } };
    };
    expect(v.mcpServers.nscouter.url).toBe(mcpUrl(7100));
    expect(v.mcpServers.nscouter.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('켜져 있으면 주소와 붙이는 방법을 보여 준다', async () => {
    render(<McpSection />);
    expect(await screen.findByText(claudeCodeCommand(7200, TOKEN))).toBeTruthy();
    expect(screen.getByText(/http:\/\/127\.0\.0\.1:7200\/mcp/, { selector: 'span' })).toBeTruthy();
  });
});
