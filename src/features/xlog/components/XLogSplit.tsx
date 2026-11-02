// XLog 화면 분할 — 탭 여러 개를 한 화면에 나란히 띄운다.
//
// **브라우저·편집기의 분할 보기와 같은 손버릇이다.** 탭 줄의 탭을 차트 위로 끌어
//   · 가장자리(왼쪽·오른쪽·위·아래 1/4)에 놓으면 그 판 옆에 새 판으로 서고
//   · 가운데에 놓으면 그 판을 그 탭으로 바꾼다
// 판은 넷까지다(`MAX_PANES`). 둘이면 경계를 끌어 몫을 바꾸고, 셋·넷은 2×2 격자다.
//
// 판을 누르면 그 판이 **지금 판**이 된다 — 툴바·왼쪽 목록·아래 표가 그 판의 것이다.
// 그래서 지금 판은 테두리로 드러낸다. 판이 하나면 머리줄도 테두리도 없다(분할이 아니다).
//
// **탭은 전부 띄워 둔 채 판에 안 놓인 것만 숨긴다.** 판을 옮길 때 차트가 다시 서면
// 받아 둔 점을 잃고 과거 구간을 다시 조회해야 한다 — 그래서 자식 순서는 탭 순서 그대로 두고
// 자리(grid-area)만 바꾼다.

import { memo, useCallback, useRef, useState, type ReactNode } from 'react';
import type { DropSide, SplitDir, XLogTab } from '../hooks/xlogTabs';
import { Divider } from '../../../components/Divider';
import { PANE } from '../../../components/paneSizing';
import { t } from '../../../i18n';

/** 탭 줄에서 끌어 온 탭을 알아보는 표. 다른 끌기(파일 등)는 받지 않는다 */
export const TAB_DRAG_TYPE = 'application/x-nscouter-xlog-tab';

/** 가장자리로 치는 폭 (판 크기에 대한 비율) */
const EDGE = 0.25;

/**
 * 판 안의 포인터 자리 → 놓일 곳. **가장 가까운 가장자리**가 이긴다 — 모서리에서 위·왼쪽이
 * 동시에 걸리면 더 가까운 쪽이다. 가장자리 띠 밖이면 가운데다.
 *
 * @param x,y 판 안의 비율(0~1)
 */
export function dropSideAt(x: number, y: number): DropSide {
  const near: [DropSide, number][] = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y],
  ];
  near.sort((a, b) => a[1] - b[1]);
  return near[0][1] < EDGE ? near[0][0] : 'center';
}

/** 놓일 곳을 미리 보여 주는 덮개 자리 */
const PREVIEW: Record<DropSide, string> = {
  left: 'inset-y-0 left-0 w-1/2',
  right: 'inset-y-0 right-0 w-1/2',
  top: 'inset-x-0 top-0 h-1/2',
  bottom: 'inset-x-0 bottom-0 h-1/2',
  center: 'inset-0',
};

interface XLogSplitProps {
  tabs: readonly XLogTab[];
  /** 탭 줄과 같은 이름 (`tabLabels`) — 탭 순서대로 */
  labels: readonly string[];
  panes: readonly string[];
  activeKey: string;
  dir: SplitDir;
  ratio: number;
  /**
   * 탭 하나의 차트. `visible` 이 거짓이면 숨겨 둔 판이다.
   * `headerSlot` 은 판 머리의 빈자리 — 화면을 나눴을 때만 있다. 차트가 제 머리(모드·멈춤·설정)를 거기 그린다
   */
  renderTab: (tab: XLogTab, visible: boolean, headerSlot: HTMLElement | null) => ReactNode;
  onFocus: (key: string) => void;
  onDrop: (key: string, target: string, side: DropSide) => void;
  onClosePane: (key: string) => void;
  /** 판을 새 창으로 뗀다 */
  onDetach: (key: string) => void;
  /**
   * 경계를 끌었다 — **첫 판 몫의 변화량**을 넘긴다. 몫을 넘기지 않는 것은 끌기 이벤트가 그리기보다
   * 잦아서다: 옛 몫에 더하면 그 사이에 끈 만큼이 사라진다.
   */
  onRatioDelta: (delta: number) => void;
}

/** 판 번호 → 격자 자리 */
function areaOf(index: number, count: number, dir: SplitDir): string {
  if (count === 1) return '1 / 1 / 2 / 2';
  if (count === 2) {
    // 가운데 칸(2)은 경계다
    const at = index === 0 ? 1 : 3;
    return dir === 'row' ? `1 / ${at} / 2 / ${at + 1}` : `${at} / 1 / ${at + 1} / 2`;
  }
  // 셋이면 셋째가 아랫줄을 다 쓴다 — 빈 칸 하나를 남기면 판이 엽서만 해진 것처럼 보인다
  if (count === 3 && index === 2) return '2 / 1 / 3 / 3';
  const row = Math.floor(index / 2) + 1;
  const col = (index % 2) + 1;
  return `${row} / ${col} / ${row + 1} / ${col + 1}`;
}

