// 떼어 낸 XLog 창 — 탭 하나를 제 창에 그린다.
//
// 모니터 여러 대에 차트를 나눠 띄우려는 것이다. 탭의 주인은 메인 창이라(`wire.ts`) 여기서는
//   · 메인 창이 보내 준 탭을 그리고
//   · 툴바·휠로 고친 것은 메인 창에 알려 고쳐 받는다
//   · 끌어서 고른 트랜잭션은 **메인 창 목록**으로 보낸다 — 상세·프로파일은 메인 창에서 본다
// 서버 고르기는 메인 창 왼쪽 목록에서 한다. 이 탭을 고치려면 «메인 창에 붙이기» 로 돌려놓는다.
//
// 스트림은 메인 창이 연다(띄운 탭의 서버를 합쳐). 점은 Rust 가 모든 창에 똑같이 뿌리므로
// 여기서는 받아서 이 탭의 서버만 그린다.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { XLogToolbar } from '../components/XLogToolbar';
import { XLogChart } from '../components/XLogChart';
import { useViewOptions } from '../hooks/useViewOptions';
import { useT, t } from '../../../i18n';
import type { PastRange, XLogMode } from '../types/timeRange';
import type { SXLog, XLogChartConfig, XLogFilterState } from '../types/xlog';
import {
  EV_BYE,
  EV_HELLO,
  EV_PATCH,
  EV_SELECT,
  EV_STATE,
  filterFromWire,
  type DetachedState,
  type SelectMessage,
  type WirePatch,
} from './wire';

/** 메인 창이 답할 때까지 인사를 되풀이하는 간격 — 메인 창이 아직 듣기 전일 수 있다 */
const HELLO_RETRY_MS = 1_500;

export function DetachedXLog({ tabKey }: { tabKey: string }) {
  // 테마·글자 크기·언어를 메인 창과 같게 — 설정 파일을 읽어 건다
  useViewOptions();
  useT();

  const [state, setState] = useState<DetachedState | null>(null);

  useEffect(() => {
    let alive = true;
    let got = false;
    const un = listen<DetachedState>(EV_STATE, e => {
      if (!alive || e.payload.tab.key !== tabKey) return;
      got = true;
      setState(e.payload);
    });
    const hello = () => { if (!got) void emit(EV_HELLO, { key: tabKey }); };
    hello();
    const timer = setInterval(hello, HELLO_RETRY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
      void un.then(f => f());
    };
  }, [tabKey]);

  // 창을 닫으면 탭을 메인 창에 도로 붙인다 — 닫았다고 탭이 사라지면 조건을 잃는다
  useEffect(() => {
    const un = getCurrentWindow().onCloseRequested(() => {
      void emit(EV_BYE, { key: tabKey });
    });
    return () => { void un.then(f => f()); };
  }, [tabKey]);

  useEffect(() => {
    if (state) document.title = `NScouter — ${state.tab.label}`;
  }, [state]);

  const patch = useCallback(
    (p: WirePatch) => void emit(EV_PATCH, { key: tabKey, patch: p }),
    [tabKey],
  );
  const onConfigChange = useCallback((c: Partial<XLogChartConfig>) => patch({ config: c }), [patch]);
  const onFilterChange = useCallback(
    (f: Partial<XLogFilterState>) => {
      const { objHashSet: _ignored, ...rest } = f;
      patch({ filter: rest });
    },
    [patch],
  );
  const onModeChange = useCallback((m: XLogMode) => patch({ mode: m }), [patch]);
  const onPastRangeChange = useCallback((r: PastRange | null) => patch({ pastRange: r }), [patch]);
  const onSelect = useCallback(
    (xlogs: SXLog[]) => {
      const msg: SelectMessage = { key: tabKey, xlogs };
      void emit(EV_SELECT, msg);
    },
    [tabKey],
  );
  const reattach = useCallback(() => {
    void emit(EV_BYE, { key: tabKey }).then(() => getCurrentWindow().destroy());
  }, [tabKey]);

  // 받은 상태가 같으면 같은 Set — 차트는 memo 다
  const filter = useMemo(() => (state ? filterFromWire(state.tab.filter) : null), [state]);

  if (!state || !filter) {
    return (
      <div className="flex h-screen items-center justify-center bg-base text-small text-fg-dim">
        {t('메인 창에서 탭을 받는 중…')}
      </div>
    );
  }

  const { tab, connected, connectionEpoch } = state;
  const nothing = filter.objHashSet.size === 0;

  return (
    <div className="flex h-screen flex-col bg-base text-fg">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-overlay px-3 py-1">
        <span className="text-body font-medium">{tab.label}</span>
        <span className="text-micro text-fg-dim">
          {filter.objHashSet.size}
          {t('대')} · {connected ? t('연결됨') : t('연결되지 않음')}
        </span>
        <span className="flex-1" />
        <span className="text-micro text-fg-faint">{t('서버 고르기는 메인 창 왼쪽 목록에서 합니다')}</span>
        <button
          type="button"
          onClick={reattach}
          title={t('이 창을 닫고 탭을 메인 창에 도로 붙입니다')}
          className="btn px-2 py-0.5 text-micro"
        >
          {t('메인 창에 붙이기')}
        </button>
      </header>
      <XLogToolbar
        key={tab.key}
        config={tab.config}
        filter={filter}
        onConfigChange={onConfigChange}
        onFilterChange={onFilterChange}
        mode={tab.mode}
        onModeChange={onModeChange}
        pastRange={tab.pastRange}
        onPastRangeChange={onPastRangeChange}
      />
      <div className="min-h-0 flex-1 p-2">
        {nothing && connected ? (
          <div className="flex h-full items-center justify-center text-small text-fg-dim">
            {t('메인 창에서 이 탭에 볼 서버를 고르세요.')}
          </div>
        ) : (
          <XLogChart
            config={tab.config}
            filter={filter}
            onSelect={onSelect}
            connected={connected}
            connectionEpoch={connectionEpoch}
            pastRange={tab.pastRange}
            objHashes={tab.filter.objHashes}
            onConfigChange={onConfigChange}
            onPastRangeChange={onPastRangeChange}
            active
          />
        )}
      </div>
    </div>
  );
}
