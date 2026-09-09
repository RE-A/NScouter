// 섹션 머리의 약속.
//
// 여덟 군데가 손으로 다시 적던 것을 한곳으로 모은 이유는 «어디를 눌러야 열리나» 를
// 화면마다 다시 배우지 않게 하려는 것이다. 그 약속을 여기서 지킨다.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SectionHeader } from './SectionHeader';

describe('SectionHeader', () => {
  it('안 접히는 섹션에는 버튼이 없다', () => {
    // 눌러도 아무 일 없는 제목은 없느니만 못하다.
    render(<SectionHeader title="서버별" subtitle="3대" />);
    expect(screen.getByRole('heading', { name: '서버별' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('접이식이면 제목 자체가 여는 버튼이다', () => {
    // 오른쪽 끝의 «열기/닫기» 글자 버튼과 제목 옆 화살표가 섞여 있었다.
    const onToggle = vi.fn();
    render(<SectionHeader title="토폴로지" open={false} onToggle={onToggle} />);

    const button = screen.getByRole('button', { name: '토폴로지' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('펼친 상태를 화면이 말한다', () => {
    render(<SectionHeader title="요약" open onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: '요약' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('부제가 없으면 자리를 만들지 않는다', () => {
    // 빈 칸이라도 자리를 잡으면 제목과 오른쪽 액션 사이가 섹션마다 달라진다.
    const { container } = render(<SectionHeader title="요약" />);
    expect(container.querySelectorAll('span')).toHaveLength(0);
  });

  it('오른쪽 액션은 그대로 놓는다', () => {
    render(<SectionHeader title="지금" action={<button>임계값</button>} />);
    expect(screen.getByRole('button', { name: '임계값' })).toBeTruthy();
  });
});
