// 트리 오른쪽 클릭의 «이 대상으로 판 열기» 항목 — 원본 스카우터의 Objects 트리 메뉴처럼
//
// 원본: 콜렉터·종류 → 카운터들 · XLog · EQ · Active Service List …, 에이전트 → Performance Counter · Snapshot …
// 여기서는 같은 판 종류(`PanelKind`)로 연다. 열린 판은 **대상 고정**이고, 같은 종류·대상의 판이 있으면 그 판이 앞으로 온다.

import type { MenuItem } from '../../../components/ContextMenu';
import type { PanelKind } from '../hooks/xlogTabs';
import { counterMeta, isHostObjectType, isJavaeeObjectType, type CounterName } from '../types/counter';
import { t } from '../../../i18n';

/** 메뉴에 올릴 카운터 — 원본 기본 배치의 것(Recent User · TPS · Elapsed · Heap) 과 자주 보는 것 */
const JAVAEE_MENU_COUNTERS: CounterName[] = ['TPS', 'ElapsedTime', 'ActiveService', 'RecentUser', 'ErrorRate', 'HeapUsed'];
const HOST_MENU_COUNTERS: CounterName[] = ['Cpu', 'Mem', 'NetInBound', 'NetOutBound'];

export type OpenPanel = (kind: PanelKind, counter?: string) => void;

/**
 * 판 열기 항목들.
 * @param objType 대상의 종류(에이전트 하나면 그 종류). 모르면(여러 종류 묶음) null — 둘 다 보인다
 */
export function panelMenuItems(open: OpenPanel, objType: string | null): MenuItem[] {
  const javaee = objType === null || isJavaeeObjectType(objType);
  const host = objType === null || isHostObjectType(objType);
  // 카운터 묶음의 첫 항목 위에 가름선 — 판(XLog · EQ …)과 카운터를 나눈다
  const counter = (c: CounterName, i: number): MenuItem => ({
    label: `${t('카운터')} · ${t(counterMeta(c).disp)} ${t('열기')}`,
    onSelect: () => open('counter', c),
    ...(i === 0 ? { divider: true } : {}),
  });
  return [
    ...(javaee
      ? [
          { label: `XLog ${t('열기')}`, onSelect: () => open('xlog') },
          { label: `Active Service EQ ${t('열기')}`, onSelect: () => open('eq') },
          { label: `${t('Active 목록')} ${t('열기')}`, onSelect: () => open('active') },
          { label: `${t('요약')} ${t('열기')}`, onSelect: () => open('summary') },
          ...JAVAEE_MENU_COUNTERS.map(counter),
        ]
      : []),
    // 호스트 카운터는 판 항목이 없는 메뉴면 맨 위이고, 섞인 묶음이면 자바 카운터를 잇는다 — 어느 쪽이든 가름선이 필요 없다
    ...(host ? HOST_MENU_COUNTERS.map(c => counter(c, 1)) : []),
  ];
}
