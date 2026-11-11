// 함께 연결할 서버 중 비밀번호를 기억하지 않은 것들을 **한 창에서 몰아서** 묻는다
//
// 여럿을 붙이는 중에 서버마다 접속 폼을 띄울 수는 없다. 그래서 예전에는 비밀번호를 기억한 서버만 함께 연결할 수
// 있었다. 붙기 전에 빠진 것만 모아 한 번에 받는다. 받은 비밀번호는 이번 접속에만 쓰고, `비밀번호 기억` 을 켜면
// 서버 목록에도 남긴다(config.json 평문 — 접속 폼과 같은 규칙).

import { memo, useState } from 'react';
import type { ServerProfile } from '../api/scouterApi';
import { displayName } from './serverProfiles';
import { Dialog } from '../../../components/Dialog';
import { Button } from '../../../components/Button';
import { t } from '../../../i18n';

interface PasswordPromptProps {
  /** 함께 붙을 서버들 (순서대로 — 앞의 것이 주 콜렉터). 비밀번호가 빈 것만 묻는다 */
  profiles: readonly ServerProfile[];
  /** 다 채운 프로필들(같은 순서)과 «기억» 여부 */
  onSubmit: (filled: ServerProfile[], remember: boolean) => void;
  onCancel: () => void;
}

export const PasswordPrompt = memo(function PasswordPrompt({ profiles, onSubmit, onCancel }: PasswordPromptProps) {
  const asked = profiles.filter(p => p.pass === '');
  const [pass, setPass] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState(false);
  const ready = asked.every(p => (pass[displayName(p)] ?? '') !== '');

  const submit = () => {
    if (!ready) return;
    onSubmit(
      profiles.map(p => (p.pass === '' ? { ...p, pass: pass[displayName(p)] ?? '' } : p)),
      remember,
    );
  };

  return (
    <Dialog
      title={t('비밀번호 입력')}
      subtitle={profiles.map(displayName).join(' + ')}
      onClose={onCancel}
      footer={
        <>
          <label className="mr-auto flex items-center gap-1.5 text-micro text-fg-dim" title={t('비밀번호가 config.json 에 평문으로 저장됩니다')}>
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
            {t('비밀번호 기억')}
          </label>
          <Button onClick={onCancel}>{t('취소')}</Button>
          <Button variant="primary" disabled={!ready} onClick={submit}>
            {t('함께 연결')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={e => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-2"
      >
        <p className="text-micro text-fg-dim">{t('비밀번호를 기억하지 않은 서버입니다. 이번 접속에 쓸 비밀번호를 넣어 주세요.')}</p>
        {asked.map((p, i) => {
          const label = displayName(p);
          return (
            <label key={label} className="flex items-center gap-2 text-small">
              <span className="w-40 min-w-0 truncate text-fg" title={`${p.host}:${p.port}`}>
                {label}
                <span className="block truncate font-mono text-micro text-fg-faint">
                  {p.host}:{p.port} · {p.user || '—'}
                </span>
              </span>
              <input
                type="password"
                autoFocus={i === 0}
                value={pass[label] ?? ''}
                onChange={e => setPass(prev => ({ ...prev, [label]: e.target.value }))}
                aria-label={`${label} ${t('비밀번호')}`}
                className="min-w-0 flex-1 rounded border border-line-control bg-input px-2 py-1 text-small text-fg focus:outline-none"
              />
            </label>
          );
        })}
        {/* Enter 로 보낸다 — 마지막 칸에서 Enter 가 곧 연결이다 */}
        <button type="submit" hidden aria-hidden />
      </form>
    </Dialog>
  );
});
