// XLog 판 배치 — 탭 하나가 판 하나다 (dockview).
//
// 예전의 탭 줄(`XLogTabBar`)과 분할(`XLogSplit`, 판 넷까지)을 대신한다. 손버릇은 그대로 옮긴다:
//   · 판 머리 탭을 **두 번 눌러 이름 바꾸기**, 오른쪽 클릭 메뉴(새 창으로 떼기 · 메인 창으로 보내기 · 이름 바꾸기 · 닫기)
//   · `+ 탭` — 지금 탭을 복제해 **같은 판 묶음에** 연다
//   · 탭을 다른 판의 가장자리로 끌면 그 옆에 서고, 가운데로 끌면 그 묶음의 탭이 된다(dockview 가 한다)
//   · 탭을 **창 밖으로 끌면 새 창으로 뗀다** (예전 탭 줄과 같은 감지 — 아래 `watchDragOut`)
//   · 판을 누르면 그 판이 **지금 판** — 툴바·왼쪽 목록·아래 표가 그 판의 것이다
//
// **탭 상태(`xlogTabs`)가 주인이다.** 탭을 열고 닫는 것은 상태가 하고, 이 컴포넌트는 상태를 판에 맞춘다.
// 판의 ✕ 도 상태에 «닫아 달라» 고만 한다 — 마지막 탭은 상태가 안 닫으므로 판도 남는다.
// 배치(어디에 어떤 묶음으로)는 dockview 가 들고, 바뀌면 `onLayoutChange` 로 알린다(저장은 App 이 한다).
//
// **판은 옮겨도 다시 세우지 않는다**(`defaultRenderer="always"`) — 차트가 받아 둔 점을 잃지 않게.
// 받고 그리는 것은 보이는 판만 한다: 판 묶음 뒤쪽 탭은 `visible=false` 로 그려지고, 보이는 판 목록은
// `onVisibleChange` 로 알린다(실시간 스트림을 그 판들의 서버로만 연다).

import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type SerializedDockview,
} from 'dockview-react';
import { ContextMenu } from '../../../components/ContextMenu';
import { PanelErrorBoundary } from '../../../components/PanelErrorBoundary';
import { kindOf, MAX_XLOG_TABS, PANEL_KIND_LABEL, type PanelKind, type SplitDir, type XLogTab } from '../hooks/xlogTabs';
import { gridMoves, opsFromSplit } from '../hooks/dockLayout';
import { t } from '../../../i18n';

/** 우리 토큰을 따르는 판 테마 (`styles/dockview-theme.css`) */
const THEME = { name: 'nscouter', className: 'dockview-theme-light dockview-theme-ns' };

export interface ScreenPoint {
  x: number;
  y: number;
}

interface XLogDockProps {
  tabs: readonly XLogTab[];
  /** 탭 이름 (`tabLabels`) — `tabs` 와 같은 순서 */
  labels: readonly string[];
  activeKey: string;
  /** 처음 띄울 배치. 없으면 `panes`·`dir` 로 짠다 */
  initialDock: SerializedDockview | null;
  panes: readonly string[];
  dir: SplitDir;
  /**
   * 탭 하나의 차트. `visible` 이 거짓이면 판 묶음 뒤쪽 탭이다(받지도 그리지도 않는다).
   * `headerSlot` 은 판 머리 오른쪽 빈자리 — 차트가 제 머리(모드·멈춤·설정)를 거기 그린다
   */
  renderTab: (tab: XLogTab, visible: boolean, headerSlot: HTMLElement | null) => ReactNode;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  /** 지금 탭을 복제해 연다 — 새 판은 그 탭의 묶음에 놓인다 */
  onAdd: () => void;
  /** 이름을 바꾼다. 빈 글자면 붙인 이름을 지운다 */
  onRename: (key: string, title: string) => void;
  /** 새 창으로 뗀다. `at` 은 창 밖에 끌어 놓은 화면 좌표 */
  onDetach: (key: string, at?: ScreenPoint) => void;
  /** (뗀 창에서만) 탭을 메인 창으로 보낸다 */
  onSendToMain?: (key: string) => void;
  /** 판을 고정(📌)하거나 트리 따라감(🔗)으로 푼다 */
  onPin: (key: string, pinned: boolean) => void;
  /** `+` 메뉴로 판을 연다 — XLog 는 지금 판 복제, 나머지는 그 종류 */
  onAddPanel: (kind: PanelKind, counter?: string) => void;
  /** `+` 메뉴의 카운터 목록 */
  counterChoices: readonly { name: string; label: string }[];
  /** 배치가 바뀌었다 (판 이름 = 탭 키) */
  onLayoutChange: (dock: SerializedDockview) => void;
  /** 보이는 판들 — 판 묶음의 앞 탭들 */
  onVisibleChange: (keys: string[]) => void;
  /**
   * 바뀔 때마다(`n`) 한 번 격자로 정렬한다 — 판을 여럿 연 뒤(«고른 것 각각 XLog»). `keys` 가 있으면 **그 판들만**
   * 첫 판의 자리 안에서 나눈다(대시보드의 다른 판은 그대로). 없으면 전부
   */
  arrangeRequest?: { n: number; keys?: readonly string[] };
}

