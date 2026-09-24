// 본문 전체 보기 — **길다고 못 읽게 두지 않는가.**
//
// SAP PO 어댑터의 payload 처럼 XML 한 통이 실려 오는 스텝이 있다. 지금까지 그건
// 한 줄로 잘리고 hover 툴팁에만 전문이 있었다 — 고를 수도 복사할 수도 없었다.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StepDetailDialog } from './StepDetailDialog';

const XML = '<r><a>hello</a><b>hello world</b></r>';

function open(body = XML) {
  const onClose = vi.fn();
  render(<StepDetailDialog kind="MESSAGE" title="RECEIVER_PAYLOAD" body={body} onClose={onClose} />);
  return { onClose, dialog: () => within(screen.getByRole('dialog')) };
}

describe('본문 전체 보기', () => {
  it('XML 이면 정렬해서 연다', () => {
    const { dialog } = open();
    // 접힌 한 줄이 아니라 태그마다 줄이 나뉘어 있어야 «어디에 무엇이 있나» 가 읽힌다.
    expect(dialog().getByText(/<a>hello<\/a>/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '정렬해 보기' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('원문으로 돌아갈 수 있다', () => {
    // 나눈 모양이 미덥지 않을 때 실제로 오간 글자를 볼 방법이 있어야 근거로 쓸 수 있다.
    const { dialog } = open();
    fireEvent.click(screen.getByRole('button', { name: '정렬해 보기' }));
    expect(dialog().getByText(XML)).toBeTruthy();
  });

  it('나눌 수 없는 본문에는 정렬 단추를 안 띄운다', () => {
    // 누르면 아무 일도 안 일어나는 단추는 없느니만 못하다.
    open('[driving thread] MS Queue Worker');
    expect(screen.queryByRole('button', { name: '정렬해 보기' })).toBeNull();
  });

  it('본문 안에서 찾고 몇 번째인지 말한다', () => {
    const { dialog } = open();
    fireEvent.change(screen.getByLabelText('본문에서 찾기'), { target: { value: 'hello' } });
    expect(dialog().getByText('1/2')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('다음 적중'));
    expect(dialog().getByText('2/2')).toBeTruthy();

    // 끝에서 한 번 더 누르면 처음으로 돈다 — 막다른 길에서 멈추면 다시 칠 수밖에 없다.
    fireEvent.click(screen.getByLabelText('다음 적중'));
    expect(dialog().getByText('1/2')).toBeTruthy();
  });

  it('못 찾으면 «없음» 이라고 적는다', () => {
    const { dialog } = open();
    fireEvent.change(screen.getByLabelText('본문에서 찾기'), { target: { value: 'zzz' } });
    expect(dialog().getByText('없음')).toBeTruthy();
    expect(screen.queryByLabelText('다음 적중')).toBeNull();
  });

  it('길이를 적는다 — 원문 기준이다', () => {
    const { dialog } = open();
    // 정렬하면 들여쓰기가 붙어 글자 수가 늘어난다. 화면이 말하는 것은 **받은 본문**의 크기다.
    expect(dialog().getByText(`${XML.length.toLocaleString()}자`)).toBeTruthy();
  });

  it('Esc 로 닫는다', () => {
    const { onClose } = open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
