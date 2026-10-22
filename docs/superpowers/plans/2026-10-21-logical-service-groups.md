# 논리 서비스 그룹 (ECS Task 묶어 보기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이름이 다른 여러 ECS Task 를 하나의 논리 서비스로 묶어 고르고, Task 가 뜨고 질 때 그 구성이 저절로 따라가게 한다.

**Architecture:** 묶는 일은 **전부 화면 쪽**이다 — 콜렉터는 오브젝트를 평평하게 줄 뿐이고, 그룹은 `obj_name`·`tags` 에서 **파생**시킨다. 저장해 두지 않는다. Task 가 갈려도 규칙이 같으면 새 Task 가 같은 그룹으로 떨어지므로, 명단을 들고 있을 이유가 없다. 선택은 지금처럼 **objHash 집합** 하나로 유지하고(네 화면이 같은 선택을 쓴다), 그룹을 고른다는 것은 «그 순간 그 그룹에 속한 해시들을 넣는다» 가 아니라 **그룹 이름을 기억해 두고 매 갱신마다 멤버를 다시 푸는** 것이다 — 그래야 새 Task 가 저절로 들어온다.

**Tech Stack:** TypeScript (strict, `any` 금지) · React 18 함수형 · vitest + @testing-library/react · Rust(Tauri) 는 설정 필드만 손댄다

**Spec:** 사용자 요구 16·17번 (대화 기록). 요약:
- 개별 Task 는 지금처럼 각각 오브젝트로 유지, 그 위에 논리 그룹을 얹는다
- 그룹을 고르면 속한 Task 전부의 XLog 를 합쳐 본다. 펼쳐서 개별 Task 도 고를 수 있다
- XLog 상세·목록에는 **실제 인스턴스명**을 같이 보여준다
- Task 가 뜨고 지면 그룹 구성이 저절로 바뀐다. 종료된 Task 는 바로 지우지 않고 잠시 둔다
- 그룹핑 우선순위: **명시적 태그 > obj_name 규칙 > ECS 메타데이터 > hostname/IP 패턴**

## Global Constraints

- 모든 주석·UI 문구는 한글. 새 UI 문구는 `src/i18n/en.ts` 에도 넣는다 (`coverage.test.ts` 가 막는다)
- TypeScript strict, `any` 금지
- XLog 스캐터는 Canvas 전용 — 이 계획은 캔버스를 건드리지 않는다
- 새 색이 필요하면 `tokens.css` 에 토큰으로 넣고 테마 5벌을 모두 채운다 (`themes.test.ts` 가 막는다)
- 기존 선택 모델(`filter.objHashSet`)을 바꾸지 않는다 — Active·Counter·Visualize 가 같은 것을 본다
- 그룹 멤버 명단을 `config.json` 에 저장하지 않는다. 저장하는 것은 **고른 그룹 이름**과 **규칙**뿐이다

## Review Focus

1. **그룹에 Task 가 하나뿐일 때** — 묶을 것이 없는데 그룹 마디가 생기면 깊이만 한 겹 늘어난다. 한 대짜리는 그룹을 만들지 않고 그대로 보여야 한다
2. **규칙에 안 걸리는 이름** (`linux`·`datasource`·수기 이름) — 그룹 없음으로 떨어져야 하고, 묶이지 않았다는 것이 화면에 드러나야 한다
3. **고른 그룹이 통째로 사라진 뒤** (서비스를 내렸다) — 선택이 빈 채로 남아 «데이터가 안 나온다» 가 되면 안 된다. 그룹이 비었음을 말해야 한다
4. **같은 Task 가 두 그룹 규칙에 걸릴 때** — 우선순위대로 하나만 이겨야 하고, 중복으로 두 번 조회되면 안 된다
5. **종료된 Task 가 아직 목록에 있을 때** — 죽은 Task 의 해시가 조회 대상에 남으면 콜렉터가 매번 빈손을 돌려준다. 그룹 멤버는 **살아 있는 것만** 조회 대상이 되어야 한다

---

### Task 1: 논리 서비스 이름 뽑기

**Files:**
- Create: `src/features/xlog/components/instanceGroup.ts`
- Test: `src/features/xlog/components/instanceGroup.test.ts`

이름이 `serviceGroup.ts` 와 겹치지 않게 한다 — 그쪽은 **URL 묶음**(ASIS ServiceGroup)이고 이쪽은 **인스턴스 묶음**이다.

