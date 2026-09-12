// 설정 화면 — 에이전트 · 콜렉터 공용
//
// 원문에 되돌려 넣는 규칙은 `configEdits.test.ts`, 카탈로그 결합은 `settingsModel.test.ts` 가 맡는다.
// 여기서 보는 것은 화면의 약속이다:
//   · 한국어 이름이 제목이고, 공식 원문이 늘 같이 보인다
//   · 구역을 고르면 그 구역만, 찾으면 걸린 것 전부
//   · 틀린 값이 있으면 저장하지 않는다 — 서버는 조용히 기본값을 쓴다
//   · 저장 전에 무엇이 바뀌는지 보여 주고, **원문 전체**를 보낸다 (F-40)

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { SettingsForm } from './SettingsForm';
import type { ConfigEntry, ConfigView } from '../xlog/types/config';

function entry(key: string, value: string, dflt: string, valueType = 0): ConfigEntry {
  return { key, value, default: dflt, changed: value !== dflt, desc: '', value_type: valueType };
}

const DATA: ConfigView = {
  text: '# 운영\nnet_collector_ip=10.0.0.5\nprofile_sql_escape_enabled=false\n',
  entries: [
    entry('net_collector_ip', '10.0.0.5', '127.0.0.1', 1),
    entry('net_collector_tcp_port', '6100', '6100', 2),
    entry('profile_sql_escape_enabled', 'false', 'true', 3),
    entry('_trace', 'false', 'false', 3),
    entry('my_plugin_option', 'x', 'x', 1),
  ],
};

function draw(
  o: {
    query?: string;
    changedOnly?: boolean;
    showInternal?: boolean;
    save?: Mock<(text: string) => Promise<void>>;
  } = {},
) {
  const save = o.save ?? vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  const onSaved = vi.fn();
  render(
    <SettingsForm
      scope="java"
      data={DATA}
      targetName="/h/shop-app"
      save={save}
      onSaved={onSaved}
      query={o.query ?? ''}
      changedOnly={o.changedOnly ?? false}
      showInternal={o.showInternal ?? false}
    />,
  );
  return { save, onSaved };
}

const nav = () => within(screen.getByRole('navigation', { name: '설정 구역' }));

describe('SettingsForm — 보기', () => {
  it('한국어 이름이 제목이고 키와 공식 원문이 같이 보인다', () => {
    // 번역을 믿으라고 하지 않는다 — 원문이 바로 밑에 있으면 어긋남을 사용자가 잡는다.
    draw();
    expect(screen.getByText('콜렉터 IP')).toBeTruthy();
    expect(screen.getByText('net_collector_ip')).toBeTruthy();
    expect(screen.getByText(/공식: Collector IP$/)).toBeTruthy();
  });

  it('구역 목록이 있고, 첫 구역만 보인다', () => {
    // 300개를 한 줄로 늘어놓으면 설정 파일을 훑는 것과 다를 게 없다.
    draw();
    expect(nav().getByRole('button', { name: /네트워크/ })).toBeTruthy();
    expect(nav().getByRole('button', { name: /프로파일/ })).toBeTruthy();
    expect(screen.queryByText('SQL 리터럴 이스케이프')).toBeNull();
  });

  it('구역을 누르면 그 구역으로 간다', () => {
    draw();
    fireEvent.click(nav().getByRole('button', { name: /프로파일/ }));
    expect(screen.getByText('SQL 리터럴 이스케이프')).toBeTruthy();
    expect(screen.queryByText('콜렉터 IP')).toBeNull();
  });

  it('공식 문서에 없는 항목은 «기타» 에 키 이름으로 뜬다', () => {
    // 버리면 플러그인이 쓰는 설정을 이 화면에서 못 고친다.
    draw();
    fireEvent.click(nav().getByRole('button', { name: /기타/ }));
    expect(screen.getAllByText('my_plugin_option').length).toBeGreaterThan(0);
    expect(screen.getByText('공식 설명 없음')).toBeTruthy();
  });

  it('찾으면 구역을 넘어 걸린 것을 전부 보여 준다', () => {
    // 한 구역만 보여 주면 «찾았는데 왜 안 보이나» 가 된다.
    draw({ query: '이스케이프' });
    expect(screen.getByText('SQL 리터럴 이스케이프')).toBeTruthy();
    expect(screen.queryByText('콜렉터 IP')).toBeNull();
  });

  it('내부 항목은 접어 둔다', () => {
    draw({ query: 'trace' });
    expect(screen.queryByText('_trace')).toBeNull();
  });

  it('기본값과 다른 항목에는 표시가 붙는다', () => {
    draw();
    expect(screen.getAllByText('기본값과 다름').length).toBeGreaterThan(0);
  });
});

