// 테마가 바뀌었다는 신호를 React 쪽으로 넘긴다.
//
// **Canvas 차트는 스스로 다시 그리지 않는다.** CSS 는 변수만 갈아 끼우면 바뀌지만,
// 캔버스에 이미 칠해 둔 픽셀은 그대로다 — 멈춰 있는 과거 조회 화면이나 갱신이 느린
// 차트는 테마를 바꿔도 옛 색으로 남는다. 그리기 효과의 의존성에 이 번호를 넣으면
// 테마가 바뀔 때마다 한 번 더 그린다.

import { useEffect, useState } from 'react';
import { subscribeTheme, themeEpoch } from './theme';

export function useThemeEpoch(): number {
  const [n, setN] = useState(themeEpoch);
  useEffect(() => subscribeTheme(setN), []);
  return n;
}
