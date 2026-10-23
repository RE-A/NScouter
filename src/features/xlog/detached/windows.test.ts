// 뗀 창을 놓을 자리
//
//   · 놓은 자리에 창 머리가 온다
//   · 화면 끝에 놓아도 그 화면 안에 다 들어온다 — 거의 다 화면 밖에 뜨던 것
//   · 둘째 모니터에 놓으면 둘째 모니터에 뜬다

import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: class {} }));
vi.mock('@tauri-apps/api/window', () => ({ availableMonitors: vi.fn() }));

import { placeWindow } from './windows';

const LEFT = { x: 0, y: 0, width: 1920, height: 1040 };
const RIGHT = { x: 1920, y: 0, width: 1920, height: 1040 };
const SIZE = { width: 1000, height: 640 };

describe('placeWindow', () => {
  it('화면 가운데에 놓으면 그 자리에 머리가 온다', () => {
    expect(placeWindow({ x: 600, y: 300 }, [LEFT], SIZE)).toEqual({ x: 480, y: 284 });
  });

  it('오른쪽 끝에 놓아도 화면 안에 다 들어온다', () => {
    const p = placeWindow({ x: 1900, y: 1000 }, [LEFT], SIZE);
    expect(p.x + SIZE.width).toBeLessThanOrEqual(LEFT.width);
    expect(p.y + SIZE.height).toBeLessThanOrEqual(LEFT.height);
  });

  it('둘째 모니터에 놓으면 둘째 모니터에 뜬다', () => {
    const p = placeWindow({ x: 2500, y: 200 }, [LEFT, RIGHT], SIZE);
    expect(p.x).toBeGreaterThanOrEqual(RIGHT.x);
  });

  it('어느 화면에도 없는 자리면 가장 가까운 화면으로', () => {
    const p = placeWindow({ x: 5000, y: 200 }, [LEFT, RIGHT], SIZE);
    expect(p.x).toBe(RIGHT.x + RIGHT.width - SIZE.width);
  });

  it('화면 정보를 못 받으면 놓은 자리 그대로(음수는 0)', () => {
    expect(placeWindow({ x: 50, y: 5 }, [], SIZE)).toEqual({ x: 0, y: 0 });
  });
});