export interface DockCtx {
  tabs: ReadonlyMap<string, XLogTab>;
  labels: ReadonlyMap<string, string>;
  renderTab: XLogDockProps['renderTab'];
  /** 판 머리 빈자리 — 그 판이 묶음의 앞 탭일 때만 있다 */
  slotOf: (key: string) => HTMLElement | null;
  setSlot: (group: string, key: string | undefined, el: HTMLElement | null) => void;
  canDetach: boolean;
  full: boolean;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onAdd: (fromKey: string) => void;
  onRename: (key: string, title: string) => void;
  onDetach: (key: string, at?: ScreenPoint) => void;
  onSendToMain?: (key: string) => void;
  onPin: (key: string, pinned: boolean) => void;
  /** 판을 모두 격자로 다시 나눈다 */
  onArrange: () => void;
  onAddPanel: (fromKey: string, kind: PanelKind, counter?: string) => void;
  counterChoices: readonly { name: string; label: string }[];
}

/** 새 창으로 뗄 수 있는 판 — XLog 만. 카운터 스트림은 메인 창에만 돈다 */
function detachable(ctx: DockCtx, key: string): boolean {
  return ctx.canDetach && kindOf(ctx.tabs.get(key) ?? ({} as XLogTab)) === 'xlog';
}

export const DockContext = createContext<DockCtx | null>(null);
function useDock(): DockCtx {
  const c = useContext(DockContext);
  if (!c) throw new Error('XLogDock 밖에서 판을 그렸다');
  return c;
}

/** 판 본문 — 그 탭의 차트 */
function PanelBody({ api }: IDockviewPanelProps) {
  const ctx = useDock();
  const [visible, setVisible] = useState(api.isVisible);
  useEffect(() => {
    const d = api.onDidVisibilityChange(e => setVisible(e.isVisible));
    return () => d.dispose();
  }, [api]);
  const tab = ctx.tabs.get(api.id);
  if (!tab) return null;
  return (
    <div
      className="flex h-full min-h-0 flex-col p-1"
      // 판을 누르면 그 판이 지금 판이다. **캡처 단계에서** 바꾼다 — 차트가 드래그를 시작하기 전에
      // 지금 판이 바뀌어 있어야, 고른 점이 그 판의 목록으로 간다 (예전 `XLogSplit` 과 같다)
      onMouseDownCapture={() => ctx.onActivate(api.id)}
    >
      {/* 판 하나가 넘어져도 앱 전체가 내려가지 않게 */}
      <PanelErrorBoundary>{ctx.renderTab(tab, visible, visible ? ctx.slotOf(api.id) : null)}</PanelErrorBoundary>
    </div>
  );
}

