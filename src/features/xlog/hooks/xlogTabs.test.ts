// XLog 탭의 계약
//
// 여기서 지키려는 것:
//   · 새 탭은 **지금 탭을 복제**한다 — 비교하려고 여는 것이니 날짜만 바꾸면 되게
//   · 복제본이 원본과 **상태를 나눠 갖지 않는다** (Set 얕은 복사 함정)
//   · 마지막 하나는 안 닫힌다 — 다 닫으면 돌아올 길이 없다
//   · 닫으면 **이웃**으로 옮긴다 (매번 첫 탭으로 튀지 않는다)
//   · 고친 것은 **그 탭만** 바뀐다. 그게 탭을 나눈 이유다
//   · 서버 고르기도 **탭마다**다 — 한쪽을 고쳐도 다른 탭은 그대로
//   · 화면 분할: 끌어 놓은 자리에 서고, 상한을 넘기면 바꾼다. 판을 내려도 탭은 남는다
//   · 이름은 붙일 수 있고, 안 붙인 이름이 겹치면 순번으로 가른다

import { describe, expect, it } from 'vitest';
import {
  activate,
  activeTab,
  addTab,
  clearSelections,
  closePane,
  closeTab,
  dropTab,
  initialTabs,
  MAX_PANES,
  MAX_XLOG_TABS,
  patchActive,
  renameTab,
  setRatio,
  setResolved,
  tabLabels,
  tabTitle,
} from './xlogTabs';

/** 2026-10-19 14:00 ~ 15:30 */
const RANGE = {
  stime: new Date(2026, 9, 19, 14, 0).getTime(),
  etime: new Date(2026, 9, 19, 15, 30).getTime(),
};

describe('처음', () => {
  it('탭 하나로 시작하고 그게 활성이다', () => {
    const s = initialTabs();
    expect(s.tabs).toHaveLength(1);
    expect(activeTab(s).key).toBe(s.activeKey);
    expect(activeTab(s).mode).toBe('live');
  });
});

describe('탭 이름', () => {
  it('실시간은 실시간이라 적는다', () => {
    expect(tabTitle(activeTab(initialTabs()))).toBe('실시간');
  });

  it('과거는 구간이 곧 이름이다', () => {
    const tab = { ...activeTab(initialTabs()), mode: 'past' as const, pastRange: RANGE };
    expect(tabTitle(tab)).toBe('10/19 14:00~15:30');
  });

  it('날짜를 넘기면 끝 날짜도 적는다 — 안 적으면 거꾸로 읽힌다', () => {
    const tab = {
      ...activeTab(initialTabs()),
      mode: 'past' as const,
      pastRange: {
        stime: new Date(2026, 9, 19, 23, 0).getTime(),
        etime: new Date(2026, 9, 20, 1, 0).getTime(),
      },
    };
    expect(tabTitle(tab)).toBe('10/19 23:00~10/20 01:00');
  });

  it('과거인데 구간을 아직 안 정했으면 그렇게 적는다', () => {
    const tab = { ...activeTab(initialTabs()), mode: 'past' as const, pastRange: null };
    expect(tabTitle(tab)).toBe('과거');
  });
});

describe('탭 더하기', () => {
  it('지금 탭을 복제한다', () => {
    let s = initialTabs();
    s = patchActive(s, { mode: 'past', pastRange: RANGE });
    s = addTab(s);

    expect(s.tabs).toHaveLength(2);
    expect(activeTab(s).mode).toBe('past');
    expect(activeTab(s).pastRange).toEqual(RANGE);
  });

  it('복제본이 원본 바로 옆에 온다 — 맨 뒤로 보내면 비교할 둘이 떨어진다', () => {
    let s = initialTabs();
    const first = s.activeKey;
    s = addTab(s);           // [first, A]
    s = addTab(s);           // [first, A, B]  (A 옆)
    s = activate(s, first);
    s = addTab(s);           // [first, C, A, B]

    expect(s.tabs[0].key).toBe(first);
    expect(s.tabs[1].key).toBe(s.activeKey);
  });

  it('복제본이 원본과 고른 서버를 나눠 갖지 않는다', () => {
    let s = initialTabs();
    s = setResolved(s, s.activeKey, new Set([1, 2]));
    s = addTab(s);
    // 복제본에서 서버를 더해도 원본이 안 바뀌어야 한다
    activeTab(s).filter.objHashSet.add(99);

    const origin = s.tabs.find(t => t.key !== s.activeKey);
    expect([...(origin?.filter.objHashSet ?? [])].sort()).toEqual([1, 2]);
  });

  it('상한을 넘기면 더 안 는다 — 버퍼가 탭마다 따로다', () => {
    let s = initialTabs();
    for (let i = 0; i < MAX_XLOG_TABS + 3; i++) s = addTab(s);
    expect(s.tabs).toHaveLength(MAX_XLOG_TABS);
  });
});

