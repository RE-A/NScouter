// 알림 배지·패널의 계약
//
// **파싱은 L4 로 검증됐지만 화면은 그동안 테스트가 없었다**(testing-strategy 의 공백 표).
// 알림은 «장애가 났다» 를 말하는 자리라, 조용히 틀리면 가장 늦게 알아챈다.
//
// 여기서 지키려는 것:
//   · 안 읽은 수를 배지가 말한다. 99 를 넘으면 «99+»
//   · 목록을 여기서 따로 모으지 않는다 — 앱이 쥔 버퍼를 그대로 그린다
//   · 레벨·시각·제목·본문이 다 보인다 (하나라도 빠지면 무슨 알림인지 못 읽는다)
//   · 배지에 외부 동작(탭 이동)이 걸려 있으면 드롭다운을 열지 않는다

import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertPanel } from './AlertPanel';
import type { AlertPack } from '../types/alert';

const alert = (over: Partial<AlertPack> = {}): AlertPack =>
  ({
    time: new Date(2026, 8, 2, 14, 3, 7).getTime(),
    level: 3,
    objType: 'tomcat',
    objHash: 11,
    title: 'INACTIVE_OBJECT',
    message: 'order-app 이 응답하지 않습니다',
    ...over,
  }) as AlertPack;

function panel(over: Partial<Parameters<typeof AlertPanel>[0]> = {}) {
  const onClear = vi.fn();
  const onMarkRead = vi.fn();
  render(
    <AlertPanel
      alerts={[alert()]}
      unread={1}
      onClear={onClear}
      onMarkRead={onMarkRead}
      {...over}
    />,
  );
  return { onClear, onMarkRead };
}

afterEach(() => vi.clearAllMocks());

describe('AlertPanel — 배지', () => {
  it('안 읽은 수를 적는다', () => {
    panel({ unread: 7 });
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('99 를 넘으면 99+ 로 적는다', () => {
    // 세 자리가 넘어가면 배지가 커져 옆 컨트롤을 민다.
    panel({ unread: 250 });
    expect(screen.getByText('99+')).toBeTruthy();
  });

  it('안 읽은 것이 없으면 숫자를 띄우지 않는다', () => {
    panel({ unread: 0 });
    expect(screen.queryByText('0')).toBeNull();
  });
});

describe('AlertPanel — 목록', () => {
  it('열면 레벨·시각·제목·본문이 다 보인다', () => {
    panel();
    fireEvent.click(screen.getByTitle('알림'));

    expect(screen.getByText('ERROR')).toBeTruthy();
    expect(screen.getByText('14:03:07')).toBeTruthy();
    expect(screen.getByText('INACTIVE_OBJECT')).toBeTruthy();
    expect(screen.getByText(/응답하지 않습니다/)).toBeTruthy();
  });

  it('열 때 읽음으로 표시한다', () => {
    const { onMarkRead } = panel();
    fireEvent.click(screen.getByTitle('알림'));
    expect(onMarkRead).toHaveBeenCalled();
  });

  it('받은 목록을 그대로 그린다 — 여기서 따로 모으지 않는다', () => {
    // 여기서 모으면 Alert 탭과 어긋난다. 버퍼는 앱이 하나만 쥔다.
    panel({ alerts: [alert({ title: 'A' }), alert({ title: 'B' })], unread: 2 });
    fireEvent.click(screen.getByTitle('알림'));

    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('B')).toBeTruthy();
  });

  it('비어 있으면 없다고 말한다', () => {
    panel({ alerts: [], unread: 0 });
    fireEvent.click(screen.getByTitle('알림'));
    expect(screen.getByText('알림 없음')).toBeTruthy();
  });

  it('Clear 를 누르면 지우기를 올린다', () => {
    const { onClear } = panel();
    fireEvent.click(screen.getByTitle('알림'));
    fireEvent.click(screen.getByText('Clear'));
    expect(onClear).toHaveBeenCalled();
  });
});

describe('AlertPanel — 배지에 다른 동작이 걸린 경우', () => {
  it('드롭다운 대신 그 동작만 부른다', () => {
    // 헤더 배지는 Alert 탭으로 데려간다. 그때 드롭다운까지 열리면 두 번 보게 된다.
    const onBadgeClick = vi.fn();
    render(
      <AlertPanel
        alerts={[alert()]}
        unread={1}
        onClear={vi.fn()}
        onMarkRead={vi.fn()}
        onBadgeClick={onBadgeClick}
      />,
    );
    fireEvent.click(screen.getByTitle('알림'));

    expect(onBadgeClick).toHaveBeenCalled();
    expect(screen.queryByText('INACTIVE_OBJECT')).toBeNull();
  });
});