/** 판 머리 탭 — 이름 · 두 번 눌러 이름 바꾸기 · 오른쪽 클릭 메뉴 · ✕ (시험에서도 쓴다) */
export function PanelTab({ api }: IDockviewPanelHeaderProps) {
  const ctx = useDock();
  const label = ctx.labels.get(api.id) ?? api.title ?? '';
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<ScreenPoint | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  /** Enter·Esc 뒤 칸이 사라지며 오는 blur 를 «정한다» 로 받지 않게 */
  const doneRef = useRef(false);

  // 고치는 동안은 탭을 끌지 않는다 — 글자를 드래그로 고르려다 탭이 끌려 나간다
  useEffect(() => {
    const tabEl = boxRef.current?.closest('.dv-tab') as HTMLElement | null;
    if (!tabEl) return;
    if (editing !== null) {
      tabEl.setAttribute('draggable', 'false');
      return () => tabEl.setAttribute('draggable', 'true');
    }
    return undefined;
  }, [editing]);

  const startEdit = () => {
    doneRef.current = false;
    setEditing(ctx.tabs.get(api.id)?.title ?? '');
  };
  const finish = (save: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (save && editing !== null) ctx.onRename(api.id, editing);
    setEditing(null);
  };

  return (
    <div
      ref={boxRef}
      className="flex h-full items-center gap-1 pl-2 pr-1 text-micro"
      onDoubleClick={startEdit}
      onContextMenu={e => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      // 메뉴가 떠 있는 동안에는 풍선 도움말을 거둔다 — 오른쪽 클릭 자리에 남아 메뉴를 덮었다
      title={menu ? undefined : `${label} — ${t('두 번 눌러 이름 바꾸기 · 다른 판 가장자리로 끌어 나란히 보기 · 창 밖으로 끌어 새 창')}`}
    >
      {editing !== null ? (
        <input
          autoFocus
          value={editing}
          aria-label={t('탭 이름')}
          placeholder={t('비우면 자동 이름')}
          onChange={e => setEditing(e.target.value)}
          onKeyDown={e => {
            // 한글 조합 중의 Enter 는 글자를 확정하는 키다
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') finish(true);
            if (e.key === 'Escape') finish(false);
            e.stopPropagation();
          }}
          onBlur={() => finish(true)}
          onFocus={e => e.currentTarget.select()}
          onMouseDown={e => e.stopPropagation()}
          className="w-32 rounded border border-line-control bg-input px-1.5 py-0.5 text-micro text-fg"
        />
      ) : (
        <span className="max-w-[14rem] truncate">
          {/* 고정 판은 이름 앞에 표시 — 트리를 고쳐도 이 판은 안 바뀐다 */}
          {ctx.tabs.get(api.id)?.pinned && (
            <span aria-label={t('대상 고정')} className="mr-1">📌</span>
          )}
          {label}
        </span>
      )}
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          ctx.onClose(api.id);
        }}
        aria-label={`${label} ${t('탭 닫기')}`}
        title={t('탭 닫기')}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-micro text-fg-faint hover:bg-hover hover:text-fg"
      >
        ✕
      </button>
      {menu &&
        createPortal(
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            items={[
              {
                label: t('새 창으로 떼기'),
                onSelect: () => ctx.onDetach(api.id),
                disabled: !ctx.canDetach
                  ? t('이 창에 탭이 하나는 남아야 합니다')
                  : detachable(ctx, api.id)
                    ? undefined
                    : t('새 창으로는 XLog 판만 뗍니다'),
              },
              ...(ctx.onSendToMain
                ? [{ label: t('메인 창으로 보내기'), onSelect: () => ctx.onSendToMain?.(api.id) }]
                : []),
              ctx.tabs.get(api.id)?.pinned
                ? { label: t('트리 따라가기로 풀기'), onSelect: () => ctx.onPin(api.id, false) }
                : { label: t('지금 대상으로 고정'), onSelect: () => ctx.onPin(api.id, true) },
              { label: t('이름 바꾸기'), onSelect: startEdit },
              {
                label: t('탭 닫기'),
                onSelect: () => ctx.onClose(api.id),
                disabled: ctx.tabs.size <= 1 ? t('마지막 탭은 닫지 않습니다') : undefined,
              },
            ]}
          />,
          document.body,
        )}
    </div>
  );
}