describe('SettingsForm — 고치기', () => {
  it('고치기 전에는 저장 줄이 없다', () => {
    draw();
    expect(screen.queryByRole('button', { name: '저장…' })).toBeNull();
  });

  it('숫자 칸에 글자가 들어가면 저장하지 않는다', () => {
    // 서버는 파싱에 실패하면 **조용히** 기본값을 쓴다 — 저장은 됐는데 설정은 안 먹는다.
    draw();
    fireEvent.change(screen.getByLabelText('net_collector_tcp_port'), { target: { value: 'abc' } });
    expect(screen.getByText('정수만 넣을 수 있습니다')).toBeTruthy();
    expect((screen.getByRole('button', { name: '저장…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('구역 목록에 저장하지 않은 바뀜 수가 뜬다', () => {
    // 다른 구역으로 넘어가도 «어디를 고쳤나» 가 목록에 남아야 한다.
    draw();
    fireEvent.change(screen.getByLabelText('net_collector_ip'), { target: { value: '10.0.0.9' } });
    expect(nav().getByTitle('저장하지 않은 바뀜').textContent).toBe('1');
  });

  it('도로 원래 값으로 돌리면 바뀜이 아니다', () => {
    draw();
    const input = screen.getByLabelText('net_collector_ip');
    fireEvent.change(input, { target: { value: '10.0.0.9' } });
    fireEvent.change(input, { target: { value: '10.0.0.5' } });
    expect(screen.queryByRole('button', { name: '저장…' })).toBeNull();
  });
});

describe('SettingsForm — 저장', () => {
  it('저장 전에 무엇이 바뀌는지 한국어 이름과 함께 보여 준다', () => {
    const { save } = draw();
    fireEvent.change(screen.getByLabelText('net_collector_ip'), { target: { value: '10.0.0.9' } });
    fireEvent.click(screen.getByRole('button', { name: '저장…' }));

    expect(screen.getByText('값 바꿈')).toBeTruthy();
    expect(screen.getAllByText('10.0.0.9').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '덮어쓰기' })).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it('원문 전체를 보낸다 — 바꾼 줄만 갈아 끼운 채로', async () => {
    // 한 줄만 보내면 나머지 설정이 전부 사라진다 (F-40).
    const { save, onSaved } = draw();
    fireEvent.change(screen.getByLabelText('net_collector_ip'), { target: { value: '10.0.0.9' } });
    fireEvent.click(screen.getByRole('button', { name: '저장…' }));
    fireEvent.click(screen.getByRole('button', { name: '덮어쓰기' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith('# 운영\nnet_collector_ip=10.0.0.9\nprofile_sql_escape_enabled=false\n');
  });

  it('기본값으로 되돌리면 그 줄을 지운 원문을 보낸다', async () => {
    // 기본값을 박아 두지 않는다 — 판이 올라가 기본값이 바뀌면 따라가게.
    const { save } = draw();
    fireEvent.click(screen.getAllByRole('button', { name: '기본값으로' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '저장…' }));
    expect(screen.getByText('줄 지움 → 기본값')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '덮어쓰기' }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).not.toContain('net_collector_ip');
    expect(save.mock.calls[0][0]).toContain('profile_sql_escape_enabled=false');
  });

  it('저장이 실패하면 고친 것을 버리지 않는다', async () => {
    const save = vi.fn<(text: string) => Promise<void>>().mockRejectedValue('권한 없음');
    const { onSaved } = draw({ save });
    fireEvent.change(screen.getByLabelText('net_collector_ip'), { target: { value: '10.0.0.9' } });
    fireEvent.click(screen.getByRole('button', { name: '저장…' }));
    fireEvent.click(screen.getByRole('button', { name: '덮어쓰기' }));

    await waitFor(() => expect(screen.getByText('권한 없음')).toBeTruthy());
    expect(onSaved).not.toHaveBeenCalled();
    expect((screen.getByLabelText('net_collector_ip') as HTMLInputElement).value).toBe('10.0.0.9');
  });
});
