// 서비스 그룹 (ASIS ServiceGroup TPS / Elapsed)
//
// 카운터가 "서버가 견디는가"를 묻는다면 이건 **"무엇이 들어오는가"** 를 묻는다.
// TPS 가 떨어졌을 때 어느 계열의 요청이 빠졌는지는 여기서만 보인다.
//
// ASIS 는 TPS 와 Elapsed 를 별개 뷰 두 개로 나눴다. 같은 응답에 둘 다 들어 있어
// 두 번 물을 이유가 없으므로 한 표에 나란히 둔다.

import { memo, useCallback, useEffect, useState } from 'react';
import { getServiceGroup, type ServiceGroupRow } from '../api/scouterApi';
import { GROUP_WINDOW_SEC, sortGroups, toStats, type GroupStat } from './serviceGroup';
import { durationTone } from './durationTone';
import { t } from '../../../i18n';

interface ServiceGroupPanelProps {
  /** 이 오브젝트들의 요청만 묶는다. **objType 으로는 못 묻는다** (F-44) */
  objHashes: number[];
  enabled: boolean;
}

/** 콜렉터가 30초 구간으로 집계하므로 그보다 자주 물을 이유가 없다 */
const POLL_MS = 10_000;

export const ServiceGroupPanel = memo(function ServiceGroupPanel({
  objHashes,
  enabled,
}: ServiceGroupPanelProps) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<GroupStat[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const key = objHashes.join(',');

  const load = useCallback(() => {
    if (objHashes.length === 0) return;
    getServiceGroup(objHashes)
      .then((rows: ServiceGroupRow[]) => {
        setStats(sortGroups(toStats(rows)));
        setError(null);
        setLoadedOnce(true);
      })
      .catch(e => setError(String(e)));
    // key 로 의존성을 잡는다 — 배열은 매 렌더 새 객체라 그대로 두면 폴링이 계속 다시 선다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!open || !enabled) return;
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [open, enabled, load]);

  if (!enabled) return null;

  const totalTps = stats.reduce((s, g) => s + g.tps, 0);

  return (
    <section className="mb-4">
      <header className="mb-2 flex items-baseline gap-2 border-b border-line pb-1">
        <h2 className="text-body font-medium text-fg">{t('서비스 그룹')}</h2>
        <span className="text-micro text-fg-faint">최근 {GROUP_WINDOW_SEC}초</span>
        <div className="flex-1" />
        {open && stats.length > 0 && (
          <span className="tnum font-mono text-micro text-fg-dim">
            {totalTps.toFixed(1)} tps · {stats.length}개 그룹
          </span>
        )}
        <button
          onClick={() => setOpen(o => !o)}
          className="rounded px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
        >
          {open ? '닫기' : t('열기')}
        </button>
      </header>

      {open && (
        <div className="rounded border border-line bg-surface">
          {error && <p className="px-3 py-6 text-center text-small text-danger">{error}</p>}
          {!error && loadedOnce && stats.length === 0 && (
            <p className="px-3 py-6 text-center text-small text-fg-faint">
              최근 {GROUP_WINDOW_SEC}초 동안 들어온 요청이 없습니다.
            </p>
          )}
          {!error && !loadedOnce && (
            <p className="px-3 py-6 text-center text-small text-fg-faint">{t('조회 중…')}</p>
          )}
          {!error && stats.length > 0 && <GroupTable stats={stats} />}
        </div>
      )}
    </section>
  );
});

const COLS = 'grid grid-cols-[minmax(0,1fr)_86px_86px_86px_96px] items-baseline gap-x-3 px-3';

function GroupTable({ stats }: { stats: GroupStat[] }) {
  const maxTps = Math.max(...stats.map(g => g.tps), 0.001);

  return (
    <div className="py-1">
      <div className={`${COLS} pb-1 text-micro text-fg-faint`}>
        <span>{t('그룹')}</span>
        <span className="text-right">TPS</span>
        <span className="text-right">{t('응답(ms)')}</span>
        <span className="text-right">{t('에러')}</span>
        <span className="text-right">{t('비중')}</span>
      </div>
      <ul className="divide-y divide-line/40">
        {stats.map(g => (
          <li key={g.name} className={`${COLS} py-1`}>
            <span className="truncate font-mono text-micro text-fg" title={g.name}>
              {g.name}
            </span>
            <span className="tnum text-right font-mono text-micro text-fg">
              {g.tps.toFixed(1)}
            </span>
            <span className={`tnum text-right font-mono text-micro ${durationTone(g.elapsed)}`}>
              {g.elapsed.toFixed(1)}
            </span>
            {/* 에러 0을 회색 0으로 찍으면 눈이 그냥 지나간다. 있을 때만 빨갛게 말한다 */}
            <span
              className={`tnum text-right font-mono text-micro ${g.error > 0 ? 'text-danger' : 'text-fg-faint'}`}
            >
              {g.error > 0 ? `${g.error} (${g.errorRate.toFixed(1)}%)` : '—'}
            </span>
            {/* 비중은 숫자보다 길이가 빠르다 */}
            <span className="flex items-center gap-1.5">
              <span className="h-1 flex-1 overflow-hidden rounded-sm bg-line/40">
                <span
                  className="block h-full bg-accent"
                  style={{ width: `${(g.tps / maxTps) * 100}%` }}
                />
              </span>
              <span className="tnum w-9 text-right font-mono text-micro text-fg-dim">
                {g.share.toFixed(0)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
