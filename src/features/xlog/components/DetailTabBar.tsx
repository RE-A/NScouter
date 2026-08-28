// 열어 둔 상세 트랜잭션의 탭 줄.
//
// **탭 이름은 서비스명이다.** txid 는 사람이 못 알아본다. 같은 서비스를 두 개 열면
// 이름이 같아지므로 시각을 덧붙인다 — 그게 두 트랜잭션을 가르는 실제 기준이다.
//
// 폭이 좁다(상세 패널 안이다). 그래서 줄을 접지 않고 **가로로 넘긴다** —
// 접으면 탭이 늘어날수록 프로파일 볼 자리를 먹는다.

import { memo } from 'react';
import type { DetailTab } from '../hooks/useXLogDetailTabs';
import { formatTime } from '../utils/colorPalette';
import { durationTone } from './durationTone';
import { t } from '../../../i18n';

interface DetailTabBarProps {
  tabs: DetailTab[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onCloseAll: () => void;
}

export const DetailTabBar = memo(function DetailTabBar({
  tabs,
  activeKey,
  onSelect,
  onClose,
  onCloseAll,
}: DetailTabBarProps) {
  return (
    <div className="flex shrink-0 items-stretch border-b border-line bg-surface">
      <div className="flex min-w-0 flex-1 gap-px overflow-x-auto">
        {tabs.map(tab => {
          const active = tab.key === activeKey;
          const xlog = tab.state.xlog;
          const elapsed = xlog ? xlog.elapsed : 0;
          return (
            <div
              key={tab.key}
              className={[
                'group flex shrink-0 items-center gap-1 border-b-2 px-2 py-1',
                active
                  ? 'border-accent bg-raised'
                  : 'border-transparent hover:bg-hover',
              ].join(' ')}
            >
              <button
                onClick={() => onSelect(tab.key)}
                title={xlog ? `${tab.title}\n${formatTime(xlog.endTime)}` : tab.title}
                className="flex min-w-0 items-baseline gap-1.5"
              >
                <span
                  className={`max-w-[9rem] truncate text-micro ${active ? 'text-fg' : 'text-fg-muted'}`}
                >
                  {tab.state.isLoading ? t('여는 중…') : tab.title}
                </span>
                {/* **같은 서비스를 두 개 열면 이름만으로는 못 가른다.** 시각이 기준이다 */}
                {xlog && (
                  <span className="tnum shrink-0 font-mono text-micro text-fg-faint">
                    {formatTime(xlog.endTime)}
                  </span>
                )}
                {xlog && elapsed > 0 && (
                  <span className={`tnum shrink-0 font-mono text-micro ${durationTone(elapsed)}`}>
                    {elapsed}ms
                  </span>
                )}
              </button>
              <button
                onClick={() => onClose(tab.key)}
                title={t('이 탭 닫기')}
                aria-label={`${t('이 탭 닫기')} — ${tab.title}`}
                className="shrink-0 rounded px-1 text-micro text-fg-faint hover:bg-hover hover:text-fg"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={onCloseAll}
        title={t('열어 둔 상세를 모두 닫습니다')}
        className="shrink-0 border-l border-line px-2 text-micro text-fg-faint hover:bg-hover hover:text-fg"
      >
        {t('모두 닫기')}
      </button>
    </div>
  );
});