**Interfaces:**
- Produces:
  - `export interface GroupRule { tagKey: string; pattern: string }`
  - `export const DEFAULT_GROUP_RULE: GroupRule` — `{ tagKey: 'service', pattern: '^(?<svc>.+?)-ip-[0-9-]+' }`
  - `export function serviceNameOf(agent: AgentObject, rule: GroupRule): string | null`
    - 우선순위대로 본다: ① `agent.tags` 에서 `rule.tagKey` 를 찾으면 그 값 ② `rule.pattern` 을 `shortName(agent.obj_name)` 에 걸어 **첫 캡처 그룹**(이름 있으면 `svc`) ③ 어느 쪽도 아니면 `null`
    - 잘못된 정규식이면 던지지 말고 `null`. 설정 파일은 사람이 여는 곳이다
  - `export function groupByService(agents, rule): Map<string, AgentObject[]>`
    - `null` 인 것은 **넣지 않는다** (그룹 없음은 호출부가 평평하게 보여준다)
    - **멤버가 하나인 그룹은 빼고** 돌려준다 — Review Focus 1

- [x] **Step 1: 실패하는 테스트를 쓴다** — `src/features/xlog/components/instanceGroup.test.ts`

```ts
const agent = (obj_name: string, tags: [string, string][] = []): AgentObject =>
  ({ obj_hash: 1, obj_type: 'tomcat', obj_name, address: '', version: '',
     alive: true, wakeup: 0, tags }) as AgentObject;

it('태그가 있으면 태그가 이긴다', () => {
  expect(serviceNameOf(agent('SAFS-ip-10-75-113-103', [['service', 'SAFS-API']]),
    DEFAULT_GROUP_RULE)).toBe('SAFS-API');
});

it('태그가 없으면 이름 규칙으로 뽑는다', () => {
  expect(serviceNameOf(agent('/CJFW_QA/SAFS-ip-10-75-113-103.ap-northeast-2.compute.internal'),
    DEFAULT_GROUP_RULE)).toBe('SAFS');
});

it('규칙에 안 걸리면 null — 묶이지 않았다는 것이 드러나야 한다', () => {
  expect(serviceNameOf(agent('/CJFW/jdbc_SAFS_R'), DEFAULT_GROUP_RULE)).toBeNull();
});

it('정규식이 깨져 있어도 던지지 않는다 — 설정 파일은 사람이 여는 곳이다', () => {
  expect(serviceNameOf(agent('SAFS-ip-1'), { tagKey: 'service', pattern: '([' })).toBeNull();
});

it('한 대짜리는 그룹을 만들지 않는다 — 깊이만 한 겹 는다', () => {
  const only = [agent('SOLO-ip-10-0-0-1')];
  expect(groupByService(only, DEFAULT_GROUP_RULE).size).toBe(0);
});

it('같은 서비스의 여러 Task 를 한 묶음으로 센다', () => {
  const g = groupByService(
    [agent('SAFS-ip-10-0-0-1'), agent('SAFS-ip-10-0-0-2')], DEFAULT_GROUP_RULE);
  expect(g.get('SAFS')).toHaveLength(2);
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/features/xlog/components/instanceGroup.test.ts`
Expected: FAIL — `serviceNameOf is not defined`

- [x] **Step 3: `instanceGroup.ts` 를 구현한다**

`shortName` 은 `agentTree.ts` 에서 가져다 쓴다. 정규식은 `new RegExp` 을 `try/catch` 로 감싼다.

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/features/xlog/components/instanceGroup.test.ts`
Expected: PASS (6 tests)

- [x] **Step 5: 커밋**

```bash
git add src/features/xlog/components/instanceGroup.ts src/features/xlog/components/instanceGroup.test.ts
git commit -m "ECS Task 이름에서 논리 서비스를 뽑는다"
```

---

### Task 2: 오브젝트 목록을 앱 전체가 주기적으로 갱신한다

**Files:**
- Modify: `src/App.tsx` — `getObjectList()` 효과의 의존성 `[isConnected]` (약 332행)
- Test: `src/features/xlog/hooks/objectRefresh.test.ts` (신규, 순수 함수만)

**지금 버그다.** 왼쪽 패널은 10초마다 다시 읽는데(`AgentSelectorPanel.tsx:67`) App 은 **접속당 한 번만** 읽는다. 그래서 새 Task 가 떠도 `counterHashes`·`objTypeOf`·`agentMap` 이 옛것이라 카운터 대상에 안 들어가고 이름이 `#해시` 로 남는다. 그룹이 저절로 따라가려면 여기가 먼저 고쳐져야 한다.

