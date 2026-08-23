// src/features/xlog/hooks/useXLogCanvas.ts
// Canvas ref 관리 + rAF 렌더링 루프

import { useCallback, useEffect, useRef, useState } from 'react';
import { XLogChartRenderer } from '../engine/XLogChartRenderer';
import { rollingWindow } from '../engine/CoordinateMapper';
import type { TimeWindow } from '../engine/CoordinateMapper';
import type { SelectionRect } from '../engine/XLogChartRenderer';
import { XLogDataStore } from '../store/XLogDataStore';
import type { SXLog, XLogChartConfig, XLogFilterState } from '../types/xlog';
import { deriveStreamStatus } from '../utils/streamStatus';
import { useTextResolver } from './useTextResolver';

/** 이 시간 넘게 XLog 가 없으면 "수신 없음"으로 본다. 폴링이 500ms 라 넉넉히 잡는다. */
const STALE_AFTER_MS = 15_000;

interface UseXLogCanvasResult {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  selection: SelectionRect | null;
  selectedXLogs: SXLog[];
  clearSelection: () => void;
}

/**
 * @param timeWindow 그릴 구간. 없으면 실시간(흐르는 창)이다.
 *        **이름이 `window` 면 전역 window 를 가려** 같은 훅의 addEventListener 가 깨진다.
 *               과거 조회는 고정 구간을 넘겨 "지금"에서 벗어난다.
 */
