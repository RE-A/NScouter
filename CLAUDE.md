# Project: Scouter Modern Client (Tauri + React + TypeScript)

## 1. AI Assistant Interaction Rules (Strict Strict)
이 프로젝트에서 AI는 아래의 규칙을 엄격하게 준수하여 답변해야 합니다.

### 1.1 Communication & Verification
- **정보 검증 (Verify Information):** 명확한 증거 없이 가정하거나 추측하지 마십시오.
- **군더더기 제거 (No Fluff):** "알겠습니다", "좋은 질문입니다" 같은 서론과 "죄송합니다" 같은 사과는 절대 금지합니다.
- **요약 금지 (No Summaries):** 변경된 내용을 말로 요약하지 말고 코드 그 자체로 보여주십시오.
- **이해 여부 확인 금지:** 주석이나 설명에 사용자의 이해 여부를 묻는 피드백을 포함하지 마십시오.
- **한글 사용:** 모든 대화나 코멘트는 한글로 작성하십시오.

### 1.2 Editing & Output Format
- **파일 단위 변경 (File-by-File):** 변경 사항은 파일 단위로 명확하게 구분하여 제공하십시오.
- **단일 청크 편집 (Single Chunk Edits):** 한 파일에 대한 수정은 여러 단계로 나누지 말고, **한 번에** 전체 코드를 제공하십시오. (`// ... existing code` 사용을 절대 지양하고, 복사-붙여넣기 가능하게 전체 코드를 출력하십시오.)
- **임의 변경 금지 (No Inventions):** 요청받지 않은 기능을 임의로 추가하거나, 관련 없는 코드를 삭제하지 마십시오. (기존 구조 보존)
- **공백 변경 제안 금지:** 단순 포맷팅이나 공백 변경만 있는 수정 제안은 하지 마십시오.
- **실제 파일 링크:** 컨텍스트 가상 경로가 아닌, 실제 파일 경로를 주석이나 제목에 명확히 언급하십시오. (예: `src/components/XLogChart.tsx`)

---

## 2. Tech Stack Overview
- **Core:** Tauri (Rust)
- **Frontend Framework:** React 18+ (Functional Components)
- **Language:** TypeScript (Strict mode)
- **Data Visualization (Crucial):** HTML5 Canvas API 또는 WebGL 기반 라이브러리 (대용량 XLog 렌더링용)

## 3. Tauri & React (TypeScript) Basic Rules

### 3.1. TypeScript & React Guidelines
- **Strict Typing:** `any` 타입 사용을 금지합니다. 모든 컴포넌트 Props, 상태(State), API 응답 데이터는 명확한 `interface` 또는 `type`으로 정의하십시오.
- **Functional Components:** 모든 React 컴포넌트는 함수형으로 작성하며, React Hooks(`useState`, `useEffect`, `useMemo`, `useCallback`)를 적절히 활용하여 생명주기와 상태를 관리하십시오.
- **Performance Optimization:** 불필요한 리렌더링을 막기 위해 렌더링 비용이 높은 컴포넌트(특히 차트 영역)는 `React.memo`로 감싸고, 파생 데이터는 `useMemo`로 캐싱하십시오.
- **Component Separation:** UI 컴포넌트와 비즈니스 로직(커스텀 훅)을 명확히 분리하여 작성하십시오.

### 3.2. Tauri Integration Rules
- **Role Separation:** 브라우저 API(Web API)로 처리할 수 있는 로직은 프론트엔드(TypeScript)에서 처리하십시오.
- **Rust Invoke:** 로컬 파일 시스템 읽기/쓰기, OS 네이티브 알림, 시스템 트레이 등 데스크톱 특화 기능이 필요할 때만 Tauri의 Rust Command(`@tauri-apps/api/invoke`)를 호출하십시오.
- **IPC Performance:** Rust와 프론트엔드(Webview) 간의 IPC 통신 시 지나치게 크거나 잦은 페이로드(Payload) 전송은 지양하십시오. 대용량 데이터는 청크(Chunk) 단위로 나누거나, 효율적인 구조로 직렬화하여 넘기십시오.

### 3.3. Scouter XLog Rendering (Architecture Constraint)
- **No DOM for Scatter Chart:** XLog를 화면에 뿌리는 스캐터 차트는 **절대로 일반적인 DOM 요소(div, svg 등)로 렌더링해서는 안 됩니다.** - **Canvas/WebGL:** 반드시 **Canvas API**를 직접 제어하거나 대용량 렌더링에 최적화된 라이브러리(ECharts GL 등)를 사용하여 초당 수만 개의 점을 렉 없이 그리십시오.
- **Data Source:** 이 클라이언트는 Scouter Collector와 직접 통신하지 않고, 중간의 **'Java Proxy Server'**를 통해 XLog 및 메트릭 데이터를 WebSocket(실시간)과 REST API(단건)로 수신합니다.