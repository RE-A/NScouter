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
│   ├── App.tsx                   # 앱 루트 (레이아웃, 이벤트 연결)
│   ├── main.tsx                  # ReactDOM 진입점
│   └── features/xlog/            # XLog 기능 모듈
│       ├── api/
│       │   └── scouterApi.ts     # Tauri invoke/listen 래퍼
│       ├── types/
│       │   └── xlog.ts           # 모든 타입 정의 (XLogPack, SXLog, Config 등)
│       ├── engine/               # Canvas 렌더링 엔진 (React 의존성 없음)
│       │   ├── XLogChartRenderer.ts  # 7단계 렌더링 오케스트레이터
│       │   ├── CoordinateMapper.ts   # 좌표 변환
│       │   ├── GridCalculator.ts     # 눈금 계산
│       │   ├── PointMap.ts           # O(1) 충돌 감지
│       │   └── DotImageCache.ts      # 점 이미지 캐시
│       ├── store/
│       │   └── XLogDataStore.ts  # 데이터 관리 (시간 윈도우, 상한)
│       ├── hooks/
│       │   ├── useXLogStream.ts  # Tauri 이벤트 → Store
│       │   └── useXLogCanvas.ts  # rAF 루프, ResizeObserver, 드래그
│       ├── components/
│       │   ├── XLogChart.tsx         # 메인 차트 컴포넌트
│       │   ├── XLogToolbar.tsx       # 필터/설정 UI
│       │   └── ConnectionDialog.tsx  # 서버 연결 UI
│       └── utils/
│           └── colorPalette.ts   # 점 색상 규칙
│
├── src-tauri/                    # Tauri + Rust 백엔드
│   ├── Cargo.toml                # 의존성 (tokio, sha2, hex, serde 등)
│   ├── tauri.conf.json           # Tauri 앱 설정
│   ├── capabilities/
│   │   └── default.json          # 권한 설정
│   └── src/
│       ├── main.rs               # 진입점
│       ├── lib.rs                # Tauri Builder + Command 등록
│       ├── commands.rs           # Tauri Command 함수 6개
│       ├── state.rs              # AppState (Mutex<Connection>, TextCache, stop_flag)
│       └── scouter/
│           ├── mod.rs
│           ├── protocol.rs       # 프로토콜 상수 (TcpFlag, PackEnum, CMD_*)
│           ├── codec.rs          # ScouterReader / ScouterWriter
│           ├── value.rs          # ScouterValue enum
│           ├── pack.rs           # XLogPack (43필드), MapPack 역직렬화
│           ├── connection.rs     # TCP 연결, 로그인, 스트림 읽기
│           ├── streaming.rs      # TRANX_REAL_TIME_GROUP 폴링 루프
│           └── dictionary.rs     # GET_TEXT_100 hash→text 캐시
│
├── docs/                         # 문서
│   ├── README.md                 # 문서 인덱스
│   ├── architecture.md           # 아키텍처 가이드 (이 파일과 동급)
│   ├── dev-guide.md              # 개발 가이드 (이 파일)
│   ├── deploy-guide.md           # 배포 가이드
│   ├── asis/                     # ASIS Java 코드 분석
│   └── plans/                    # 상세 설계 문서
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

2. `commands.rs`에 새 Command 구현:
   ```rust
   #[tauri::command]
   pub async fn my_request(state: State<'_, AppState>) -> Result<..., String> {
       let mut conn = state.connection.lock().await;
       let conn = conn.as_mut().ok_or("연결되지 않음")?;

       let param = MapPack::new();
       let session = conn.session;
       conn.send_request(CMD_MY_REQUEST, session, &param)
           .map_err(|e| e.to_string())?;

       // 응답 수신
       loop {
           match conn.read_next_pack().map_err(|e| e.to_string())? {
               Some(AnyPack::Map(map)) => { /* 처리 */ }
               Some(_) => {}
               None => break,
           }
       }
       Ok(...)
   }
   ```

---

## 6. 단위 테스트

### Rust 테스트

```bash
cd src-tauri
cargo test
```

현재 테스트 위치:
- `scouter/codec.rs` — Decimal/Blob 경계값 15개 테스트
- `scouter/connection.rs` — SHA-256 해시 테스트

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

현재 테스트 미구성. 추후 Vitest 추가 예정:

```bash
npm install -D vitest @testing-library/react
```

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

- `start_xlog_stream` command는 현재 **블로킹** 방식으로 동작. 스트리밍 루프가 실행 중인 동안 command가 반환되지 않음.
- 실용적 해결: `invoke('start_xlog_stream', ...)` 호출 후 응답을 기다리지 말 것 (fire-and-forget).
- 세션 만료(`INVALID_SESSION`) 시 자동 재연결 없음 — `xlog-error` 이벤트를 수신하여 UI에서 재연결 버튼 표시.

### txid / gxid 정밀도

- Java `long`(i64)은 JavaScript `number`(f64) 범위를 초과함.
- Rust에서 String으로 직렬화하여 전달. 프론트에서 `BigInt(xlog.txid)` 변환 필요.

### XLogPack 선택적 필드

- 필드 21번(`countryCode`)부터는 `remaining() > 0` 조건부 읽기.
- 구버전 Collector에서는 후반 필드가 없을 수 있음 → 기본값(0, "", false)으로 처리.

### Canvas 좌표

- `drawImage(dot, px-2, py-2)` — **좌상단 기준**. 중심 기준으로 계산하면 위치가 2픽셀 어긋남.
- `devicePixelRatio`를 고려한 canvas 크기 설정 (`ResizeObserver` 내부에서 처리).
