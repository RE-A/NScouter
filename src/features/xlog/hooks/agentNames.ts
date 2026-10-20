// 오브젝트 이름은 **목록보다 오래 산다.**
//
// 오브젝트가 목록에서 사라져도 그 오브젝트가 남긴 XLog 는 화면에 그대로 있다.
// 그때 이름을 못 풀면 `#해시` 로 덮이고, 어느 서버의 트랜잭션이었는지 알 수 없게 된다.
//
// 콜렉터는 죽은 오브젝트를 영원히 들고 있지만(F-60), 비활성 정리를 하면 지워진다 —
// 그 정리는 `ObjectWR`(오늘자 오브젝트 DB)까지 건드려서 **오늘 받은 XLog 의 이름이
// 끊긴다.** ASIS 도 같은 이유로 이름만 따로 영구 보관한다
// (`AgentModelThread`: `if (TextProxy.object.getText(objHash) == null) putText(...)`).
//
// **모듈 저장소다.** 앱에 하나뿐이고 거의 안 바뀌므로 컨텍스트를 얹지 않는다
// (`useViewOptions` 와 같은 이유).

import type { AgentObject } from '../types/xlog';

const names = new Map<number, string>();

/**
 * 본 이름을 쌓는다. **지우지 않는다.**
 *
 * 빈 이름은 담지 않는다 — 빈 칸으로 덮으면 있던 이름까지 잃는다.
 * 콜렉터가 이름 없는 팩을 보내는 일이 실제로 있다(objHash 만 든 빈 응답, F-34).
 */
export function rememberNames(agents: readonly AgentObject[]): void {
  for (const a of agents) {
    if (a.obj_name !== '') names.set(a.obj_hash, a.obj_name);
  }
}

/** 모르면 `undefined`. **지어내지 않는다** — 부르는 쪽이 해시를 드러내는 편이 낫다 */
export function nameOf(objHash: number): string | undefined {
  return names.get(objHash);
}

/**
 * 비운다. **콜렉터를 갈아탈 때만.**
 *
 * objHash 는 objName 의 해시라(F-35) 개발·운영이 같은 이름을 쓰면 **해시까지 같다.**
 * 안 비우면 다른 서버의 이름이 그대로 보인다.
 */
export function clearNames(): void {
  names.clear();
}

/** 지금까지 본 전부. 화면이 `Map` 을 기대하는 자리(`agentMap`)에 그대로 넘긴다 */
export function allNames(): Map<number, string> {
  return new Map(names);
}