**Interfaces:**
- Consumes: 없음
- Produces: `export function mergeObjects(prev: readonly AgentObject[], next: readonly AgentObject[], now: number, keepMs: number): AgentObject[]`
  - `next` 에 있는 것은 그대로 살린다
  - `prev` 에만 있는 것은 `keepMs` 안이면 `alive: false` 로 남긴다 (`wakeup` 기준). 지나면 버린다
  - **종료된 Task 를 바로 지우지 않는 이유**: 재배포 중 몇 초 비는 사이에 화면에서 사라지면 «장애» 로 읽힌다
- `export const TERMINATED_KEEP_MS = 60_000`

- [x] **Step 1: 실패하는 테스트를 쓴다**

```ts
it('새 Task 는 바로 들어온다', () => { /* next 에만 있는 해시가 결과에 있다 */ });
it('사라진 Task 는 잠시 죽은 채로 남는다', () => { /* alive === false 로 남는다 */ });
it('오래 지난 것은 버린다', () => { /* now - wakeup > TERMINATED_KEEP_MS 면 없다 */ });
it('되돌아온 Task 는 다시 살아난다', () => { /* 같은 해시가 next 에 오면 alive === true */ });
```

- [x] **Step 2: 실패를 확인한다** — `npx vitest run src/features/xlog/hooks/objectRefresh.test.ts`

- [x] **Step 3: `mergeObjects` 를 구현하고 App 효과를 주기 갱신으로 바꾼다**

`setInterval(load, 10_000)` 로 바꾸고 `clearInterval` 로 정리한다. 주기는 왼쪽 패널과 **같은 10초** — 둘이 다르면 화면 두 곳이 서로 다른 명단을 보여준다. `setAgentMap` 의 기존 «같으면 그대로» 비교를 유지한다(매 갱신마다 새 Map 을 만들면 그걸 의존성으로 쓰는 곳이 전부 다시 돈다).

- [x] **Step 4: 통과를 확인한다** — 위 명령 + `npx vitest run` 전체

- [x] **Step 5: 커밋**

```bash
git commit -am "오브젝트 목록을 앱 전체가 10초마다 다시 읽는다"
```

---

### Task 3: 에이전트 트리에 「서비스」 묶기를 더한다

**Files:**
- Modify: `src/features/xlog/components/agentTree.ts` — `GroupBy` 에 `'service'` 추가, `groupAgents` 분기
- Modify: `src/features/xlog/components/AgentSelectorPanel.tsx` — 묶기 버튼에 「서비스」 추가
- Test: `src/features/xlog/components/agentTree.test.ts` (기존 파일에 더한다)

**Interfaces:**
- Consumes: Task 1 의 `groupByService`, `DEFAULT_GROUP_RULE`
- Produces: `GroupBy = 'type' | 'group' | 'service'`
  - `groupAgents(agents, query, 'service', types, rule)` — 묶인 것은 서비스 이름으로, `null` 인 것은 기존 `'(그룹 없음)'` 마디로
  - `AgentGroup` 에 `kind: 'type' | 'host' | 'service'` 를 더한다 — 화면이 서비스 묶음만 다르게(펼침·일괄 선택) 다루려면 구별이 필요하다

- [x] **Step 1: 실패하는 테스트를 쓴다**

```ts
it('서비스로 묶으면 같은 서비스의 Task 가 한 마디에 모인다', () => { /* ... */ });
it('규칙에 안 걸린 것은 «그룹 없음» 으로 떨어진다 — 조용히 숨기지 않는다', () => { /* ... */ });
it('묶음은 이름순 — 살아 있는 수로 정렬하면 10초마다 목록이 춤춘다', () => { /* ... */ });
```

- [x] **Step 2: 실패를 확인한다** — `npx vitest run src/features/xlog/components/agentTree.test.ts`

- [x] **Step 3: `groupAgents` 에 `'service'` 분기를 더하고 패널에 버튼을 단다**

기본 묶기는 **바꾸지 않는다** — 지금 쓰는 사람의 화면이 말없이 달라지면 안 된다.

- [x] **Step 4: 통과를 확인한다**

- [x] **Step 5: 커밋**

---

### Task 4: 그룹을 고르면 멤버가 저절로 따라온다

