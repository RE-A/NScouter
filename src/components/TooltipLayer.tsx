// 툴팁 한 벌 — 브라우저 기본 툴팁(`title`)을 대신 그린다.
//
// **왜 갈아 끼우나.** 기본 툴팁은 우리가 위치를 못 정한다. 서버를 오른쪽 클릭하면 그 줄의 툴팁
// (이름·IP·버전)이 방금 연 메뉴를 덮었고, 서버 고르기 목록·「조건 더보기」 줄도 같은 식으로 가려졌다.
// 테마도 안 따르고(윈도우 기본 노란 상자), 뜨는 데 1초 가까이 걸린다.
//
// **쓰는 쪽은 그대로 `title` 을 단다.** 툴팁을 단 자리가 200곳이 넘는다 — 하나하나 감싸는 대신
// 여기서 문서 전체의 포인터를 본다:
//   · 올라가면 그 요소의 `title` 을 잠시 떼어 둔다 — 그래야 기본 툴팁이 안 뜬다
//   · 조금 머물면 우리 툴팁을 요소 아래(자리가 없으면 위)에 띄운다
//   · 누르기·오른쪽 클릭·휠·키·스크롤이면 바로 내리고, **그 요소를 떠날 때까지 다시 안 띄운다** —
//     메뉴를 연 자리에서 툴팁이 메뉴를 덮던 것
//   · 떠나면 `title` 을 되돌린다 — DOM 이 React 가 그린 그대로여야 테스트·보조기술이 같은 것을 본다

import { useEffect, useRef, useState } from 'react';

/** 머물러야 뜨는 시간 — 지나가는 포인터마다 뜨면 화면이 깜빡인다 */
export const TOOLTIP_DELAY_MS = 450;
/** 요소와 툴팁 사이 */
const GAP = 6;
/** 화면 가장자리에서 띄우는 여백 */
const EDGE = 8;

interface Shown {
  text: string;
  /** 요소의 화면 위치 */
  rect: { left: number; top: number; right: number; bottom: number; width: number };
}

/**
 * 툴팁을 놓을 자리. 요소 아래 가운데가 기본이고, 아래가 모자라면 위, 좌우는 화면 안으로 민다.
 */
export function placeTooltip(
  anchor: Shown['rect'],
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const below = anchor.bottom + GAP;
  const top = below + size.height <= viewport.height - EDGE
    ? below
    : Math.max(EDGE, anchor.top - GAP - size.height);
  const centered = anchor.left + anchor.width / 2 - size.width / 2;
  const left = Math.min(Math.max(EDGE, centered), Math.max(EDGE, viewport.width - EDGE - size.width));
  return { left: Math.round(left), top: Math.round(top) };
}

export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /** 지금 포인터가 올라가 있는(툴팁을 가진) 요소와 떼어 둔 글 */
    let current: { el: Element; text: string } | null = null;
    /** 눌러서 내린 요소 — 떠날 때까지 다시 안 띄운다 */
    let quiet: Element | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const hide = () => {
      clearTimeout(timer);
      setShown(null);
      setPos(null);
    };
    /** 떼어 둔 `title` 을 돌려놓는다. 그 사이 React 가 새 값을 걸었으면 그쪽이 이긴다 */
    const release = () => {
      if (current && !current.el.hasAttribute('title')) current.el.setAttribute('title', current.text);
      current = null;
    };

    const over = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target === null) return;
      const el = target.closest('[title]');
      // 아직 떼어 둔 요소 안이다(자식으로 옮겨 갔다). `title` 을 떼어 뒀으니 closest 는 그 바깥을
      // 찾는다 — 자식이 제 툴팁을 가진 게 아니면 지금 것을 그대로 둔다
      if (current && current.el.contains(target) && (el === null || el.contains(current.el))) return;
      if (el === null) {
        release();
        hide();
        quiet = null;
        return;
      }
      if (current?.el === el) return;
      release();
      hide();
      const text = el.getAttribute('title') ?? '';
      // 곧바로 뗀다 — 기본 툴팁이 뜰 틈을 주지 않는다
      el.removeAttribute('title');
      current = { el, text };
      if (quiet !== el) quiet = null;
      if (text.trim() === '' || quiet === el) return;
      timer = setTimeout(() => {
        if (current?.el !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        setShown({ text, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width } });
      }, TOOLTIP_DELAY_MS);
    };

    const out = (e: PointerEvent) => {
      // 창 밖으로 나갔다
      if (e.relatedTarget === null) {
        release();
        hide();
        quiet = null;
      }
    };

    /** 누르면 내리고, 이 요소를 떠날 때까지 조용히 */
    const dismiss = () => {
      hide();
      if (current) quiet = current.el;
    };

    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerout', out, true);
    const quietEvents = ['pointerdown', 'contextmenu', 'wheel', 'keydown'] as const;
    for (const ev of quietEvents) document.addEventListener(ev, dismiss, true);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerout', out, true);
      for (const ev of quietEvents) document.removeEventListener(ev, dismiss, true);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('blur', dismiss);
      clearTimeout(timer);
      release();
    };
  }, []);

  // 크기를 재야 자리를 정할 수 있다 — 먼저 안 보이게 그리고, 잰 뒤에 놓는다
  useEffect(() => {
    if (!shown || !boxRef.current) return;
    const b = boxRef.current.getBoundingClientRect();
    setPos(placeTooltip(shown.rect, { width: b.width, height: b.height }, { width: window.innerWidth, height: window.innerHeight }));
  }, [shown]);

  if (!shown) return null;
  return (
    <div
      ref={boxRef}
      role="tooltip"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      className="pointer-events-none fixed z-[100] max-w-xs rounded border border-line-strong bg-overlay px-2 py-1 text-micro leading-snug whitespace-pre-line text-fg shadow-lg"
    >
      {shown.text}
    </div>
  );
}
