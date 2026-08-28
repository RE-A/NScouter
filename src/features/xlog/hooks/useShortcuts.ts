// 키 조합을 화면 동작에 잇는다. 판정은 `shortcuts.ts` 가 한다.
//
// **핸들러를 ref 에 담아 두고 리스너는 한 번만 단다.** 매번 다시 달면 App 이
// 다시 그려질 때마다(초당 여러 번) 리스너를 떼었다 붙인다.

import { useEffect, useRef } from 'react';
import { isEditableTarget, matchShortcut, type ShortcutAction } from './shortcuts';

export type ShortcutHandlers = Partial<Record<ShortcutAction, () => void>>;

export function useShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const inEditable = isEditableTarget(e.target);
      const action = matchShortcut({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        inEditable,
      });
      if (action === null) return;

      // 입력칸에서 Esc 는 **그 칸에서 빠져나오는 것**이다. 상세를 닫지 않는다 —
      // 검색어를 지우려다 보던 프로파일이 사라지면 다시 찾아 열어야 한다.
      if (action === 'close-detail' && inEditable) {
        (e.target as HTMLElement).blur();
        return;
      }

      const fn = ref.current[action];
      if (!fn) return;

      // **웹뷰 기본 동작을 막는다.** F5 · Ctrl+R 은 그냥 두면 화면을 새로 읽어
      // 열어 둔 것이 전부 사라진다. Ctrl+W 도 마찬가지 이유다.
      e.preventDefault();
      fn();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
