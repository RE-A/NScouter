// Active 탭 — **지금 안 끝나고 있는 것.**
//
// 다른 탭과 무엇이 다른가:
//   XLog      끝난 것을 점으로 (사후)
//   Visualize 지난 몇 시간의 모양 (추세)
//   Counter   서버가 견디는가 (지표)
//   **Active  지금 이 순간 무엇이 걸려 있는가 (현장)**
//
// 여기 있던 것이 전에도 있기는 했다 — 에이전트 우클릭의 모달, 그리고 Counter 탭
// 안의 접힌 패널. 둘 다 «찾아야 보이는» 자리라 장애 중에 쓰이지 않았다.
// 화면을 옮기는 것만으로는 부족해서 셋을 더했다: 리소스로 접어 보기,
// 같은 것을 붙들고 있은 시간, 그리고 전체를 한눈에 세우는 게이지.
//
// **이 화면의 성격을 화면 안에 적어 둔다.** 순간 스냅샷이라 빠른 쿼리는 거의 안
// 잡히고, 바인드 값은 오지 않는다. 적어 두지 않으면 «왜 대부분 비어 있냐» 가 된다.

import { memo, useCallback, useMemo, useState } from 'react';
import type { ActiveService } from '../xlog/types/object';
import { ThreadDetailDialog } from '../xlog/components/ThreadDetailDialog';
import { ActiveGauge } from './ActiveGauge';
import { ActiveList } from './ActiveList';
import { ResourceGroups } from './ResourceGroups';
import {
  groupByResource,
  matchesRow,
  resourceOf,
  sortRows,
  stepCounts,
} from './activeModel';
import { DEFAULT_POLL_MS, POLL_MS, useActiveServices, type PollMs } from './useActiveServices';
import { t } from '../../i18n';

interface ActiveTabProps {
  /** 접속돼 있고 이 탭을 보고 있는가 */
  enabled: boolean;
  /** javaee 오브젝트의 objType. 액티브는 objHash 로는 못 묻는다 (F-34) */
  javaeeType: string;
  /** 왼쪽에서 고른 서버. 여기 없는 서버의 것은 보여주지 않는다 */
  picked: ReadonlySet<number>;
  agentMap: Map<number, string>;
}

/** 주기 고르개에 적을 글자. `0` 은 멈춤 */
function pollLabel(ms: PollMs): string {
  return ms === 0 ? t('멈춤') : `${ms / 1000}${t('초')}`;
}

