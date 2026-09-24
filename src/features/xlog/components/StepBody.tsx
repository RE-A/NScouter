// 스텝 본문 — **긴 것을 한 줄로 자르고 툴팁에 밀어 넣지 않는다.**
//
// 지금까지 긴 본문은 `truncate` + `title` 이었다. 마우스를 올리면 수천 자짜리 XML 이
// 툴팁으로 펼쳐져 화면을 덮고, 그 안에서는 고를 수도 복사할 수도 없다.
//
// SQL 은 바인딩·행수 같은 제 것이 있어 `ProfileStepList` 의 `SqlBody` 가 따로 맡는다.
// 여기는 **그 밖의 모든 종류**(메시지·API·메서드)가 같은 방식으로 열리게 하는 자리다.

import { memo, useLayoutEffect, useRef, useState } from 'react';
import { CopyButton } from '../../../components/CopyButton';
import { StepDetailDialog } from './StepDetailDialog';
import { t } from '../../../i18n';

/**
 * 이보다 길면 접는다.
 *
 * 글자 수로 정하는 것은 **접을지 말지**뿐이다. 실제로 몇 줄이 되는지는 패널 폭에
 * 달렸으므로 «펼치기» 를 띄울지는 재서 정한다 (`overflows`).
 */
export const LONG_BODY = 120;

interface StepBodyProps {
  /** 배지에 적을 종류 글자. 전체 보기 창에 그대로 넘긴다 */
  kind: string;
  /** 창 제목에 쓸 짧은 이름 */
  title: string;
  body: string;
  /** 글자색 — 스텝 종류에 따라 부르는 쪽이 정한다 */
  tone?: string;
  /**
   * 검색으로 짚은 줄인가. 짚으면 펼친다 — 걸린 글자가 접힘 아래 있으면
   * 줄로 스크롤해도 여전히 안 보인다.
   */
  revealed?: boolean;
}

export const StepBody = memo(function StepBody({
  kind,
  title,
  body,
  tone = 'text-fg',
  revealed = false,
}: StepBodyProps) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [full, setFull] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (expanded) return;
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [body, expanded]);

  useLayoutEffect(() => {
    if (revealed && overflows) setExpanded(true);
  }, [revealed, overflows]);

  return (
    <div className="min-w-0">
      {/* **`block` 과 `line-clamp` 를 같이 쓰면 안 된다** — 둘 다 display 를 정하는데
          line-clamp 는 `-webkit-box` 여야 듣는다. 접기는 리터럴 클래스로만 쓴다. */}
      <span
        ref={ref}
        className={`text-small ${tone} ${
          expanded ? 'block break-all whitespace-pre-wrap' : 'line-clamp-2 break-all'
        }`}
      >
        {body}
      </span>

      <div className="flex items-baseline gap-0.5">
        {overflows && (
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              setExpanded(v => !v);
            }}
            aria-expanded={expanded}
            className="rounded px-1 text-micro text-fg-faint hover:bg-hover hover:text-fg"
          >
            {expanded ? t('접기') : `${t('펼치기')} (${body.length.toLocaleString()}${t('자')})`}
          </button>
        )}
        {/* 정렬·검색·긴 본문은 창에서 본다. 목록 안에서 다 하려 들면 한 스텝이
            화면을 다 먹는다. */}
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            setFull(true);
          }}
          className="rounded px-1 text-micro text-fg-faint hover:bg-hover hover:text-fg"
        >
          {t('전문 보기')}
        </button>
        <CopyButton text={body} />
      </div>

      {full && (
        <StepDetailDialog kind={kind} title={title} body={body} onClose={() => setFull(false)} />
      )}
    </div>
  );
});
