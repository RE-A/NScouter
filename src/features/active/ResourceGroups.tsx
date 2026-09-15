// 무엇을 기다리고 있나 — **목록을 리소스로 접은 것.**
//
// 트랜잭션 목록만 있으면 «느린 게 여덟 건» 까지는 보이는데 그다음 질문인
// «같은 것 때문인가, 제각각인가» 에 답하려면 눈으로 쿼리를 맞춰 봐야 한다.
// 여기서 접어 두면 «이 쿼리 하나에 여섯 건» 이 한 줄로 나온다 — 그게 답이다.
//
// **건수가 아니라 가장 오래된 것으로 세운다** (`groupByResource`). 많이 도는 것이
// 아니라 안 끝나는 것을 찾으러 온 화면이다.

import { memo } from 'react';
import { formatElapsed, KIND_LABEL, type ResourceGroup, type ResourceKind } from './activeModel';
import { t } from '../../i18n';

/** 종류별 색. 프로파일 스텝에서 쓰는 카테고리색과 같다 — DB 는 주황, 외부 호출은 하늘 */
const DOT: Record<ResourceKind, string> = {
  sql: 'bg-[var(--cat-sql)]',
  api: 'bg-[var(--cat-api)]',
  cpu: 'bg-[var(--cat-method)]',
};

interface ResourceGroupsProps {
  groups: readonly ResourceGroup[];
  /** 고른 묶음의 키. `null` 이면 전체 */
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** 전체 건수. 「전체」 줄에 적는다 */
  total: number;
}

export const ResourceGroups = memo(function ResourceGroups({
  groups,
  selected,
  onSelect,
  total,
}: ResourceGroupsProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-baseline justify-between px-3 py-2">
        <span className="text-micro tracking-wide text-fg-dim uppercase">
          {t('무엇을 기다리나')}
        </span>
        <span className="text-micro text-fg-faint">
          {groups.length}
          {t('가지')}
        </span>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto pb-2">
        <li>
          <button
            onClick={() => onSelect(null)}
            aria-pressed={selected === null}
            className={`flex w-full items-baseline justify-between gap-2 border-l-2 px-3 py-1.5 text-left ${
              selected === null
                ? 'border-l-accent bg-accent/12'
                : 'border-l-transparent hover:bg-hover/60'
            }`}
          >
            <span className="text-small text-fg">{t('전체')}</span>
            <span className="font-mono text-micro tabular-nums text-fg-muted">{total}</span>
          </button>
        </li>

        {groups.map(g => {
          const on = selected === g.key;
          return (
            <li key={g.key}>
              <button
                onClick={() => onSelect(on ? null : g.key)}
                aria-pressed={on}
                // 쿼리 전문은 줄에 안 들어간다. 잘라 보여주고 전문은 title 로 둔다.
                title={g.label === '' ? t(KIND_LABEL[g.kind]) : g.label}
                className={`flex w-full flex-col gap-1 border-l-2 px-3 py-1.5 text-left ${
                  on ? 'border-l-accent bg-accent/12' : 'border-l-transparent hover:bg-hover/60'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className={`size-1.5 shrink-0 rounded-full ${DOT[g.kind]}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-mono text-micro text-fg-muted">
                    {g.label === '' ? t(KIND_LABEL[g.kind]) : g.label}
                  </span>
                </span>
                <span className="flex items-baseline justify-between gap-2 pl-3">
                  <span className="font-mono text-micro tabular-nums text-fg-dim">
                    {g.count}
                    {t('건')}
                  </span>
                  {/* 이 묶음이 얼마나 깊은가. 정렬 기준이 이것이라 옆에 보여야 납득된다 */}
                  <span
                    className={`font-mono text-micro tabular-nums ${
                      g.maxElapsed >= 3_000
                        ? 'text-danger'
                        : g.maxElapsed >= 1_000
                          ? 'text-warn'
                          : 'text-fg-faint'
                    }`}
                  >
                    {formatElapsed(g.maxElapsed)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
});
