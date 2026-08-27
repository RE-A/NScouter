// 에러 텍스트 표시 — 첫 줄만 보이고 스택은 접는다
//
// 스택 트레이스를 그대로 그리면 50줄 빨간 벽이 되어
// 정작 봐야 할 프로파일을 화면 밖으로 밀어낸다.

import { useState } from 'react';
import { summarizeError } from './errorText';
import { t } from '../../../i18n';

interface ErrorDetailProps {
  text: string;
  /** 프로파일 스텝 안에서는 더 작게 */
  compact?: boolean;
}

export function ErrorDetail({ text, compact }: ErrorDetailProps) {
  const [open, setOpen] = useState(false);
  const { head, rest, restLines, isEmpty } = summarizeError(text);

  if (isEmpty) return null;

  return (
    <div className={compact ? 'mt-0.5' : ''}>
      <div className="flex items-start gap-2">
        <p
          className={`min-w-0 flex-1 break-all text-danger ${compact ? 'text-micro' : 'text-small'}`}
        >
          {head}
        </p>
        {restLines > 0 && (
          <button
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            className="shrink-0 rounded border border-line px-1.5 text-micro text-fg-dim hover:text-fg"
          >
            {open ? t('접기') : `${t('스택')} ${restLines}${t('줄')}`}
          </button>
        )}
      </div>
      {open && rest && (
        <pre className="mt-1 max-h-56 overflow-auto rounded bg-base/60 p-2 font-mono text-micro leading-relaxed break-all whitespace-pre-wrap text-fg-dim">
          {rest}
        </pre>
      )}
    </div>
  );
}
