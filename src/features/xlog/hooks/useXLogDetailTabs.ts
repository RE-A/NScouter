// 상세 패널을 **여러 개** 열어 둔다.
//
// 왜 필요한가: 느린 트랜잭션을 볼 때 하는 일은 «이건 왜 느리지» 가 아니라
// **«정상인 것과 뭐가 다르지»** 다. 하나만 열리면 두 개를 번갈아 열어야 하고,
// 그 사이에 실시간 목록이 흘러가 방금 본 것을 다시 못 찾는다.
//
// 창을 따로 띄우지 않고 탭으로 두는 이유: 새 창은 텍스트 사전과 접속 상태를
// 다시 갖춰야 하고, 창이 살아 있는 동안 그걸 관리해야 한다. 탭은 지금 있는
// 사전을 그대로 쓴다.

import { useCallback, useState } from 'react';
import { useTextResolver } from './useTextResolver';
import { loadXLogDetail, type XLogDetailState } from './useXLogDetail';
import type { SXLog } from '../types/xlog';

/**
 * 동시에 열어 둘 수 있는 최대 탭 수.
 *
 * **프로파일 하나가 수천 스텝일 수 있다.** 무제한으로 두면 오래 켜 두는 동안
 * 조용히 쌓인다. 넘치면 **가장 오래 안 본 것**을 닫는다 — 지금 보는 것과
 * 방금 본 것은 남는다.
 */
export const MAX_DETAIL_TABS = 8;

export interface DetailTab {
  /** 탭 식별자. 한 트랜잭션은 txid 하나다 */
  key: string;
  /** 탭 머리에 쓸 이름. 프로파일이 오기 전에도 있어야 해서 xlog 에서 뽑는다 */
  title: string;
  state: XLogDetailState;
  /** 마지막으로 이 탭을 본 시각. 넘칠 때 무엇을 닫을지 정하는 데만 쓴다 */
  touchedAt: number;
}

export interface XLogDetailTabs {
  tabs: DetailTab[];
  activeKey: string | null;
  /** 지금 보고 있는 탭의 상태. 없으면 null */
  active: XLogDetailState | null;
  /** 열거나, 이미 열려 있으면 그리로 옮긴다 */
  open: (xlog: SXLog) => void;
  close: (key: string) => void;
  closeActive: () => void;
  closeAll: () => void;
  activate: (key: string) => void;
  /** 다음/이전 탭으로. 끝에서 처음으로 돈다 */
  cycle: (dir: 1 | -1) => void;
}

interface TabsState {
  tabs: DetailTab[];
  activeKey: string | null;
}

const EMPTY: TabsState = { tabs: [], activeKey: null };

/** 탭 머리에 쓸 짧은 이름. 서비스명은 아직 해석 전일 수 있어 뒤에서 채운다 */
function titleOf(xlog: SXLog, texts: Record<number, string>): string {
  return texts[xlog.service] ?? `0x${(xlog.service >>> 0).toString(16)}`;
}

