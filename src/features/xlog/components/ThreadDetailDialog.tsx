// 실행 중인 트랜잭션 상세 (ASIS OBJECT_THREAD_DETAIL)
//
// 액티브 서비스 목록은 "무엇이 3초째 안 끝난다"까지 말한다.
// **그래서 어디에 멈춰 있나**는 여기에만 있다 — 장애 중에 실제로 필요한 건 이쪽이다.

import { memo, useEffect, useState } from 'react';
import { getThreadDetail, type ThreadDetail } from '../api/scouterApi';
import { detailRows } from './threadDetail';
import { durationTone } from './durationTone';
import { t } from '../../../i18n';

interface ThreadDetailDialogProps {
  objHash: number;
  threadId: number;
  txid: string;
  /** 목록에서 본 이름. 응답이 오기 전에도 무엇을 여는지 보여준다 */
  service: string;
  objName: string;
  onClose: () => void;
}

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  /** 여는 사이에 끝난 경우. **오류가 아니다** */
  | { kind: 'gone' }
  | { kind: 'ok'; detail: ThreadDetail };

export const ThreadDetailDialog = memo(function ThreadDetailDialog({
  objHash,
  threadId,
  txid,
  service,
  objName,
  onClose,
}: ThreadDetailDialogProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    getThreadDetail(objHash, threadId, txid)
      .then(d => {
        if (!alive) return;
        setLoad(d ? { kind: 'ok', detail: d } : { kind: 'gone' });
      })
      .catch(e => alive && setLoad({ kind: 'error', message: String(e) }));
    return () => {
      alive = false;
    };
  }, [objHash, threadId, txid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const d = load.kind === 'ok' ? load.detail : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line-strong bg-raised shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2">
          <h2 className="text-base font-medium text-fg">{t('실행 중인 트랜잭션')}</h2>
          <span className="min-w-0 truncate text-micro text-fg-dim" title={service}>
            {service}
          </span>
          <div className="flex-1" />
          <span className="truncate text-micro text-fg-faint">{objName}</span>
          {d && (
            <span className={`tnum font-mono text-small ${durationTone(d.service_elapsed)}`}>
              {d.service_elapsed.toLocaleString()}ms
            </span>
          )}
          <button
            onClick={onClose}
            className="rounded px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {load.kind === 'loading' && <Note>{t('조회 중…')}</Note>}
          {load.kind === 'error' && (
            <p className="px-4 py-6 text-center text-small text-danger">{load.message}</p>
          )}
          {/* **끝난 것은 오류가 아니다.** 에러로 띄우면 고장으로 읽힌다. */}
          {load.kind === 'gone' && (
            <Note>
              이미 끝난 트랜잭션입니다.
              <br />
              <span className="text-micro">{t('여는 사이에 완료되면 상세가 남지 않습니다.')}</span>
            </Note>
          )}

          {d && (
            <>
              {/* 지금 멈춰 있는 지점이 SQL·외부호출이면 스택보다 이게 먼저다 */}
              {(d.sql || d.subcall) && (
                <section className="border-b border-line px-4 py-2">
                  <h3 className="mb-1 text-micro tracking-wide text-fg-dim uppercase">
                    {d.sql ? '실행 중인 SQL' : t('호출 중인 외부 API')}
                  </h3>
                  <pre className="font-mono text-micro leading-relaxed whitespace-pre-wrap text-fg">
                    {d.sql || d.subcall}
                  </pre>
                  {d.sql_bind_var && (
                    <pre className="mt-1 font-mono text-micro whitespace-pre-wrap text-fg-dim">
                      바인드: {d.sql_bind_var}
                    </pre>
                  )}
                </section>
              )}

              <section className="border-b border-line px-4 py-2">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                  {detailRows(d).map(r => (
                    <div key={r.label} className="flex items-baseline justify-between gap-3">
                      <dt className="text-micro text-fg-dim">{r.label}</dt>
                      <dd
                        className={`truncate font-mono text-micro ${r.dim ? 'text-fg-faint' : 'text-fg'}`}
                        title={r.value}
                      >
                        {r.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="px-4 py-2">
                <h3 className="mb-1 text-micro tracking-wide text-fg-dim uppercase">
                  스택 트레이스
                </h3>
                {d.stack_trace ? (
                  <pre className="font-mono text-micro leading-relaxed whitespace-pre-wrap text-fg">
                    {d.stack_trace}
                  </pre>
                ) : (
                  <p className="py-2 text-small text-fg-faint">{t('스택이 오지 않았습니다.')}</p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-small text-fg-faint">{children}</p>;
}
