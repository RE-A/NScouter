# NScouter 개발 가이드

---

## 1. 개발 환경 요구사항

| 도구 | 버전 | 설치 확인 |
|------|------|-----------|
| Rust (rustup) | 1.75+ | `rustc --version` |
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |
| Tauri CLI | v2 | `npm run tauri -- --version` |
| WebView2 (Windows) | 자동 설치 | Windows 11 기본 내장 |

### 1.1 Rust 설치

```bash
# rustup 설치 (https://rustup.rs)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Windows MSVC 타겟 추가 (Windows 빌드 시 필요)
rustup target add x86_64-pc-windows-msvc
```

### 1.2 Node.js 설치

```bash
# nvm 사용 권장
nvm install 20
nvm use 20
```

### 1.3 의존성 설치

```bash
cd NScouter
npm install
```

---

## 2. 디렉토리 구조

```
NScouter/
├── src/                          # React 프론트엔드
│   ├── App.tsx                   # 앱 루트 (레이아웃, 상단 탭, 이벤트 연결)
│   ├── main.tsx                  # ReactDOM 진입점
│   ├── components/               # 공용 UI (Pane, Divider, ContextMenu, SectionHeader 등)
│   ├── i18n/                     # 문구 (index.ts, en.ts) — 한국어 원문이 키, en.ts 가 영어 사전
│   ├── styles/                   # 디자인 토큰·테마 (tokens.ts/.css, theme.ts)
│   ├── test/                     # Vitest setup, fakeCanvas
│   └── features/
│       ├── xlog/                 # XLog 기능 모듈 (앱의 중심)
│       │   ├── api/              # scouterApi.ts(invoke/listen 래퍼), subscribe, connectFlow, pastXLog
│       │   ├── types/            # 타입 정의 (xlog.ts 의 SXLog·XLogColumns·Config 등)
│       │   ├── engine/           # Canvas 렌더링 엔진 (React 의존성 없음)
│       │   │                     #   XLogChartRenderer · CoordinateMapper · GridCalculator ·
│       │   │                     #   PointMap · DotImageCache · yScale · densityGrid · pixelQuery · rectSelect
│       │   ├── store/            # XLogDataStore (시간 창, 건수 상한)
│       │   ├── hooks/            # useXLogStream · useXLogCanvas · 탭·선택·이름 캐시 등
│       │   ├── components/       # 차트·툴바·상세·검색·서버 트리·카운터·토폴로지 등
│       │   ├── trace/            # 콜트리·흐름 트리 모델
│       │   └── utils/            # colorPalette(점 색상 규칙), xlogDate, streamStatus, alertWatch
│       ├── active/               # 액티브 서비스 탭
│       ├── visualize/            # 시각화 탭 (KPI·분포·타임라인·인스턴스 그리드)
│       ├── settings/             # 앱 설정 대화상자
│       ├── config/               # 에이전트·서버 설정 편집 (catalog/official.ts 는 tools/gen_config_catalog.py 로 생성)
│       └── parity/               # ASIS 이관 인벤토리 (이관율 계산)
│
├── src-tauri/                    # Tauri + Rust 백엔드
│   ├── Cargo.toml                # 의존성 (tokio, serde, sha2, hex, flate2, tauri-plugin-log 등)
│   ├── tauri.conf.json           # Tauri 앱 설정
│   ├── capabilities/
│   │   └── default.json          # 권한 설정
│   ├── tests/                    # scouter_integration(L3 mock) · live_collector(L4 실서버) · log_level*
│   └── src/
│       ├── main.rs               # 진입점
│       ├── lib.rs                # Tauri Builder + Command 등록 (Command 목록의 원본)
│       ├── commands.rs           # Tauri Command 전부 + 카운터·알림 스트림 루프
│       ├── state.rs              # AppState (연결, 조회용 연결 풀, 스트림 토큰, 설정)
│       ├── config.rs             # config.json (실행파일 경로 기준)
│       ├── profile_store.rs      # 프로파일 저장·열기
│       ├── export_store.rs       # CSV 내보내기
│       └── scouter/
│           ├── mod.rs
│           ├── protocol.rs       # 프로토콜 상수 (TcpFlag, PackEnum, CMD_*)
│           ├── codec.rs          # ScouterReader / ScouterWriter
│           ├── value.rs          # ScouterValue enum
│           ├── pack.rs           # XLogPack, MapPack 등 역직렬화
│           ├── connection.rs     # TCP 연결, 로그인, 요청/응답 읽기
│           ├── streaming.rs      # TRANX_REAL_TIME_GROUP 폴링 루프
│           ├── xlog_columns.rs   # 실시간 XLog 열 묶음 직렬화
│           ├── dictionary.rs     # GET_TEXT_100 hash→text 캐시
│           ├── counter.rs / alert.rs            # 실시간 카운터·알림 파라미터
│           ├── object.rs / objtype.rs / family.rs  # 오브젝트 단건·타입 단위 명령, Family 판정
│           ├── past.rs / search.rs / trace.rs   # 과거 XLog, 조건 검색, gxid 조회
│           ├── profile.rs / profile_search.rs   # 프로파일 Step 파싱, 본문 검색
│           ├── summary.rs / distribution.rs     # 요약, 응답시간 분포
│           ├── configure.rs      # 에이전트·콜렉터 설정 조회
│           └── mock_server.rs    # 통합 테스트용 가짜 Collector
│
├── Test/                         # 로컬 Scouter 테스트 환경 (podman compose)
├── tools/                        # gen_config_catalog.py
├── docs/                         # 문서 (인덱스는 docs/README.md)
│
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 3. 개발 서버 실행

```bash
# 프론트엔드 + Rust 백엔드 동시 실행 (핫 리로드 지원)
npm run tauri dev
```

내부적으로:
1. `npm run dev` → Vite dev server `:1420` 시작
2. `cargo build` → Rust 백엔드 컴파일
3. Tauri가 WebView를 열고 `http://localhost:1420` 로드

