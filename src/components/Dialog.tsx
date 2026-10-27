// 대화창 껍데기 한 벌 — 뒤 가림막 · 머리(제목·닫기) · 몸통 · 발(버튼들).
//
// 대화창이 열 곳 넘게 저마다 `fixed inset-0 … bg-black/50|60` 으로 시작해, 가림막 농도·모서리·
// 머리 높이·닫기 버튼(✕ 크기와 자리)·Esc 처리가 조금씩 달랐다. Esc 가 안 먹는 창도 있었다
// (안쪽 칸에 포커스가 없으면 keydown 이 창까지 안 온다).
//
// **Esc 는 맨 위 창만 닫는다.** 상세 창 위에 또 창을 열 수 있어서(스텝 상세 → 프로파일 전문)
// 한 번 누르면 하나씩 닫혀야 한다.
// **가림막은 누른 곳과 뗀 곳이 둘 다 가림막일 때만 닫는다.** 안에서 글자를 끌어 고르다 밖에서
// 놓으면 창이 닫히던 것.

import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import { t } from '../i18n';

/** 열린 창들 — 마지막이 맨 위 */
const stack: symbol[] = [];

export interface DialogProps {
  title: ReactNode;
  /** 제목 옆 작은 글 (대상 이름 등) */
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** 발(오른쪽 정렬). 없으면 발을 안 그린다 */
  footer?: ReactNode;
  /** 머리 오른쪽, 닫기 버튼 앞 (검색칸·토글 등) */
  headerExtra?: ReactNode;
  /** 창 너비 클래스. 기본 40rem */
  widthClass?: string;
  /** 몸통 클래스. 기본은 여백 + 세로 스크롤 — 몸통이 스스로 나눠 그리면 덮는다 */
  bodyClassName?: string;
  /** 보조기술이 읽을 이름. 제목이 글이 아니면 준다 */
  ariaLabel?: string;
  /** 가림막 z 순서. 메뉴(z-50) 위에서 열리는 창은 올린다 */
  zClass?: string;
  /**
   * 입력칸 안에서 누른 Esc 로도 닫나. 기본은 닫는다.
   * 값을 지우려고 Esc 를 누르는 칸이 많은 창(콜렉터 설정)은 끈다 — 고치던 것이 통째로 닫혔다.
   */
  escInInputs?: boolean;
}

export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  headerExtra,
  widthClass = 'w-[40rem]',
  bodyClassName = 'overflow-y-auto px-4 py-3',
  ariaLabel,
  zClass = 'z-50',
  escInInputs = true,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const escInInputsRef = useRef(escInInputs);
  escInInputsRef.current = escInInputs;

  useEffect(() => {
    const me = Symbol('dialog');
    stack.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || stack[stack.length - 1] !== me) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (!escInInputsRef.current && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) return;
      // 뒤 화면의 단축키(Esc = 상세 닫기)까지 가지 않게 — 창 하나 닫으려다 상세도 닫혔다
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    // 안쪽에서 스스로 포커스를 잡지 않았으면 창에 둔다 — 키보드가 뒤 화면에 남지 않게
    if (panelRef.current && !panelRef.current.contains(document.activeElement)) panelRef.current.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = stack.indexOf(me);
      if (i >= 0) stack.splice(i, 1);
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 ${zClass} flex items-center justify-center bg-black/60 p-6`}
      onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
        downOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
        tabIndex={-1}
        className={`flex max-h-full max-w-full flex-col overflow-hidden rounded-lg border border-line-strong bg-raised shadow-2xl outline-none ${widthClass}`}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
          {/* 제목 자리에 종류 칩·대상 이름이 같이 오는 창이 많다 — 줄어들 때는 그쪽이 잘린다 */}
          <h2 className="flex min-w-0 items-center gap-3 text-body font-semibold text-fg">{title}</h2>
          {subtitle !== undefined && (
            <span className="min-w-0 truncate font-mono text-micro text-fg-dim">{subtitle}</span>
          )}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{headerExtra}</div>
          <Button variant="ghost" size="xs" onClick={onClose} aria-label={t('닫기')} title={t('닫기 (Esc)')}>
            ✕
          </Button>
        </header>
        <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
        {footer !== undefined && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-2.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
