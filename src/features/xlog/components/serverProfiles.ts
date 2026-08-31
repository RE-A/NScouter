// 서버 프로필 — 여러 콜렉터를 갈아 가며 보기 위한 순수 로직
//
// **한 번에 한 서버다.** 동시에 두 콜렉터를 보는 것이 아니라, 매번 호스트·계정을
// 다시 치지 않고 **빠르게 갈아타는** 것이 목적이다.
//
// 이름이 곧 식별자다. 사람이 고르는 목록이라 화면에 보이는 이름과 저장된 키가
// 다르면 «어느 것을 고른 건지» 를 코드에서도 화면에서도 설명할 수 없다.

import type { ServerProfile } from '../api/scouterApi';

/** 이름이 비면 `host:port` 를 쓴다. 목록에 «(이름 없음)» 이 늘어서면 고를 수가 없다 */
export function displayName(p: ServerProfile): string {
  const name = p.name.trim();
  if (name !== '') return name;
  return `${p.host}:${p.port}`;
}

/** 같은 서버인가 — 이름이 아니라 **접속 대상**으로 본다 */
export function sameTarget(a: ServerProfile, b: ServerProfile): boolean {
  return a.host === b.host && a.port === b.port && a.user === b.user;
}

/**
 * 설정 파일에서 읽은 목록을 쓸 수 있는 모양으로 다듬는다.
 *
 * 사람이 여는 파일이라 무엇이든 들어올 수 있다. 호스트가 없는 줄은 접속할 수 없으므로
 * 버리고, 이름이 겹치면 **뒤에 온 것에 번호를 붙인다** — 같은 이름 둘이 목록에 있으면
 * 무엇을 고른 건지 알 수 없다.
 */
export function normalize(list: unknown): ServerProfile[] {
  if (!Array.isArray(list)) return [];

  const out: ServerProfile[] = [];
  const used = new Set<string>();

  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Partial<ServerProfile>;
    const host = typeof r.host === 'string' ? r.host.trim() : '';
    if (host === '') continue;

    const port = Number(r.port);
    const profile: ServerProfile = {
      name: typeof r.name === 'string' ? r.name.trim() : '',
      host,
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 6100,
      user: typeof r.user === 'string' ? r.user : '',
      pass: typeof r.pass === 'string' ? r.pass : '',
    };

    let label = displayName(profile);
    if (used.has(label)) {
      let n = 2;
      while (used.has(`${label} (${n})`)) n++;
      label = `${label} (${n})`;
      profile.name = label;
    }
    used.add(label);
    out.push(profile);
  }
  return out;
}

/**
 * 접속한 서버를 목록에 넣거나 갱신한다.
 *
 * **접속 대상이 같으면 새로 만들지 않는다.** 그러지 않으면 껐다 켤 때마다 같은 서버가
 * 하나씩 늘어난다. 이름은 이미 붙여 둔 것을 지키고(사용자가 지은 이름이다),
 * 비밀번호는 새로 받은 것이 있을 때만 갈아 끼운다 — 저장 안 하기로 한 프로필의
 * 빈 비밀번호를 접속했다고 채워 넣으면 «저장 안 함» 이 조용히 뒤집힌다.
 */
export function upsert(
  list: readonly ServerProfile[],
  entry: ServerProfile,
  options: { savePass: boolean },
): ServerProfile[] {
  const next = [...list];
  const idx = next.findIndex(p => sameTarget(p, entry));

  if (idx < 0) {
    next.push({ ...entry, pass: options.savePass ? entry.pass : '' });
    return next;
  }

  const old = next[idx];
  next[idx] = {
    ...old,
    // 이름은 사용자가 지은 것이 이긴다. 비어 있을 때만 새로 받은 것을 쓴다.
    name: old.name.trim() !== '' ? old.name : entry.name,
    pass: options.savePass ? entry.pass : '',
  };
  return next;
}

/** 이름으로 고른다. 없으면 첫 번째, 그것도 없으면 null */
export function pick(
  list: readonly ServerProfile[],
  name: string,
): ServerProfile | null {
  if (list.length === 0) return null;
  return list.find(p => displayName(p) === name) ?? list[0];
}

/**
 * 예전 설정(`last_host`/`last_port`/`last_user`)에서 프로필 하나를 만든다.
 *
 * 프로필 목록이 생기기 전에 쓰던 파일이 그대로 있다. **그 접속 정보를 잃으면 안 된다** —
 * 앱을 올리자마자 «어제까지 붙던 서버» 를 다시 쳐야 하는 것은 퇴보다.
 */
export function fromLegacy(cfg: {
  last_host?: string | null;
  last_port?: number | null;
  last_user?: string | null;
  last_pass?: string | null;
}): ServerProfile[] {
  const host = cfg.last_host?.trim();
  if (!host) return [];
  return [
    {
      name: '',
      host,
      port: cfg.last_port ?? 6100,
      user: cfg.last_user ?? '',
      pass: cfg.last_pass ?? '',
    },
  ];
}
