// 서버 프로필의 계약
//
// 여기서 지키려는 것:
//   · 설정 파일이 무엇을 담고 있어도 목록이 망가지지 않는다 (사람이 여는 파일이다)
//   · 껐다 켤 때마다 같은 서버가 하나씩 늘지 않는다
//   · «비밀번호 저장 안 함» 이 접속했다고 조용히 뒤집히지 않는다
//   · 예전 설정(last_host)으로 붙던 서버를 잃지 않는다

import { describe, expect, it } from 'vitest';
import { displayName, fromLegacy, normalize, pick, upsert } from './serverProfiles';
import type { ServerProfile } from '../api/scouterApi';

const p = (over: Partial<ServerProfile> = {}): ServerProfile => ({
  name: '', host: '10.0.0.1', port: 6100, user: 'admin', pass: '', ...over,
});

describe('displayName', () => {
  it('이름이 없으면 host:port 로 보인다', () => {
    // «(이름 없음)» 이 늘어서면 고를 수가 없다.
    expect(displayName(p())).toBe('10.0.0.1:6100');
    expect(displayName(p({ name: '운영' }))).toBe('운영');
  });
});

describe('normalize', () => {
  it('호스트가 없는 줄은 버린다', () => {
    expect(normalize([{ host: '' }, { host: 'a' }])).toHaveLength(1);
  });

  it('배열이 아니면 빈 목록이다', () => {
    expect(normalize(null)).toEqual([]);
    expect(normalize('nope')).toEqual([]);
  });

  it('포트가 이상하면 기본값으로 돌린다', () => {
    expect(normalize([{ host: 'a', port: 0 }])[0].port).toBe(6100);
    expect(normalize([{ host: 'a', port: 99999 }])[0].port).toBe(6100);
    expect(normalize([{ host: 'a', port: 6200 }])[0].port).toBe(6200);
  });

  it('이름이 겹치면 뒤에 온 것에 번호를 붙인다', () => {
    // 같은 이름 둘이면 무엇을 고른 건지 알 수 없다.
    const out = normalize([{ host: 'a', name: '운영' }, { host: 'b', name: '운영' }]);
    expect(out.map(displayName)).toEqual(['운영', '운영 (2)']);
  });
});

describe('upsert', () => {
  it('같은 대상이면 늘리지 않는다', () => {
    // 껐다 켤 때마다 하나씩 늘면 목록이 금방 못 쓰게 된다.
    const list = [p({ name: '운영' })];
    const out = upsert(list, p(), { savePass: false });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('운영'); // 사용자가 지은 이름이 이긴다
  });

  it('다른 대상이면 더한다', () => {
    const out = upsert([p()], p({ host: '10.0.0.2' }), { savePass: false });
    expect(out).toHaveLength(2);
  });

  it('저장 안 함이면 비밀번호를 담지 않는다', () => {
    const out = upsert([], p({ pass: 'secret' }), { savePass: false });
    expect(out[0].pass).toBe('');
  });

  it('저장하기로 했으면 담는다', () => {
    const out = upsert([], p({ pass: 'secret' }), { savePass: true });
    expect(out[0].pass).toBe('secret');
  });

  it('저장 안 함이 접속으로 뒤집히지 않는다', () => {
    const list = [p({ name: '운영', pass: '' })];
    const out = upsert(list, p({ pass: 'typed-now' }), { savePass: false });
    expect(out[0].pass).toBe('');
  });
});

describe('pick', () => {
  it('이름으로 고른다', () => {
    const list = [p({ name: 'a' }), p({ name: 'b', host: '10.0.0.2' })];
    expect(pick(list, 'b')?.host).toBe('10.0.0.2');
  });

  it('없는 이름이면 첫 번째로 떨어진다', () => {
    // 지워진 프로필 이름이 설정에 남아 있어도 접속은 되어야 한다.
    const list = [p({ name: 'a' })];
    expect(pick(list, '사라진것')?.name).toBe('a');
  });

  it('목록이 비면 null', () => {
    expect(pick([], 'a')).toBeNull();
  });
});

describe('fromLegacy', () => {
  it('예전 설정으로 프로필 하나를 만든다', () => {
    const out = fromLegacy({ last_host: '10.0.0.9', last_port: 6200, last_user: 'u', last_pass: 'p' });
    expect(out).toEqual([{ name: '', host: '10.0.0.9', port: 6200, user: 'u', pass: 'p' }]);
  });

  it('붙던 곳이 없으면 빈 목록이다', () => {
    expect(fromLegacy({})).toEqual([]);
    expect(fromLegacy({ last_host: '  ' })).toEqual([]);
  });
});
