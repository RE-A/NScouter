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
import { MAX_XLOG_TABS, type SplitDir, type XLogTab } from '../hooks/xlogTabs';
import { opsFromSplit } from '../hooks/dockLayout';
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
  /** 배치가 바뀌었다 (판 이름 = 탭 키) */
  onLayoutChange: (dock: SerializedDockview) => void;
  /** 보이는 판들 — 판 묶음의 앞 탭들 */
  onVisibleChange: (keys: string[]) => void;
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
      {ctx.renderTab(tab, visible, visible ? ctx.slotOf(api.id) : null)}
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
        <span className="max-w-[14rem] truncate">{label}</span>
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
                disabled: ctx.canDetach ? undefined : t('이 창에 탭이 하나는 남아야 합니다'),
              },
              ...(ctx.onSendToMain
                ? [{ label: t('메인 창으로 보내기'), onSelect: () => ctx.onSendToMain?.(api.id) }]
                : []),
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
  return (
    <div className="flex h-full items-center pl-1">
      <button
        type="button"
        disabled={ctx.full || key === undefined}
        onClick={() => key && ctx.onAdd(key)}
        title={
          ctx.full
            ? t('탭은 최대 6개입니다. 탭마다 조회한 것을 따로 들고 있어 더 늘리면 메모리를 먹습니다')
            : t('지금 조건을 복제해 탭을 하나 더 엽니다 — 날짜만 바꿔 견주는 데 씁니다')
        }
        className="btn-ghost px-1.5 py-0.5 text-micro"
      >
        + {t('탭')}
      </button>
    </div>
  );
}

/** 판 묶음 머리 오른쪽 — 앞 탭의 차트 머리(포털 자리)와 `↗` */
function GroupActions({ activePanel, group }: IDockviewHeaderActionsProps) {
  const ctx = useDock();
  const key = activePanel?.id;
  const { setSlot } = ctx;
  const ref = useCallback((el: HTMLDivElement | null) => setSlot(group.id, key, el), [setSlot, group.id, key]);
  return (
    <div className="flex h-full min-w-0 items-center gap-1 pr-1">
      <div ref={ref} className="flex min-w-0 items-center" />
      {key && (
        <button
          type="button"
          disabled={!ctx.canDetach}
          onClick={() => ctx.onDetach(key)}
          title={ctx.canDetach ? t('이 판을 새 창으로 뗍니다 — 다른 모니터에 띄울 때') : t('이 창에 탭이 하나는 남아야 합니다')}
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
  const { tabs, labels, activeKey, renderTab, onActivate, onClose, onAdd, onRename, onDetach, onSendToMain } = props;
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

  // 탭 상태 → 판. 닫힌 탭의 판은 내리고, 새 탭은 직전 지금 판의 묶음에 연다. 이름도 맞춘다
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
        ...(ref ? { position: { referencePanel: ref.id, direction: 'within' as const } } : {}),
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
    }),
    [tabMap, labelMap, renderTab, slotOf, setSlot, tabs.length, onActivate, onClose, onAdd, onRename, onDetach, onSendToMain],
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
