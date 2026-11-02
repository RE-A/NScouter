// 에러 텍스트 표시 — 첫 줄만 보이고 스택은 접는다
//
// 스택 트레이스를 그대로 그리면 50줄 빨간 벽이 되어
// 정작 봐야 할 프로파일을 화면 밖으로 밀어낸다.
//
// **펼치는 것과 읽는 것은 다르다.** 펼친 스택은 좁은 칸에서 스크롤될 뿐이라,
// «어느 프레임에서 터졌나» 를 찾으려면 눈으로 훑어야 한다. 긴 스택은 창에서
// 연다 — 본문 검색과 통째 복사가 거기 있다 (SQL·메시지와 같은 창이다).

import { useState } from 'react';
import { summarizeError } from './errorText';
import { FullTextButton } from './FullTextButton';
import { previewLine } from './textFormat';
import { t } from '../../../i18n';
import { Button } from '../../../components/Button';

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
          <span className="flex shrink-0 items-baseline gap-1">
            <Button
              size="xs"
              onClick={() => setOpen(o => !o)}
              aria-expanded={open}
            >
              {open ? t('접기') : `${t('스택')} ${restLines}${t('줄')}`}
            </Button>
            <FullTextButton kind="ERROR" title={previewLine(head, 60)} body={text} min={0} />
          </span>
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
