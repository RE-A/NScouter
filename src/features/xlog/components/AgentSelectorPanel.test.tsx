// 서버 목록 — **묶음 단위로 고르기.**
//
// 운영에서는 한 콜렉터에 100대가 넘게 붙는다. 한 대씩 눌러 고르게 두면
// 고르는 일 자체가 일이 된다. 규칙은 `agentFilter.ts` 가 맡고,
// 여기서는 **체크박스가 그 규칙에 무엇을 넘기는가** 만 본다.

import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentObject } from '../types/xlog';
import { AgentSelectorPanel } from './AgentSelectorPanel';

const agents: AgentObject[] = [
  { obj_hash: 11, obj_type: 'tomcat', obj_name: '/h/shop-app', address: '', version: '', alive: true, wakeup: 0, tags: [] },
  { obj_hash: 22, obj_type: 'tomcat', obj_name: '/h/order-app', address: '', version: '', alive: true, wakeup: 0, tags: [] },
  { obj_hash: 33, obj_type: 'linux', obj_name: '/h/test-host', address: '', version: '', alive: true, wakeup: 0, tags: [] },
];

vi.mock('../api/scouterApi', () => ({
  getObjectList: () => Promise.resolve(agents),
}));

afterEach(() => vi.clearAllMocks());

function draw(selected: number[] = []) {
  const onSelectionChange = vi.fn();
  render(
    <AgentSelectorPanel
      isConnected
      selectedHashes={new Set(selected)}
      onSelectionChange={onSelectionChange}
      groupBy="type"
      onGroupByChange={() => {}}
    />,
  );
  return { onSelectionChange };
}

/** 묶음 체크박스. `aria-label` 이 묶음 이름이다 */
const groupBox = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

describe('AgentSelectorPanel — 묶음 고르기', () => {
  it('묶음마다 체크박스가 있다', async () => {
    draw();
    await waitFor(() => expect(groupBox('tomcat')).toBeTruthy());
    expect(groupBox('linux')).toBeTruthy();
  });

  it('묶음을 켜면 그 묶음 전부가 넘어간다', async () => {
    const { onSelectionChange } = draw();
    await waitFor(() => expect(groupBox('tomcat')).toBeTruthy());

    fireEvent.click(groupBox('tomcat'));
    const next = onSelectionChange.mock.calls[0][0] as Set<number>;
    expect([...next].sort((a, b) => a - b)).toEqual([11, 22]);
  });

  it('다 골라 둔 묶음을 누르면 통째로 빠진다', async () => {
    const { onSelectionChange } = draw([11, 22]);
    await waitFor(() => expect(groupBox('tomcat')).toBeTruthy());

    fireEvent.click(groupBox('tomcat'));
    expect([...(onSelectionChange.mock.calls[0][0] as Set<number>)]).toEqual([]);
  });

  it('일부만 고른 묶음은 켜짐도 꺼짐도 아니다', async () => {
    draw([11]);
    await waitFor(() => expect(groupBox('tomcat')).toBeTruthy());
    expect(groupBox('tomcat').indeterminate).toBe(true);
    expect(groupBox('tomcat').checked).toBe(false);
  });

  it('다 고른 묶음은 켜져 보인다', async () => {
    draw([11, 22]);
    await waitFor(() => expect(groupBox('tomcat')).toBeTruthy());
    expect(groupBox('tomcat').checked).toBe(true);
  });

  it('다른 묶음의 선택은 건드리지 않는다', async () => {
    const { onSelectionChange } = draw([33]);
    await waitFor(() => expect(groupBox('tomcat')).toBeTruthy());

    fireEvent.click(groupBox('tomcat'));
    expect([...(onSelectionChange.mock.calls[0][0] as Set<number>)].sort((a, b) => a - b))
      .toEqual([11, 22, 33]);
  });
});

describe('AgentSelectorPanel — 머리글', () => {
  it('아무도 안 골랐으면 그렇다고 적는다', async () => {
    // **«전체» 라고 적으면 안 된다.** 이제 안 고른 상태에서는 화면이 비어 있다.
    draw();
    await waitFor(() => expect(screen.getByText('고른 서버 없음')).toBeTruthy());
  });

  it('고른 수를 적는다', async () => {
    // 여기 적히는 수가 곧 화면에 그려지는 서버 수다.
    draw([11, 22]);
    await waitFor(() => expect(screen.getByText('2')).toBeTruthy());
    expect(screen.getByText(/선택 · 해제/)).toBeTruthy();
  });
});
