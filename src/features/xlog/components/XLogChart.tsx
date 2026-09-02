// src/features/xlog/components/XLogChart.tsx

import React, { memo, useMemo } from 'react';
import { useXLogCanvas } from '../hooks/useXLogCanvas';
import { useXLogStream } from '../hooks/useXLogStream';

import { usePastXLog } from '../hooks/usePastXLog';
import { useLiveBackfill } from '../hooks/useLiveBackfill';
import type { SXLog, XLogChartConfig, XLogFilterState } from '../types/xlog';
import type { PastRange } from '../types/timeRange';
import { panRange, zoomRange } from '../types/timeRange';
import { stepYMax } from '../engine/yScale';
import { T, F } from '../../../styles/tokens';
import { t } from '../../../i18n';

interface XLogChartProps {
  config: XLogChartConfig;
  filter: XLogFilterState;
  onSelect?: (xlogs: SXLog[]) => void;
  /** 비었을 때 "미연결"과 "데이터 없음"을 구분하는 데 쓴다 */
  connected: boolean;
  /**
   * 값이 바뀌면 선택을 해제한다.
   *
   * 선택 사각형은 캔버스 안(useXLogCanvas)에 있고 목록은 App 이 들고 있다.
   * 목록의 ✕ 만으로는 App 상태만 지워져 **캔버스에 사각형이 남는다.**
   * 해제 버튼은 하나여야 하므로 목록 쪽에 두고 여기로 신호를 보낸다.
   */
  clearSignal?: number;
  /**
   * 과거 구간. null 이면 실시간이다.
   *
   * 실시간과 **스토어가 다르다** — 실시간 스토어는 창 밖을 잘라내는데(prune)
   * 과거 구간은 시간이 흘러도 그대로 있어야 한다.
   */
  pastRange?: PastRange | null;
  /**
   * 조회 대상 오브젝트 — 지금 고른 서버(없으면 전체)다.
   *
   * 과거 구간 조회에도, **실시간 화면의 왼쪽을 메우는 데도** 같은 목록을 쓴다.
   * 실시간 스트림이 받는 것과 같아야 한다 — 다르면 화면 왼쪽과 오른쪽의 대상이 다르다.
   */
  objHashes?: number[];
  /**
   * 차트 설정을 바꾼다. **Ctrl+휠(세로축 확대·축소)에 쓴다.**
   *
   * 시간축은 과거 구간에서만 움직이지만 세로축은 실시간에서도 움직여야 한다 —
   * 축이 낮으면 큰 점이 한 개도 안 보인다.
   */
  onConfigChange?: (patch: Partial<XLogChartConfig>) => void;
  /**
   * 휠로 구간이 바뀌었을 때. 툴바의 입력값도 따라가야 하므로 위로 올린다.
   *
   * 드래그는 **트랜잭션 선택 그대로**다. 확대·이동은 휠이 맡는다.
   */
  onPastRangeChange?: (r: PastRange) => void;
  /**
   * 값이 바뀌면 **같은 구간을 다시 받아 온다** (F5).
   *
   * 구간을 새 객체로 바꾸는 방식은 쓸 수 없다 — 재조회 판정이 stime/etime 값으로
   * 돌아서 같은 구간이면 아무 일도 일어나지 않는다.
   */
  refreshSignal?: number;
}

/**
 * 이 이상 벌어지면 알린다.
 *
 * 폴링 간격(500ms)과 전송 지연으로 늘 몇백 ms 는 벌어진다 — 그 정도로 띄우면
 * 경고가 늘 떠 있어 아무도 안 읽는다. 창 폭(가장 좁은 것이 1분)에 견주어
 * **점 자리가 눈에 띄게 밀리는 크기**를 임계로 둔다.
 */
const SKEW_WARN_MS = 10_000;

/**
 * 상한 안내를 띄워 두는 시간.
 *
 * 상한은 **계속** 걸리므로(한 번 넘치면 폴링마다 넘친다) 안내도 계속 떠 있어야 한다.
 * 다만 부하가 잦아들어 더 이상 안 버리면 조용히 사라져야 한다 — prune 주기(5초)의
 * 몇 배로 둔다.
 */