export const XLogSplit = memo(function XLogSplit({
  tabs,
  labels,
  panes,
  activeKey,
  dir,
  ratio,
  renderTab,
  onFocus,
  onDrop,
  onClosePane,
  onDetach,
  onRatioDelta,
}: XLogSplitProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  /** 판마다 머리의 빈자리 (차트가 포털로 그린다) */
  const [slots, setSlots] = useState<Record<string, HTMLElement | null>>({});
  /**
   * 판마다 **같은 ref 함수**를 준다. 그릴 때마다 새 함수면 React 가 옛 것에 null, 새 것에 요소를
   * 차례로 넘겨 자리가 null→요소로 출렁이고, 그게 다시 그리기를 부른다.
   */
  const slotRefs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const slotRef = useCallback((key: string) => {
    let f = slotRefs.current.get(key);
    if (!f) {
      f = (el: HTMLElement | null) =>
        setSlots(prev => (prev[key] === el ? prev : { ...prev, [key]: el }));
      slotRefs.current.set(key, f);
    }
    return f;
  }, []);
  /** 끌고 있는 탭이 놓일 곳. 끌기가 아니면 null */
  const [hover, setHover] = useState<{ target: string; side: DropSide } | null>(null);

  const count = panes.length;
  const split = count > 1;
  const r = ratio;
  const grid =
    count === 1
      ? { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' }
      : count === 2
        ? dir === 'row'
          ? { gridTemplateColumns: `${r}fr ${PANE.divider}px ${1 - r}fr`, gridTemplateRows: '1fr' }
          : { gridTemplateColumns: '1fr', gridTemplateRows: `${r}fr ${PANE.divider}px ${1 - r}fr` }
        : { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 4 };

  const isTabDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(TAB_DRAG_TYPE);
  /** 이 판 안의 포인터 자리 → 놓일 곳. 덮개와 놓기가 **같은 계산**을 쓴다 */
  const sideOf = (e: React.DragEvent<HTMLElement>): DropSide => {
    const box = e.currentTarget.getBoundingClientRect();
    return dropSideAt(
      (e.clientX - box.left) / Math.max(1, box.width),
      (e.clientY - box.top) / Math.max(1, box.height),
    );
  };

  return (
    <div
      ref={boxRef}
      className={`grid h-full min-h-0 ${split ? 'p-1' : ''}`}
      style={grid}
      onDragLeave={e => {
        // 판 사이를 지날 때도 leave 가 온다 — 상자 밖으로 나갔을 때만 덮개를 거둔다
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(null);
      }}
    >
      {tabs.map((tab, i) => {
        const at = panes.indexOf(tab.key);
        const visible = at >= 0;
        const on = tab.key === activeKey;
        return (
          <div
            key={tab.key}
            // 판을 누르면 그 판이 지금 판이다. **캡처 단계에서** 바꾼다 — 차트가 드래그를 시작하기
            // 전에 지금 판이 바뀌어 있어야, 고른 점이 그 판의 목록으로 간다.
            onMouseDownCapture={visible && !on ? () => onFocus(tab.key) : undefined}
            onDragOver={
              visible
                ? e => {
                    if (!isTabDrag(e)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    const side = sideOf(e);
                    if (hover?.target !== tab.key || hover.side !== side) setHover({ target: tab.key, side });
                  }
                : undefined
            }
            onDrop={
              visible
                ? e => {
                    if (!isTabDrag(e)) return;
                    e.preventDefault();
                    const key = e.dataTransfer.getData(TAB_DRAG_TYPE);
                    const side = sideOf(e);
                    setHover(null);
                    if (key) onDrop(key, tab.key, side);
                  }
                : undefined
            }
            className={
              visible
                ? `relative flex min-h-0 min-w-0 flex-col ${
                    split ? `rounded border ${on ? 'border-accent' : 'border-line'}` : ''
                  }`
                : 'hidden'
            }
            style={visible ? { gridArea: areaOf(at, count, dir) } : undefined}
          >
            {/* 판이 둘 이상일 때만 머리줄 — 어느 판이 어느 탭인지, 어느 것이 지금 판인지 */}
            {visible && split && (
              <div
                className={`flex shrink-0 items-center gap-2 border-b border-line px-2 py-0.5 text-micro ${
                  on ? 'bg-accent/10 text-fg' : 'text-fg-dim'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{labels[i]}</span>
                <div ref={slotRef(tab.key)} className="flex min-w-0 items-center" />
                <button
                  type="button"
                  onClick={() => onDetach(tab.key)}
                  title={t('이 판을 새 창으로 뗍니다 — 다른 모니터에 띄울 때')}
                  aria-label={`${labels[i]} ${t('새 창으로 떼기')}`}
                  className="flex h-4 w-4 items-center justify-center rounded text-fg-faint hover:bg-hover hover:text-fg"
                >
                  ↗
                </button>
                <button
                  type="button"
                  onClick={() => onClosePane(tab.key)}
                  title={t('이 판을 내립니다 — 탭은 남습니다')}
                  aria-label={`${labels[i]} ${t('판 내리기')}`}
                  className="flex h-4 w-4 items-center justify-center rounded text-fg-faint hover:bg-hover hover:text-fg"
                >
                  ✕
                </button>
              </div>
            )}
            <div className={`min-h-0 flex-1 ${split ? 'p-1' : 'p-2'}`}>
              {renderTab(tab, visible, split ? (slots[tab.key] ?? null) : null)}
            </div>
            {hover?.target === tab.key && (
              <div
                className={`pointer-events-none absolute rounded border-2 border-accent bg-accent/15 ${PREVIEW[hover.side]}`}
                aria-hidden
              />
            )}
          </div>
        );
      })}
      {count === 2 && (
        <div
          style={{ gridArea: dir === 'row' ? '1 / 2 / 2 / 3' : '2 / 1 / 3 / 2' }}
          className={dir === 'row' ? 'flex' : 'flex flex-col'}
        >
          <Divider
            orientation={dir === 'row' ? 'vertical' : 'horizontal'}
            label={t('판 경계')}
            onDrag={d => {
              const box = boxRef.current?.getBoundingClientRect();
              const size = box ? (dir === 'row' ? box.width : box.height) : 0;
              if (size > 0) onRatioDelta(d / size);
            }}
          />
        </div>
      )}
    </div>
  );
});