> **첫 실행 시** Rust 의존성을 모두 컴파일하므로 5~10분 소요. 이후 변경분만 증분 빌드.

### 개발 중 유용한 명령

```bash
# Rust만 타입 체크 (빠름)
cd src-tauri && cargo check

# Rust 단위 테스트 실행
cd src-tauri && cargo test

# TypeScript 타입 체크
node_modules/.bin/tsc --noEmit

# Vite 프리뷰 (UI만 확인, Tauri 없이)
npm run dev
# → http://localhost:1420 브라우저에서 확인
# (단, Tauri invoke 호출은 실패함 — Canvas 렌더링만 확인 가능)
```

---

## 4. 코드 컨벤션

### 4.1 TypeScript

- `any` 타입 **절대 금지**. 모든 타입은 `interface` 또는 `type`으로 명시.
- 컴포넌트는 **함수형** + Hooks만 사용. 클래스 컴포넌트 금지.
- 렌더링 비용이 높은 컴포넌트는 `React.memo` 적용 (`XLogChart`).
- 비즈니스 로직은 커스텀 훅(`use*.ts`)으로 분리. 컴포넌트에 로직 직접 작성 금지.
- Canvas 렌더링 엔진(`engine/`)은 React 의존성 없는 순수 클래스로 유지.

```typescript
// ✅ 올바른 예
interface XLogChartProps {
  config: XLogChartConfig;
  filter: XLogFilterState;
}

// ❌ 금지
function render(data: any) { ... }
```

### 4.2 Rust

- 에러는 `io::Error` 또는 `String`으로 전파. `unwrap()` 사용 금지 (테스트 코드 제외).
- Tauri Command 함수는 `async fn`으로 작성, `Result<T, String>` 반환.
- 동시성: `Arc<AtomicBool>` (중지 플래그), `tokio::sync::Mutex` (공유 상태).
- `BigEndian` 읽기는 반드시 `ScouterReader`를 통해서만. 직접 바이트 파싱 금지.