const CAP_NOTICE_MS = 30_000;

export const XLogChart = memo(function XLogChart({
  config,
  filter,
  onSelect,
  connected,
  clearSignal,
  pastRange = null,
  objHashes = [],
  onConfigChange,
  onPastRangeChange,
  refreshSignal = 0,
}: XLogChartProps) {
  const { store: liveStore, streamError, clearError } = useXLogStream(config);

  const isPast = pastRange !== null;
  /** Ctrl+휠이 딛고 설 값 */
  const yMaxNow = config.yMax;

  // **보는 창을 그대로 넘긴다.**
  // 무엇을 더 받을지는 훅이 정한다 — 안쪽으로 확대하면 받을 것이 없고,
  // 좌우로 옮기면 **모자란 쪽만** 받는다(planFetch). 예전에는 창이 벗어날 때마다
  // 구간 전체를 다시 받아서, 조금만 옮겨도 수만 건을 처음부터 끌어왔다.
  const past = usePastXLog(pastRange, objHashes);

  /**
   * **실시간에서도 과거를 받는다.**
   *
   * 스트림은 «지금부터» 만 주므로, 켜자마자 보이는 것은 오른쪽 끝 한 줄뿐이고
   * 30분 창이 차려면 30분이 걸린다. 창의 왼쪽(= 아직 못 받은 과거)을 같은 저장소에
   * 뒤늦게 부어 넣는다 — 겹치지 않게 무엇을 받을지는 훅이 정한다.
   */
  const backfill = useLiveBackfill(liveStore, config.timeRangeMs, objHashes, connected && !isPast);

  // **처음 마운트될 때는 다시 받지 않는다.** 이미 위에서 받고 있다.
  const pastReload = past.reload;
  const firstRefresh = React.useRef(true);
  React.useEffect(() => {
    if (firstRefresh.current) { firstRefresh.current = false; return; }
    if (isPast) pastReload();
  }, [refreshSignal, isPast, pastReload]);
  const store = isPast ? past.store : liveStore;

  // 과거는 고정 구간, 실시간은 흐르는 창.
  const timeWindow = useMemo(
    () => (pastRange ? { start: pastRange.stime, end: pastRange.etime } : null),
    [pastRange],
  );

  /**
   * 휠 = 확대/축소, Shift+휠 = 좌우 이동.
   *
   * 커서 아래 시각을 고정해야 확대가 예측 가능하다 — 가운데 기준이면
   * 보고 있던 지점이 화면 밖으로 달아난다.
   */
  const handleWheel = React.useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      // **Ctrl+휠은 세로축이다.** 실시간에서도 된다 — 시간축은 실시간에서 흐르는 창이라
      // 건드릴 수 없지만, 세로축은 언제든 늘리고 줄일 수 있어야 한다.
      // (축이 낮아 30초짜리가 한 점도 안 보이던 것이 현장에서 나온 문제다.)
      if (e.ctrlKey && onConfigChange) {
        e.preventDefault();
        onConfigChange({ yMax: stepYMax(yMaxNow, e.deltaY > 0 ? 1 : -1) });
        return;
      }

      if (!pastRange || !onPastRangeChange) return;
      e.preventDefault();

      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;

      if (e.shiftKey) {
        onPastRangeChange(panRange(pastRange, e.deltaY > 0 ? 0.2 : -0.2));
      } else {
        onPastRangeChange(zoomRange(pastRange, ratio, e.deltaY > 0 ? 1.25 : 0.8));
      }
    },
    [pastRange, onPastRangeChange, onConfigChange, yMaxNow],
  );

  const { canvasRef, selectedXLogs, clearSelection } = useXLogCanvas(
    store,
    config,
    filter,
    connected,
    timeWindow,
  );

  /**
   * 선택 변경 시 콜백.
   *
   * **콜백 신원이 바뀌었다고 다시 알리면 안 된다.** 부모가 콜백을 매 렌더 새로 만들면
   * 선택이 그대로인데도 "새로 골랐다"가 계속 날아간다 — 그 신호로 뭔가를 초기화하는
   * 쪽에서는 조용히 망가진다(실제로 프로파일 검색이 첫 묶음만 돌고 취소됐다).
   * 진짜로 선택이 바뀐 때만 알린다.
   */
  const prevSelRef = React.useRef<SXLog[] | null>(null);
  React.useEffect(() => {
    if (prevSelRef.current === selectedXLogs) return;
    prevSelRef.current = selectedXLogs;
    if (selectedXLogs.length > 0) {
      onSelect?.(selectedXLogs);
    }
  }, [selectedXLogs, onSelect]);

  // 첫 렌더(초기값)에는 지울 게 없으므로 실제로 바뀐 뒤에만 해제한다.
  const prevClearRef = React.useRef(clearSignal);
  React.useEffect(() => {
    if (prevClearRef.current === clearSignal) return;
    prevClearRef.current = clearSignal;
    clearSelection();
  }, [clearSignal, clearSelection]);

  /**
   * 콜렉터 시각과 이 PC 시각이 얼마나 벌어졌나. 작으면 아무 말도 하지 않는다.
   *
   * 몇 초는 늘 있는 일이라(폴링 간격·전송 지연) 임계를 넘을 때만 띄운다.
   */
  /**
   * 상한에 걸려 오래된 점을 버리고 있는가.
   *
   * 창은 30분인데 화면에는 그보다 짧은 구간만 남는 상황이다. 조용히 두면
   * «데이터가 유실된다» 로 읽힌다 — 무엇을 왜 버렸고 어떻게 하면 되는지 말한다.
   */
  const capWarning = (() => {
    const at = store.lastDropAtMs;
    if (at === null || Date.now() - at > CAP_NOTICE_MS) return null;
    // **지금 걸려 있는 값**을 적는다. 설정에서 바꿀 수 있으므로 상수를 적으면 거짓이 된다.
    // **받은 것 기준**이라고 밝힌다. 화면 필터(서비스·IP·응답시간)는 그리기 직전에 걸리므로,
    // «화면에 4천 건인데 왜 10만이 넘느냐» 가 나온다 — 버퍼에는 거르기 전의 것이 들어 있다.
    return `${t('버퍼 상한')} ${store.maxItemCount.toLocaleString()}${t('건(화면 필터 이전, 받은 것 기준) — 오래된 점부터 지웁니다. 왼쪽에서 서버를 좁히거나 설정에서 상한을 올리면 다 보입니다')}`;
  })();

  /** 왼쪽을 다 못 채웠을 때 할 말. 채우는 중이거나 다 찼으면 없다 */
  const backfillNotice = (() => {
    if (backfill.error !== null) {
      return `${t('과거 구간을 채우지 못했습니다')} — ${backfill.error}`;
    }
    if (backfill.truncated) {
      return t('과거 구간을 다 채우지 못했습니다 — 창을 좁히거나 왼쪽에서 서버를 좁혀 주세요');
    }
    return null;
  })();

  const skewWarning = (() => {
    const skew = store.clockSkewMs;
    if (skew === null || Math.abs(skew) < SKEW_WARN_MS) return null;
    const sec = Math.round(Math.abs(skew) / 1000);
    return skew > 0
      ? `${t('데이터 시각이 이 PC 보다')} ${sec}${t('초 앞섭니다 — 최신 점이 창 밖에 있을 수 있습니다')}`
      : `${t('데이터 시각이 이 PC 보다')} ${sec}${t('초 뒤처집니다 — 오른쪽이 비어 보일 수 있습니다')}`;
  })();

  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%' }}
      onWheel={handleWheel}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          cursor: 'crosshair',
        }}
      />

      {/* 과거 조회는 수만 건이라 몇 초 걸린다. 진행 상황이 없으면 멈춘 것처럼 보인다. */}
      {isPast && (past.loading || past.error) && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded border border-line-strong bg-overlay px-3 py-1 text-body shadow-lg">
          {past.error ? (
            <span className="text-danger">{past.error}</span>
          ) : (
            <span className="text-fg-muted">
              {t('불러오는 중…')} <span className="tnum font-mono text-fg">
                {(past.progress?.loaded ?? 0).toLocaleString()}
              </span>{t('건')}
            </span>
          )}
        </div>
      )}
      {/* **뒤늦게 차오르는 중이라고 말한다.** 아무 말이 없으면 왼쪽이 빈 것을 보고
          «데이터가 없다» 로 읽고, 다 찬 뒤에 다시 보면 «없다더니 있네» 가 된다. */}
      {!isPast && backfill.loading && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded border border-line-strong bg-overlay px-3 py-1 text-micro text-fg-muted shadow-lg">
          {t('과거 구간 채우는 중…')} <span className="tnum font-mono text-fg">
            {backfill.loaded.toLocaleString()}
          </span>{t('건')}
        </div>
      )}

      {isPast && !past.loading && past.progress?.truncated && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded border border-warn/50 bg-overlay px-3 py-1 text-body text-warn shadow-lg">
          {t('너무 많아 일부만 표시합니다 — 구간을 좁혀 주세요')}
        </div>
      )}

      {/* **시계가 어긋나면 점이 창 밖에 놓인다.**
          차트의 오른쪽 끝은 이 PC 의 «지금» 이다. 콜렉터 쪽 시각이 앞서면 방금 온 점이
          오른쪽 밖으로, 뒤처지면 오른쪽이 빈 채로 남는다 — 스트림은 멀쩡한데
          화면에서만 사라진 것처럼 보인다. 조용히 두면 원인을 찾을 길이 없다. */}
      {/* **그림 위에 띄우지 않는다.** 가운데 아래에 뒀더니 점을 가렸다 —
          안내가 정작 보려던 것을 덮으면 안내가 아니다. 차트 맨 아래 한 줄로 눕힌다. */}
      {!isPast && capWarning !== null && (
        <div className="absolute inset-x-0 bottom-0 truncate border-t border-warn/40 bg-overlay/95 px-2 py-0.5 text-micro text-warn">
          {capWarning}
        </div>
      )}

      {/* 왼쪽을 덜 채웠다(상한에 걸렸거나 조회가 실패했다). 조용히 두면
          «그 시간대에 트래픽이 없었다» 로 읽힌다.
          상한 안내가 떠 있으면 그쪽이 먼저다 — 같은 자리에 두 줄을 겹칠 수 없다. */}
      {!isPast && capWarning === null && !backfill.loading && backfillNotice !== null && (
        <div className="absolute inset-x-0 bottom-0 truncate border-t border-warn/40 bg-overlay/95 px-2 py-0.5 text-micro text-warn">
          {backfillNotice}
        </div>
      )}

      {!isPast && skewWarning !== null && (
        <div className="absolute top-2 right-2 rounded border border-warn/50 bg-overlay px-2 py-1 text-micro text-warn shadow-lg">
          {skewWarning}
        </div>
      )}

      {streamError && (
        <div style={errorBannerStyle}>
          <span>{streamError}</span>
          <button onClick={clearError} style={closeBtnStyle}>✕</button>
        </div>
      )}

      {/* 선택 개수 배지는 뺐다 — 바로 아래 목록이 같은 값을 "선택 19건" 으로 이미 말한다.
          같은 일을 하는 컨트롤 두 개가 표현만 달랐다("개" vs "건"). */}
    </div>
  );
});

const errorBannerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(220, 50, 50, 0.9)',
  color: T.text,
  padding: '6px 12px',
  borderRadius: 4,
  fontSize: F.body,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  zIndex: 10,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: T.text,
  cursor: 'pointer',
  padding: 0,
  fontSize: F.base,
  lineHeight: 1,
};
