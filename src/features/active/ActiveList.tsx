// 실행 중인 트랜잭션 — 느린 것부터.
//
// **막대를 쓰는 이유.** 숫자만 늘어놓으면 «12,400 / 4,100 / 980» 을 눈으로 견줘야
// 하는데, 장애 중에는 그 한 박자가 아깝다. 가장 오래된 것을 가득 찬 막대로 두고
// 나머지를 그 비율로 그리면 «하나만 튀는가, 다 같이 밀렸는가» 가 즉시 읽힌다.
// 둘은 원인이 다르다 — 앞은 특정 쿼리, 뒤는 자원 고갈이다.
//
// 줄마다 **무엇을 붙들고 있는지**를 두 번째 줄에 둔다. 서비스명만으로는 대책이
// 안 나온다. 「/shop/checkout 이 12초」 는 증상이고, 「그 12초 중 3초째 이 쿼리」 가
// 손댈 자리다.

import { memo } from 'react';
import type { ActiveService } from '../xlog/types/object';
import {
  elapsedPct,
  formatElapsed,
  heldMs,
  resourceOf,
  rowKey,
  stepOf,
  type Hold,
  type SpeedStep,
} from './activeModel';
import { t } from '../../i18n';

/** 막대·글자색. 게이지와 같은 세 단계다 */
const STEP: Record<SpeedStep, { bar: string; text: string }> = {
  1: { bar: 'bg-accent', text: 'text-fg-muted' },
  2: { bar: 'bg-warn', text: 'text-warn' },
  3: { bar: 'bg-danger', text: 'text-danger' },
};

/** 스레드가 무엇을 하고 있나. 자바 스레드 상태를 그대로 쓴다 */
const STAT_TONE: Record<string, string> = {
  RUNNABLE: 'text-ok',
  BLOCKED: 'text-danger',
  WAITING: 'text-warn',
  TIMED_WAITING: 'text-warn',
};

interface ActiveListProps {
  rows: readonly ActiveService[];
  holds: ReadonlyMap<string, Hold>;
  /** 마지막으로 받은 시각. 붙들고 있은 시간을 이 시각 기준으로 잰다 */
  at: number | null;
  /** 막대의 100% 기준. 걸러낸 뒤에도 **전체 최댓값**을 쓴다 (기준이 흔들리면 못 견준다) */
  maxElapsed: number;
  serverName: (objHash: number) => string;
  onPick: (row: ActiveService) => void;
}

export const ActiveList = memo(function ActiveList({
  rows,
  holds,
  at,
  maxElapsed,
  serverName,
  onPick,
}: ActiveListProps) {
  if (rows.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-body text-fg-faint">
        {t('지금 실행 중인 트랜잭션이 없습니다.')}
      </p>
    );
  }

  return (
    <ol className="divide-y divide-line/40">
      {rows.map(row => {
        const step = stepOf(row.elapsed);
        const res = resourceOf(row);
        const held = at === null ? null : heldMs(holds, row, at);
        const server = serverName(row.obj_hash);

        return (
          <li key={rowKey(row)}>
            <button
              // txid 가 없으면 스택을 물을 수 없다. 눌러도 빈 창이면 고장으로 읽힌다.
              onClick={row.txid ? () => onPick(row) : undefined}
              disabled={row.txid === null}
              title={row.txid ? t('스택 트레이스 보기') : t('이 행은 상세를 물을 수 없습니다')}
              className={`flex w-full items-start gap-3 px-3 py-2 text-left ${
                row.txid ? 'cursor-pointer hover:bg-hover/60' : 'cursor-default'
              }`}
            >
              {/* 막대 + 경과. 가장 오래된 것이 가득 찬다 */}
              <span className="flex w-[124px] shrink-0 flex-col gap-1 pt-0.5">
                <span className={`text-right font-mono text-base tabular-nums ${STEP[step].text}`}>
                  {formatElapsed(row.elapsed)}
                </span>
                <span className="flex h-1.5 overflow-hidden rounded-full bg-base">
                  <span
                    className={`${STEP[step].bar} transition-[width] duration-300`}
                    style={{ width: `${elapsedPct(row.elapsed, maxElapsed)}%` }}
                  />
                </span>
              </span>

              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-body text-fg" title={row.service}>
                  {row.service}
                </span>

                {/* 지금 붙들고 있는 것. 대책이 나오는 자리다 */}
                {res.kind === 'cpu' ? (
                  <span className="text-micro text-fg-faint">
                    {t('기다리는 대상 없음 — 제 코드 실행 중')}
                  </span>
                ) : (
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span
                      className={`shrink-0 font-mono text-micro ${
                        res.kind === 'sql' ? 'text-[var(--cat-sql)]' : 'text-[var(--cat-api)]'
                      }`}
                    >
                      {res.kind === 'sql' ? 'SQL' : 'API'}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-micro text-fg-muted"
                      title={res.label}
                    >
                      {res.label}
                    </span>
                    {/* «3초째 같은 쿼리» — 방금 넘어온 것과 계속 매달린 것을 가른다 */}
                    {held !== null && (
                      <span className="shrink-0 font-mono text-micro tabular-nums text-fg-dim">
                        {formatElapsed(held)}
                        {t('째')}
                      </span>
                    )}
                  </span>
                )}

                <span className="flex flex-wrap items-baseline gap-x-2 text-micro text-fg-faint">
                  <span className="truncate" title={server}>
                    {server}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="truncate font-mono" title={row.name}>
                    {row.name}
                  </span>
                  {row.ip !== '' && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="font-mono">{row.ip}</span>
                    </>
                  )}
                </span>
              </span>

              <span className="flex w-[104px] shrink-0 flex-col items-end gap-0.5 pt-0.5">
                <span className={`font-mono text-micro ${STAT_TONE[row.stat] ?? 'text-fg-faint'}`}>
                  {row.stat}
                </span>
                {/* CPU 시간. 「멈춘 것」 과 「도는 것」 을 가른다 — 둘 다 elapsed 는 길다 */}
                <span className="font-mono text-micro tabular-nums text-fg-faint">
                  cpu {row.cpu.toLocaleString()}ms
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
});
