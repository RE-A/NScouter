// 서버 갈아타기 — 헤더의 드롭다운
//
// 줄을 누르면 그 서버 하나로 갈아탄다. 매번 호스트·계정을 다시 치지 않고 빠르게 옮겨 가는 것이 목적이다.
//
// **여러 서버를 함께 볼 수도 있다.** 시스템별로 콜렉터가 나뉜 곳에서는 서버 목록·XLog 를 한 화면에서
// 섞어 봐야 한다. 줄 앞의 체크로 둘 이상 고르고 `함께 연결` 을 누르면, 서버 하나에 붙은 것처럼 보인다
// (Rust `crate::hub`). 맨 위에 고른 것이 주 콜렉터다. 비밀번호를 기억한 서버만 고를 수 있다 —
// 여럿을 붙이는 중에 하나씩 물을 수가 없다.
//
// 갈아타면 화면이 통째로 바뀐다 — 오브젝트 해시가 서버마다 다르므로 필터도 상세 탭도
// 그대로 둘 수 없다. 그래서 «지금 어느 서버를 보고 있나» 를 늘 띄워 둔다.
// 이름만 보이고 어디에 붙었는지 모르면, 운영과 QA 를 헷갈린 채로 오래 볼 수 있다.

import React, { memo, useEffect, useRef, useState } from 'react';
import type { ServerProfile } from '../api/scouterApi';
import { displayName, sameTarget } from './serverProfiles';
import { t } from '../../../i18n';
import { Button } from '../../../components/Button';

interface ServerSwitcherProps {
  profiles: readonly ServerProfile[];
  /** 지금 붙어 있는 서버 이름(여럿이면 ` + ` 로 이은 것). 미연결이면 null */
  current: string | null;
  /** 함께 붙어 있는 서버 이름들. 하나만 붙어 있으면 비우거나 그 하나 */
  currentSet?: readonly string[];
  busy: boolean;
  /** 고른 서버로 갈아탄다. 비밀번호가 없으면 부르는 쪽이 물어본다 */
  onSwitch: (profile: ServerProfile) => void;
  /** 고른 서버들에 함께 붙는다 (목록 순서대로 — 앞의 것이 주 콜렉터). 없으면 체크를 안 보인다 */
  onSwitchMany?: (profiles: ServerProfile[]) => void;
  /** 목록에서 지운다 */
  onRemove: (profile: ServerProfile) => void;
  /**
   * 이름을 붙인다.
   *
   * `10.89.2.18:6100` 셋이 늘어선 목록에서 운영과 QA 를 가르는 **유일한 단서**다.
   * 빈 이름으로 부르면 이름을 지우는 것이고, 그러면 다시 `host:port` 로 보인다.
   */
  onRename: (profile: ServerProfile, name: string) => void;
}

