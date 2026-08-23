// 끌어서 크기를 바꾸는 경계선
//
// 포인터 캡처를 쓴다. mousemove 를 document 에 붙이면 드래그 중 커서가
// 캔버스나 iframe 위로 지나갈 때 이벤트를 뺏겨 끌기가 끊긴다.
//
// 평소에는 hairline 이고, 실제 잡을 수 있는 영역은 그보다 넓다 —
// 4px 짜리 선을 정확히 노리게 만들면 못 쓴다.

import React, { useCallback, useRef } from 'react';
import { PANE } from './paneSizing';

interface DividerProps {
  orientation: 'vertical' | 'horizontal';
  /** 끌린 누적 변위(px)를 시작 시점 기준으로 넘긴다 */
  onDrag: (delta: number) => void;
  label: string;
}

export function Divider({ orientation, onDrag, label }: DividerProps) {
  const startRef = useRef(0);
  const vertical = orientation === 'vertical';

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      startRef.current = vertical ? e.clientX : e.clientY;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [vertical],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const now = vertical ? e.clientX : e.clientY;
      onDrag(now - startRef.current);
      startRef.current = now;
    },
    [vertical, onDrag],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  // 키보드로도 조정할 수 있어야 한다 — 포인터만 지원하면 접근이 막힌다.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 40 : 10;
      const dec = vertical ? 'ArrowLeft' : 'ArrowUp';
      const inc = vertical ? 'ArrowRight' : 'ArrowDown';
      if (e.key === dec) { e.preventDefault(); onDrag(-step); }
      else if (e.key === inc) { e.preventDefault(); onDrag(step); }
    },
    [vertical, onDrag],
  );

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyDown}
      style={vertical ? { width: PANE.divider } : { height: PANE.divider }}
      className={[
        'group relative shrink-0 touch-none',
        vertical ? 'cursor-col-resize' : 'cursor-row-resize',
        'focus-visible:outline-none',
      ].join(' ')}
    >
      {/* 잡기 쉬우라고 실제 판정 영역을 선 밖으로 넓힌다 */}
      <span
        aria-hidden
        className={
          vertical
            ? 'absolute inset-y-0 -inset-x-1'
            : 'absolute inset-x-0 -inset-y-1'
        }
      />
      <span
        aria-hidden
        className={[
          'absolute rounded-full bg-transparent transition-colors',
          'group-hover:bg-accent/60 group-focus-visible:bg-accent',
          vertical
            ? 'inset-y-1 left-1/2 w-[2px] -translate-x-1/2'
            : 'inset-x-1 top-1/2 h-[2px] -translate-y-1/2',
        ].join(' ')}
      />
    </div>
  );
}
