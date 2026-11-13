// 시각 칸 — `datetime-local` 을 ms 값으로 다룬다
//
// 연도를 한 자리씩 치면 브라우저가 `0002-…` → `0020-…` → `0202-…` 를 넘긴다. 이를 시각으로 바꿔 다시 써 넣으면
// 4자리가 아닌 연도(`2-11-13…`)가 되어 칸이 비어 버린다. 그래서 치는 중의 글자는 이 칸이 들고,
// 온전한 시각(1970 년 이후)일 때만 위로 올린다.

import { useState } from 'react';
import { fromLocalInput, toLocalInput } from '../features/xlog/types/timeRange';

/** 치는 중의 값은 받지 않는다 — 빈 값·1970 년 전 */
export function parseTimeInput(s: string): number | null {
  const v = fromLocalInput(s);
  return v !== null && new Date(v).getFullYear() >= 1970 ? v : null;
}

export function TimeInput({ ms, onChange, className }: { ms: number; onChange: (ms: number) => void; className?: string }) {
  const [text, setText] = useState(() => toLocalInput(ms));
  const [seen, setSeen] = useState(ms);
  // 밖에서 바뀐 값(빠른 선택·조건 묶음·모드 전환 등)은 칸에 다시 쓴다
  if (ms !== seen) {
    setSeen(ms);
    setText(toLocalInput(ms));
  }
  return (
    <input
      type="datetime-local"
      value={text}
      onChange={e => {
        setText(e.target.value);
        const v = parseTimeInput(e.target.value);
        if (v !== null && v !== ms) {
          setSeen(v);
          onChange(v);
        }
      }}
      className={className}
    />
  );
}