/** 판 묶음 머리, 탭들 바로 뒤 — `+ 탭` */
function GroupAdd({ activePanel }: IDockviewHeaderActionsProps) {
  const ctx = useDock();
  const key = activePanel?.id;
  /** `+` 메뉴 — 원본 스카우터의 오른쪽 클릭 메뉴처럼 무엇을 띄울지 고른다 */
  const [menu, setMenu] = useState<ScreenPoint | null>(null);
  const others: PanelKind[] = ['eq', 'active', 'summary', 'serviceGroup', 'alert', 'visualize', 'counterBoard'];
  return (
    <div className="flex h-full items-center pl-1">
      <button
        type="button"
        aria-label={t('탭 추가')}
        disabled={ctx.full || key === undefined}
        onClick={e => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left, y: r.bottom + 2 });
        }}
        title={ctx.full ? t('탭은 최대 16개입니다') : t('판 추가 — XLog(지금 판 복제) · EQ · Active · 카운터 …')}
        className="btn-ghost px-1.5 py-0.5 text-micro"
      >
        +
      </button>
      {menu &&
        key &&
        createPortal(
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            items={[
              { label: `XLog — ${t('지금 판 복제')}`, onSelect: () => ctx.onAddPanel(key, 'xlog') },
              ...others.map(k => ({ label: t(PANEL_KIND_LABEL[k]), onSelect: () => ctx.onAddPanel(key, k) })),
              ...ctx.counterChoices.map(c => ({
                label: `${t('카운터')} · ${t(c.label)}`,
                onSelect: () => ctx.onAddPanel(key, 'counter', c.name),
              })),
            ]}
          />,
          document.body,
        )}
      <button
        type="button"
        onClick={ctx.onArrange}
        disabled={ctx.tabs.size <= 1}
        title={t('판을 모두 격자로 고르게 나눕니다 (받아 둔 점은 그대로)')}
        aria-label={t('격자로 정렬')}
        className="btn-ghost px-1.5 py-0.5 text-micro"
      >
        ⊞
      </button>
    </div>
  );
}

/** 판 묶음 머리 오른쪽 — 앞 탭의 차트 머리(포털 자리)와 `↗` */
function GroupActions({ activePanel, group, api }: IDockviewHeaderActionsProps) {
  const ctx = useDock();
  const key = activePanel?.id;
  const { setSlot } = ctx;
  /**
   * **좁은 판은 차트 조작을 머리에 올리지 않는다** — 머리가 꽉 차면 dockview 가 탭 이름을 `∨` 목록으로 숨긴다.
   * 자리를 안 주면 차트가 제 조작을 판 안 첫 줄에 그린다(`XLogChart` `headerSlot` 없을 때). 탭 이름이 먼저다
   */
  const [wide, setWide] = useState(() => api.width >= NARROW_PX);
  useEffect(() => {
    const d = api.onDidDimensionsChange(e => setWide(e.width >= NARROW_PX));
    return () => d.dispose();
  }, [api]);
  const ref = useCallback(
    (el: HTMLDivElement | null) => setSlot(group.id, key, wide ? el : null),
    [setSlot, group.id, key, wide],
  );
  const pinned = key !== undefined && ctx.tabs.get(key)?.pinned === true;
  return (
    <div className="flex h-full min-w-0 items-center gap-1 pr-1">
      <div ref={ref} className="flex min-w-0 items-center" />
      {key && (
        // **이 판이 트리를 따라가나.** 원본 스카우터의 «대상이 박힌 창» 이 고정 판이다
        <button
          type="button"
          onClick={() => ctx.onPin(key, !pinned)}
          aria-pressed={pinned}
          title={
            pinned
              ? t('대상 고정 — 트리를 고쳐도 이 판은 안 바뀝니다. 이 판을 누른 채 트리를 고치면 이 판만 바뀝니다. 누르면 트리 따라가기로 풉니다')
              : t('트리 따라감 — 트리에서 고르면 따라감 판이 모두 함께 바뀝니다. 누르면 지금 고른 대상으로 고정합니다')
          }
          className={`flex h-5 items-center rounded px-1 text-micro ${pinned ? 'bg-accent/15 text-fg' : 'text-fg-faint hover:bg-hover hover:text-fg'}`}
        >
          {/* 판이 좁아도 머리가 넘치지 않게 글자 없이 표시만 — 뜻은 풍선 도움말이 말한다 */}
          {pinned ? '📌' : '🔗'}
        </button>
      )}
      {key && (
        <button
          type="button"
          disabled={!detachable(ctx, key)}
          onClick={() => ctx.onDetach(key)}
          title={
            detachable(ctx, key)
              ? t('이 판을 새 창으로 뗍니다 — 다른 모니터에 띄울 때')
              : ctx.canDetach
                ? t('새 창으로는 XLog 판만 뗍니다')
                : t('이 창에 탭이 하나는 남아야 합니다')
          }
          aria-label={`${ctx.labels.get(key) ?? ''} ${t('새 창으로 떼기')}`}
          className="flex h-5 w-5 items-center justify-center rounded text-fg-faint hover:bg-hover hover:text-fg disabled:opacity-40"
        >
          ↗
        </button>
      )}
    </div>
  );
}

