// 헤더의 «콜렉터 설정» 단추
//
// **콜렉터 설정은 합칠 수 없다** — 콜렉터마다 설정 파일이 하나씩이다. 여러 콜렉터에 함께 붙어 있으면
// 어느 콜렉터를 고칠지 먼저 고르게 한다(창을 연 뒤에 바꾸게 하면 고치던 것이 조용히 날아간다).
// 콜렉터가 하나면 예전처럼 바로 연다.

import { memo, useEffect, useRef, useState } from 'react';
import type { CollectorStatus } from '../api/scouterApi';
import { t } from '../../../i18n';

interface CollectorConfigButtonProps {
  /** 함께 붙은 콜렉터들 (주 콜렉터가 맨 앞). 하나 이하면 고를 것이 없다 */
  collectors: readonly CollectorStatus[];
  /** 설정 창을 연다. `collector` 는 고른 콜렉터 이름 — 콜렉터가 하나면 undefined(주 콜렉터) */
  onOpen: (collector?: string) => void;
}

export const CollectorConfigButton = memo(function CollectorConfigButton({ collectors, onOpen }: CollectorConfigButtonProps) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const multi = collectors.length > 1;

  // 바깥을 누르면 닫는다 — 열린 채로 남으면 아래 화면을 가린다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => (multi ? setOpen(o => !o) : onOpen(undefined))}
        aria-expanded={multi ? open : undefined}
        title={multi ? t('고칠 콜렉터를 고른 뒤 설정을 엽니다') : t('지금 붙은 콜렉터의 설정을 보고 고칩니다')}
        className="btn px-2 py-0.5 text-micro"
      >
        {t('콜렉터 설정')}
        {multi && ' ▾'}
      </button>
      {multi && open && (
        <div className="absolute right-0 z-30 mt-1 w-56 rounded border border-line-strong bg-surface p-1 shadow" role="menu">
          {collectors.map(c => (
            <button
              key={c.name}
              role="menuitem"
              disabled={!c.connected}
              onClick={() => {
                setOpen(false);
                onOpen(c.name);
              }}
              title={c.connected ? `${c.host}:${c.port}` : `${c.host}:${c.port} · ${t('붙지 못함')}`}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-micro hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className={`size-1.5 shrink-0 rounded-full ${c.connected ? 'bg-ok' : 'bg-danger'}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-fg">{c.name}</span>
              <span className="truncate font-mono text-fg-faint">{c.server_id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
