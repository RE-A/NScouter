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
//
// 탭을 **창 밖으로 끌어 놓으면 새 창으로 떨어진다**(브라우저 탭과 같다). 오른쪽 클릭 메뉴에도 있다.
// 뗀 탭은 `↗` 를 달고, 누르면 그 창을 앞으로 부른다.

import { memo, useRef, useState } from 'react';
import { ContextMenu } from '../../../components/ContextMenu';
import { MAX_XLOG_TABS, tabLabels, type XLogTab } from '../hooks/xlogTabs';
import { TAB_DRAG_TYPE } from './XLogSplit';
import { t } from '../../../i18n';

interface XLogTabBarProps {
  tabs: readonly XLogTab[];
  activeKey: string;
  /** 화면에 띄운 탭들 */
  panes: readonly string[];
  /** 새 창으로 뗀 탭들 */
  detached: readonly string[];
  /** 새 창으로 뗀다. `at` 은 창 밖에 끌어 놓은 화면 좌표 */
  onDetach: (key: string, at?: { x: number; y: number }) => void;
  /** 뗀 탭을 도로 붙인다 */
  onAttach: (key: string) => void;
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
  detached,
  onDetach,
  onAttach,
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
  /** 오른쪽 클릭 메뉴 */
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  /**
   * 끌던 탭이 **창 밖으로 나갔나.** `dragend` 의 좌표만 믿을 수 없다 — WebKit 은 창 밖에 놓으면
   * 0,0 을 주기도 한다. 그래서 끄는 동안 문서를 떠나고(dragleave, 갈 곳 없음) 들어오는(dragenter)
   * 것을 따로 지켜본다.
   */
  const outsideRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const watchDrag = () => {
    outsideRef.current = false;
    lastPointRef.current = null;
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) {
        outsideRef.current = true;
        if (e.screenX !== 0 || e.screenY !== 0) lastPointRef.current = { x: e.screenX, y: e.screenY };
      }
    };
    const enter = () => { outsideRef.current = false; };
    const stop = () => {
      document.removeEventListener('dragleave', leave);
      document.removeEventListener('dragenter', enter);
    };
    document.addEventListener('dragleave', leave);
    document.addEventListener('dragenter', enter);
    // 탭의 onDragEnd 가 결과를 읽은 **뒤에** 뗀다 — 다음 틱
    document.addEventListener('dragend', () => setTimeout(stop, 0), { once: true });
  };
  /** 안 뗀 탭이 하나뿐이면 그건 못 뗀다 — 메인 창 차트 자리가 빈다 */
  const dockedCount = tabs.filter(tab => !detached.includes(tab.key)).length;

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
              watchDrag();
            }}
            // **창 밖에 놓았으면 새 창으로 뗀다.** 판이 받은 것(dropEffect move)이 아니고
            // 놓은 자리가 창 밖일 때만 — 창 안 빈 곳에 놓은 것은 «그만둔 것» 이다
            onDragEnd={e => {
              if (e.dataTransfer.dropEffect === 'move') return;
              // WebKitGTK 는 창 밖에 놓으면 client 좌표에 끌기 **시작점**을 준다(실측 44,20).
              // 그래서 client 좌표로는 안 가리고, 문서를 떠났는지와 화면 좌표로 가린다
              const hasScreen = e.screenX !== 0 || e.screenY !== 0;
              const outside = outsideRef.current || (hasScreen && isOutsideScreenRect(e.screenX, e.screenY));
              if (!outside) return;
              if (detached.includes(tab.key) || dockedCount <= 1) return;
              const at = e.screenX !== 0 || e.screenY !== 0 ? { x: e.screenX, y: e.screenY } : lastPointRef.current;
              onDetach(tab.key, at ?? undefined);
            }}
            onContextMenu={e => {
              e.preventDefault();
              setMenu({ key: tab.key, x: e.clientX, y: e.clientY });
            }}
            className={`flex items-center rounded-t border-b-2 ${
              on ? 'border-accent bg-hover' : panes.includes(tab.key) ? 'border-accent/40' : 'border-transparent'
            } ${detached.includes(tab.key) ? 'italic' : ''}`}
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
                // 메뉴가 떠 있는 동안에는 풍선 도움말을 거둔다 — 오른쪽 클릭 자리에 남아 메뉴를 덮었다
                title={menu ? undefined : `${label} — ${t('두 번 눌러 이름 바꾸기 · 차트 가장자리로 끌어 나란히 보기')}`}
                className={`max-w-[12rem] truncate px-2 py-0.5 text-micro ${
                  on ? 'text-fg' : 'text-fg-dim hover:text-fg-muted'
                }`}
              >
                {detached.includes(tab.key) && <span aria-hidden>↗ </span>}
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={
            detached.includes(menu.key)
              ? [
                  { label: t('창 보기'), onSelect: () => onActivate(menu.key) },
                  { label: t('메인 창에 붙이기'), onSelect: () => onAttach(menu.key) },
                  { label: t('탭 닫기'), onSelect: () => onClose(menu.key) },
                ]
              : [
                  {
                    label: t('새 창으로 떼기'),
                    onSelect: () => onDetach(menu.key),
                    disabled: dockedCount <= 1 ? t('메인 창에 탭이 하나는 남아야 합니다') : undefined,
                  },
                  {
                    label: t('이름 바꾸기'),
                    onSelect: () => {
                      const tab = tabs.find(x => x.key === menu.key);
                      if (tab) startEdit(tab);
                    },
                  },
                  { label: t('탭 닫기'), onSelect: () => onClose(menu.key), disabled: tabs.length <= 1 ? t('마지막 탭은 닫지 않습니다') : undefined },
                ]
          }
        />
      )}
    </div>
  );
});

/** 화면 좌표가 이 창 밖인가 — 창 가장자리에서 조금 벗어난 정도는 안 친다 */
function isOutsideScreenRect(x: number, y: number): boolean {
  const M = 8;
  const left = window.screenX;
  const top = window.screenY;
  return x < left - M || y < top - M || x > left + window.outerWidth + M || y > top + window.outerHeight + M;
}

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
