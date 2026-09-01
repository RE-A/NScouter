# 테스트 전략 (TDD)

> **용도**: Claude 참조용. 이 프로젝트에서 TDD로 개발할 때의 계층·명령·판단 기준.
> 실제 테스트 작성 전에 이 문서로 "어느 계층에 쓸지"와 "RED를 어떻게 확인할지"를 정한다.

## 철칙

```
실패하는 테스트 없이 프로덕션 코드를 쓰지 않는다.
```

- **RED를 눈으로 봐야 한다.** 실패를 안 봤으면 그 테스트가 옳은 걸 검증하는지 모른다.
- 테스트가 바로 통과하면 → 이미 있는 동작을 테스트한 것이다. 테스트를 고친다.
- 테스트가 *에러*나면 (컴파일 실패, 오타) → 그건 RED가 아니다. 고쳐서 *실패*하게 만든다.
- GREEN은 최소 구현으로. 테스트에 없는 기능을 미리 넣지 않는다.
- 버그 수정도 동일하다. 재현 테스트를 먼저 쓴다.

---

## 4개 계층

| 계층 | 위치 | 실행 | 대상 |
|---|---|---|---|
| **L1** 프론트 유닛 | `src/features/**/*.test.ts` | `npm test` | 렌더러 엔진, 스토어, 순수 로직 |
| **L2** Rust 유닛 | `src-tauri/src/**/mod tests` | `cargo test --lib` | 코덱, 해시, 파서 |
| **L3** Rust 통합 (mock) | `src-tauri/tests/scouter_integration.rs` | `cargo test --test scouter_integration` | 연결·로그인·요청 흐름 |
| **L4** Rust 통합 (실서버) | `src-tauri/tests/live_collector.rs` | `cargo test --test live_collector -- --ignored` | 실제 프로토콜 |

L4는 `#[ignore]`라 기본 실행에서 빠진다. Test 환경이 떠 있어야 한다.

```powershell
cd Test; .\scripts\up.ps1; .\scripts\load.ps1     # 콜렉터 + 앱 + 부하
cd ..\src-tauri; cargo test --test live_collector -- --ignored --nocapture
```

### 전체 실행

```bash
npm test                  # L1
cd src-tauri && cargo test  # L2 + L3 (L4는 ignored)
```

---

## 어디에 쓸 것인가

| 바꾸는 것 | 계층 | 이유 |
|---|---|---|
| 좌표 변환, 그리드 계산, 충돌 감지 | L1 | 순수 함수. 입출력만 검증하면 된다 |
| XLogDataStore 윈도우/상한 로직 | L1 | 시간 의존은 파라미터로 주입 |
| React 컴포넌트 | L1 | `@testing-library/react`. Tauri API는 이미 mock됨 |
| Decimal/Blob/Text 인코딩 | L2 | 경계값 위주 |
| Pack 파싱 (XLog/Object/Profile) | **L3 + L4** | mock만으로는 부족 — 아래 함정 참조 |
| 커맨드명, 요청 파라미터 | **L4** | 실서버만이 진실 |
| 연결 수명 관리 | **L4** | mock은 연결당 1명령 제약을 재현하지 않는다 |

### 함정 — mock이 실물과 다르면 테스트가 통과해도 소용없다

`read_object_pack()`의 필드 순서 버그(F-4)가 mock 통합 테스트를 **통과한 채로** 살아남았다.
`mock_server.rs`가 오브젝트 목록을 ObjectPack이 아니라 MapPack으로 응답했기 때문이다.

> **판단 기준**: 와이어 포맷을 다루는 코드는 mock 테스트만으로 GREEN 선언하지 않는다.
> L4에서도 확인하거나, mock을 실제 포맷과 일치시킨 뒤 GREEN으로 본다.

`docs/verified-facts.md`의 O-2가 이 과제다.

---

## RED 확인 방법 (계층별)

### L1 (vitest)

```bash
npm test -- src/features/xlog/engine/CoordinateMapper.test.ts
```

- 새 파일이면 import 대상이 없어 **에러**가 난다. 이건 RED가 아니다.
  대상 함수의 시그니처만 먼저 만들고(`throw new Error('not implemented')`) 실패를 본다.
- `expect` 실패 메시지가 의도한 내용인지 확인한다.