const COMPONENTS = { xlog: PanelBody };

/** 이보다 좁은 판 묶음은 차트 조작을 판 안으로 내린다 (`GroupActions`) */
const NARROW_PX = 560;

/** 화면 좌표가 이 창 밖인가 — 창 가장자리에서 조금 벗어난 정도는 안 친다 */
function isOutsideScreenRect(x: number, y: number): boolean {
  const M = 8;
  const left = window.screenX;
  const top = window.screenY;
  return x < left - M || y < top - M || x > left + window.outerWidth + M || y > top + window.outerHeight + M;
}

/**
 * 탭을 끄는 동안 **창 밖으로 나갔다가 거기 놓였나** 를 지켜본다. 예전 탭 줄과 같은 감지다:
 * `dragend` 의 좌표만 믿을 수 없다 — WebKitGTK 는 창 밖에 놓으면 client 좌표에 끌기 시작점을, 0,0 을
 * 주기도 한다. 그래서 문서를 떠나고(dragleave, 갈 곳 없음) 들어오는(dragenter) 것을 따로 본다.
 */
export function watchDragOut(onOut: (at: ScreenPoint | null) => void): void {
  let outside = false;
  let last: ScreenPoint | null = null;
  const leave = (e: DragEvent) => {
    if (e.relatedTarget === null) {
      outside = true;
      if (e.screenX !== 0 || e.screenY !== 0) last = { x: e.screenX, y: e.screenY };
    }
  };
  const enter = () => {
    outside = false;
  };
  const end = (e: DragEvent) => {
    document.removeEventListener('dragleave', leave);
    document.removeEventListener('dragenter', enter);
    // 판이 받았으면(옮기기) 뗀 것이 아니다
    if (e.dataTransfer?.dropEffect === 'move') return;
    const hasScreen = e.screenX !== 0 || e.screenY !== 0;
    if (!(outside || (hasScreen && isOutsideScreenRect(e.screenX, e.screenY)))) return;
    onOut(hasScreen ? { x: e.screenX, y: e.screenY } : last);
  };
  document.addEventListener('dragleave', leave);
  document.addEventListener('dragenter', enter);
  document.addEventListener('dragend', end, { once: true });
}

