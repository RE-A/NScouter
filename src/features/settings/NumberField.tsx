// 숫자 하나를 고치는 칸 — 설정 창의 «콜렉터 요청» 과 «AI 연결» 한도가 같이 쓴다.
//
// **치는 동안에는 적용하지 않는다.** `2` 를 지우고 `32` 를 치는 사이에 `3` 이 적용되면 안 된다 —
// 칸을 떠날 때나 Enter 에서 범위로 잘라 한 번 알린다. 범위는 칸 옆에 적어 둔다(손으로 친 0 이나
// 엄청 큰 값이 들어오면 콜렉터에 연결이 쏟아진다). Rust 도 같은 범위로 다시 자른다.

import { useEffect, useState } from 'react';

export function NumberField({
  label,
  hint,
  value,
  min,
  max,
  unit,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const n = Number(text);
    const v = text.trim() !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : value;
    setText(String(v));
    if (v !== value) onChange(v);
  };

  return (
    <label className="flex items-center gap-2 text-small" title={hint}>
      <span className="w-44 shrink-0 text-fg-muted">{label}</span>
      <input
        value={text}
        inputMode="numeric"
        disabled={disabled}
        onChange={e => setText(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
        }}
        className="w-24 rounded border border-line-control bg-input px-1.5 py-0.5 text-right font-mono text-body text-fg"
      />
      {unit && <span className="text-fg-faint">{unit}</span>}
      <span className="text-micro text-fg-faint">
        {min.toLocaleString()}~{max.toLocaleString()}
      </span>
    </label>
  );
}
