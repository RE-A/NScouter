// 트리 오른쪽 클릭 «… 열기» — 종류에 맞는 판만, 누르면 그 종류·카운터로 연다

import { describe, expect, it, vi } from 'vitest';
import { panelMenuItems } from './panelMenu';

describe('panelMenuItems', () => {
  it('자바 서버 — XLog·EQ·Active·요약·카운터, 호스트 카운터는 없다', () => {
    const labels = panelMenuItems(() => {}, 'tomcat').map(i => i.label);
    expect(labels[0]).toBe('XLog 열기');
    expect(labels.some(l => l.includes('TPS'))).toBe(true);
    expect(labels.some(l => l.includes('CPU'))).toBe(false);
  });

  it('호스트 — 호스트 카운터만', () => {
    const labels = panelMenuItems(() => {}, 'linux').map(i => i.label);
    expect(labels.some(l => l.includes('XLog'))).toBe(false);
    expect(labels.some(l => l.includes('CPU'))).toBe(true);
  });

  it('종류가 섞인 묶음 — 둘 다', () => {
    const labels = panelMenuItems(() => {}, null).map(i => i.label);
    expect(labels.some(l => l.includes('XLog'))).toBe(true);
    expect(labels.some(l => l.includes('CPU'))).toBe(true);
  });

  it('누르면 종류와 카운터 이름을 넘긴다', () => {
    const open = vi.fn();
    const items = panelMenuItems(open, 'tomcat');
    items.find(i => i.label.includes('TPS'))!.onSelect();
    items[0].onSelect();
    expect(open.mock.calls).toEqual([['counter', 'TPS'], ['xlog']]);
  });
});
