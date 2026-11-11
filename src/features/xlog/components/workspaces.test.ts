// 작업 공간(이름 붙인 서버 묶음)의 계약
//
// 여기서 지키려는 것:
//   · 묶음은 서버를 **이름으로** 가리킨다 — 서버 이름을 바꾸거나 지우면 묶음도 따라간다
//   · 하나 남은 묶음은 없앤다 (그 서버 한 대와 같다)
//   · 빠진 서버·비밀번호 없는 서버가 있으면 «바로 붙을 수 없다» 고 말한다

import { describe, expect, it } from 'vitest';
import type { ServerProfile, Workspace } from '../api/scouterApi';
import {
  dropMember,
  isReady,
  matchWorkspace,
  normalizeWorkspaces,
  removeWorkspace,
  renameMember,
  resolveWorkspace,
  upsertWorkspace,
} from './workspaces';

const p = (name: string, pass = 'x'): ServerProfile => ({ name, host: `${name}.local`, port: 6100, user: 'admin', pass });
const ws = (name: string, ...servers: string[]): Workspace => ({ name, servers });

describe('normalizeWorkspaces', () => {
  it('못 쓸 줄은 버린다 — 이름 없음, 서버 둘 미만, 겹친 이름', () => {
    const got = normalizeWorkspaces([
      ws('운영', 'A', 'B'),
      ws('', 'A', 'B'),
      ws('혼자', 'A'),
      ws('운영', 'C', 'D'),
      { name: '중복', servers: ['A', 'A', 'B', 3, ''] },
      null,
      'x',
    ]);
    expect(got).toEqual([ws('운영', 'A', 'B'), ws('중복', 'A', 'B')]);
  });

  it('목록이 아니면 빈 목록', () => {
    expect(normalizeWorkspaces(undefined)).toEqual([]);
    expect(normalizeWorkspaces({})).toEqual([]);
  });
});

describe('upsertWorkspace · removeWorkspace', () => {
  it('새 이름은 끝에 넣고, 있는 이름은 그 자리에서 갈아 끼운다', () => {
    const a = upsertWorkspace([ws('운영', 'A', 'B')], 'QA', ['C', 'D']);
    expect(a.map(w => w.name)).toEqual(['운영', 'QA']);
    const b = upsertWorkspace(a, '운영', ['A', 'B', 'C']);
    expect(b).toEqual([ws('운영', 'A', 'B', 'C'), ws('QA', 'C', 'D')]);
  });

  it('이름이 비었거나 서버가 둘 미만이면 아무것도 안 한다', () => {
    const base = [ws('운영', 'A', 'B')];
    expect(upsertWorkspace(base, '  ', ['A', 'B'])).toEqual(base);
    expect(upsertWorkspace(base, 'X', ['A'])).toEqual(base);
  });

  it('지운다', () => {
    expect(removeWorkspace([ws('운영', 'A', 'B'), ws('QA', 'C', 'D')], '운영')).toEqual([ws('QA', 'C', 'D')]);
  });
});

describe('서버 이름이 바뀌거나 지워질 때', () => {
  it('이름을 바꾸면 묶음이 가리키는 이름도 옮긴다', () => {
    expect(renameMember([ws('운영', 'A', 'B'), ws('QA', 'C', 'D')], 'B', 'B2')).toEqual([ws('운영', 'A', 'B2'), ws('QA', 'C', 'D')]);
  });

  it('서버를 지우면 묶음에서도 빠지고, 하나 남은 묶음은 없어진다', () => {
    const got = dropMember([ws('셋', 'A', 'B', 'C'), ws('둘', 'A', 'B')], 'B');
    expect(got).toEqual([ws('셋', 'A', 'C')]);
  });
});

describe('resolveWorkspace', () => {
  it('묶음 순서대로 프로필을 준다 — 앞의 것이 주 콜렉터다', () => {
    const r = resolveWorkspace(ws('운영', 'B', 'A'), [p('A'), p('B')]);
    expect(r.profiles.map(x => x.name)).toEqual(['B', 'A']);
    expect(isReady(r)).toBe(true);
  });

  it('목록에 없는 서버가 있으면 붙을 수 없다', () => {
    const r = resolveWorkspace(ws('운영', 'A', 'B', '없는것'), [p('A'), p('B')]);
    expect(r.missing).toEqual(['없는것']);
    expect(isReady(r)).toBe(false);
  });

  it('비밀번호 없는 서버는 가려 말하되 붙을 수는 있다 — 붙을 때 묻는다', () => {
    const r = resolveWorkspace(ws('운영', 'A', 'B'), [p('A'), p('B', '')]);
    expect(r.noPass).toEqual(['B']);
    expect(r.profiles.map(x => x.name)).toEqual(['A', 'B']);
    expect(isReady(r)).toBe(true);
  });
});

describe('matchWorkspace', () => {
  const list = [ws('운영', 'A', 'B'), ws('QA', 'C', 'D')];

  it('붙어 있는 서버들과 구성원·순서가 같은 묶음의 이름', () => {
    expect(matchWorkspace(list, ['A', 'B'])).toBe('운영');
  });

  it('순서가 다르면 다른 접속이다 — 주 콜렉터가 다르다', () => {
    expect(matchWorkspace(list, ['B', 'A'])).toBeNull();
  });

  it('하나만 붙어 있으면 묶음이 아니다', () => {
    expect(matchWorkspace(list, ['A'])).toBeNull();
  });
});