**Files:**
- Create: `src/features/xlog/hooks/groupSelection.ts`
- Modify: `src/App.tsx` — `handleAgentSelectionChange` 주변
- Modify: `src/features/xlog/components/AgentSelectorPanel.tsx` — 그룹 마디의 체크박스
- Test: `src/features/xlog/hooks/groupSelection.test.ts`

**여기가 이 계획의 핵심이다.** 그룹을 고른 순간의 해시들을 집어넣으면, 새 Task 가 떠도 안 들어오고 죽은 Task 가 남는다. **고른 것은 그룹 이름**이고, 해시는 갱신마다 다시 푼다.

**Interfaces:**
- Consumes: Task 1 `groupByService`, Task 2 `mergeObjects`
- Produces:
  - `export interface GroupSelection { services: ReadonlySet<string>; hashes: ReadonlySet<number> }`
    - `services` — 통째로 고른 그룹 이름. `hashes` — 낱개로 고른 Task
  - `export function resolveSelection(sel: GroupSelection, agents: readonly AgentObject[], rule: GroupRule): Set<number>`
    - `services` 에 속한 **살아 있는** Task 의 해시 + `hashes` 중 목록에 아직 있는 것
    - 죽은 Task 는 넣지 않는다 (Review Focus 5)
    - 중복은 Set 이 걷는다 (Review Focus 4)
  - `export function toggleService(sel, name): GroupSelection`
  - `export function toggleHash(sel, hash): GroupSelection`

- [x] **Step 1: 실패하는 테스트를 쓴다**

```ts
it('그룹을 고르면 그 그룹의 Task 가 전부 대상이 된다', () => { /* ... */ });
it('새 Task 가 뜨면 다시 안 골라도 들어온다', () => {
  // 같은 selection 을 **늘어난 agents** 로 다시 풀면 해시가 하나 는다
});
it('죽은 Task 는 조회 대상에 안 넣는다 — 콜렉터가 매번 빈손을 돌려준다', () => { /* ... */ });
it('그룹과 낱개를 같이 골라도 두 번 세지 않는다', () => { /* ... */ });
it('고른 그룹이 통째로 사라지면 빈 집합이다 — 호출부가 그걸 말해야 한다', () => { /* ... */ });
```

- [x] **Step 2: 실패를 확인한다**

- [x] **Step 3: 구현하고 App 에 붙인다**

App 은 `GroupSelection` 을 상태로 들고, `agents` 가 갱신될 때마다 `resolveSelection` 으로 푼 결과를 **모든 XLog 탭에** 적는다 (`setTabSelection`, 0.5.12 에서 만든 것). 기존 `filter.objHashSet` 의 뜻과 쓰임은 그대로다.

- [x] **Step 4: 통과를 확인한다** — 위 + 전체

- [x] **Step 5: 커밋**

---

### Task 5: 고른 그룹이 비면 그렇게 말한다

**Files:**
- Modify: `src/App.tsx` — `nothingPicked` 판정 주변
- Test: `src/features/xlog/hooks/groupSelection.test.ts` (Task 4 파일에 더한다)

Review Focus 3. 그룹은 골라 뒀는데 그 서비스의 Task 가 하나도 안 살아 있으면, 화면은 «안 골랐다» 와 똑같이 비어 보인다. 둘은 다른 일이고 할 일도 다르다.

**Interfaces:**
- Produces: `export function selectionState(sel, agents, rule): 'none' | 'empty-group' | 'ok'`

- [x] **Step 1: 실패하는 테스트를 쓴다**

```ts
it('아무것도 안 골랐으면 none', () => { /* ... */ });
it('골랐는데 살아 있는 Task 가 없으면 empty-group', () => { /* ... */ });
it('살아 있는 것이 있으면 ok', () => { /* ... */ });
```

- [x] **Step 2~4: 실패 확인 → 구현 → 통과 확인**

`'empty-group'` 일 때 XLog·Active 의 빈 화면 문구를 「고른 서비스에 살아 있는 Task 가 없습니다」로 바꾼다. `en.ts` 에도 넣는다.

- [x] **Step 5: 커밋**

---

### Task 6: 목록과 상세에 인스턴스명을 같이 보여준다

**Files:**
- Modify: `src/features/xlog/components/XLogTable.tsx` (서버 열)
- Modify: `src/features/xlog/components/XLogDetailPanel.tsx` (속성)
- Test: 각 컴포넌트의 기존 테스트 파일

스펙의 «서비스 전체 흐름과 문제 난 개별 Task 둘 다». 그룹으로 합쳐 봐도 **한 줄 한 줄은 어느 Task 것인지** 알아야 한다.