export function useXLogDetailTabs(): XLogDetailTabs {
  const [state, setState] = useState<TabsState>(EMPTY);
  const { resolve, getCached } = useTextResolver();

  // **닫힌 탭에 응답이 늦게 도착한다.** 그대로 넣으면 닫은 탭이 되살아나므로
  // 키가 아직 살아 있을 때만 반영한다 (아래 두 곳의 `prev.tabs.some`).

  const activate = useCallback((key: string) => {
    setState(prev =>
      prev.tabs.some(t => t.key === key)
        ? {
            tabs: prev.tabs.map(t => (t.key === key ? { ...t, touchedAt: Date.now() } : t)),
            activeKey: key,
          }
        : prev,
    );
  }, []);

  const open = useCallback(
    (xlog: SXLog) => {
      const key = xlog.txid;
      let alreadyOpen = false;

      setState(prev => {
        const found = prev.tabs.find(t => t.key === key);
        if (found) {
          alreadyOpen = true;
          return {
            tabs: prev.tabs.map(t => (t.key === key ? { ...t, touchedAt: Date.now() } : t)),
            activeKey: key,
          };
        }

        const seed: DetailTab = {
          key,
          title: titleOf(xlog, {}),
          state: { isLoading: true, error: null, profile: null, texts: {}, xlog },
          touchedAt: Date.now(),
        };

        // 넘치면 **지금 보는 것을 빼고** 가장 오래 안 본 것을 닫는다.
        let kept = prev.tabs;
        if (kept.length >= MAX_DETAIL_TABS) {
          const victim = kept
            .filter(t => t.key !== prev.activeKey)
            .reduce<DetailTab | null>(
              (oldest, t) => (oldest === null || t.touchedAt < oldest.touchedAt ? t : oldest),
              null,
            );
          if (victim) kept = kept.filter(t => t.key !== victim.key);
        }
        return { tabs: [...kept, seed], activeKey: key };
      });

      if (alreadyOpen) return;

      loadXLogDetail(xlog, resolve)
        .then(({ profile, texts }) => {
          setState(prev =>
            prev.tabs.some(t => t.key === key)
              ? {
                  ...prev,
                  tabs: prev.tabs.map(t =>
                    t.key === key
                      ? {
                          ...t,
                          title: titleOf(xlog, texts),
                          state: { isLoading: false, error: null, profile, texts, xlog },
                        }
                      : t,
                  ),
                }
              : prev,
          );
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          setState(prev =>
            prev.tabs.some(t => t.key === key)
              ? {
                  ...prev,
                  tabs: prev.tabs.map(t =>
                    t.key === key
                      ? { ...t, state: { ...t.state, isLoading: false, error: msg } }
                      : t,
                  ),
                }
              : prev,
          );
        });
    },
    [resolve],
  );

  const close = useCallback((key: string) => {
    setState(prev => {
      const idx = prev.tabs.findIndex(t => t.key === key);
      if (idx < 0) return prev;
      const tabs = prev.tabs.filter(t => t.key !== key);
      if (prev.activeKey !== key) return { ...prev, tabs };
      // **닫은 자리의 이웃으로 옮긴다.** 늘 첫 탭으로 돌아가면 여러 개를 정리할 때
      // 볼 곳이 매번 튄다.
      const next = tabs[Math.min(idx, tabs.length - 1)];
      return { tabs, activeKey: next ? next.key : null };
    });
  }, []);

  const closeActive = useCallback(() => {
    setState(prev => {
      if (prev.activeKey === null) return prev;
      const idx = prev.tabs.findIndex(t => t.key === prev.activeKey);
      const tabs = prev.tabs.filter(t => t.key !== prev.activeKey);
      const next = tabs[Math.min(idx, tabs.length - 1)];
      return { tabs, activeKey: next ? next.key : null };
    });
  }, []);

  const closeAll = useCallback(() => setState(EMPTY), []);

  const cycle = useCallback((dir: 1 | -1) => {
    setState(prev => {
      if (prev.tabs.length === 0) return prev;
      const idx = prev.tabs.findIndex(t => t.key === prev.activeKey);
      const nextIdx = (((idx < 0 ? 0 : idx) + dir) % prev.tabs.length + prev.tabs.length) % prev.tabs.length;
      const next = prev.tabs[nextIdx];
      return {
        tabs: prev.tabs.map(t => (t.key === next.key ? { ...t, touchedAt: Date.now() } : t)),
        activeKey: next.key,
      };
    });
  }, []);

  // 제목은 사전이 나중에 채워지기도 한다 — 그릴 때 한 번 더 본다.
  const tabs = state.tabs.map(t =>
    t.state.xlog
      ? { ...t, title: getCached('service', t.state.xlog.service) ?? t.title }
      : t,
  );
  const active = tabs.find(t => t.key === state.activeKey)?.state ?? null;

  return {
    tabs,
    activeKey: state.activeKey,
    active,
    open,
    close,
    closeActive,
    closeAll,
    activate,
    cycle,
  };
}
