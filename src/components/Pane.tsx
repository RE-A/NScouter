// 분할 레이아웃의 패널 한 칸
//
// 끌어 옮기기도, 8방향 리사이즈도 없다 — 크기는 경계(Divider)로만 조정한다.
// 자유 배치를 쓰던 시절에는 패널이 서로 겹쳐 z 순서를 관리해야 했고,
// 절대 좌표라 창 밖으로 나가 잘리는 문제가 반복됐다.

import React from 'react';

interface PaneProps {
  /** 없으면 제목 줄을 안 그린다 — 안의 것이 제 머리를 갖고 있을 때(XLog 판은 탭 줄이 머리다) */
  title?: string;
  children: React.ReactNode;
  /** 타이틀바 오른쪽에 놓을 보조 요소 (개수, 닫기 등) */
  aside?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function Pane({ title, children, aside, className = '', style }: PaneProps) {
  return (
    <section
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded border border-line bg-raised ${className}`}
      style={style}
    >
      {title !== undefined && (
        <div className="flex h-[26px] shrink-0 items-center justify-between border-b border-line px-2.5">
          {/* 제목은 줄지 않는다. 보조 요소가 길면 그쪽이 잘린다 — 제목이 «트...» 가 되면
              무슨 패널인지부터 잃는다. */}
          <span className="shrink-0 text-micro font-semibold tracking-[0.08em] text-fg-dim uppercase">
            {title}
          </span>
          {aside && <div className="ml-2 flex min-w-0 justify-end">{aside}</div>}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}
