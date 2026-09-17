// 쿼리 상세 — 목록에서 잘려 보이던 쿼리를 **전문과 바인드 값까지.**
//
// 목록의 한 줄은 쿼리 앞부분뿐이다. 그걸로는 «어느 테이블의 어떤 조건인가» 를 못 읽고,
// 복사해 DB 에서 실행 계획을 볼 수도 없다.
//
// **바인드 값은 목록에는 없고 스레드 상세에는 있다.** 에이전트(`AgentThread`)가
// 스레드 상세 응답에 지금 SQL 단계의 `param` 을 `SQLActiveBindVar` 로 실어 보낸다.
// 그래서 이 창을 열 때 그 트랜잭션의 상세를 한 번 묻는다. 여는 사이에 트랜잭션이
// 끝났거나 다음 쿼리로 넘어갔으면 값이 없거나 다른 문장의 값이다 — 그 경우를 가려서 말한다.
//
// 같은 리소스에 매달린 다른 트랜잭션도 아래에 늘어놓는다. «이 쿼리 하나에 여섯 건» 을
// 본 다음 질문은 늘 «그 여섯이 누구인가» 다.

import { memo, useEffect, useMemo, useState } from 'react';
import { getThreadDetail, type ThreadDetail } from '../xlog/api/scouterApi';
import type { ActiveService } from '../xlog/types/object';
import { bindSql } from '../xlog/components/sqlBind';
import { formatSql } from '../xlog/components/sqlFormat';
import { CopyButton } from '../../components/CopyButton';
import { formatElapsed, resourceOf, sortRows } from './activeModel';
import { t } from '../../i18n';

interface QueryDetailDialogProps {
  /** 연 줄 */
  row: ActiveService;
  /** 지금 목록 전체. 같은 리소스에 매달린 것을 여기서 고른다 */
  rows: readonly ActiveService[];
  serverName: (objHash: number) => string;
  /** 매달린 트랜잭션 한 건의 스택을 본다 */
  onOpenStack: (row: ActiveService) => void;
  onClose: () => void;
}

type Bind =
  | { kind: 'loading' }
  /** 여는 사이에 끝났다. 오류가 아니다 */
  | { kind: 'gone' }
  /** 다른 문장으로 넘어갔다 — 그 값을 이 문장에 붙이면 틀린 SQL 이 된다 */
  | { kind: 'moved' }
  | { kind: 'ok'; params: string }
  | { kind: 'error'; message: string };

