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

export function useSectionFold(byService: boolean): SectionFold {
  const [fold, setFold] = useState<FoldMode>(byService ? 'service' : 'each');
  const [foldFor, setFoldFor] = useState(byService);
  // 묶기가 바뀌면 그린 그 자리에서 바로 고친다 — effect 로 미루면 한 번은 옛 방식으로 그린다
  if (foldFor !== byService) {
    setFoldFor(byService);
    setFold(byService ? 'service' : 'each');
  }
  return {
    fold,
    setFold,
    choices: byService ? ['each', 'service', 'total'] : ['each', 'total'],
  };
}
