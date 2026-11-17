// 위쪽 줄의 대시보드 이름들 — 원본 스카우터의 퍼스펙티브 전환
//
// 한 번 누르면 그 대시보드로, 두 번 누르면 이름 바꾸기, 오른쪽 클릭은 복제·되돌리기·지우기.
// `+` 는 지금 배치 복제 또는 기본 제공 하나를 새로 연다. `Ctrl+1~9` 는 놓인 순서다(App).
// 상태는 App 이 들고(`dashboards.ts`), 여기는 보여 주고 알리기만 한다.

import { memo, useEffect, useRef, useState } from 'react';
import type { DashboardPrefs } from '../api/scouterApi';
import { ContextMenu, type MenuItem } from '../../../components/ContextMenu';
import { MAX_DASHBOARDS, PRESET_IDS, PRESET_NAME, type PresetId } from '../hooks/dashboards';
import { t } from '../../../i18n';

interface DashboardBarProps {
  list: readonly DashboardPrefs[];
  activeId: string;
  /** 대시보드 화면을 보고 있나 — 아니면(Active·통계 …) 지금 대시보드도 칠하지 않는다 */
  showing: boolean;
  onSwitch: (id: string) => void;
  /** `copy` = 지금 배치 복제, 그 밖은 기본 제공을 새로 */
  onAdd: (from: 'copy' | PresetId) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onReset: (id: string) => void;
}

export const DashboardBar = memo(function DashboardBar({
  list,
  activeId,
  showing,
  onSwitch,
  onAdd,
  onRename,
  onRemove,
  onReset,
}: DashboardBarProps) {
  const [menu, setMenu] = useState<{ items: MenuItem[]; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 고칠 칸이 처음 열릴 때만 글자를 고른다 — 칠 때마다 고르면 친 것이 지워진다
  const editingId = editing?.id;
  useEffect(() => {
    if (editingId !== undefined) inputRef.current?.select();
  }, [editingId]);
  const full = list.length >= MAX_DASHBOARDS;
  const fullWhy = full ? t('대시보드는 {n}개까지입니다').replace('{n}', String(MAX_DASHBOARDS)) : undefined;

  const finish = (save: boolean) => {
    if (save && editing) onRename(editing.id, editing.value);
    setEditing(null);
  };

  const itemMenu = (e: React.MouseEvent, d: DashboardPrefs) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t('이름 바꾸기'), onSelect: () => setEditing({ id: d.id, value: d.name }) },
        ...(d.id === activeId ? [{ label: t('지금 배치를 새 대시보드로 복제'), onSelect: () => onAdd('copy'), disabled: fullWhy }] : []),
        ...(d.preset ? [{ label: t('기본으로 되돌리기'), onSelect: () => onReset(d.id) }] : []),
        {
          label: t('대시보드 지우기'),
          onSelect: () => onRemove(d.id),
          disabled: list.length <= 1 ? t('마지막 대시보드는 지울 수 없습니다') : undefined,
        },
      ],
    });
  };

  const addMenu = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({
      x: r.left,
      y: r.bottom + 2,
      items: [
        { label: t('지금 배치를 새 대시보드로 복제'), onSelect: () => onAdd('copy'), disabled: fullWhy },
        ...PRESET_IDS.map(p => ({ label: `${t('새로')} · ${t(PRESET_NAME[p])}`, onSelect: () => onAdd(p), disabled: fullWhy })),
      ],
    });
  };

  return (
    <>
      {list.map((d, i) => {
        const active = showing && d.id === activeId;
        if (editing?.id === d.id) {
          return (
            <input
              key={d.id}
              ref={inputRef}
              value={editing.value}
              onChange={e => setEditing({ id: d.id, value: e.target.value })}
              onBlur={() => finish(true)}
              onKeyDown={e => {
                if (e.key === 'Enter') finish(true);
                else if (e.key === 'Escape') finish(false);
              }}
              aria-label={t('대시보드 이름')}
              className="w-32 rounded border border-line-control bg-input px-1.5 py-0.5 text-body text-fg"
            />
          );
        }
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onSwitch(d.id)}
            onDoubleClick={() => setEditing({ id: d.id, value: d.name })}
            onContextMenu={e => itemMenu(e, d)}
            aria-current={active ? 'page' : undefined}
            title={i < 9 ? `Ctrl+${i + 1} · ${t('두 번 눌러 이름 바꾸기, 오른쪽 클릭으로 복제·지우기')}` : undefined}
            className={`btn-ghost max-w-[12rem] truncate px-2.5 py-1 text-body transition-colors ${
              active ? 'border-accent bg-accent/15 text-accent-bright' : ''
            }`}
          >
            {t(d.name)}
          </button>
        );
      })}
      <button
        type="button"
        onClick={addMenu}
        aria-label={t('대시보드 더하기')}
        title={t('대시보드 더하기')}
        className="btn-ghost px-1.5 py-1 text-body text-fg-dim"
      >
        +
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </>
  );
});
