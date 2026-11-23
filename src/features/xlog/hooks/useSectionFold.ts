// 카운터 구역의 접는 방식 (App 의 CounterSection).
//
// **서비스로 묶어 볼 때는 서비스별이 기본이다.** ECS 에서 Task 4대짜리 서비스가 열 개면
// 개별은 40선이라 못 읽고, 합계는 서비스끼리 섞인다. 묶기를 바꾸면 그 묶기의 기본으로
// 돌아간다 — 서비스 묶기를 풀었는데 «서비스별» 이 남아 있으면 고를 버튼도 없는 상태가 된다.

import { useState } from 'react';
import type { FoldMode } from '../components/counterSeries';

export interface SectionFold {
  fold: FoldMode;
  setFold: (f: FoldMode) => void;
  /** 고를 수 있는 것. 버튼 순서다 */
  choices: readonly FoldMode[];
}

/** 이보다 많은 서버를 그리면 개별 선은 읽을 수 없다 — 기본을 접은 보기로 둔다 */
export const MANY_LINES = 10;

/**
 * @param byService 서비스로 묶어 보는가
 * @param lines 그릴 서버 수. `MANY_LINES` 를 넘고 서비스로 묶지 않았으면 기본이 «전체» 다 —
 *   대규모(서버 수십 대)에서 개별 선 수십 개가 겹쳐 아무것도 읽히지 않았다. **사람이 고르면 그것을 따른다**
 */
export function useSectionFold(byService: boolean, lines = 0): SectionFold {
  /** 사람이 고른 것. 없으면 기본을 따른다(서버 수가 바뀌면 기본도 따라 바뀐다) */
  const [chosen, setChosen] = useState<FoldMode | null>(null);
  const [foldFor, setFoldFor] = useState(byService);
  // 묶기가 바뀌면 그린 그 자리에서 바로 고친다 — effect 로 미루면 한 번은 옛 방식으로 그린다
  if (foldFor !== byService) {
    setFoldFor(byService);
    setChosen(null);
  }
  const fallback: FoldMode = byService ? 'service' : lines > MANY_LINES ? 'total' : 'each';
  return {
    fold: chosen ?? fallback,
    setFold: setChosen,
    choices: byService ? ['each', 'service', 'total'] : ['each', 'total'],
  };
}
