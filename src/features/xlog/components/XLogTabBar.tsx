// XLog 탭 줄
//
// 맨 위 탭줄(Log·Active·…)과 **다른 층이다.** 저쪽은 «무엇을 보나» 고
// 이쪽은 «같은 것을 어떤 조건으로 보나» 다. 섞으면 Active·Counter 가
// 오른쪽으로 밀려나 찾기 어려워진다.
//
// 탭이 하나뿐이면 **줄 자체를 그리지 않는다.** 고를 것이 없는 줄은
// 자리만 먹고, 처음 쓰는 사람에게는 못 보던 구조가 하나 더 생긴 셈이 된다.

import { memo } from 'react';
import { MAX_XLOG_TABS, tabTitle, type XLogTab } from '../hooks/xlogTabs';
import { t } from '../../../i18n';

interface XLogTabBarProps {
  tabs: readonly XLogTab[];
  activeKey: string;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onAdd: () => void;
}

export const XLogTabBar = memo(function XLogTabBar({
  tabs,
  activeKey,
  onActivate,
  onClose,
  onAdd,
}: XLogTabBarProps) {
  const full = tabs.length >= MAX_XLOG_TABS;

  // 탭이 하나면 「+」만 둔다 — 줄을 통째로 그리면 쓰지도 않는 구조가 늘 보인다.
  if (tabs.length <= 1) {
    return (
      <div className="flex shrink-0 items-center border-b border-line bg-raised px-3 py-0.5">
        <AddButton onAdd={onAdd} full={full} />
      </div>
    );
  }

  return (
    <div
      role="tablist"
      aria-label={t('XLog 탭 목록')}
      className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line bg-raised px-3 py-0.5"
    >
      {tabs.map(tab => {
        const on = tab.key === activeKey;
        return (
          // **탭 안에 닫기 버튼이 있다.** 버튼 안에 버튼은 둘 수 없어서
          // 바깥은 div 로 두고 제목 쪽만 버튼으로 만든다.
          <div
            key={tab.key}
            className={`flex items-center rounded-t border-b-2 ${
              on ? 'border-accent bg-hover' : 'border-transparent'
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onActivate(tab.key)}
              title={tabTitle(tab)}
              className={`max-w-[12rem] truncate px-2 py-0.5 text-micro ${
                on ? 'text-fg' : 'text-fg-dim hover:text-fg-muted'
              }`}
            >
              {tabTitle(tab)}
            </button>
            <button
              type="button"
              onClick={() => onClose(tab.key)}
              aria-label={`${tabTitle(tab)} ${t('탭 닫기')}`}
              title={t('탭 닫기')}
              className="mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-micro text-fg-faint hover:bg-hover hover:text-fg"
            >
              ✕
            </button>
          </div>
        );
      })}
      <AddButton onAdd={onAdd} full={full} />
    </div>
  );
});

function AddButton({ onAdd, full }: { onAdd: () => void; full: boolean }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={full}
      // 막힌 이유를 말해 주지 않으면 버튼이 왜 안 눌리는지 알 수 없다
      title={
        full
          ? t('탭은 최대 6개입니다. 탭마다 조회한 것을 따로 들고 있어 더 늘리면 메모리를 먹습니다')
          : t('지금 조건을 복제해 탭을 하나 더 엽니다 — 날짜만 바꿔 견주는 데 씁니다')
      }
      className="btn-ghost ml-1 px-1.5 py-0.5 text-micro"
    >
      + {t('탭')}
    </button>
  );
}
