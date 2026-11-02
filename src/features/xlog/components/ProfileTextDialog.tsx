// 프로파일 전문 창 — **보고서에 붙일 한 덩어리.**
//
// 스텝 목록은 읽기 좋지만 그대로 퍼 나를 수가 없다. 장애 보고서·티켓·메신저에
// 들어가는 것은 글자라, ASIS 스카우터도 같은 창을 따로 뒀다(`ProfileTextFull`).
// 모양을 ASIS 와 맞춘 이유는 받는 쪽이 이미 그렇게 읽을 줄 알기 때문이다.
//
// **글자를 만드는 일은 여기서 하지 않는다**(`profileFullText`). 창은 보여 주기만 한다 —
// 그래야 모양을 화면 없이 테스트할 수 있다.

import { memo, useMemo, useState } from 'react';
import { CopyButton } from '../../../components/CopyButton';
import { profileFullText } from './profileFullText';
import { stepDepth } from './stepLayout';
import type { ProfileStep } from '../types/profile';
import type { SXLog } from '../types/xlog';
import { t } from '../../../i18n';
import { Dialog } from '../../../components/Dialog';

interface ProfileTextDialogProps {
  xlog: SXLog;
  steps: readonly ProfileStep[];
  texts: Record<number, string>;
  objName: string;
  serviceName: string;
  onClose: () => void;
}

export const ProfileTextDialog = memo(function ProfileTextDialog({
  xlog,
  steps,
  texts,
  objName,
  serviceName,
  onClose,
}: ProfileTextDialogProps) {
  // 긴 줄을 접을지. SQL 이 길면 가로로 한참 가는데, 보고서에 넣기 전에
  // **실제로 어떤 모양인지** 보려면 접지 않은 쪽이 맞다. 기본은 접지 않는다.
  const [wrap, setWrap] = useState(false);

  const body = useMemo(() => {
    const parents = steps.map(s => (s.kind === 'Unknown' ? -1 : s.parent));
    return profileFullText({
      xlog,
      steps,
      texts,
      objName,
      serviceName,
      // 목록이 쓰는 것과 **같은 계산**이다. 다르면 화면의 들여쓰기와 전문이 어긋난다.
      depths: steps.map((_, i) => stepDepth(parents, i)),
    });
  }, [xlog, steps, texts, objName, serviceName]);

  return (
    <Dialog
      onClose={onClose}
      widthClass="w-full max-w-5xl"
      bodyClassName="flex flex-col"
      ariaLabel={t('프로파일 전문')}
      title={
        <>
          <span className="min-w-0 truncate text-base font-medium text-fg" title={serviceName}>
            {t('프로파일 전문')}
          </span>
          <span className="min-w-0 truncate font-mono text-micro text-fg-dim">{serviceName}</span>
        </>
      }
      headerExtra={
        <>
          <span className="shrink-0 font-mono text-micro text-fg-faint">
            {steps.length.toLocaleString()}
            {t('개 스텝')}
          </span>
        </>
      }
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <button
          type="button"
          onClick={() => setWrap(w => !w)}
          aria-pressed={wrap}
          className="btn px-2 py-0.5 text-micro"
        >
          {t('긴 줄 접기')}
        </button>
        <CopyButton text={body} />
      </div>

      <pre
        className={`min-h-0 flex-1 overflow-auto bg-base px-4 py-3 font-mono text-small leading-relaxed text-fg ${
          wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre'
        }`}
      >
        {body}
      </pre>
    </Dialog>
  );
});
