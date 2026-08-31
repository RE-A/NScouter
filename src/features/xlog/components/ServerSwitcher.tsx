// 서버 갈아타기 — 헤더의 드롭다운
//
// **한 번에 한 서버다.** 두 콜렉터를 나란히 보는 것이 아니라, 매번 호스트·계정을
// 다시 치지 않고 빠르게 옮겨 가는 것이 목적이다.
//
// 갈아타면 화면이 통째로 바뀐다 — 오브젝트 해시가 서버마다 다르므로 필터도 상세 탭도
// 그대로 둘 수 없다. 그래서 «지금 어느 서버를 보고 있나» 를 늘 띄워 둔다.
// 이름만 보이고 어디에 붙었는지 모르면, 운영과 QA 를 헷갈린 채로 오래 볼 수 있다.

import { memo, useEffect, useRef, useState } from 'react';
import type { ServerProfile } from '../api/scouterApi';
import { displayName } from './serverProfiles';
import { t } from '../../../i18n';

interface ServerSwitcherProps {
  profiles: readonly ServerProfile[];
  /** 지금 붙어 있는 서버 이름. 미연결이면 null */
  current: string | null;
  busy: boolean;
  /** 고른 서버로 갈아탄다. 비밀번호가 없으면 부르는 쪽이 물어본다 */
  onSwitch: (profile: ServerProfile) => void;
  /** 목록에서 지운다 */
  onRemove: (profile: ServerProfile) => void;
}

export const ServerSwitcher = memo(function ServerSwitcher({
  profiles,
  current,
  busy,
  onSwitch,
  onRemove,
}: ServerSwitcherProps) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 바깥을 누르면 닫는다. 드롭다운이 열린 채로 남으면 아래 화면을 가린다.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // 하나뿐이면 고를 것이 없다. 이름은 헤더 배지가 이미 말한다.
  if (profiles.length === 0) return null;

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        aria-expanded={open}
        title={t('붙을 서버를 고릅니다')}
        className="max-w-[10rem] truncate rounded border border-line-strong px-2 py-0.5 text-micro text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50"
      >
        {busy ? t('바꾸는 중…') : (current ?? t('서버 고르기'))} ▾
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded border border-line-strong bg-surface p-1 shadow">
          {profiles.map(p => {
            const label = displayName(p);
            const on = label === current;
            return (
              <div
                key={label}
                className={`flex items-center gap-1 rounded px-1 ${on ? 'bg-hover' : 'hover:bg-hover'}`}
              >
                <button
                  onClick={() => {
                    setOpen(false);
                    onSwitch(p);
                  }}
                  className="min-w-0 flex-1 px-1 py-1 text-left"
                >
                  <div className={`truncate text-micro ${on ? 'text-fg' : 'text-fg-muted'}`}>
                    {label}
                  </div>
                  {/* **어디에 붙는지 늘 보인다.** 이름만으로는 운영과 QA 를 못 가른다 */}
                  <div className="truncate font-mono text-micro text-fg-faint">
                    {p.host}:{p.port} · {p.user || '—'}
                    {p.pass === '' ? ` · ${t('비밀번호 물음')}` : ''}
                  </div>
                </button>
                <button
                  onClick={() => onRemove(p)}
                  aria-label={`${label} ${t('지우기')}`}
                  title={t('목록에서 지웁니다')}
                  className="shrink-0 rounded px-1 text-micro text-fg-faint hover:text-danger"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
