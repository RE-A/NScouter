// 복사 버튼 — 프로파일 SQL 과 Active 탭 쿼리 상세가 같이 쓴다.
//
// 원래 ProfileStepList 안에 있던 것을 꺼냈다. 두 벌이 되면 «복사됨» 이 뜨는 시간이나
// 클립보드 거절을 다루는 방식이 화면마다 달라진다.

import { useEffect, useState } from 'react';
import { t } from '../i18n';

/**
 * 눌러서 클립보드로. 복사했다는 것을 **버튼 자신이** 잠깐 말한다.
 *
 * 토스트를 띄우지 않는 이유: 프로파일 한 판에 스텝이 수백 개라 어느 줄에서 눌렀는지가
 * 중요한데, 화면 한가운데 뜨는 알림은 그걸 말해 주지 못한다.
 */
export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1200);
    return () => clearTimeout(id);
  }, [done]);

  return (
    <button
      type="button"
      onClick={e => {
        // 행 클릭(상세 열기)까지 번지면 복사하려다 다른 창이 뜬다.
        e.stopPropagation();
        // 클립보드는 거절될 수 있다(권한·포커스). 실패하면 조용히 둔다 —
        // 여기서 에러를 띄우면 프로파일 읽기가 끊긴다.
        void navigator.clipboard?.writeText(text).then(() => setDone(true)).catch(() => {});
      }}
      title={t('이 문장을 클립보드로 복사합니다')}
      className="mt-0.5 rounded px-1 text-micro text-fg-faint hover:bg-hover hover:text-fg"
    >
      {done ? t('복사됨') : t('복사')}
    </button>
  );
}