export function useXLogCanvas(
  store: XLogDataStore,
  config: XLogChartConfig,
  filter: XLogFilterState,
  connected: boolean,
  timeWindow?: TimeWindow | null,
): UseXLogCanvasResult {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<XLogChartRenderer | null>(null);
  const rafRef = useRef<number>(0);
  /** 마지막으로 실제로 그린 시간 창. 드래그 미리보기가 같은 창을 써야 한다 */
  const renderWindowRef = useRef<TimeWindow>(rollingWindow(Date.now(), config.timeRangeMs));
  /**
   * 캔버스를 다시 그려야 한다는 표시.
   *
   * **캔버스는 크기를 바꾸면 내용이 지워진다.** 그런데 루프는 데이터가 바뀌었을 때만
   * 다시 그리므로, 흐르지 않는 상태(미연결·트래픽 없음)에서 크기가 바뀌면
   * 축도 안내 문구도 없는 **빈 화면**이 그대로 남는다. 처음 마운트될 때가 바로 그 경우다 —
   * 첫 그림은 0x0 캔버스에 그려지고, 뒤늦게 크기가 잡히면서 지워진다.
   */
  const needsRedrawRef = useRef(true);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [selectedXLogs, setSelectedXLogs] = useState<SXLog[]>([]);

  const { getCached, resolve } = useTextResolver();

  /**
   * 서비스명 필터가 걸리면 **버퍼에 있는 서비스 해시를 전부 풀어 둔다.**
   *
   * 목록은 선택한 것만 풀면 되지만 차트는 모든 점을 판정해야 한다 —
   * 안 풀린 해시는 이름 없음으로 취급되어 포함 조건에서 통째로 빠진다.
   * 서로 다른 서비스는 실측에서 열 몇 개 수준이라 주기적으로 훑어도 싸다.
   */
  useEffect(() => {
    if (filter.service.text.trim() === '') return;
    let alive = true;

    const fill = () => {
      const hashes = [...new Set(store.getAll().map(x => x.service).filter(Boolean))]
        .filter(h => getCached('service', h) === undefined);
      if (hashes.length === 0) return;
      resolve('service', hashes)
        .then(() => {
          // 이름이 채워지면 판정이 달라진다. 다시 그리게 표시한다.
          if (alive) needsRedrawRef.current = true;
        })
        .catch(() => {});
    };

    fill();
    const id = setInterval(fill, 2_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [filter.service.text, store, getCached, resolve]);

  // 렌더러 초기화
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    rendererRef.current = new XLogChartRenderer(canvas, config);
    // 서비스명 필터는 이미 받아 둔 사전만 읽는다 (그리기 루프는 기다릴 수 없다).
    rendererRef.current.setServiceNameResolver(h => getCached('service', h));

    // **관찰 대상은 부모다.**
    //
    // 이전에는 캔버스 자신을 관찰하면서 캔버스의 style 을 px 로 고정했다.
    // 캔버스는 처음엔 width:100% 라 부모를 따라가지만, 관찰자가 한 번 돌면서
    // px 로 못 박히는 순간 부모와 끊긴다. 그리고 관찰 대상이 자기 자신이라
    // 부모가 커져도 다시 발화하지 않는다 —
    // 창을 키우면 패널만 커지고 차트는 그대로 남아 아래가 빈다.
    //
    // 부모는 우리가 크기를 건드리지 않으므로 되먹임도 없다.
    const applySize = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      rendererRef.current?.resize(canvas.width, canvas.height);
      needsRedrawRef.current = true;
    };

    const box = canvas.parentElement;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      applySize(width, height);
    });
    if (box) {
      applySize(box.clientWidth, box.clientHeight);
      observer.observe(box);
    }

    return () => {
      observer.disconnect();
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // config 변경 시 렌더러 업데이트
  useEffect(() => {
    rendererRef.current?.updateConfig(config);
  }, [config]);

  // rAF 루프
  useEffect(() => {
    let running = true;

    // 데이터가 안 들어와도 상태 문구는 갱신돼야 하므로
    // dirty 가 아니어도 문구가 바뀌면 다시 그린다.
    let lastStatusMsg = '';

    // 드래그 미리보기는 이벤트 핸들러 클로저 안에서 그리는데, 그 클로저는
    // `[store, filter]` 에만 묶여 있어 **과거 구간을 알지 못한다.**
    // 매 프레임 실제로 쓴 창을 여기에 남겨 두 그림이 같은 좌표계를 쓰게 한다.

    function loop() {
      if (!running) return;
      const renderer = rendererRef.current;

      if (renderer) {
        const now = Date.now();
        // 과거 구간은 시간이 흘러도 창이 그대로다. "수신 없음" 판정도 하지 않는다 —
        // 다 받아온 뒤에는 더 올 게 없는 게 정상이다.
        const status = timeWindow
          ? undefined
          : deriveStreamStatus({
              connected,
              lastReceivedAt: store.lastReceivedAt,
              now,
              staleAfterMs: STALE_AFTER_MS,
            });
        const statusChanged = (status?.message ?? '') !== lastStatusMsg;

        // 그리지 않는 프레임에도 갱신한다 — 드래그가 시작되는 순간의 창이 필요하다.
        const renderWindow = timeWindow ?? rollingWindow(now, config.timeRangeMs);
        renderWindowRef.current = renderWindow;

        if (store.isDirty() || statusChanged || needsRedrawRef.current) {
          needsRedrawRef.current = false;
          renderer.render(
            store.getAll(),
            filter,
            renderWindow,
            selection,
            status,
          );
          store.clearDirty();
          lastStatusMsg = status?.message ?? '';
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [store, filter, selection, connected, timeWindow, config.timeRangeMs]);

  const clearSelection = useCallback(() => {
    setSelection(null);
    setSelectedXLogs([]);
    store.clearDirty(); // force re-render
    if (store.size > 0) {
      // dirty 플래그를 강제 설정하려면 빈 add → 제거 대신 직접 dirty 노출 필요
      // XLogDataStore에 forceDirty() 추가 없이 간단히 처리
    }
  }, [store]);

  // 드래그 선택 이벤트
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;

    function getCanvasPos(e: MouseEvent): { x: number; y: number } {
      const rect = canvas!.getBoundingClientRect();
      const dpr = devicePixelRatio;
      return {
        x: (e.clientX - rect.left) * dpr,
        y: (e.clientY - rect.top) * dpr,
      };
    }

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      const { x, y } = getCanvasPos(e);
      dragging = true;
      startX = x;
      startY = y;
      setSelection({ x1: x, y1: y, x2: x, y2: y });
    }

    function onMouseMove(e: MouseEvent) {
      if (!dragging) return;
      const { x, y } = getCanvasPos(e);
      setSelection({ x1: startX, y1: startY, x2: x, y2: y });
      // dirty 플래그 강제 설정 (선택 오버레이 갱신)
      // store는 외부에서 dirty를 관리하므로 renderer를 직접 호출
      const renderer = rendererRef.current;
      if (renderer) {
        const data = store.getAll();
        // **`rollingWindow(now)` 를 쓰면 안 된다.** 과거 조회 중에 드래그하면
        // 차트가 "지금" 으로 튀고, 그 좌표계로 선택이 계산돼 엉뚱한 건이 잡힌다.
        renderer.render(
          data,
          filter,
          renderWindowRef.current,
          { x1: startX, y1: startY, x2: x, y2: y },
        );
      }
    }

    function onMouseUp(e: MouseEvent) {
      if (!dragging) return;
      dragging = false;
      const { x, y } = getCanvasPos(e);
      const sel = { x1: startX, y1: startY, x2: x, y2: y };
      setSelection(sel);

      const renderer = rendererRef.current;
      if (!renderer) return;

      const data = store.getAll();
      const isDrag = Math.abs(x - startX) > 3 || Math.abs(y - startY) > 3;

      if (isDrag) {
        setSelectedXLogs(renderer.querySelection(sel, data));
        return;
      }

      // 단일 클릭 — 그 자리의 점 1개를 연다.
      // 못 찾았을 때만 선택을 비운다. 무조건 비우면 클릭이 아무 일도 안 하는 것처럼 보인다.
      setSelection(null);
      const hit = renderer.queryPoint(x, y, data);
      setSelectedXLogs(hit ? [hit] : []);
    }

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [store, filter]);

  return { canvasRef, selection, selectedXLogs, clearSelection };
}