describe('탭 닫기', () => {
  it('마지막 하나는 안 닫는다', () => {
    const s = initialTabs();
    expect(closeTab(s, s.activeKey)).toBe(s);
  });

  it('보던 탭을 닫으면 이웃으로 옮긴다', () => {
    let s = initialTabs();
    s = addTab(s);
    const middle = s.activeKey;
    s = addTab(s);
    const last = s.activeKey;
    s = activate(s, middle);

    s = closeTab(s, middle);
    expect(s.activeKey).toBe(last);
  });

  it('맨 끝을 닫으면 그 앞으로 옮긴다', () => {
    let s = initialTabs();
    s = addTab(s);
    const last = s.activeKey;

    s = closeTab(s, last);
    expect(s.tabs).toHaveLength(1);
    expect(s.activeKey).toBe(s.tabs[0].key);
  });

  it('안 보던 탭을 닫아도 보던 자리는 그대로다', () => {
    let s = initialTabs();
    const first = s.tabs[0].key;
    s = addTab(s);
    const watching = s.activeKey;

    s = closeTab(s, first);
    expect(s.activeKey).toBe(watching);
  });
});

describe('조건은 탭마다다', () => {
  it('고친 것은 그 탭만 바뀐다', () => {
    let s = initialTabs();
    s = addTab(s);
    const other = s.tabs.find(t => t.key !== s.activeKey)!;

    s = patchActive(s, { mode: 'past', pastRange: RANGE });

    expect(activeTab(s).mode).toBe('past');
    expect(s.tabs.find(t => t.key === other.key)?.mode).toBe('live');
  });

  it('서버 고르기도 그 탭만 바뀐다 — «결제» 탭을 고쳐도 «주문» 탭은 그대로', () => {
    let s = addTab(initialTabs());
    const other = s.tabs.find(t => t.key !== s.activeKey)!;
    s = patchActive(s, { selection: { services: new Set(['pay']), hashes: new Set() } });
    s = setResolved(s, s.activeKey, new Set([7]));

    expect([...activeTab(s).selection.services]).toEqual(['pay']);
    expect([...activeTab(s).filter.objHashSet]).toEqual([7]);
    const o = s.tabs.find(t => t.key === other.key)!;
    expect(o.selection.services.size).toBe(0);
    expect(o.filter.objHashSet.size).toBe(0);
  });

  it('복제본은 고른 서버를 물려받는다 — 비교하려고 여는 것이니 다시 고르지 않게', () => {
    let s = initialTabs();
    s = patchActive(s, { selection: { services: new Set(['pay']), hashes: new Set([3]) } });
    s = addTab(s);
    expect([...activeTab(s).selection.services]).toEqual(['pay']);
  });

  it('푼 해시가 같으면 상태를 그대로 돌려준다 — 10초마다 차트가 다시 서지 않게', () => {
    let s = initialTabs();
    s = setResolved(s, s.activeKey, new Set([1, 2]));
    expect(setResolved(s, s.activeKey, new Set([2, 1]))).toBe(s);
  });

  it('콜렉터를 갈아타면 모든 탭의 고르기를 비운다', () => {
    let s = addTab(initialTabs());
    s = patchActive(s, { selection: { services: new Set(['pay']), hashes: new Set() } });
    s = setResolved(s, s.activeKey, new Set([7]));
    s = clearSelections(s);
    for (const t of s.tabs) {
      expect(t.selection.services.size).toBe(0);
      expect(t.filter.objHashSet.size).toBe(0);
    }
  });
});