```rust
// ✅ 올바른 예
pub async fn connect_scouter(...) -> Result<(), String> {
    let conn = ScouterConnection::connect(&host, port)
        .map_err(|e| format!("연결 실패: {e}"))?;
    Ok(())
}

// ❌ 금지
let _ = some_result.unwrap();
```

### 4.3 파일/모듈 명명

| 구분 | 규칙 | 예시 |
|------|------|------|
| React 컴포넌트 | PascalCase `.tsx` | `XLogChart.tsx` |
| 커스텀 훅 | `use` + PascalCase `.ts` | `useXLogStream.ts` |
| 엔진/유틸 클래스 | PascalCase `.ts` | `CoordinateMapper.ts` |
| Rust 모듈 | snake_case | `connection.rs` |
| Rust 구조체/enum | PascalCase | `ScouterConnection` |
| Rust 함수 | snake_case | `read_decimal()` |

---

## 5. 주요 작업 방법

### 5.1 새 Tauri Command 추가

**Rust 측 (`commands.rs`):**

```rust
#[tauri::command]
pub async fn my_command(
    param: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // 구현
    Ok("result".to_string())
}
```

**`lib.rs`에 등록:**

```rust
.invoke_handler(tauri::generate_handler![
    connect_scouter,
    // ...
    my_command,  // ← 추가
])
```

**TypeScript 측 (`scouterApi.ts`):**

```typescript
export async function myCommand(param: string): Promise<string> {
    return invoke<string>('my_command', { param });
}
```

---

### 5.2 새 Tauri 이벤트 추가

**Rust 측 (emit):**

```rust
app.emit("my-event", MyPayload { data: "..." })?;
```

`MyPayload`는 `#[derive(serde::Serialize, Clone)]` 필수.

**TypeScript 측 (listen):**

```typescript
export function onMyEvent(handler: (data: MyPayload) => void): Promise<UnlistenFn> {
    return listen<MyPayload>('my-event', e => handler(e.payload));
}
```

---

### 5.3 새 Y축 모드 추가

`src/features/xlog/types/xlog.ts`에서:

```typescript
// 1. 타입에 추가
export type YAxisMode = 'elapsed' | 'cpu' | ... | 'myMode';

// 2. 설정 추가
export const Y_AXIS_CONFIGS: Record<YAxisMode, YAxisModeConfig> = {
    // ...
    myMode: {
        label: 'My Metric',
        defaultMax: 100,
        unit: 'unit',
        valueExtractor: (x: SXLog) => x.myField,
    },
};
```

`XLogToolbar.tsx`의 `Y_AXIS_OPTIONS` 배열에도 추가.

---

### 5.4 Scouter 새 RequestCmd 추가

1. `protocol.rs`에 상수 추가:
   ```rust
   pub const CMD_MY_REQUEST: &str = "MY_REQUEST";
   ```

2. `commands.rs`에 새 Command 구현. 응답이 MapPack 하나면 기존 헬퍼 `request_map`
   (오브젝트 단건이면 `request_object_map`)을 쓴다 — `send_request` → `read_next_pack` 루프가 그 안에 있다:
   ```rust
   #[tauri::command]
   pub async fn my_request(state: State<'_, AppState>) -> Result<(), String> {
       let map = request_map(&state, CMD_MY_REQUEST, MapPack::new()).await?;
       // map: Option<MapPack> — 처리
       Ok(())
   }
   ```
   응답 팩이 여러 개거나 MapPack 이 아니면 `request_map` 처럼 `state.connection` 을 잠그고
   `send_request` 후 `read_next_pack()` 이 `None` 이 될 때까지 읽는다.
   오래 걸리는 objType 단위 조회는 `state.connection` 대신 조회용 연결 풀을 쓰는 기존 Command
   (`request_objtype_maps`)를 따른다 — 짧은 폴링을 막지 않기 위해서다.

