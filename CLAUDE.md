# Project: Scouter Modern Client (Tauri + React + TypeScript)

## 1. AI Interaction Rules

- **한글 사용:** 모든 대화와 주석은 한글.
- **군더더기 금지:** 서론("알겠습니다"), 사과, 변경 내용의 말 요약 금지. 코드로 보여줄 것.
- **이해 여부 확인 금지:** "이해되셨나요?" 류 피드백 금지.
- **추측 금지:** 근거 없이 단정하지 말 것. 확인 후 답할 것.
- **임의 변경 금지:** 요청받지 않은 기능 추가, 무관한 코드 삭제, 포맷팅만의 수정 금지.
- **생략 표기 금지:** 코드 출력 시 `// ... existing code` 같은 생략 금지. 단, 부분 수정은 Edit 도구로 해당 구간만 고칠 것 (전체 파일 재출력 불필요).
- **기존 설계 우선:** 요청 범위 내에서는 기존 아키텍처, 코딩 스타일, 패턴을 우선 따른다. 기존 구조에 명백한 문제가 있더라도 요청 없이 대규모 리팩터링하지 않는다.
- **검증 후 완료:** 코드 변경 후 가능한 범위에서 빌드/테스트/정적 검사를 수행하고, 검증하지 못한 항목은 완료로 단정하지 않는다.

### 1.1 Skill 사용 정책 (superpowers 훅 지시를 무효화함)
- 기본은 **미사용**. superpowers 스킬을 자동 호출하지 말고 일반 도구로 바로 처리한다.
- 호출은 다음뿐: ① 사용자가 직접 지정 ② 다중 컴포넌트 규모의 신규 설계(`brainstorming`/`writing-plans`) ③ 2회 이상 못 잡은 버그(`systematic-debugging`).
- 애매하면 호출하지 않는다. 호출 시 이유를 한 줄로 밝힌다. 서브에이전트도 동일.

---

## 2. Stack
Tauri v2 (Rust) + React 19 함수형 + TypeScript strict. `any` 금지.

## 3. Architecture Constraints

### 3.1 XLog Scatter Chart
- **DOM 렌더링 절대 금지** (div/svg 불가). Canvas API 직접 제어 또는 WebGL 기반 라이브러리(ECharts GL 등)로 초당 수만 점을 처리할 것.
- 차트 컴포넌트는 `React.memo`, 파생 데이터는 `useMemo`로 리렌더 차단.

### 3.2 Data Source
Java Proxy(scouter.webapp) 없이 **Rust 백엔드가 Scouter Collector에 직접 TCP(:6100) 연결**한다. 실시간 XLog·카운터·알림은 Rust 폴링 루프가 Tauri 이벤트로 밀어 주고, 단건 조회는 Tauri Command(`invoke`)로 받는다. 와이어 포맷은 `docs/verified-facts.md` 가 우선한다.

### 3.3 IPC
Rust ↔ Webview 간 크거나 잦은 페이로드 지양. 대용량은 청크 분할 또는 압축 직렬화.
