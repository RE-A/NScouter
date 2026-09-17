// 상세 패널의 «찾기» 와 «요약에서 뛰기»
//
// 여기서 지키려는 것:
//   · 패널 안 검색은 위쪽 검색바와 **다른 칸**이다 (위는 트랜잭션을 찾고, 여기는 그 안을 찾는다)
//   · 걸린 게 없으면 없다고 말한다 — 조용하면 «검색이 안 되는» 것으로 읽힌다
//   · 요약에서 줄을 누르면 목록으로 넘어가 그 스텝을 짚는다

import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { XLogDetailPanel } from './XLogDetailPanel';
import type { XLogDetailState } from '../hooks/useXLogDetail';
import type { ProfileStep } from '../types/profile';
import type { SXLog } from '../types/xlog';

vi.mock('../hooks/useTextResolver', () => ({
  useTextResolver: () => ({ resolve: () => Promise.resolve({}), getCached: () => undefined }),
}));
// 연관 트랜잭션·흐름은 콜렉터를 부른다. 이 테스트의 관심사가 아니다.
vi.mock('../hooks/useCallTrace', () => ({
  useCallTrace: () => ({ loading: false, error: null, roots: [], rows: [], texts: {} }),
}));
vi.mock('../hooks/useFlowProfiles', () => ({
  useFlowProfiles: () => ({ loading: false, error: null, profiles: new Map(), failed: 0 }),
}));

const base = { parent: -1, index: 0, start_time: 0, start_cpu: 0 };
const sql = (index: number, hash: number, elapsed: number): ProfileStep =>
  ({ kind: 'Sql', ...base, index, hash, param: '', elapsed, error: 0, updated: 0 }) as ProfileStep;

const XLOG = {
  txid: 'z1',
  gxid: '0',
  caller: '0',
  endTime: new Date(2026, 7, 30, 14, 14, 15).getTime(),
  elapsed: 3975,
  objHash: 1,
  service: 7,
  error: 0,
  xType: 0,
  cpu: 0,
  sqlCount: 2,
  sqlTime: 100,
  apiCallCount: 0,
  apiCallTime: 0,
  ipAddr: '10.0.0.1',
  allocKBytes: 0,
  threadNameHash: 0,
} as SXLog;

const STATE: XLogDetailState = {
  isLoading: false,
  error: null,
  xlog: XLOG,
  profile: { txid: 'z1', obj_hash: 1, steps: [sql(0, 7, 10), sql(1, 8, 90), sql(2, 7, 20)] },
  texts: { 7: 'select fruit', 8: 'update basket' },
};

function panel(over: Partial<XLogDetailState> = {}) {
  return render(
    <XLogDetailPanel
      state={{ ...STATE, ...over }}
      onClose={vi.fn()}
      agentMap={new Map()}
      onSelectTrace={vi.fn()}
      onOpenTxid={vi.fn()}
    />,
  );
}

afterEach(() => vi.clearAllMocks());

describe('XLogDetailPanel — 이 안에서 찾기', () => {
  it('친 글자가 걸린 스텝 수를 센다', () => {
    panel();
    fireEvent.change(screen.getByLabelText('이 안에서 찾기'), { target: { value: 'fruit' } });

    // select fruit 이 두 번 나온다
    expect(screen.getByText('1/2')).toBeTruthy();
  });

  it('걸린 게 없으면 없다고 말한다', () => {
    panel();
    fireEvent.change(screen.getByLabelText('이 안에서 찾기'), { target: { value: 'zzzz' } });

    expect(screen.getByText('없음')).toBeTruthy();
  });

  it('빈 칸이면 위쪽 검색어를 그대로 쓴다', () => {
    // 패널 칸을 비워 두면 예전처럼 검색바가 데려온 자리를 짚어야 한다.
    render(
      <XLogDetailPanel
        state={STATE}
        onClose={vi.fn()}
        agentMap={new Map()}
        onSelectTrace={vi.fn()}
        onOpenTxid={vi.fn()}
        searchQuery="basket"
      />,
    );
    expect(screen.getByText('1/1')).toBeTruthy();
  });
});