export const XLogDock = memo(function XLogDock(props: XLogDockProps) {
  const { tabs, labels, activeKey, renderTab, onActivate, onClose, onAdd, onRename, onDetach, onSendToMain, onPin } = props;
  const apiRef = useRef<DockviewApi | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  /** 묶음마다 머리 빈자리 — 그 묶음의 앞 탭 것 */
  const [slots, setSlots] = useState<Record<string, { key: string; el: HTMLElement }>>({});
  const setSlot = useCallback((group: string, key: string | undefined, el: HTMLElement | null) => {
    setSlots(prev => {
      const cur = prev[group];
      if (!el || key === undefined) {
        if (!cur) return prev;
        const next = { ...prev };
        delete next[group];
        return next;
      }
      if (cur && cur.key === key && cur.el === el) return prev;
      return { ...prev, [group]: { key, el } };
    });
  }, []);
  const slotOf = useCallback(
    (key: string) => Object.values(slots).find(s => s.key === key)?.el ?? null,
    [slots],
  );

  const tabMap = useMemo(() => new Map(tabs.map(tb => [tb.key, tb])), [tabs]);
  const labelMap = useMemo(() => new Map(tabs.map((tb, i) => [tb.key, labels[i] ?? ''])), [tabs, labels]);

  /** 보이는 판 목록을 알린다 — 바뀌었을 때만 */
  const visibleRef = useRef('');
  const reportVisible = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const keys = api.panels.filter(p => p.api.isVisible).map(p => p.id);
    const sig = [...keys].sort().join('|');
    if (sig === visibleRef.current) return;
    visibleRef.current = sig;
    propsRef.current.onVisibleChange(keys);
  }, []);

  /** 직전에 지금 판이던 키 — 새 탭을 그 판의 묶음에 놓는다 */
  const lastActiveRef = useRef(activeKey);

  const onReady = useCallback(
    (e: DockviewReadyEvent) => {
      const api = e.api;
      apiRef.current = api;
      const p = propsRef.current;
      const keys = p.tabs.map(tb => tb.key);
      const title = (k: string) => p.labels[keys.indexOf(k)] ?? '';
      let restored = false;
      if (p.initialDock) {
        try {
          api.fromJSON(p.initialDock);
          restored = keys.every(k => api.getPanel(k) !== undefined) && api.panels.length === keys.length;
        } catch {
          restored = false;
        }
        if (!restored) api.clear();
      }
      if (!restored) {
        for (const op of opsFromSplit(keys, p.panes, p.dir, p.activeKey)) {
          api.addPanel({
            id: op.key,
            component: 'xlog',
            title: title(op.key),
            ...(op.position ? { position: op.position } : {}),
            ...(op.inactive ? { inactive: true } : {}),
          });
        }
      }
      api.getPanel(p.activeKey)?.api.setActive();
      lastActiveRef.current = p.activeKey;

      api.onDidActivePanelChange(({ panel }) => {
        if (panel && panel.id !== propsRef.current.activeKey) propsRef.current.onActivate(panel.id);
        reportVisible();
      });
      api.onDidLayoutChange(() => {
        propsRef.current.onLayoutChange(api.toJSON());
        reportVisible();
      });
      api.onWillDragPanel(ev => {
        const key = ev.panel.id;
        watchDragOut(at => {
          if (propsRef.current.tabs.length > 1) propsRef.current.onDetach(key, at ?? undefined);
        });
      });
      reportVisible();
    },
    [reportVisible],
  );

  // 탭 상태 → 판. 닫힌 탭의 판은 내리고, 새 탭은 직전 지금 판의 묶음에 연다(`openBeside` 면 그 옆에). 이름도 맞춘다
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const keys = new Set(tabs.map(tb => tb.key));
    for (const panel of [...api.panels]) if (!keys.has(panel.id)) panel.api.close();
    for (const tb of tabs) {
      if (api.getPanel(tb.key)) continue;
      const ref = api.getPanel(lastActiveRef.current) ?? api.activePanel;
      api.addPanel({
        id: tb.key,
        component: 'xlog',
        title: labelMap.get(tb.key) ?? '',
        ...(ref ? { position: { referencePanel: ref.id, direction: tb.openBeside ? ('right' as const) : ('within' as const) } } : {}),
        // 옆에 세울 때는 기준 판의 반만 — 크기를 안 주면 같은 줄의 판들이 모두 고르게 다시 나뉘어
        // 원본 기본의 Alert · 카운터 열까지 폭이 바뀌었다
        ...(ref && tb.openBeside ? { initialWidth: Math.floor(ref.group.width / 2) } : {}),
        // 지금 판이 될 탭만 앞으로 — 다른 창에서 들어온 탭 여럿은 뒤쪽 탭으로 쌓인다
        ...(tb.key === activeKey ? {} : { inactive: true }),
      });
    }
    for (const panel of api.panels) {
      const l = labelMap.get(panel.id);
      if (l !== undefined && panel.title !== l) panel.api.setTitle(l);
    }
    reportVisible();
  }, [tabs, labelMap, activeKey, reportVisible]);

  /**
   * 격자로 정렬 — 판을 **옮기기만** 해서(`gridMoves`) 받아 둔 점을 지킨다. 쪼갤 때마다 반씩이라
   * 옮긴 뒤 줄·칸 크기를 고르게 맞춘다. 탭 순서대로 왼쪽 위부터 놓는다.
   * `only` 가 있으면 그 판들만 — 첫 판의 묶음에 모은 뒤 **그 자리**를 나눈다.
   */
  const arrange = useCallback((only?: readonly string[]) => {
    const api = apiRef.current;
    if (!api) return;
    // 옮기는 동안 dockview 가 다른 판을 지금 판으로 알린다 — 끝나고 되돌릴 판을 먼저 잡아 둔다
    const want = propsRef.current.activeKey;
    const order = propsRef.current.tabs.map(tb => tb.key);
    const keys = (only ? order.filter(k => only.includes(k)) : order).filter(k => api.getPanel(k));
    const { moves, cols, rows } = gridMoves(keys);
    const move = (m: (typeof moves)[number]) => {
      const panel = api.getPanel(m.key);
      const ref = api.getPanel(m.ref);
      if (panel && ref) panel.api.moveTo({ group: ref.group, position: m.position });
    };
    // 나눌 자리 — 전부면 판 전체, 일부면 **옮기기 전** 첫 판 묶음의 크기(그 판들은 이미 이 묶음의 탭이다).
    // 옮긴 직후의 묶음 크기는 아직 새로 재지 않은 값이라 쓰지 않는다
    const first = api.getPanel(keys[0] ?? '')?.group;
    const W = only && first ? first.width : api.width;
    const H = only && first ? first.height : api.height;
    for (const m of moves) move(m);
    // 크기는 다음 프레임에 맞춘다 — 옮긴 직후에는 나뉜 묶음들의 크기가 아직 서지 않아 맞춘 값이 어긋났다
    requestAnimationFrame(() => {
      for (let r = 0; r < rows; r++) {
        // 마지막 줄이 짧으면 그 줄의 판 수로 나눈다 — 빈칸이 없으니 칸 수로 나누면 한 판이 남는 몫을 다 가졌다
        const inRow = Math.min(cols, keys.length - r * cols);
        for (let c = 0; c < inRow; c++) {
          const g = api.getPanel(keys[r * cols + c] ?? '')?.group;
          g?.api.setSize({ width: Math.floor(W / inRow), height: Math.floor(H / rows) });
        }
      }
      api.getPanel(want)?.api.setActive();
    });
  }, []);

  // 정렬 요청 — 판을 놓는 효과(위) 다음에 돈다. 같은 커밋에 열린 판까지 넣고 정렬한다
  // 처음 설 때(다시 세울 때 포함)의 값은 이미 지난 요청이다 — 그때는 저장된 배치를 따른다
  const arrangeRequest = props.arrangeRequest;
  const arrangedRef = useRef(arrangeRequest?.n ?? 0);
  useEffect(() => {
    if (!arrangeRequest || arrangeRequest.n === arrangedRef.current) return;
    arrangedRef.current = arrangeRequest.n;
    arrange(arrangeRequest.keys);
  }, [arrangeRequest, arrange]);

  // 지금 판 → dockview (단축키·다른 곳에서 바꿨을 때)
  useEffect(() => {
    const api = apiRef.current;
    lastActiveRef.current = activeKey;
    if (!api || api.activePanel?.id === activeKey) return;
    api.getPanel(activeKey)?.api.setActive();
  }, [activeKey]);

  const ctx = useMemo<DockCtx>(
    () => ({
      tabs: tabMap,
      labels: labelMap,
      renderTab,
      slotOf,
      setSlot,
      canDetach: tabs.length > 1,
      full: tabs.length >= MAX_XLOG_TABS,
      onActivate,
      onClose,
      onAdd: (fromKey: string) => {
        // 누른 묶음의 앞 탭을 먼저 지금 탭으로 — 복제는 지금 탭을 본뜬다
        if (fromKey !== propsRef.current.activeKey) onActivate(fromKey);
        lastActiveRef.current = fromKey;
        onAdd();
      },
      onRename,
      onDetach,
      onSendToMain,
      onPin,
      // 단추가 클릭 이벤트를 넘기므로 감싼다 — 그대로 주면 이벤트가 `only` 로 들어간다
      onArrange: () => arrange(),
      onAddPanel: (fromKey: string, kind: PanelKind, counter?: string) => {
        // 누른 묶음의 앞 탭을 먼저 지금 탭으로 — 새 판은 그 옆(같은 묶음)에 열린다
        if (fromKey !== propsRef.current.activeKey) onActivate(fromKey);
        lastActiveRef.current = fromKey;
        propsRef.current.onAddPanel(kind, counter);
      },
      counterChoices: props.counterChoices,
    }),
    [tabMap, labelMap, renderTab, slotOf, setSlot, tabs.length, onActivate, onClose, onAdd, onRename, onDetach, onSendToMain, onPin, arrange, props.counterChoices],
  );

  return (
    <DockContext.Provider value={ctx}>
      <DockviewReact
        className="h-full"
        components={COMPONENTS}
        defaultTabComponent={PanelTab}
        leftHeaderActionsComponent={GroupAdd}
        rightHeaderActionsComponent={GroupActions}
        onReady={onReady}
        defaultRenderer="always"
        dndStrategy="html5"
        theme={THEME}
      />
    </DockContext.Provider>
  );
});