### L2 / L3 (cargo)

```bash
cd src-tauri && cargo test --lib codec::tests::test_decimal_zero
```

- 컴파일 에러는 RED가 아니다. 타입·시그니처를 먼저 맞춰 컴파일은 통과시키고
  `unimplemented!()` 또는 잘못된 반환값으로 **assert 실패**를 만든다.

### L4 (실서버)

```bash
cargo test --test live_collector <name> -- --ignored --nocapture
```

- Test 환경이 떠 있어야 한다. 안 떠 있으면 연결 실패로 에러 → RED 아님.
- 부하가 필요한 테스트(XLog 건수)는 `load.ps1`을 켠 상태에서.
- **환경 문제와 코드 문제를 구분할 것.** 구분이 안 되면
  `Test/scripts/signal_check.py`로 환경 쪽을 먼저 확인한다.

---

## 현재 상태

```
L1  709건 / 70개 파일 — 렌더러 엔진(좌표·그리드·PointMap·픽셀 조회·영역 선택),
                       스토어, 훅, 컴포넌트(필터 창·알림·서버 전환·저장본),
                       i18n 사전, parity(이관율)
L2  178건 — codec 경계값, sha256, 팩·요청 파라미터 파서, 저장본·내보내기, TextCache
L3  5건 — connect/login, object list, xlog stream, 모르는 팩 타입, PerfCounterPack
L4  88건 — 실서버 프로토콜 전반 (기본 ignore)
```

이관율은 `src/features/parity/`에 있다. 기능을 옮기면 `inventory.ts`의 status 와
`PARITY_RATCHET` 을 갱신한다. **status 만 올리고 evidence 를 안 적으면 테스트가 막는다.**

설정: `vite.config.ts`의 `test` 블록 (jsdom, `src/test/setup.ts`에서 Tauri API mock).
커버리지 대상은 `src/features/**`.

### 공백 (테스트 없음)

| 영역 | 계층 | 비고 |
|---|---|---|
| `XLogChartRenderer` 렌더 파이프라인 | L1 | Canvas mock 필요 |
| `DotImageCache` | L1 | OffscreenCanvas mock 필요 |
| 스텝 파싱 — 값을 꺼내 쓰는 6종 | L2 | ThreadCall 만 합성 blob 으로 검증. 나머지는 L4 에 기댄다.<br>SUM·Span 계열은 **자리만** 검증했다(내용은 화면에 안 쓴다) |

> 카운터·알람 프로토콜은 L4로 검증 완료다 (N-6/N-8 수정).
> 알람을 만들려면 `podman stop/start order-app` (F-16).

---

## 새 기능/수정 절차

1. **어느 계층인지 정한다** (위 표)
2. 와이어 포맷을 건드리면 → `docs/verified-facts.md` 확인. 없으면 실물로 확인 후 F-N 추가
3. **RED** — 테스트 1개, 동작 1개, 이름은 동작을 서술
4. **RED 확인** — 실행해서 실패를 본다. 실패 사유가 "기능 없음"인지 확인
5. **GREEN** — 최소 구현
6. **GREEN 확인** — 해당 테스트 + 전체 스위트
7. **REFACTOR** — 그린 유지하며 정리
8. 와이어 포맷 관련이면 **L4로 한 번 더 확인**

## 테스트 작성 규칙

- 이름은 동작을 서술한다. `test('objType을 objHash보다 먼저 읽는다')` (O), `test('parse works')` (X)
- 이름에 "and"가 들어가면 테스트를 쪼갠다
- mock은 불가피할 때만. mock 동작이 아니라 **실제 동작**을 검증한다
- 테스트 전용 코드를 프로덕션 타입에 넣지 않는다
- 테스트를 쓰기 전에 **"어떤 프로덕션 변경이 이 테스트를 실패시키는가"**를 답할 수 있어야 한다

## 관련 문서

- [verified-facts.md](verified-facts.md) — 프로토콜 실측 사실. 와이어 포맷 작업 전 필수
- [architecture.md](architecture.md) — 모듈 구조
- [../Test/README.md](../Test/README.md) — L4 실행에 필요한 환경 기동
- [../Test/NSCOUTER-ISSUES.md](../Test/NSCOUTER-ISSUES.md) — 발견·수정된 결함 이력
