// 긴 본문을 창으로 — **어느 화면에서 누르든 같은 창이 열린다.**
//
// 프로파일의 같은 데이터가 세 곳에 나온다: 스텝 목록 · 요약 · 흐름 보기.
// 목록에서만 전문을 볼 수 있으면 «요약에서 긴 SQL 을 보려면 목록으로 돌아가야 한다» 가
// 된다. 창을 여는 자리를 한 곳으로 모아, 어디서 눌러도 같은 정렬·검색·복사를 쓴다.
//
// **짧으면 아무것도 안 그린다.** 한 줄에 다 보이는 것 옆에 단추가 붙으면 목록이
// 시끄러워진다 — 누를 이유가 없는 단추가 수백 개 생긴다.

import { memo, useState } from 'react';
import { StepDetailDialog } from './StepDetailDialog';
import { LONG_BODY } from './StepBody';
import { t } from '../../../i18n';

interface FullTextButtonProps {
  /** 창 배지에 적을 종류 글자 (`SQL`·`API`·`ERROR`…) */
  kind: string;
  /** 창 제목에 쓸 짧은 이름 */
  title: string;
  body: string;
  /**
   * 이보다 길 때만 그린다. 0 이면 길이와 무관하게 늘 그린다 —
   * 이미 «길어서» 펼침 자리에 놓인 본문이 그렇다.
   */
  min?: number;
  className?: string;
}

export const FullTextButton = memo(function FullTextButton({
  kind,
  title,
  body,
  min = LONG_BODY,
  className = 'rounded px-1 text-micro text-fg-faint hover:bg-hover hover:text-fg',
}: FullTextButtonProps) {
  const [full, setFull] = useState(false);

  if (body.length <= min) return null;

  return (
    <>
      <button
        type="button"
        // 줄 전체가 눌리는 자리(요약·흐름 보기)에 놓인다. 번지면 창을 열려다
        // 엉뚱한 곳으로 이동한다.
        onClick={e => {
          e.stopPropagation();
          setFull(true);
        }}
        className={className}
      >
        {t('전문 보기')}
      </button>

      {full && (
        <StepDetailDialog kind={kind} title={title} body={body} onClose={() => setFull(false)} />
      )}
    </>
  );
});