export const ServerSwitcher = memo(function ServerSwitcher({
  profiles,
  current,
  currentSet = [],
  busy,
  onSwitch,
  onSwitchMany,
  onRemove,
  onRename,
}: ServerSwitcherProps) {
  const [open, setOpen] = useState(false);
  /** 함께 붙으려고 체크한 서버 이름들 */
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  /**
   * 지금 이름을 고치고 있는 서버와 입력 중인 글자.
   *
   * **한 번에 하나만 고친다.** 여러 줄을 동시에 열면 어느 줄을 저장하는 중인지
   * 화면이 말해 주지 못한다.
   */
  const [editing, setEditing] = useState<{ target: ServerProfile; draft: string } | null>(null);
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

  // 목록을 닫으면 고치던 것도 버린다. 다시 열었을 때 남아 있으면
  // «언제 적 입력이 왜 여기 있나» 가 된다.
  // 열 때는 지금 함께 붙어 있는 것을 체크해 둔다 — 하나 더 붙이거나 빼기 쉽게
  useEffect(() => {
    if (!open) setEditing(null);
    else setPicked(new Set(currentSet.length > 1 ? currentSet : []));
    // currentSet 은 열 때의 것만 쓴다 — 열린 동안 체크를 덮지 않는다
  }, [open]);

  const multi = onSwitchMany !== undefined && profiles.length > 1;
  const togglePick = (label: string) =>
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  const pickedProfiles = profiles.filter(p => picked.has(displayName(p)));

  const commit = () => {
    if (!editing) return;
    onRename(editing.target, editing.draft);
    setEditing(null);
  };

  // 하나뿐이면 고를 것이 없다. 이름은 헤더 배지가 이미 말한다.
  if (profiles.length === 0) return null;

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        aria-expanded={open}
        title={t('붙을 서버를 고릅니다')}
        className="btn max-w-[10rem] truncate px-2 py-0.5 text-micro"
      >
        {busy ? t('바꾸는 중…') : (current ?? t('서버 고르기'))} ▾
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded border border-line-strong bg-surface p-1 shadow">
          {profiles.map(p => {
            const label = displayName(p);
            const on = label === current || currentSet.includes(label);
            const editingThis = editing !== null && sameTarget(editing.target, p);
            return (
              <div
                key={label}
                className={`flex items-center gap-1 rounded px-1 ${on ? 'bg-hover' : 'hover:bg-hover'}`}
              >
                {multi && (
                  <input
                    type="checkbox"
                    checked={picked.has(label)}
                    disabled={p.pass === ''}
                    onChange={() => togglePick(label)}
                    aria-label={`${label} ${t('함께 연결')}`}
                    title={p.pass === '' ? t('비밀번호를 기억한 서버만 함께 연결할 수 있습니다') : t('함께 연결할 서버로 고릅니다')}
                    className="shrink-0"
                  />
                )}
                {editingThis ? (
                  <input
                    autoFocus
                    value={editing.draft}
                    onChange={e => setEditing({ target: p, draft: e.target.value })}
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                      // Esc 는 **버리고** 나간다. 저장으로 읽히면 실수로 이름이 바뀐다.
                      if (e.key === 'Escape') setEditing(null);
                      if (e.key === 'Enter') commit();
                    }}
                    // 바깥을 눌러 빠져나가는 것도 «다 썼다» 다 — 버리면 방금 친 것이 사라진다.
                    onBlur={commit}
                    placeholder={`${p.host}:${p.port}`}
                    aria-label={`${label} ${t('이름')}`}
                    className="min-w-0 flex-1 rounded border border-accent bg-input px-1.5 py-1 text-micro text-fg focus:outline-none"
                  />
                ) : (
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
                )}

                {!editingThis && (
                  <>
                    {/* 이름 짓기를 우클릭이나 더블클릭에 숨기지 않는다 — 있는 줄 모르면 없는 기능이다 */}
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setEditing({ target: p, draft: p.name })}
                      aria-label={`${label} ${t('이름 바꾸기')}`}
                      title={t('이 서버를 부를 이름을 정합니다')}
                      className="shrink-0"
                    >
                      ✎
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => onRemove(p)}
                      aria-label={`${label} ${t('지우기')}`}
                      title={t('목록에서 지웁니다')}
                      className="shrink-0 hover:text-danger"
                    >
                      ✕
                    </Button>
                  </>
                )}
              </div>
            );
          })}
          {multi && (
            <div className="mt-1 flex items-center gap-2 border-t border-line px-1 pt-1">
              <span className="min-w-0 flex-1 truncate text-micro text-fg-faint">
                {picked.size < 2 ? t('둘 이상 체크하면 함께 연결합니다') : pickedProfiles.map(displayName).join(' + ')}
              </span>
              <Button
                size="xs"
                variant="primary"
                disabled={picked.size < 2}
                onClick={() => {
                  setOpen(false);
                  onSwitchMany?.(pickedProfiles);
                }}
                title={t('체크한 서버들에 함께 붙습니다 — 서버 하나에 붙은 것처럼 보입니다')}
              >
                {t('함께 연결')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
