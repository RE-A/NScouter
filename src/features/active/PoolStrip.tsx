// 커넥션 풀 줄 — **«풀이 찼다» 와 «무엇 때문에» 를 한 화면에.**
//
// 게이지 바로 아래, 목록 바로 위다. 자리가 뜻이다 — 풀이 꽉 찼으면 그 아래 목록이
// 이유고, 여유로우면 그 아래 목록의 느린 것은 풀 탓이 아니다.
//
// 풀이 없을 때 **줄을 통째로 숨기지 않는다.** 두 관문(F-41)을 안 열면 풀 오브젝트
// 자체가 안 잡히는데, 화면에서 사라지면 «이 앱은 커넥션 풀을 못 본다» 로 읽힌다.
//
// **고르라고 시키지 않는다.** 고른 WAS 아래 풀은 앱이 스스로 찾아 받는다
// (App 의 `poolHashes`). 그래서 여기서 비어 있다는 것은 «안 골랐다» 가 아니라
// 둘 중 하나다 — 풀 오브젝트 자체가 없거나(관문), 이름이 부모와 안 이어지거나.

import { memo } from 'react';
import { poolLevel, usagePct, type Pool, type PoolLevel } from './poolModel';
import { t } from '../../i18n';

/** 단계별 색. 게이지와 같은 세 색을 쓴다 — 9할 찬 풀은 3초 넘은 트랜잭션과 같은 급이다 */
const LEVEL: Record<PoolLevel, { bar: string; text: string }> = {
  unknown: { bar: 'bg-line', text: 'text-fg-faint' },
  ok: { bar: 'bg-accent', text: 'text-fg' },
  warn: { bar: 'bg-warn', text: 'text-warn' },
  full: { bar: 'bg-danger', text: 'text-danger' },
};

interface PoolStripProps {
  pools: readonly Pool[];
  /**
   * 콜렉터에 `datasource` 오브젝트가 **하나라도** 붙어 있는가.
   *
   * 비었을 때의 안내가 갈린다. 하나도 없으면 관문(F-41) 문제이고, 있는데 여기가
   * 비었으면 이름이 부모 WAS 와 안 이어진 것이다 — 고치는 곳이 서로 다르다.
   */
  anyDatasource: boolean;
}

export const PoolStrip = memo(function PoolStrip({ pools, anyDatasource }: PoolStripProps) {
  return (
    <div className="rounded border border-line bg-raised px-3 py-2">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-micro tracking-wide text-fg-dim uppercase">{t('커넥션 풀')}</span>
        <span className="text-micro text-fg-faint">
          {pools.length}
          {t('개')}
        </span>
      </div>

      {pools.length === 0 ? (
        // 왜 비었는지까지 적는다. «없다» 만 적으면 어디를 봐야 할지 알 수 없다.
        <p className="py-1 text-micro text-fg-faint">
          {anyDatasource
            ? t('고른 서버 아래에 커넥션 풀이 없습니다. 풀 오브젝트는 있으니, 이름이 WAS 아래로 안 붙는 경우라면 왼쪽에서 그 풀을 직접 고르세요.')
            : t('커넥션 풀이 안 잡힙니다. 앱의 spring.datasource.hikari.register-mbeans 와 에이전트의 jmx_counter_enabled 를 모두 켜야 합니다.')}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {pools.map(p => {
            const level = poolLevel(p);
            const pct = usagePct(p);
            return (
              <li
                key={p.objHash}
                title={p.objName}
                className="flex min-w-[168px] flex-1 flex-col gap-1 rounded border border-line bg-surface px-2.5 py-1.5"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-micro text-fg-muted">
                    {/* 풀 이름만으로는 어느 WAS 것인지 모른다. 부모를 같이 적는다 */}
                    {p.parentName === '' ? p.poolName : `${p.parentName.split('/').pop()} · ${p.poolName}`}
                  </span>
                  <span className={`font-mono text-micro tabular-nums ${LEVEL[level].text}`}>
                    {pct === null ? '—' : `${Math.round(pct)}%`}
                  </span>
                </span>

                <span className="flex h-1.5 overflow-hidden rounded-full bg-base">
                  <span
                    className={`${LEVEL[level].bar} transition-[width] duration-300`}
                    style={{ width: `${pct ?? 0}%` }}
                  />
                </span>

                <span className="flex items-baseline justify-between gap-2 font-mono text-micro tabular-nums text-fg-faint">
                  <span className={LEVEL[level].text}>
                    {t('사용 중')} {p.active ?? '—'} / {p.max ?? '—'}
                  </span>
                  <span>
                    {t('유휴')} {p.idle ?? '—'}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