export const ActiveTab = memo(function ActiveTab({
  enabled,
  javaeeType,
  picked,
  agentMap,
}: ActiveTabProps) {
  const [period, setPeriod] = useState<PollMs>(DEFAULT_POLL_MS);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [detail, setDetail] = useState<ActiveService | null>(null);

  const feed = useActiveServices(javaeeType, enabled, period);

  const serverName = useCallback(
    (objHash: number) => agentMap.get(objHash) ?? `#${objHash}`,
    [agentMap],
  );

  /** 고른 서버의 것만. 안 고른 서버가 섞이면 «내가 안 보는 서버» 의 장애를 본다 */
  const mine = useMemo(
    () => (picked.size === 0 ? feed.rows : feed.rows.filter(r => picked.has(r.obj_hash))),
    [feed.rows, picked],
  );

  const counts = useMemo(() => stepCounts(mine), [mine]);
  const groups = useMemo(() => groupByResource(mine), [mine]);
  const sorted = useMemo(() => sortRows(mine), [mine]);
  const oldest = sorted[0] ?? null;

  /** 찾기와 묶음은 **목록만** 줄인다. 게이지와 묶음 목록은 전체를 유지한다 —
   *  걸러낸 뒤의 수를 전체인 줄 알면 «다 끝났네» 가 된다. */
  const shown = useMemo(
    () =>
      sorted.filter(
        r => matchesRow(r, query) && (group === null || resourceOf(r).key === group),
      ),
    [sorted, query, group],
  );

  const filtering = query.trim() !== '' || group !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('서비스·쿼리·호출·스레드·IP 로 찾기')}
          className="h-7 w-[280px] rounded border border-line bg-input px-2 text-body text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
        />

        <div className="flex items-center gap-1">
          <span className="text-micro text-fg-dim">{t('갱신')}</span>
          {POLL_MS.map(ms => (
            <button
              key={ms}
              onClick={() => setPeriod(ms)}
              aria-pressed={period === ms}
              className={`rounded px-1.5 py-0.5 font-mono text-micro ${
                period === ms ? 'bg-accent/20 text-accent' : 'text-fg-faint hover:bg-hover hover:text-fg'
              }`}
            >
              {pollLabel(ms)}
            </button>
          ))}
          <button
            onClick={feed.refresh}
            className="ml-1 rounded px-1.5 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
          >
            {t('지금 받기')}
          </button>
        </div>

        <div className="flex-1" />

        {/* 언제 것인가. 멈춰 두면 화면은 그대로인데 세상은 아니다 */}
        <span className="flex items-center gap-1.5 text-micro text-fg-faint">
          <span
            className={`size-1.5 rounded-full ${
              feed.loading ? 'bg-accent' : period === 0 ? 'bg-fg-faint' : 'bg-ok'
            }`}
            aria-hidden
          />
          {feed.at === null
            ? t('아직 받지 않았습니다')
            : `${t('마지막 갱신')} ${new Date(feed.at).toLocaleTimeString()}`}
        </span>
      </div>

      {feed.error && (
        <p className="border-b border-line bg-danger/10 px-3 py-1.5 text-micro text-danger">
          {feed.error}
        </p>
      )}
      {feed.incomplete.length > 0 && (
        // 조용히 적게 보여주면 «지금 한가하다» 로 오해한다.
        <p className="border-b border-line px-3 py-1.5 text-micro text-warn">
          {feed.incomplete.length}
          {t('개 서버가 응답하지 않아 목록에 빠져 있습니다')}
        </p>
      )}

      <section aria-label={t('액티브 현황')} className="px-3 pt-3">
        <ActiveGauge
          counts={counts}
          oldest={oldest}
          oldestServer={oldest === null ? '' : serverName(oldest.obj_hash)}
        />
      </section>

      {/* 본문 — 왼쪽은 접은 것, 오른쪽은 편 것 */}
      <div className="mt-3 flex min-h-0 flex-1 gap-3 px-3 pb-3">
        <aside
          aria-label={t('무엇을 기다리나')}
          className="flex w-[260px] shrink-0 flex-col rounded border border-line bg-surface"
        >
          <ResourceGroups
            groups={groups}
            selected={group}
            onSelect={setGroup}
            total={counts.total}
          />
        </aside>

        <section
          aria-label={t('실행 중인 트랜잭션')}
          className="flex min-w-0 flex-1 flex-col rounded border border-line bg-surface"
        >
          <div className="flex items-baseline justify-between border-b border-line px-3 py-2">
            <span className="text-micro tracking-wide text-fg-dim uppercase">
              {t('실행 중인 트랜잭션')}
            </span>
            <span className="text-micro text-fg-faint">
              {filtering
                ? `${shown.length} / ${counts.total}${t('건')}`
                : `${counts.total}${t('건')}`}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <ActiveList
              rows={shown}
              holds={feed.holds}
              at={feed.at}
              maxElapsed={counts.maxElapsed}
              serverName={serverName}
              onPick={setDetail}
            />
          </div>

          {/* 이 화면이 무엇을 못 보여주는지. 빼면 «왜 대부분 비어 있냐» 가 된다 */}
          <p className="border-t border-line px-3 py-1.5 text-micro text-fg-faint">
            {t('순간 스냅샷입니다 — 짧게 끝나는 쿼리는 잡히지 않습니다. 쿼리의 바인드 값은 오지 않습니다.')}
          </p>
        </section>
      </div>

      {detail?.txid && (
        <ThreadDetailDialog
          objHash={detail.obj_hash}
          threadId={detail.id}
          txid={detail.txid}
          service={detail.service}
          objName={serverName(detail.obj_hash)}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
});