3. `lib.rs` 의 `generate_handler!` 에 등록하고 `scouterApi.ts` 에 래퍼를 단다 (5.1).

---

## 6. 단위 테스트

### Rust 테스트

```bash
cd src-tauri
cargo test                                       # L2 유닛 + L3 mock 통합
cargo test --test live_collector -- --ignored    # L4 실서버 (Test 환경이 떠 있어야 한다)
```

2026-10-22 기준 226건(L2) + 5건(L3) + 103건(L4, 기본 `#[ignore]`), 그 밖에 로그 레벨 시험 2건(`tests/log_level*.rs`).
L2 는 각 모듈 하단의 `#[cfg(test)] mod tests`, L3 는 `tests/scouter_integration.rs`,
L4 는 `tests/live_collector.rs` 에 있다.

새 테스트 추가 위치:

```rust
// codec.rs 하단
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_my_case() {
        let mut w = ScouterWriter::new();
        w.write_decimal(12345);
        let mut r = ScouterReader::new(w.into_bytes());
        assert_eq!(r.read_decimal().unwrap(), 12345);
    }
}
```

### TypeScript 테스트

```bash
npm test                                # 전체
npm run test:watch                      # 고칠 때
npm test -- src/features/xlog/engine    # 일부만
```

Vitest + jsdom. 설정은 `vite.config.ts` 의 `test` 블록이고 Tauri API mock 은
`src/test/setup.ts` 에서 건다. 2026-10-22 기준 1,651건 / 132개 파일이며, 테스트 파일은 대상 옆에
`*.test.ts(x)` 로 둔다.

계층(L1~L4) 구분과 «무엇을 어디서 검증하나» 는 [테스트 전략](testing-strategy.md).

---

## 7. 디버깅

### Rust 로그 출력

```rust
// 개발 시 임시 디버그 출력
eprintln!("[DEBUG] session = {}", self.session);

// 프로덕션용 (tauri::plugin::log 사용 시)
log::info!("연결 성공: {}", server_id);
```

### WebView 개발자 도구

개발 모드에서 자동으로 DevTools 열림.
`tauri.conf.json`에서 `devtools: true` 설정 시 우클릭 → 검사로도 열 수 있음.

### Tauri 이벤트 모니터링

브라우저 콘솔에서:

```javascript
const { listen } = window.__TAURI__.event;
listen('xlog-data', e => console.log(e.payload));
```

---

## 8. 알려진 제약사항 및 주의사항

### TCP 연결

- `start_xlog_stream` 은 스트림 전용 연결을 따로 열어 `tokio::spawn` 으로 폴링을 돌리고 **바로 반환**한다.
  같은 스트림을 다시 시작하면 이전 태스크는 중지 토큰으로 멈춘다 (`StreamTokens::take_token`).
- 일시 오류는 `xlog-error` 를 보내고 1초 뒤 스스로 다시 폴링한다.
- 세션 만료(`INVALID_SESSION`) 시 자동 재로그인 없음 — `xlog-error` 를 보내고 스트림 루프를 끝낸다.

### txid / gxid 정밀도

- Java `long`(i64)은 JavaScript `number`(f64) 범위를 초과함.
- Rust에서 String으로 직렬화하여 전달. 프론트는 **문자열 그대로** 키·비교에 쓰고 숫자로 바꾸지 않는다 (`SXLog.txid: string`).

### XLogPack 선택적 필드

- 필드 21번(`countryCode`)부터는 `remaining() > 0` 조건부 읽기.
- 구버전 Collector에서는 후반 필드가 없을 수 있음 → 기본값(0, "", false)으로 처리.

### Canvas 좌표

- `drawImage(dot, x - half, y - half)` — **좌상단 기준**. 중심 기준으로 계산하면 점 크기의 절반만큼 어긋남.
- `devicePixelRatio`를 고려한 canvas 크기 설정 (`ResizeObserver` 내부에서 처리).