**Interfaces:**
- Consumes: `agentMap` (objHash → objName), Task 1 `serviceNameOf`
- 서버 열은 **짧은 인스턴스명**을 쓴다. 그룹명은 이미 왼쪽에서 고른 것이라 줄마다 반복할 이유가 없다

- [x] **Step 1: 실패하는 테스트를 쓴다**

```ts
it('한 줄에 그 트랜잭션이 돈 Task 이름이 보인다', () => { /* ... */ });
it('이름을 못 풀면 해시를 드러낸다 — 빈 칸은 «못 받았다» 로 읽힌다', () => { /* ... */ });
```

- [x] **Step 2~5: 실패 확인 → 구현 → 통과 확인 → 커밋**

---

### Task 7: 그룹 규칙을 설정에서 고친다

**Files:**
- Modify: `src-tauri/src/config.rs` — `AppConfig` 에 `group_rule: GroupRulePrefs`
- Modify: `src/features/xlog/api/scouterApi.ts` — `AppConfig` 에 `group_rule`
- Modify: `src/features/settings/SettingsDialog.tsx` — 「서비스 묶기」 구역
- Test: `src/features/settings/SettingsDialog.test.tsx` (기존 파일에 더한다)

규칙은 사이트마다 다르다. ECS 가 아닐 수도 있고, 이름 규칙이 `svc-1`·`svc-2` 일 수도 있다.

**Interfaces:**
- Rust: `pub struct GroupRulePrefs { pub tag_key: String, pub pattern: String }`, `#[serde(default)]`, 기본은 Task 1 의 `DEFAULT_GROUP_RULE` 과 **같은 값**
- 화면: 태그 키 입력칸 + 패턴 입력칸 + **지금 목록으로 미리보기**(몇 개 그룹으로 묶이는지 수를 보여준다 — 정규식을 눈으로만 보고 맞추는 것은 어렵다)

- [x] **Step 1: 실패하는 테스트를 쓴다**

```ts
it('규칙을 바꾸면 저장된다', () => { /* saveConfig 에 group_rule 이 담긴다 */ });
it('정규식이 깨져 있으면 저장 전에 말해 준다', () => { /* ... */ });
```

- [x] **Step 2~5: 실패 확인 → 구현 → 통과 확인 → 커밋**

---

### Task 8: 문서

**Files:**
- Modify: `docs/duplicate-objname-guide.md` — 「이름을 나눈 다음」 절을 더한다
- Modify: `docs/user-guide.md` — 서비스 묶기 사용법

이름을 유니크하게 나눈 **다음** 에 오는 문제가 이 기능이다. 가이드가 거기서 끊기면 나눈 사람이 «이제 100줄이 됐다» 에서 멈춘다.

- [x] **Step 1: 두 문서를 고친다**
- [x] **Step 2: 커밋**

---

## 이 계획에 **없는** 것

- **datasource 중복(18번)** — 에이전트가 `getObjName() + "/" + poolName` 으로 짓는 것이 바이트코드로 확인됐다. 부모 `obj_name` 만 유니크하게 하면 자동으로 따라온다(테스트 환경에서 실측). 화면 쪽에서 할 일이 없다
- **ECS 메타데이터 직접 조회** — 클라이언트는 ECS API 를 모른다. 태그로 들어오면 Task 1 의 ① 이 받는다
- **그룹 단위 집계 수치** (그룹 TPS·평균 응답) — 합쳐 조회하면 기존 집계가 그대로 돈다. 그룹별 비교표는 별건이다

---

### Task 9: 비활성 오브젝트 정리 (수동 + 주기)

**Files:**
- Create: `src/features/xlog/hooks/agentNames.ts` — 이름 영구 캐시
- Create: `src/features/xlog/hooks/agentNames.test.ts`
- Modify: `src-tauri/src/commands.rs` — `remove_inactive_objects` 커맨드
- Modify: `src-tauri/src/lib.rs` — 핸들러 등록
- Modify: `src-tauri/src/config.rs` — `auto_remove_inactive_min: u32`
- Modify: `src/features/xlog/api/scouterApi.ts`
- Modify: `src/features/xlog/components/AgentSelectorPanel.tsx` — 정리 버튼
- Modify: `src/features/settings/SettingsDialog.tsx` — 주기 설정
- Modify: `src/App.tsx` — 주기 실행

