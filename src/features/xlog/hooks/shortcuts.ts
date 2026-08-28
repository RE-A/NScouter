// 키 조합 → 할 일. **순수 함수다.**
//
// DOM 없이 판정할 수 있어야 한다. 단축키는 «눌러 보고 아는» 종류의 코드라
// 화면을 띄우지 않고는 확인이 안 되면 손댈 때마다 도박이 된다.
//
// 지키는 규칙 두 가지:
//   1. **입력칸 안에서는 거의 다 죽는다.** 서비스 이름에 `1` 을 치는데 탭이 바뀌면 안 된다.
//      Esc 만 살려 두고, 그건 «이 칸에서 빠져나온다» 는 뜻으로 쓴다.
//   2. **Ctrl 과 Meta 를 같이 본다.** 지금은 Windows 뿐이지만 mac 에서 Cmd 가 안 먹으면
//      «단축키가 없는 앱» 이 된다 — 조합을 여기 한 곳에만 적어 둔다.

export type ShortcutAction =
  | 'close-detail'
  | 'focus-search'
  | 'tab-xlog'
  | 'tab-counter'
  | 'tab-alert'
  | 'close-detail-tab'
  | 'cycle-detail-next'
  | 'cycle-detail-prev'
  | 'open-settings'
  | 'toggle-mode'
  | 'reload';

/** 판정에 필요한 것만. KeyboardEvent 를 그대로 받지 않는 이유는 파일 머리 참고 */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** 입력칸·textarea·contenteditable 안에서 눌렀는가 */
  inEditable: boolean;
}

/** 화면에 적어 줄 목록. 설정 창이 이걸 그대로 읽는다 — 두 벌이 되면 어긋난다 */
export const SHORTCUT_HELP: ReadonlyArray<{ keys: string; action: ShortcutAction }> = [
  { keys: 'Esc', action: 'close-detail' },
  { keys: 'Ctrl+F', action: 'focus-search' },
  { keys: 'Ctrl+1', action: 'tab-xlog' },
  { keys: 'Ctrl+2', action: 'tab-counter' },
  { keys: 'Ctrl+3', action: 'tab-alert' },
  { keys: 'Ctrl+W', action: 'close-detail-tab' },
  { keys: 'Ctrl+Tab', action: 'cycle-detail-next' },
  { keys: 'Ctrl+Shift+Tab', action: 'cycle-detail-prev' },
  { keys: 'Ctrl+,', action: 'open-settings' },
  { keys: 'Ctrl+R', action: 'toggle-mode' },
  { keys: 'F5', action: 'reload' },
];

export function matchShortcut(e: KeyEventLike): ShortcutAction | null {
  // Esc 는 입력칸 안에서도 산다. 다만 뜻이 다르다 — 부르는 쪽에서 가른다.
  if (e.key === 'Escape') return 'close-detail';

  // **입력칸 안에서는 나머지를 전부 죽인다.** 값을 치다가 화면이 바뀌면
  // 무엇을 눌러 그렇게 됐는지 알 수 없다.
  if (e.inEditable) return null;

  if (e.key === 'F5' && !e.ctrlKey && !e.metaKey && !e.altKey) return 'reload';

  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.altKey) return null;

  // Tab 은 Shift 로 방향이 갈린다. 나머지는 Shift 가 붙으면 다른 조합이므로 받지 않는다.
  if (e.key === 'Tab') return e.shiftKey ? 'cycle-detail-prev' : 'cycle-detail-next';
  if (e.shiftKey) return null;

  switch (e.key) {
    case 'f':
    case 'F':
      return 'focus-search';
    case '1':
      return 'tab-xlog';
    case '2':
      return 'tab-counter';
    case '3':
      return 'tab-alert';
    case 'w':
    case 'W':
      return 'close-detail-tab';
    case ',':
      return 'open-settings';
    case 'r':
    case 'R':
      return 'toggle-mode';
    default:
      return null;
  }
}

/**
 * 이 요소 안에서 친 글자는 그 요소의 것인가.
 *
 * `<input readonly>` 는 값을 못 바꾸므로 단축키를 살려 둔다 —
 * 읽기 전용 칸에 포커스가 갔다고 단축키가 통째로 죽으면 이유를 짐작할 수 없다.
 */
export function isEditableTarget(el: EventTarget | null): boolean {
  if (el === null || !(typeof HTMLElement !== 'undefined' && el instanceof HTMLElement)) {
    return false;
  }
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const input = el as HTMLInputElement;
    if (input.readOnly || input.disabled) return false;
    // 체크박스·라디오·버튼은 글자를 받지 않는다
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(
      input.type,
    );
  }
  return false;
}