describe('화면 분할', () => {
  /** 탭 n 개, 판은 처음 하나 */
  const tabs = (n: number) => {
    let s = initialTabs();
    for (let i = 1; i < n; i++) s = addTab(s);
    return activate(s, s.tabs[0].key);
  };

  it('처음에는 판 하나다', () => {
    const s = initialTabs();
    expect(s.panes).toEqual([s.activeKey]);
  });

  it('오른쪽에 놓으면 좌우로, 아래에 놓으면 위아래로 선다', () => {
    const s = tabs(2);
    const [a, b] = s.tabs.map(t => t.key);
    const right = dropTab(s, b, a, 'right');
    expect(right.panes).toEqual([a, b]);
    expect(right.dir).toBe('row');
    expect(right.activeKey).toBe(b);

    const top = dropTab(s, b, a, 'top');
    expect(top.panes).toEqual([b, a]);
    expect(top.dir).toBe('column');
  });

  it('가운데에 놓으면 그 판을 바꾼다', () => {
    const s = tabs(2);
    const [a, b] = s.tabs.map(t => t.key);
    expect(dropTab(s, b, a, 'center').panes).toEqual([b]);
  });

  it('떠 있는 탭을 다른 판에 놓으면 자리만 바뀐다 — 같은 탭이 둘로 보이지 않는다', () => {
    let s = tabs(2);
    const [a, b] = s.tabs.map(t => t.key);
    s = dropTab(s, b, a, 'right');
    expect(dropTab(s, a, b, 'right').panes).toEqual([b, a]);
    expect(dropTab(s, a, b, 'center').panes).toEqual([b, a]);
  });

  it('판이 상한이면 가장자리에 놓아도 더 쪼개지 않고 바꾼다', () => {
    let s = tabs(MAX_PANES + 1);
    const keys = s.tabs.map(t => t.key);
    for (let i = 1; i < MAX_PANES; i++) s = dropTab(s, keys[i], keys[i - 1], 'right');
    expect(s.panes).toHaveLength(MAX_PANES);
    const last = keys[MAX_PANES];
    s = dropTab(s, last, keys[0], 'right');
    expect(s.panes).toHaveLength(MAX_PANES);
    expect(s.panes[0]).toBe(last);
  });

  it('안 띄운 탭을 누르면 지금 판 자리에 띄운다 — 옆 판은 그대로', () => {
    let s = tabs(3);
    const [a, b, c] = s.tabs.map(t => t.key);
    s = dropTab(s, b, a, 'right'); // [a, b], 지금 판 b
    s = activate(s, c);
    expect(s.panes).toEqual([a, c]);
    expect(s.activeKey).toBe(c);
  });

  it('띄운 탭을 누르면 그 판으로 옮기기만 한다', () => {
    let s = tabs(2);
    const [a, b] = s.tabs.map(t => t.key);
    s = dropTab(s, b, a, 'right');
    s = activate(s, a);
    expect(s.panes).toEqual([a, b]);
    expect(s.activeKey).toBe(a);
  });

  it('새 탭은 지금 판 자리에 연다', () => {
    let s = tabs(2);
    const [a, b] = s.tabs.map(t => t.key);
    s = dropTab(s, b, a, 'right');
    s = addTab(s);
    expect(s.panes[0]).toBe(a);
    expect(s.panes[1]).toBe(s.activeKey);
    expect(s.panes).toHaveLength(2);
  });

  it('판을 내려도 탭은 남는다. 마지막 판은 못 내린다', () => {
    let s = tabs(2);
    const [a, b] = s.tabs.map(t => t.key);
    s = dropTab(s, b, a, 'right');
    s = closePane(s, b);
    expect(s.panes).toEqual([a]);
    expect(s.activeKey).toBe(a);
    expect(s.tabs).toHaveLength(2);
    expect(closePane(s, a)).toBe(s);
  });

  it('띄운 탭을 닫으면 판에서도 빠진다', () => {
    let s = tabs(3);
    const [a, b] = s.tabs.map(t => t.key);
    s = dropTab(s, b, a, 'right');
    s = closeTab(s, b);
    expect(s.panes).toEqual([a]);
    expect(s.activeKey).toBe(a);
  });

  it('판 하나뿐일 때 그 탭을 닫으면 이웃 탭을 띄운다', () => {
    const s = tabs(2);
    const [a, b] = s.tabs.map(t => t.key);
    const after = closeTab(s, a);
    expect(after.panes).toEqual([b]);
    expect(after.activeKey).toBe(b);
  });

  it('몫은 한쪽이 사라지지 않게 묶인다', () => {
    const s = initialTabs();
    expect(setRatio(s, 0.01).ratio).toBe(0.2);
    expect(setRatio(s, 0.99).ratio).toBe(0.8);
    expect(setRatio(s, Number.NaN)).toBe(s);
  });
});

describe('탭 이름 붙이기', () => {
  it('붙인 이름이 조건에서 만든 이름보다 앞선다', () => {
    const s = initialTabs();
    const named = renameTab(s, s.activeKey, '  결제 서버  ');
    expect(tabTitle(activeTab(named))).toBe('결제 서버');
  });

  it('비우면 조건에서 만든 이름으로 돌아간다', () => {
    const s = initialTabs();
    const back = renameTab(renameTab(s, s.activeKey, '결제'), s.activeKey, '   ');
    expect(activeTab(back).title).toBeUndefined();
    expect(tabTitle(activeTab(back))).toBe('실시간');
  });

  it('그 탭만 바뀐다', () => {
    const two = addTab(initialTabs());
    const [first] = two.tabs;
    const named = renameTab(two, first.key, '결제');
    expect(named.tabs[0].title).toBe('결제');
    expect(named.tabs[1].title).toBeUndefined();
  });

  it('복제본은 붙인 이름을 안 물려받는다 — 둘 다 «결제» 면 못 가른다', () => {
    const s = initialTabs();
    const two = addTab(renameTab(s, s.activeKey, '결제'));
    expect(activeTab(two).title).toBeUndefined();
  });
});

describe('탭 줄 이름', () => {
  it('안 붙인 실시간 탭 둘은 순번으로 가른다', () => {
    const two = addTab(initialTabs());
    expect(tabLabels(two.tabs)).toEqual(['실시간', '실시간 2']);
  });

  it('겹치지 않으면 순번을 안 붙인다', () => {
    const two = addTab(initialTabs());
    const named = renameTab(two, two.tabs[1].key, '주문');
    expect(tabLabels(named.tabs)).toEqual(['실시간', '주문']);
  });

  it('붙인 이름끼리 겹쳐도 가른다', () => {
    let s = addTab(addTab(initialTabs()));
    for (const t of s.tabs) s = renameTab(s, t.key, 'A');
    expect(tabLabels(s.tabs)).toEqual(['A', 'A 2', 'A 3']);
  });
});