export const QueryDetailDialog = memo(function QueryDetailDialog({
  row,
  rows,
  serverName,
  onOpenStack,
  onClose,
}: QueryDetailDialogProps) {
  const res = resourceOf(row);
  const isSql = res.kind === 'sql';
  const [bind, setBind] = useState<Bind>(isSql && row.txid ? { kind: 'loading' } : { kind: 'gone' });
  const [inline, setInline] = useState(true);

  useEffect(() => {
    if (!isSql || !row.txid) return;
    let alive = true;
    getThreadDetail(row.obj_hash, row.id, row.txid)
      .then((d: ThreadDetail | null) => {
        if (!alive) return;
        if (d === null) setBind({ kind: 'gone' });
        else if (d.sql.trim() !== res.label) setBind({ kind: 'moved' });
        else setBind({ kind: 'ok', params: d.sql_bind_var });
      })
      .catch(e => alive && setBind({ kind: 'error', message: String(e) }));
    return () => {
      alive = false;
    };
  }, [isSql, row.obj_hash, row.id, row.txid, res.label]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** 화면에 놓을 문장. 값이 있고 채우기를 켰으면 채운 문장이다 */
  const statement = useMemo(() => {
    if (!isSql) return { text: res.label, bound: 0, placeholders: 0 };
    if (bind.kind === 'ok' && bind.params !== '' && inline) return bindSql(res.label, bind.params);
    return { text: res.label, bound: 0, placeholders: 0 };
  }, [isSql, res.label, bind, inline]);

  const same = useMemo(
    () => sortRows(rows.filter(r => resourceOf(r).key === res.key)),
    [rows, res.key],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={isSql ? t('쿼리 상세') : t('외부 호출 상세')}
        onClick={e => e.stopPropagation()}
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line-strong bg-raised shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2">
          <span
            className={`font-mono text-micro ${isSql ? 'text-[var(--cat-sql)]' : 'text-[var(--cat-api)]'}`}
          >
            {isSql ? 'SQL' : 'API'}
          </span>
          <h2 className="text-base font-medium text-fg">
            {isSql ? t('쿼리 상세') : t('외부 호출 상세')}
          </h2>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="rounded px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <section className="border-b border-line px-4 py-3">
            <div className="mb-1.5 flex items-center gap-2">
              <h3 className="text-micro tracking-wide text-fg-dim uppercase">
                {isSql ? t('문장') : t('호출 대상')}
              </h3>
              <div className="flex-1" />
              {isSql && bind.kind === 'ok' && bind.params !== '' && (
                <label className="flex items-center gap-1 text-micro text-fg-dim">
                  <input type="checkbox" checked={inline} onChange={e => setInline(e.target.checked)} />
                  {t('값 채워 보기')}
                </label>
              )}
              <CopyButton text={statement.text} />
            </div>
            <pre className="max-h-[40vh] overflow-auto rounded border border-line bg-base px-3 py-2 font-mono text-small leading-relaxed whitespace-pre-wrap text-fg">
              {isSql ? formatSql(statement.text) : statement.text}
            </pre>

            {isSql && (
              <div className="mt-2 text-micro">
                {bind.kind === 'loading' && <span className="text-fg-faint">{t('바인드 값을 묻는 중…')}</span>}
                {bind.kind === 'ok' && bind.params === '' && (
                  <span className="text-fg-faint">{t('이 문장에는 바인드 값이 없습니다.')}</span>
                )}
                {bind.kind === 'ok' && bind.params !== '' && (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-fg-muted">
                      {t('바인드:')} {bind.params}
                    </span>
                    {inline && statement.placeholders > statement.bound && (
                      // 모자라게 채운 문장을 그대로 실행하면 틀린다. 남은 자리를 알린다.
                      <span className="text-warn">
                        {t('자리표시자')} {statement.placeholders}
                        {t('개 중')} {statement.bound}
                        {t('개만 채웠습니다 — 남은 자리는 ? 그대로입니다.')}
                      </span>
                    )}
                    {/* 에이전트는 값 하나를 정해진 길이에서 자른다. 복사해 실행하기 전에 알아야 한다 */}
                    <span className="text-fg-faint">
                      {t('값마다 에이전트 설정 trace_sql_parameter_max_length (기본 20자) 에서 잘릴 수 있습니다.')}
                    </span>
                  </div>
                )}
                {bind.kind === 'gone' && (
                  <span className="text-fg-faint">
                    {t('이미 끝난 트랜잭션이라 바인드 값을 받지 못했습니다.')}
                  </span>
                )}
                {bind.kind === 'moved' && (
                  <span className="text-warn">
                    {t('여는 사이에 다음 쿼리로 넘어가 이 문장의 바인드 값을 받지 못했습니다.')}
                  </span>
                )}
                {bind.kind === 'error' && <span className="text-danger">{bind.message}</span>}
              </div>
            )}
          </section>

          <section className="px-4 py-3">
            <h3 className="mb-1.5 text-micro tracking-wide text-fg-dim uppercase">
              {isSql ? t('이 쿼리에 매달린 트랜잭션') : t('이 호출에 매달린 트랜잭션')}{' '}
              <span className="font-mono text-fg-faint">{same.length}</span>
            </h3>
            <ol className="divide-y divide-line/40 rounded border border-line">
              {same.map(r => (
                <li key={`${r.obj_hash}:${r.id}:${r.txid ?? r.service}`}>
                  <button
                    onClick={r.txid ? () => onOpenStack(r) : undefined}
                    disabled={r.txid === null}
                    title={r.txid ? t('스택 트레이스 보기') : t('이 행은 상세를 물을 수 없습니다')}
                    className={`flex w-full items-baseline gap-3 px-3 py-1.5 text-left ${
                      r.txid ? 'hover:bg-hover/60' : 'cursor-default'
                    } ${r === row ? 'bg-accent/10' : ''}`}
                  >
                    <span className="w-[72px] shrink-0 text-right font-mono text-small tabular-nums text-fg">
                      {formatElapsed(r.elapsed)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-small text-fg" title={r.service}>
                      {r.service}
                    </span>
                    <span className="shrink-0 truncate text-micro text-fg-faint">
                      {serverName(r.obj_hash)} · {r.name}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
});