**왜 필요한가 (F-60):** 콜렉터는 죽은 오브젝트를 **영원히 들고 있다.**
`object_deadtime_ms` 는 「죽었다고 표시」할 시점만 정하고 자동 삭제 설정이 없다.
ECS 에서는 Task 가 갈릴 때마다 이름이 달라지므로 재배포 한 번에 Task 수만큼 쌓인다.

**조심할 것 둘.**

1. **전역이다.** `OBJECT_REMOVE_INACTIVE` 는 콜렉터의 목록을 지운다 — 같은 콜렉터에
   붙은 **다른 사람 화면에서도** 사라진다. 그래서 주기 실행은 **기본 꺼짐**이고,
   화면이 그 사실을 말해야 한다.
2. **이름이 끊긴다.** 제거는 `ObjectMap.remove` 와 `ObjectWR.remove`(오늘자 오브젝트 DB)
   둘을 건드린다. 지우고 나면 **오늘 받은 XLog 의 서버 이름이 안 풀린다.**
   ASIS 가 `TextProxy.object.putText` 로 이름만 영구 캐시해 둔 이유가 이것이다.
   → **이름 캐시가 먼저다.** 그것 없이 정리를 켜면 과거 조회가 `#해시` 로 덮인다.

**Interfaces:**
- Produces:
  - `rememberNames(agents: readonly AgentObject[]): void` — 본 적 있는 objHash→objName 을 쌓는다. **지우지 않는다**
  - `nameOf(objHash: number): string | undefined`
  - `clearNames(): void` — 콜렉터를 갈아탈 때만. 해시는 이름의 해시라 서버가 달라도 같을 수 있다(F-35)
  - Rust: `#[tauri::command] async fn remove_inactive_objects(state) -> Result<(), String>` — `request_objtype_maps` 가 아니라 단건 요청(`OBJECT_REMOVE_INACTIVE`, 파라미터 없음)
  - 설정: `auto_remove_inactive_min` — 0 이면 끔(**기본값**), 그 외는 분 단위 주기

- [x] **Step 1: 이름 캐시의 실패하는 테스트를 쓴다**

```ts
it('한 번 본 이름은 목록에서 사라져도 남는다', () => { /* ... */ });
it('이름이 바뀌면 새 이름으로 갱신한다 — 같은 해시면 같은 이름이지만 대비한다', () => { /* ... */ });
it('콜렉터를 갈아타면 비운다 — 해시는 이름의 해시라 서버가 달라도 겹친다 (F-35)', () => { /* ... */ });
```

- [x] **Step 2: 실패를 확인한다** — `npx vitest run src/features/xlog/hooks/agentNames.test.ts`

- [x] **Step 3: `agentNames.ts` 를 구현하고 `App` 의 `agentMap` 을 여기로 바꾼다**

`agentMap` 은 지금 살아 있는 목록에서 매번 다시 만든다 — 그래서 오브젝트가 사라지면
이름이 끊긴다. 캐시를 거쳐 읽게 한다.

- [x] **Step 4: 통과를 확인한다**

- [x] **Step 5: 커밋**

- [x] **Step 6: Rust 커맨드를 더하고 `live_collector` 에 실측 테스트를 쓴다**

```rust
#[ignore] #[tokio::test] async fn live_remove_inactive() { /* 응답이 오는지, 목록이 줄었는지 */ }
```

- [x] **Step 7: 실측으로 확인한다**

Run: `cargo test --test live_collector live_remove_inactive -- --ignored --nocapture`
Expected: PASS — 명령이 받아들여지고, 직전/직후 목록 길이가 찍힌다

- [x] **Step 8: 커밋**

- [x] **Step 9: 화면 — 서버 목록에 「비활성 정리」 버튼**

죽은 것이 하나도 없으면 **그리지 않는다.** 누를 이유가 없는 버튼은 자리만 먹는다.
누르면 몇 개를 지울지 먼저 말하고 확인을 받는다 — **다른 사람 화면에서도 사라진다**는 것을
그 자리에서 적는다.

- [x] **Step 10: 설정 — 자동 정리 주기 (기본 끔)**

`0`(끔) · `30분` · `1시간` · `6시간`. 자유 입력을 받지 않는 이유는 글자 크기와 같다.
**끔이 기본인 이유를 설명 줄에 적는다** — 전역이라 남의 화면까지 바뀐다.

- [x] **Step 11: 통과를 확인한다** — 전체 + `cargo test`

- [x] **Step 12: 커밋**
