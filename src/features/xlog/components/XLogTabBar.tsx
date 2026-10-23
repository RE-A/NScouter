// XLog 탭 줄
//
// 맨 위 탭줄(Log·Active·…)과 **다른 층이다.** 저쪽은 «무엇을 보나» 고
// 이쪽은 «같은 것을 어떤 조건으로 보나» 다. 섞으면 Active·Counter 가
// 오른쪽으로 밀려나 찾기 어려워진다.
//
// 탭이 하나뿐이면 **줄 자체를 그리지 않는다.** 고를 것이 없는 줄은
// 자리만 먹고, 처음 쓰는 사람에게는 못 보던 구조가 하나 더 생긴 셈이 된다.
//
// 이름은 **두 번 눌러 고친다** (브라우저·편집기 탭과 같은 손버릇). Enter 로 정하고
// Esc 로 물린다. 비우고 정하면 조건에서 만든 이름으로 돌아간다.
//
// 탭을 **차트 위로 끌어 놓으면** 화면이 나뉜다(`XLogSplit`). 판에 떠 있는 탭은 밑줄로 드러낸다 —
// 지금 판은 진하게, 옆 판은 흐리게.

import { memo, useRef, useState } from 'react';
import { MAX_XLOG_TABS, tabLabels, type XLogTab } from '../hooks/xlogTabs';
import { TAB_DRAG_TYPE } from './XLogSplit';
import { t } from '../../../i18n';

interface XLogTabBarProps {
  tabs: readonly XLogTab[];
  activeKey: string;
  /** 화면에 띄운 탭들 */
  panes: readonly string[];
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onAdd: () => void;
  /** 이름을 바꾼다. 빈 글자면 붙인 이름을 지운다 */
  onRename: (key: string, title: string) => void;
}

export const XLogTabBar = memo(function XLogTabBar({
  tabs,
  activeKey,
  panes,
  onActivate,
  onClose,
  onAdd,
  onRename,
}: XLogTabBarProps) {
  const full = tabs.length >= MAX_XLOG_TABS;
  /** 이름을 고치고 있는 탭과 입력 중인 글자 */
  const [editing, setEditing] = useState<{ key: string; text: string } | null>(null);
  /**
   * 이번 고치기를 이미 끝냈나. Enter·Esc 뒤에 칸이 사라지면서 blur 가 한 번 더 올 수 있다 —
   * 그걸 «정한다» 로 받으면 Esc 로 물린 이름이 들어간다.
   */
  const doneRef = useRef(false);
  const startEdit = (tab: XLogTab) => {
    doneRef.current = false;
    setEditing({ key: tab.key, text: tab.title ?? '' });
  };
  const finishEdit = (save: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (save && editing) onRename(editing.key, editing.text);
    setEditing(null);
  };
  const labels = tabLabels(tabs);

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
      {tabs.map((tab, i) => {
        const on = tab.key === activeKey;
        const label = labels[i];
        const isEditing = editing?.key === tab.key;
        return (
          // **탭 안에 닫기 버튼이 있다.** 버튼 안에 버튼은 둘 수 없어서
          // 바깥은 div 로 두고 제목 쪽만 버튼으로 만든다.
          <div
            key={tab.key}
            // 고치는 중에는 끌지 않는다 — 글자를 드래그로 고르려다 탭이 끌려 나간다
            draggable={!isEditing}
            onDragStart={e => {
              e.dataTransfer.setData(TAB_DRAG_TYPE, tab.key);
              e.dataTransfer.effectAllowed = 'move';
            }}
            className={`flex items-center rounded-t border-b-2 ${
              on ? 'border-accent bg-hover' : panes.includes(tab.key) ? 'border-accent/40' : 'border-transparent'
            }`}
          >
            {isEditing ? (
              <input
                autoFocus
                value={editing.text}
                aria-label={t('탭 이름')}
                // 비우면 조건에서 만든 이름으로 돌아간다 — 무엇으로 돌아가는지 보여 준다
                placeholder={t('비우면 자동 이름')}
                onChange={e => setEditing({ key: tab.key, text: e.target.value })}
                onKeyDown={e => {
                  // 한글 조합 중의 Enter 는 글자를 확정하는 키다 — 이름을 정하는 키로 치지 않는다
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Enter') finishEdit(true);
                  if (e.key === 'Escape') finishEdit(false);
                }}
                onBlur={() => finishEdit(true)}
                onFocus={e => e.currentTarget.select()}
                className="w-32 rounded border border-line-control bg-input px-1.5 py-0.5 text-micro text-fg"
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => onActivate(tab.key)}
                onDoubleClick={() => startEdit(tab)}
                title={`${label} — ${t('두 번 눌러 이름 바꾸기 · 차트 가장자리로 끌어 나란히 보기')}`}
                className={`max-w-[12rem] truncate px-2 py-0.5 text-micro ${
                  on ? 'text-fg' : 'text-fg-dim hover:text-fg-muted'
                }`}
              >
                {label}
              </button>
            )}
            <button
              type="button"
              onClick={() => onClose(tab.key)}
              aria-label={`${label} ${t('탭 닫기')}`}
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
