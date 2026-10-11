// 전문 보기 — **어느 화면에서 누르든 같은 창인가.**
//
// 프로파일의 같은 데이터가 스텝 목록 · 요약 · 흐름 보기 · 에러 스택 네 곳에 나온다.
// 한 곳에서만 전문을 볼 수 있으면 «요약에서 긴 SQL 을 보려면 목록으로 돌아가야 한다»
// 가 된다. 여기서 보는 것은 그 입구가 한 벌인가다.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FullTextButton } from './FullTextButton';
import { ErrorDetail } from './ErrorDetail';
import { ProfileSummaryTable } from './ProfileSummaryTable';
import type { ProfileStep } from '../types/profile';

const LONG = `select ${'c'.repeat(200)} from t`;

describe('전문 보기 단추', () => {
  it('짧으면 그리지 않는다 — 누를 이유 없는 단추가 수백 개 생긴다', () => {
    render(<FullTextButton kind="SQL" title="t" body="select 1" />);
    expect(screen.queryByRole('button', { name: '전문 보기' })).toBeNull();
  });

  it('길면 눌러서 창을 연다', () => {
    render(<FullTextButton kind="SQL" title="t" body={LONG} />);
    fireEvent.click(screen.getByRole('button', { name: '전문 보기' }));
    expect(screen.getByRole('dialog').textContent).toContain('from t');
  });

  it('min=0 이면 길이와 무관하게 그린다 — 이미 길어서 펼침 자리에 온 본문', () => {
    render(<FullTextButton kind="MESSAGE" title="t" body="짧다" min={0} />);
    expect(screen.getByRole('button', { name: '전문 보기' })).toBeTruthy();
  });

  it('줄 전체가 눌리는 자리에서도 창만 연다', () => {
    // 번지면 창을 열려다 목록의 다른 곳으로 이동한다.
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <FullTextButton kind="SQL" title="t" body={LONG} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: '전문 보기' }));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe('에러 스택', () => {
  const stack = `java.lang.NullPointerException: boom\n${Array.from(
    { length: 12 },
    (_, i) => `\tat com.example.Foo.bar${i}(Foo.java:${i})`,
  ).join('\n')}`;

  it('펼치기와 별개로 전문을 창에서 열 수 있다', () => {
    // 펼친 스택은 좁은 칸에서 스크롤될 뿐이라 «어느 프레임에서 터졌나» 를 못 찾는다.
    render(<ErrorDetail text={stack} />);
    fireEvent.click(screen.getByRole('button', { name: '전문 보기' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('NullPointerException');
    expect(dialog.textContent).toContain('Foo.bar11');
  });

  it('한 줄짜리 에러에는 단추를 안 띄운다', () => {
    render(<ErrorDetail text="java.lang.IllegalStateException: closed" />);
    expect(screen.queryByRole('button', { name: '전문 보기' })).toBeNull();
  });
});

describe('요약 탭', () => {
  const sqlStep = (hash: number): ProfileStep => ({
    kind: 'Sql',
    parent: -1,
    index: 0,
    start_time: 0,
    start_cpu: 0,
    hash,
    param: '',
    elapsed: 5,
    error: 0,
    updated: 0,
  });

  it('긴 문장을 툴팁이 아니라 창으로 연다', () => {
    // 요약의 이름은 SQL 문장 통째다. title 에 달면 수천 자짜리 툴팁이 화면을 덮는다.
    render(<ProfileSummaryTable steps={[sqlStep(11)]} texts={{ 11: LONG }} />);

    fireEvent.click(screen.getByRole('button', { name: '전문 보기' }));
    expect(screen.getByRole('dialog').textContent).toContain('from t');
  });
});
