// src/components/FloatingPanel.tsx

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';

interface Rect { x: number; y: number; w: number; h: number; }
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface DragState {
  startX: number;
  startY: number;
  startRect: Rect;
  mode: 'move' | ResizeDir;
}

interface FloatingPanelProps {
  title: string;
  children: React.ReactNode;
  initialRect: Rect;
  minW?: number;
  minH?: number;
  zIndex?: number;
  onFocus?: () => void;
}

export const FloatingPanel = memo(function FloatingPanel({
  title,
  children,
  initialRect,
  minW = 160,
  minH = 120,
  zIndex = 10,
  onFocus,
}: FloatingPanelProps) {
  const [rect, setRect] = useState<Rect>(initialRect);
  const dragRef = useRef<DragState | null>(null);

  const handleTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, startRect: { ...rect }, mode: 'move' };
    onFocus?.();
  }, [rect, onFocus]);

  const makeResizeHandler = useCallback((dir: ResizeDir) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startY: e.clientY, startRect: { ...rect }, mode: dir };
    onFocus?.();
  }, [rect, onFocus]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const { x: ox, y: oy, w: ow, h: oh } = drag.startRect;
      let x = ox, y = oy, w = ow, h = oh;

      if (drag.mode === 'move') {
        x = ox + dx;
        y = oy + dy;
      } else {
        const m = drag.mode;
        if (m.includes('e')) w = Math.max(minW, ow + dx);
        if (m.includes('s')) h = Math.max(minH, oh + dy);
        if (m.includes('w')) { const nw = Math.max(minW, ow - dx); x = ox + ow - nw; w = nw; }
        if (m.includes('n')) { const nh = Math.max(minH, oh - dy); y = oy + oh - nh; h = nh; }
      }
      setRect({ x, y, w, h });
    };
    const onUp = () => { dragRef.current = null; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [minW, minH]);

  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex,
        background: '#111120',
        border: '1px solid #1e1e3a',
        borderRadius: 6,
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      onMouseDown={onFocus}
    >
      {/* 타이틀 바 */}
      <div
        style={{
          height: 32,
          background: '#161628',
          borderBottom: '1px solid #1e1e3a',
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          cursor: 'move',
          userSelect: 'none',
          flexShrink: 0,
        }}
        onMouseDown={handleTitleMouseDown}
      >
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#9090b0',
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}>
          {title}
        </span>
      </div>

      {/* 콘텐츠 */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {children}
      </div>

      {/* 리사이즈 핸들 (8방향) */}
      <div style={rh('nw')} onMouseDown={makeResizeHandler('nw')} />
      <div style={rh('n')}  onMouseDown={makeResizeHandler('n')} />
      <div style={rh('ne')} onMouseDown={makeResizeHandler('ne')} />
      <div style={rh('e')}  onMouseDown={makeResizeHandler('e')} />
      <div style={rh('se')} onMouseDown={makeResizeHandler('se')} />
      <div style={rh('s')}  onMouseDown={makeResizeHandler('s')} />
      <div style={rh('sw')} onMouseDown={makeResizeHandler('sw')} />
      <div style={rh('w')}  onMouseDown={makeResizeHandler('w')} />
    </div>
  );
});

const CS = 8;  // corner handle size (px)
const ES = 5;  // edge handle thickness (px)

function rh(dir: ResizeDir): React.CSSProperties {
  const base: React.CSSProperties = { position: 'absolute', zIndex: 2 };
  switch (dir) {
    case 'nw': return { ...base, top: 0, left: 0, width: CS, height: CS, cursor: 'nw-resize' };
    case 'n':  return { ...base, top: 0, left: CS, right: CS, height: ES, cursor: 'n-resize' };
    case 'ne': return { ...base, top: 0, right: 0, width: CS, height: CS, cursor: 'ne-resize' };
    case 'e':  return { ...base, top: CS, right: 0, bottom: CS, width: ES, cursor: 'e-resize' };
    case 'se': return { ...base, bottom: 0, right: 0, width: CS, height: CS, cursor: 'se-resize' };
    case 's':  return { ...base, bottom: 0, left: CS, right: CS, height: ES, cursor: 's-resize' };
    case 'sw': return { ...base, bottom: 0, left: 0, width: CS, height: CS, cursor: 'sw-resize' };
    case 'w':  return { ...base, top: CS, left: 0, bottom: CS, width: ES, cursor: 'w-resize' };
  }
}
