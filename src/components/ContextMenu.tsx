// 우클릭 메뉴
//
// 화면 밖으로 나가지 않게 위치를 뒤집는다 (menuPosition).
// 바깥 클릭·Esc·스크롤로 닫힌다 — 열어두고 잊으면 다른 조작을 가린다.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { menuPosition } from './menuPosition';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** 지금은 못 쓰는 항목. 이유를 title 로 보여준다 */
  disabled?: string;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  // 실제 크기를 재기 전에는 클릭 지점에 둔다. 잰 뒤 한 번 보정한다.
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(
      menuPosition(
        x,
        y,
        { w: el.offsetWidth, h: el.offsetHeight },
        { w: window.innerWidth, h: window.innerHeight },
      ),
    );
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // capture 로 받아야 메뉴 안 클릭보다 먼저 닫히는 일이 없다.
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      // 메뉴 안에서 시작한 pointerdown 이 위 리스너까지 올라가면 즉시 닫힌다.
      onPointerDown={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
      className="fixed z-50 min-w-[168px] overflow-hidden rounded border border-line-strong bg-overlay py-1 shadow-lg"
    >
      {items.map(item => (
        <button
          key={item.label}
          role="menuitem"
          disabled={!!item.disabled}
          title={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onClose();
          }}
          className={`block w-full px-3 py-1 text-left text-body ${
            item.disabled
              ? 'cursor-not-allowed text-fg-faint'
              : 'text-fg-muted hover:bg-hover hover:text-fg'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
