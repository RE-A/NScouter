// XLog 탭의 계약
//
// 여기서 지키려는 것:
//   · 새 탭은 **지금 탭을 복제**한다 — 비교하려고 여는 것이니 날짜만 바꾸면 되게
//   · 복제본이 원본과 **상태를 나눠 갖지 않는다** (Set 얕은 복사 함정)
//   · 마지막 하나는 안 닫힌다 — 다 닫으면 돌아올 길이 없다
//   · 닫으면 **이웃**으로 옮긴다 (매번 첫 탭으로 튀지 않는다)
//   · 고친 것은 **그 탭만** 바뀐다. 그게 탭을 나눈 이유다
//   · 서버 고르기는 탭 바깥이라 **모든 탭에** 적힌다

import { describe, expect, it } from 'vitest';
import {
  activate,
  activeTab,
  addTab,
  closeTab,
  initialTabs,
  MAX_XLOG_TABS,
  patchActive,
  setSelection,
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
    s = setSelection(s, new Set([1, 2]));
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

  it('서버 고르기만은 모든 탭에 적힌다 — 탭 바깥의 선택이라 한 벌이다', () => {
    let s = initialTabs();
    s = addTab(s);
    s = setSelection(s, new Set([7]));

    for (const t of s.tabs) expect([...t.filter.objHashSet]).toEqual([7]);
  });
});
