// 작업 공간 — 이름 붙여 둔 서버 묶음의 순수 로직
//
// 시스템별로 콜렉터가 나뉜 곳에서는 늘 같은 몇 대를 함께 본다. 매번 체크해 고르지 않게
// 묶음에 이름을 붙여 두고(«운영 전체»), 골라서 한 번에 붙는다.
//
// **서버는 이름으로 가리킨다** (`displayName`). 접속 정보를 묶음에 한 벌 더 두면 서버 쪽을 고쳤을 때
// 묶음만 옛 값으로 남는다. 대신 서버 이름을 바꾸거나 지울 때 여기도 함께 고쳐야 한다
// (`renameMember` · `dropMember`).

import type { ServerProfile, Workspace } from '../api/scouterApi';
import { displayName } from './serverProfiles';

/** 묶음은 둘부터다 — 하나면 그냥 그 서버다 */
export const MIN_MEMBERS = 2;

/**
 * 설정 파일에서 읽은 목록을 쓸 수 있는 모양으로 다듬는다.
 * 이름이 비었거나 서버가 둘 미만인 줄은 버리고, 이름이 겹치면 **앞의 것**을 남긴다.
 */
export function normalizeWorkspaces(list: unknown): Workspace[] {
  if (!Array.isArray(list)) return [];
  const out: Workspace[] = [];
  const used = new Set<string>();
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Partial<Workspace>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (name === '' || used.has(name)) continue;
    const servers = Array.isArray(r.servers)
      ? [...new Set(r.servers.filter((x): x is string => typeof x === 'string' && x.trim() !== ''))]
      : [];
    if (servers.length < MIN_MEMBERS) continue;
    used.add(name);
    out.push({ name, servers });
  }
  return out;
}

/**
 * 묶음을 넣거나, 같은 이름이 있으면 **그 자리에서** 갈아 끼운다(목록 순서를 지킨다).
 * 이름이 비었거나 서버가 둘 미만이면 원본 그대로다.
 */
export function upsertWorkspace(list: readonly Workspace[], name: string, servers: readonly string[]): Workspace[] {
  const n = name.trim();
  const members = [...new Set(servers)];
  if (n === '' || members.length < MIN_MEMBERS) return [...list];
  const next = [...list];
  const at = next.findIndex(w => w.name === n);
  if (at < 0) next.push({ name: n, servers: members });
  else next[at] = { name: n, servers: members };
  return next;
}

export function removeWorkspace(list: readonly Workspace[], name: string): Workspace[] {
  return list.filter(w => w.name !== name);
}

/** 서버 이름이 바뀌었다 — 묶음이 가리키는 이름도 옮긴다 */
export function renameMember(list: readonly Workspace[], before: string, after: string): Workspace[] {
  if (before === after) return [...list];
  return list.map(w => (w.servers.includes(before) ? { ...w, servers: w.servers.map(s => (s === before ? after : s)) } : w));
}

/**
 * 서버를 목록에서 지웠다 — 묶음에서도 뺀다. **둘 미만이 된 묶음은 없앤다** —
 * 하나 남은 묶음은 그 서버 한 대와 같아 고를 뜻이 없다.
 */
export function dropMember(list: readonly Workspace[], server: string): Workspace[] {
  return list
    .map(w => (w.servers.includes(server) ? { ...w, servers: w.servers.filter(s => s !== server) } : w))
    .filter(w => w.servers.length >= MIN_MEMBERS);
}

/** 묶음을 붙을 수 있는 프로필로 푼 것 */
export interface ResolvedWorkspace {
  /** 묶음 순서대로 (앞의 것이 주 콜렉터) */
  profiles: ServerProfile[];
  /** 서버 목록에 없는 이름 */
  missing: string[];
  /** 비밀번호를 기억하지 않은 서버 — 여럿을 붙이는 중에 하나씩 물을 수 없다 */
  noPass: string[];
}

export function resolveWorkspace(ws: Workspace, profiles: readonly ServerProfile[]): ResolvedWorkspace {
  const out: ResolvedWorkspace = { profiles: [], missing: [], noPass: [] };
  for (const name of ws.servers) {
    const p = profiles.find(x => displayName(x) === name);
    if (!p) out.missing.push(name);
    else if (p.pass === '') out.noPass.push(name);
    else out.profiles.push(p);
  }
  return out;
}

/** 바로 붙을 수 있나 — 빠진 서버도, 비밀번호 없는 서버도 없다 */
export function isReady(r: ResolvedWorkspace): boolean {
  return r.missing.length === 0 && r.noPass.length === 0 && r.profiles.length >= MIN_MEMBERS;
}

/**
 * 지금 붙어 있는 서버들과 **구성원·순서가 같은** 묶음의 이름. 없으면 null.
 * 순서까지 보는 것은 앞의 것이 주 콜렉터라서다 — 순서가 다르면 다른 접속이다
 */
export function matchWorkspace(list: readonly Workspace[], connected: readonly string[]): string | null {
  if (connected.length < MIN_MEMBERS) return null;
  const hit = list.find(w => w.servers.length === connected.length && w.servers.every((s, i) => s === connected[i]));
  return hit?.name ?? null;
}
