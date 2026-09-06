// 격자가 화면에 무엇을 적는가.
//
// 줄 세우기·최악 지표 고르기는 `instanceRows.test.ts` 가 맡는다.
// 여기서 보는 것은 **누를 수 있는가**와 **색이 붙는가** 뿐이다.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InstanceGrid } from './InstanceGrid';
import { buildRows, type InstanceValues } from './instanceRows';
import { DEFAULT_THRESHOLDS } from './threshold';

const agentMap = new Map<number, string>([
  [11, '/test-host/shop-app'],
  [22, '/test-host/order-app'],
  [33, '/test-host/test-host'],
]);

function rowsOf(samples: [number, InstanceValues][], javaeeHashes: number[] = [11, 22]) {
  return buildRows({
    samples: new Map(samples),
    agentMap,
    javaeeHashes,
    thresholds: DEFAULT_THRESHOLDS,
  });
}

function draw(samples: [number, InstanceValues][], javaeeHashes: number[] = [11, 22]) {
  const onDrill = vi.fn();
  const view = render(<InstanceGrid rows={rowsOf(samples, javaeeHashes)} onDrill={onDrill} />);
  return { ...view, onDrill };
}

describe('InstanceGrid', () => {
  it('서버마다 한 칸을 그린다', () => {
    draw([[11, { tps: 20 }], [22, { tps: 10 }]]);
    expect(screen.getByText('shop-app')).toBeTruthy();
    expect(screen.getByText('order-app')).toBeTruthy();
  });

  it('가장 나쁜 지표 하나만 적는다', () => {
    // 칸이 좁다. 여섯 개를 다 적으면 격자가 다시 나열이 된다.
    draw([[11, { tps: 20, heap: 95 }]]);
    expect(screen.getByText('Heap 95.0%')).toBeTruthy();
    expect(screen.queryByText(/TPS/)).toBeNull();
  });

  it('위험한 칸에 위험 띠가 붙는다', () => {
    const { container } = draw([[11, { heap: 95 }]]);
    expect(container.querySelectorAll('.bg-danger').length).toBe(1);
  });

  it('임계 안이면 아무 색도 쓰지 않는다', () => {
    const { container } = draw([[11, { heap: 30 }]]);
    expect(container.querySelectorAll('.bg-warn, .bg-danger').length).toBe(0);
  });

  it('나쁜 칸이 앞에 온다', () => {
    // 백 대가 붙어 있어도 봐야 할 것이 첫 줄에 와야 한다.
    draw([[11, { heap: 30 }], [22, { heap: 95 }]]);
    const names = screen.getAllByRole('button').map(b => b.textContent);
    expect(names[0]).toContain('order-app');
  });

  it('머리글에 위험·주의 수를 적는다', () => {
    draw([[11, { heap: 95 }], [22, { heap: 75 }], [33, { cpu: 10 }]], []);
    expect(screen.getByText(/3대 · 위험 1 · 주의 1/)).toBeTruthy();
  });

  it('아무 문제 없으면 등급 수를 적지 않는다', () => {
    // «위험 0 · 주의 0» 이 늘 붙어 있으면 그 자리를 안 읽게 된다.
    draw([[11, { heap: 30 }]]);
    expect(screen.queryByText(/위험|주의/)).toBeNull();
  });

  it('javaee 서버는 눌러서 파고들 수 있다', () => {
    const { onDrill } = draw([[11, { tps: 20 }]]);
    fireEvent.click(screen.getByText('shop-app'));
    expect(onDrill).toHaveBeenCalledWith(11);
  });

  it('호스트 서버는 눌리지 않는다', () => {
    // 트랜잭션이 없으므로 데려가 봐야 빈 화면이다.
    const { onDrill } = draw([[33, { cpu: 20 }]], []);
    const btn = screen.getByText('test-host').closest('button');
    expect(btn?.hasAttribute('disabled')).toBe(true);
    fireEvent.click(btn as HTMLElement);
    expect(onDrill).not.toHaveBeenCalled();
  });

  it('마우스를 올리면 전체 이름을 보여준다', () => {
    // 짧은 이름은 서버가 여럿일 때 겹칠 수 있다.
    draw([[11, { tps: 20 }]]);
    expect(screen.getByTitle(/^\/test-host\/shop-app — /)).toBeTruthy();
  });

  it('받은 지표가 없으면 그렇다고 적는다', () => {
    // 빈 격자만 두면 고장으로 읽힌다.
    draw([]);
    expect(screen.getByText(/아직 받은 지표가 없습니다/)).toBeTruthy();
  });
});
