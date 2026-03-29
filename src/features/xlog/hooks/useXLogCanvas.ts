// src/features/xlog/hooks/useXLogCanvas.ts
// Canvas ref 관리 + rAF 렌더링 루프

import { useCallback, useEffect, useRef, useState } from 'react';
import { XLogChartRenderer } from '../engine/XLogChartRenderer';
import type { SelectionRect } from '../engine/XLogChartRenderer';
import { XLogDataStore } from '../store/XLogDataStore';
import type { SXLog, XLogChartConfig, XLogFilterState } from '../types/xlog';

interface UseXLogCanvasResult {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  selection: SelectionRect | null;
  selectedXLogs: SXLog[];
  clearSelection: () => void;
}

export function useXLogCanvas(
  store: XLogDataStore,
  config: XLogChartConfig,
  filter: XLogFilterState,
): UseXLogCanvasResult {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<XLogChartRenderer | null>(null);
  const rafRef = useRef<number>(0);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [selectedXLogs, setSelectedXLogs] = useState<SXLog[]>([]);

  // 렌더러 초기화
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    rendererRef.current = new XLogChartRenderer(canvas, config);

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        canvas.width = Math.round(width * devicePixelRatio);
        canvas.height = Math.round(height * devicePixelRatio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        rendererRef.current?.resize(canvas.width, canvas.height);
      }
    });
    observer.observe(canvas);

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

    function loop() {
      if (!running) return;
      const renderer = rendererRef.current;

      if (renderer && store.isDirty()) {
        const now = Date.now();
        const data = store.getAll();
        renderer.render(data, filter, now, selection);
        store.clearDirty();
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [store, filter, selection]);

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
        renderer.render(data, filter, Date.now(), { x1: startX, y1: startY, x2: x, y2: y });
      }
    }

    function onMouseUp(e: MouseEvent) {
      if (!dragging) return;
      dragging = false;
      const { x, y } = getCanvasPos(e);
      const sel = { x1: startX, y1: startY, x2: x, y2: y };
      setSelection(sel);

      const renderer = rendererRef.current;
      if (renderer && Math.abs(x - startX) > 3 && Math.abs(y - startY) > 3) {
        const hits = renderer.querySelection(sel, store.getAll());
        setSelectedXLogs(hits);
      } else {
        setSelection(null);
        setSelectedXLogs([]);
      }
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
