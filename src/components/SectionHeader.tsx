// 섹션 머리.
//
// 같은 머리를 여덟 군데가 손으로 다시 적고 있었다. 클래스가 같아 보여도 **접는 방법이
// 제각각이었다** — 어떤 섹션은 오른쪽 끝의 «열기/닫기» 글자 버튼이었고, 어떤 섹션은
// 제목 옆 화살표였다. 그러면 화면을 옮길 때마다 «이건 어디를 눌러야 열리나» 를
// 다시 배워야 한다.
//
// 자리를 셋으로 굳힌다:
//   왼쪽  제목 (접이식이면 화살표가 붙고, 제목 자체가 여는 버튼이다)
//   가운데 부제 — 조건·개수처럼 **읽고 지나갈** 것
//   오른쪽 액션 — 누를 것. 여기에는 여는 버튼을 두지 않는다
//
// 제목은 본문보다 한 단계 크다. 같은 크기면 섹션이 몇 개인지가 스크롤해야 보인다.

import type { ReactNode } from 'react';

interface SectionHeaderProps {
  /** 이미 `t()` 를 지난 글자. 여기서 번역하지 않는다 — 부르는 쪽이 문맥을 안다 */
  title: string;
  /** 조건·개수·상태처럼 읽고 지나갈 것 */
  subtitle?: ReactNode;
  /**
   * 접이식인가.
   *
   * `undefined` 면 안 접히는 섹션이라 화살표도 버튼도 없다 —
   * 눌러도 아무 일 없는 제목은 없느니만 못하다.
   */
  open?: boolean;
  onToggle?: () => void;
  /** 오른쪽 끝. 누를 것만 둔다 */
  action?: ReactNode;
}

export function SectionHeader({ title, subtitle, open, onToggle, action }: SectionHeaderProps) {
  const collapsible = open !== undefined && onToggle !== undefined;

  return (
    <header className="mb-2 flex items-baseline gap-2 border-b border-line pb-1">
      {collapsible ? (
        <button
          onClick={onToggle}
          aria-expanded={open}
          className="flex shrink-0 items-baseline gap-1.5 text-left"
        >
          {/* `inline-block` 이 있어야 회전이 먹는다 — inline 요소에는 transform 이 안 걸린다 */}
          <span
            aria-hidden
            className={`inline-block text-micro text-fg-dim transition-transform ${
              open ? '' : '-rotate-90'
            }`}
          >
            ▾
          </span>
          <Title>{title}</Title>
        </button>
      ) : (
        <Title>{title}</Title>
      )}

      {subtitle !== undefined && subtitle !== '' && (
        <span className="min-w-0 truncate text-micro text-fg-faint">{subtitle}</span>
      )}

      <div className="flex-1" />
      {action}
    </header>
  );
}

function Title({ children }: { children: ReactNode }) {
  return <h2 className="shrink-0 text-base font-semibold text-fg">{children}</h2>;
}
