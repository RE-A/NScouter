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

describe('AgentSelectorPanel — 종류 식별', () => {
  it('그룹으로 묶으면 줄마다 종류를 적는다', async () => {
    // 그룹(호스트)으로 묶으면 묶음 머리가 종류를 말해 주지 않는다. WAS 와
    // 커넥션 풀이 한 호스트 아래 나란히 있는데 이름만으로는 가를 수 없다.
    render(
      <AgentSelectorPanel
        isConnected
        selectedHashes={new Set()}
        onSelectionChange={() => {}}
        groupBy="group"
        onGroupByChange={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('shop-app')).toBeTruthy());
    expect(screen.getAllByTitle(/오브젝트 종류 — tomcat/)).toHaveLength(2);
    expect(screen.getAllByTitle(/오브젝트 종류 — linux/)).toHaveLength(1);
  });

  it('타입으로 묶으면 줄에 되풀이하지 않는다', async () => {
    draw();
    await waitFor(() => expect(groupBox('tomcat')).toBeTruthy());
    // 묶음 머리가 이미 그 말을 하고 있다.
    expect(screen.queryByTitle(/오브젝트 종류 —/)).toBeNull();
  });

  it('종류 칩으로 목록을 줄인다', async () => {
    draw();
    await waitFor(() => expect(groupBox('linux')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /^tomcat/ }));

    await waitFor(() => expect(screen.queryByLabelText('linux')).toBeNull());
    expect(groupBox('tomcat')).toBeTruthy();
  });

  it('칩을 도로 끄면 전부 돌아온다', async () => {
    draw();
    await waitFor(() => expect(groupBox('linux')).toBeTruthy());

    const chip = screen.getByRole('button', { name: /^tomcat/ });
    fireEvent.click(chip);
    await waitFor(() => expect(screen.queryByLabelText('linux')).toBeNull());
    fireEvent.click(chip);

    // 다 끈 상태는 «아무것도 안 봄» 이 아니라 «거를 것이 없다» 다.
    await waitFor(() => expect(groupBox('linux')).toBeTruthy());
  });
});

describe('AgentSelectorPanel — 종류가 하나뿐이면', () => {
  it('칩도 배지도 뜨지 않는다', async () => {
    // 모든 줄에 `tomcat` 이 붙는 건 정보가 아니라 여백을 먹는 글자다.
    vi.resetModules();
    const only = agents.filter(a => a.obj_type === 'tomcat');
    vi.doMock('../api/scouterApi', () => ({ getObjectList: () => Promise.resolve(only) }));
    const { AgentSelectorPanel: Panel } = await import('./AgentSelectorPanel');

    render(
      <Panel
        isConnected
        selectedHashes={new Set()}
        onSelectionChange={() => {}}
        groupBy="group"
        onGroupByChange={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('shop-app')).toBeTruthy());
    expect(screen.queryByTitle(/오브젝트 종류 —/)).toBeNull();
    expect(screen.queryByText('종류')).toBeNull();
  });
});
