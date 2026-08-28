import { describe, expect, it } from 'vitest';
import { matchShortcut, isEditableTarget, SHORTCUT_HELP, type KeyEventLike } from './shortcuts';

const key = (over: Partial<KeyEventLike>): KeyEventLike => ({
  key: 'a',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  inEditable: false,
  ...over,
});

describe('matchShortcut', () => {
  it('제안한 조합을 전부 알아본다', () => {
    expect(matchShortcut(key({ key: 'Escape' }))).toBe('close-detail');
    expect(matchShortcut(key({ key: 'f', ctrlKey: true }))).toBe('focus-search');
    expect(matchShortcut(key({ key: '1', ctrlKey: true }))).toBe('tab-xlog');
    expect(matchShortcut(key({ key: '2', ctrlKey: true }))).toBe('tab-counter');
    expect(matchShortcut(key({ key: '3', ctrlKey: true }))).toBe('tab-alert');
    expect(matchShortcut(key({ key: 'w', ctrlKey: true }))).toBe('close-detail-tab');
    expect(matchShortcut(key({ key: 'Tab', ctrlKey: true }))).toBe('cycle-detail-next');
    expect(matchShortcut(key({ key: 'Tab', ctrlKey: true, shiftKey: true }))).toBe(
      'cycle-detail-prev',
    );
    expect(matchShortcut(key({ key: ',', ctrlKey: true }))).toBe('open-settings');
    expect(matchShortcut(key({ key: 'r', ctrlKey: true }))).toBe('toggle-mode');
    expect(matchShortcut(key({ key: 'F5' }))).toBe('reload');
  });

  it('Cmd 도 Ctrl 과 같이 본다', () => {
    expect(matchShortcut(key({ key: 'f', metaKey: true }))).toBe('focus-search');
    expect(matchShortcut(key({ key: '1', metaKey: true }))).toBe('tab-xlog');
  });

  it('대문자로 와도 같다 — Shift 가 눌린 채 오는 경우가 있다', () => {
    // CapsLock 이나 키보드 배열에 따라 key 가 'F' 로 온다
    expect(matchShortcut(key({ key: 'F', ctrlKey: true }))).toBe('focus-search');
    expect(matchShortcut(key({ key: 'W', ctrlKey: true }))).toBe('close-detail-tab');
  });

  it('**입력칸 안에서는 Esc 만 산다**', () => {
    // 서비스 이름에 1 을 치는데 탭이 바뀌면 안 된다
    expect(matchShortcut(key({ key: '1', ctrlKey: true, inEditable: true }))).toBeNull();
    expect(matchShortcut(key({ key: 'f', ctrlKey: true, inEditable: true }))).toBeNull();
    expect(matchShortcut(key({ key: 'F5', inEditable: true }))).toBeNull();
    expect(matchShortcut(key({ key: 'Escape', inEditable: true }))).toBe('close-detail');
  });

  it('수식키 없는 글자는 단축키가 아니다', () => {
    // 그냥 타이핑하다 화면이 바뀌면 안 된다
    expect(matchShortcut(key({ key: 'f' }))).toBeNull();
    expect(matchShortcut(key({ key: '1' }))).toBeNull();
    expect(matchShortcut(key({ key: 'r' }))).toBeNull();
  });

  it('Alt 가 섞이면 우리 것이 아니다', () => {
    // Alt+F4, Alt+Tab 같은 OS 조합을 가로채면 안 된다
    expect(matchShortcut(key({ key: 'f', ctrlKey: true, altKey: true }))).toBeNull();
    expect(matchShortcut(key({ key: 'Tab', altKey: true }))).toBeNull();
    expect(matchShortcut(key({ key: 'F5', altKey: true }))).toBeNull();
  });

  it('Tab 말고는 Shift 가 붙으면 받지 않는다', () => {
    // Ctrl+Shift+R 은 하드 새로고침이다 — 우리 것으로 삼지 않는다
    expect(matchShortcut(key({ key: 'r', ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(matchShortcut(key({ key: 'f', ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it('모르는 조합은 null 이다', () => {
    expect(matchShortcut(key({ key: 'q', ctrlKey: true }))).toBeNull();
    expect(matchShortcut(key({ key: 'F1' }))).toBeNull();
  });

  it('도움말 목록의 동작이 실제 판정과 어긋나지 않는다', () => {
    // **두 벌이 되면 설정 창이 거짓말을 한다.** 목록에 적힌 동작이 전부 실제로 나오는지 본다.
    const reachable = new Set(
      [
        matchShortcut(key({ key: 'Escape' })),
        matchShortcut(key({ key: 'f', ctrlKey: true })),
        matchShortcut(key({ key: '1', ctrlKey: true })),
        matchShortcut(key({ key: '2', ctrlKey: true })),
        matchShortcut(key({ key: '3', ctrlKey: true })),
        matchShortcut(key({ key: 'w', ctrlKey: true })),
        matchShortcut(key({ key: 'Tab', ctrlKey: true })),
        matchShortcut(key({ key: 'Tab', ctrlKey: true, shiftKey: true })),
        matchShortcut(key({ key: ',', ctrlKey: true })),
        matchShortcut(key({ key: 'r', ctrlKey: true })),
        matchShortcut(key({ key: 'F5' })),
      ].filter(a => a !== null),
    );
    for (const row of SHORTCUT_HELP) {
      expect(reachable.has(row.action), `${row.keys} 는 실제로 나오지 않는다`).toBe(true);
    }
  });
});

describe('isEditableTarget', () => {
  const el = (html: string): HTMLElement => {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.firstElementChild as HTMLElement;
  };

  it('글자를 받는 칸이면 참이다', () => {
    expect(isEditableTarget(el('<input type="text">'))).toBe(true);
    expect(isEditableTarget(el('<input>'))).toBe(true);
    expect(isEditableTarget(el('<textarea></textarea>'))).toBe(true);
    expect(isEditableTarget(el('<select></select>'))).toBe(true);
  });

  it('누르는 칸은 거짓이다', () => {
    // 체크박스에 포커스가 있다고 단축키가 죽으면 안 된다
    expect(isEditableTarget(el('<input type="checkbox">'))).toBe(false);
    expect(isEditableTarget(el('<input type="radio">'))).toBe(false);
    expect(isEditableTarget(el('<button></button>'))).toBe(false);
    expect(isEditableTarget(el('<div></div>'))).toBe(false);
  });

  it('읽기 전용·비활성 칸에서는 단축키가 산다', () => {
    expect(isEditableTarget(el('<input type="text" readonly>'))).toBe(false);
    expect(isEditableTarget(el('<input type="text" disabled>'))).toBe(false);
  });

  it('아무것도 아닌 대상에 죽지 않는다', () => {
    expect(isEditableTarget(null)).toBe(false);
  });
});