describe('XLogDetailPanel — 요약에서 목록으로', () => {
  it('요약 줄을 누르면 목록으로 넘어간다', () => {
    panel();
    fireEvent.click(screen.getByRole('button', { name: '요약' }));
    // 요약 표가 떴다 — 정렬 버튼의 툴팁으로 확인한다
    expect(screen.getByTitle('무엇이 반복되나')).toBeTruthy();

    fireEvent.click(screen.getAllByTitle(/누르면 목록에서 이 스텝으로 갑니다/)[0]);

    // 목록으로 돌아왔다 — 요약 표의 정렬 버튼이 사라진다
    expect(screen.queryByTitle('무엇이 반복되나')).toBeNull();
  });
});

describe('XLogDetailPanel — 찾으면 그 자리로 데려간다', () => {
  // 60 스텝 중 40번째만 target 을 담는다. 나머지는 모두 «select common».
  const many: ProfileStep[] = Array.from({ length: 60 }, (_, i) => sql(i, i === 40 ? 9 : 7, 5));
  const MANY: Partial<XLogDetailState> = {
    profile: { txid: 'z1', obj_hash: 1, steps: many },
    texts: { 7: 'select common', 9: 'select target_table where x' },
  };

  /** 스크롤이 불린 줄의 글자. jsdom 에는 scrollIntoView 가 없어 흉내 낸다 */
  function recordScrolls(): string[] {
    const calls: string[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      calls.push(this.textContent ?? '');
    });
    return calls;
  }

  it('검색어를 고쳐도 첫 적중이 같은 줄이면 다시 그 줄로 데려간다', () => {
    // 재현한 결함: 강조가 «켜질 때» 만 스크롤해서, ta → tar → target 동안 화면이 멈춰 있었다.
    // 읽느라 스크롤을 옮겨 둔 뒤 검색어를 다듬으면 결과가 화면 밖에 그대로 남았다.
    const calls = recordScrolls();
    panel(MANY);
    const box = screen.getByLabelText('이 안에서 찾기');

    fireEvent.change(box, { target: { value: 'targ' } });
    const afterFirst = calls.length;
    fireEvent.change(box, { target: { value: 'target' } });
    fireEvent.change(box, { target: { value: 'target_' } });

    expect(calls.length - afterFirst).toBe(2);
    expect(calls[calls.length - 1]).toContain('target_table');
  });

  it('Enter 는 다음 적중, Shift+Enter 는 이전 적중이다', () => {
    panel();
    const box = screen.getByLabelText('이 안에서 찾기');
    fireEvent.change(box, { target: { value: 'fruit' } });
    expect(screen.getByText('1/2')).toBeTruthy();

    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByText('2/2')).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByText('1/2')).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(screen.getByText('2/2')).toBeTruthy();
  });

  it('적중이 하나뿐이어도 Enter 를 누르면 다시 그 줄로 데려간다', () => {
    // 옮겨 갈 곳이 없다고 아무 일도 안 하면 «Enter 가 안 먹는다» 로 읽힌다.
    const calls = recordScrolls();
    panel(MANY);
    const box = screen.getByLabelText('이 안에서 찾기');
    fireEvent.change(box, { target: { value: 'target' } });
    const before = calls.length;
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(calls.length).toBeGreaterThan(before);
  });

  it('한글 조합 중의 Enter 는 이동으로 치지 않는다', () => {
    // 조합을 끝내는 Enter 까지 이동으로 받으면 한 글자 칠 때마다 적중이 넘어간다.
    panel();
    const box = screen.getByLabelText('이 안에서 찾기');
    fireEvent.change(box, { target: { value: 'fruit' } });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(screen.getByText('1/2')).toBeTruthy();
  });
});
