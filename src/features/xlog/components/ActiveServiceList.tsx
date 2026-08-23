// 액티브 서비스 목록 (타입 전체)
//
// 액티브 막대가 "몇 건이 돌고 있나"라면 이건 **무엇이 안 끝나고 있나**다.
// 장애 중에 실제로 보는 화면이라 느린 것부터 놓는다.

import { memo, useEffect, useState } from 'react';
import { getTypeActiveServices } from '../api/scouterApi';
import type { ActiveService } from '../types/object';
import { durationTone } from './durationTone';
import { ThreadDetailDialog } from './ThreadDetailDialog';

interface ActiveServiceListProps {
  objType: string;
  agentMap: Map<number, string>;
}

/** 목록이 길어도 화면 하나를 넘기지 않는다. 넘으면 위쪽(느린 것)만 봐도 충분하다 */
const MAX_ROWS = 30;

export const ActiveServiceList = memo(function ActiveServiceList({
  objType,
  agentMap,
}: ActiveServiceListProps) {
  const [rows, setRows] = useState<ActiveService[]>([]);
  const [incomplete, setIncomplete] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  /** 상세를 연 행. txid 가 없는 행은 열 수 없다 */
  const [picked, setPicked] = useState<ActiveService | null>(null);

  useEffect(() => {
    // 접혀 있으면 부르지 않는다. 에이전트에 스레드 덤프를 시키는 요청이라 공짜가 아니다.
    if (!open || !objType) return;

    let alive = true;
    const poll = async () => {
      try {
        const res = await getTypeActiveServices(objType);
        if (!alive) return;
        setRows(res.rows);
        setIncomplete(res.incomplete);
        setError(null);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    void poll();
    const timer = setInterval(poll, 3_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open, objType]);

  return (
    <div className="rounded border border-line bg-surface">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between px-3 py-2 text-left hover:bg-hover/60"
      >
        <span className="text-micro tracking-wide text-fg-dim uppercase">
          액티브 서비스 목록
        </span>
        <span className="text-micro text-fg-faint">
          {open ? `${rows.length}건 · 닫기` : '열기'}
        </span>
      </button>

      {open && (
        <>
          {error && (
            <p className="mx-3 mb-2 rounded border-l-2 border-danger bg-danger/10 px-2 py-1.5 text-small text-danger">
              {error}
            </p>
          )}

          {/* 잘린 목록을 그냥 보여주면 "한가하다"로 오해한다 */}
          {incomplete.length > 0 && (
            <p className="mx-3 mb-2 rounded border-l-2 border-warn bg-warn/10 px-2 py-1.5 text-micro text-warn">
              {incomplete.map(h => agentMap.get(h) ?? `0x${(h >>> 0).toString(16)}`).join(', ')}
              {' '}의 목록이 완전하지 않습니다
            </p>
          )}

          {rows.length === 0 ? (
            <p className="px-3 pb-3 text-small text-fg-faint">
              지금 돌고 있는 트랜잭션이 없습니다
            </p>
          ) : (
            <ol className="divide-y divide-line/60 border-t border-line">
              {rows.slice(0, MAX_ROWS).map(r => (
                <li
                  key={`${r.obj_hash}-${r.id}`}
                  // **txid 가 없으면 상세를 물을 수 없다.** 누를 수 있게 해 두고 빈 창을
                  // 띄우면 고장으로 읽힌다 — 애초에 커서를 바꾸지 않는다.
                  onClick={r.txid ? () => setPicked(r) : undefined}
                  title={r.txid ? '스택 트레이스 보기' : undefined}
                  className={`grid grid-cols-[minmax(0,1fr)_minmax(0,90px)_70px] items-baseline gap-x-2 px-3 py-1 hover:bg-hover/60 ${
                    r.txid ? 'cursor-pointer' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <span className="block truncate text-small text-fg" title={r.service}>
                      {r.service || r.name}
                    </span>
                    {/* SQL 이 있으면 그게 지금 멈춰 있는 지점이다 */}
                    {(r.sql || r.subcall) && (
                      <span
                        className="block truncate font-mono text-micro text-fg-dim"
                        title={r.sql || r.subcall}
                      >
                        {r.sql || r.subcall}
                      </span>
                    )}
                  </div>

                  <span
                    className="truncate text-micro text-fg-dim"
                    title={agentMap.get(r.obj_hash) ?? ''}
                  >
                    {agentMap.get(r.obj_hash) ?? `0x${(r.obj_hash >>> 0).toString(16)}`}
                  </span>

                  <span className={`tnum text-right font-mono text-small ${durationTone(r.elapsed)}`}>
                    {r.elapsed.toLocaleString()}
                    <span className="ml-0.5 text-micro text-fg-faint">ms</span>
                  </span>
                </li>
              ))}
            </ol>
          )}

          {rows.length > MAX_ROWS && (
            <p className="px-3 py-1.5 text-micro text-fg-faint">
              느린 {MAX_ROWS}건만 표시 · 전체 {rows.length}건
            </p>
          )}
        </>
      )}

      {picked?.txid && (
        <ThreadDetailDialog
          objHash={picked.obj_hash}
          threadId={picked.id}
          txid={picked.txid}
          service={picked.service || picked.name}
          objName={agentMap.get(picked.obj_hash) ?? `0x${(picked.obj_hash >>> 0).toString(16)}`}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  );
});
