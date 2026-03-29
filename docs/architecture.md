# NScouter 아키텍처 가이드

---

## 1. 시스템 개요

NScouter는 Java 기반 Scouter Eclipse 클라이언트를 **Tauri + Rust + React** 스택으로 포팅한 데스크톱 애플리케이션이다. Java Proxy(scouter.webapp) 없이 **Rust 백엔드가 Collector에 직접 TCP 연결**하여 XLog 데이터를 수신하고, React Canvas로 실시간 스캐터 차트를 렌더링한다.

```
┌──────────────────────────────────────────────────────────────────┐
│                         사용자 PC                                  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                   NScouter (Tauri App)                   │    │
│  │                                                           │    │
│  │  ┌────────────────┐        ┌─────────────────────────┐   │    │
│  │  │  React 프론트  │  IPC   │     Rust 백엔드          │   │    │
│  │  │  (Webview)     │◄──────►│     (Native)             │   │    │
│  │  │                │ Event  │                           │   │    │
│  │  │  Canvas 차트   │        │  TCP 연결 / 프로토콜      │   │    │
│  │  └────────────────┘        └──────────┬────────────────┘   │    │
│  │                                        │ TCP :6100          │    │
│  └────────────────────────────────────────│────────────────────┘    │
│                                           │                         │
└───────────────────────────────────────────│─────────────────────────┘
                                            │ 방화벽 통과
                                            ▼
                               ┌────────────────────────┐
                               │  Scouter Collector      │
                               │  (모니터링 대상 서버)    │
                               │  :6100 (TCP)            │
                               └────────────────────────┘
```

---

## 2. 레이어 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│                         프레젠테이션 레이어                            │
│                                                                       │
│   App.tsx          XLogChart.tsx      XLogToolbar.tsx                │
│   (라우팅/레이아웃)  (Canvas 래핑)     (필터/Y축 모드)                 │
│                    ConnectionDialog.tsx                              │
├─────────────────────────────────────────────────────────────────────┤
│                         훅 / 상태 레이어                              │
│                                                                       │
│   useXLogStream          useXLogCanvas                               │
│   (Tauri 이벤트 수집)     (rAF 루프, ResizeObserver, 드래그)          │
│        │                      │                                       │
│        ▼                      ▼                                       │
│   XLogDataStore        XLogChartRenderer                             │
│   (시간 윈도우 관리)    (Canvas 렌더링 오케스트레이터)                 │
├─────────────────────────────────────────────────────────────────────┤
│                         엔진 레이어 (Canvas 렌더러)                    │
│                                                                       │
│   CoordinateMapper   PointMap        DotImageCache   GridCalculator  │
│   (좌표 변환)         (O(1) 충돌감지)  (OffscreenCanvas)  (눈금 계산) │
├─────────────────────────────────────────────────────────────────────┤
│                         API 레이어 (Tauri IPC)                        │
│                                                                       │
│   scouterApi.ts                                                      │
│   invoke: connect / disconnect / start_stream / stop_stream          │
│   listen: xlog-data / xlog-error / scouter-connected / disconnected  │
├═════════════════════════════════════════════════════════════════════╡
│                      ──── Tauri IPC 경계 ────                         │
├═════════════════════════════════════════════════════════════════════╡
│                         Tauri Command 레이어 (Rust)                   │
│                                                                       │
│   commands.rs                                                        │
│   connect_scouter / disconnect_scouter                               │
│   start_xlog_stream / stop_xlog_stream                               │
│   resolve_texts / get_object_list                                    │
├─────────────────────────────────────────────────────────────────────┤
│                         Scouter 프로토콜 레이어 (Rust)                 │
│                                                                       │
│   connection.rs        streaming.rs       dictionary.rs              │
│   (TCP 연결/로그인)     (폴링 루프)         (hash→text 캐시)           │
│        │                    │                                         │
│   pack.rs              value.rs           codec.rs                   │
│   (XLogPack/MapPack)   (ScouterValue)     (ScouterReader/Writer)      │
│        │                    │                    │                    │
│        └────────────────────┴────────────────────┘                   │
│                         protocol.rs (상수)                            │
├─────────────────────────────────────────────────────────────────────┤
│                         네트워크 레이어                                │
│                                                                       │
│   TcpStream (BufReader/BufWriter)                                    │
│   TCP :6100 → Scouter Collector                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 데이터 흐름

### 3.1 연결 → 스트리밍 흐름

```
사용자                프론트엔드              Rust 백엔드          Collector
  │                     │                       │                     │
  │ 연결 버튼 클릭       │                       │                     │
  │────────────────────►│                       │                     │
  │                     │ invoke(connect_scouter)│                     │
  │                     │──────────────────────►│                     │
  │                     │                       │ TCP connect :6100   │
  │                     │                       │────────────────────►│
  │                     │                       │ send 0xCAFE2001     │
  │                     │                       │────────────────────►│
  │                     │                       │ LOGIN (MapPack)     │
  │                     │                       │────────────────────►│
  │                     │                       │◄────────────────────│
  │                     │                       │ session ID          │
  │                     │ emit(scouter-connected)│                     │
  │                     │◄──────────────────────│                     │
  │                     │                       │                     │
  │                     │ invoke(start_xlog_stream)                   │
  │                     │──────────────────────►│                     │
  │                     │                       │ 폴링 루프 시작      │
  │                     │                       │                     │
  │                     │                       │ TRANX_REAL_TIME_GROUP_LATEST
  │                     │                       │────────────────────►│
  │                     │                       │◄────────────────────│
  │                     │                       │ XLogPack (Blob)     │
  │                     │ emit(xlog-data, xlog) │                     │
  │                     │◄──────────────────────│                     │
  │ 차트에 점 표시       │                       │                     │
  │◄────────────────────│ rAF → render()        │                     │
  │                     │                       │ (500ms 후 반복...)  │
```

### 3.2 XLog 데이터 렌더링 파이프라인

```
Tauri 이벤트 "xlog-data"
        │
        ▼
useXLogStream.onXLogData()
        │  xlogPackToSXLog() 변환
        ▼
XLogDataStore.add(sxlog)
  ─ dirty = true
  ─ 100,000건 상한, 5분 윈도우 자동 prune
        │
        ▼ (rAF 루프에서 dirty 감지)
useXLogCanvas → XLogChartRenderer.render()
        │
        ├─ 1. drawBackground()    배경색 채우기
        ├─ 2. drawIgnoreArea()    무시 영역 (회색 띠)
        ├─ 3. drawYGrid()         Y축 수평 점선 + 레이블
        ├─ 4. drawXGrid(mapper)   X축 수직 점선 + 시간 레이블
        ├─ 5. drawDataPoints()    ★ 핵심
        │       ├─ CoordinateMapper: (endTime, elapsed) → (px, py)
        │       ├─ XLogFilterState: 필터 통과 여부
        │       ├─ PointMap.has(): O(1) 충돌 체크
        │       ├─ getDotColor(): objHash/xType/error → 색상
        │       └─ ctx.drawImage(OffscreenCanvas, px-2, py-2)
        ├─ 6. drawBorder()        테두리
        └─ 7. drawMetadata()      점 개수, Y축 모드명
```

---

## 4. Rust 백엔드 모듈 상세

### 4.1 모듈 의존 관계

```
commands.rs
    │
    ├── state.rs (AppState)
    │       ├── ScouterConnection (Mutex)
    │       ├── TextCache (Mutex)
    │       └── stream_stop (Arc<AtomicBool>)
    │
    ├── scouter/connection.rs
    │       ├── scouter/codec.rs   (ScouterReader / ScouterWriter)
    │       ├── scouter/pack.rs    (XLogPack, MapPack, AnyPack)
    │       ├── scouter/value.rs   (ScouterValue enum)
    │       └── scouter/protocol.rs (상수)
    │
    ├── scouter/streaming.rs
    │       └── → connection.rs (read_next_pack, send_request)
    │
    └── scouter/dictionary.rs
            └── → connection.rs (send_request, read_next_pack)
```

### 4.2 ScouterConnection 내부 구조

```
ScouterConnection {
    reader: BufReader<TcpStream>   ← 수신 전용
    writer: BufWriter<TcpStream>   ← 송신 전용
    session: i64                   ← 로그인 후 발급
    server_id: String
}

┌─────────────────────────────────────────────────┐
│               연결 초기화 시퀀스                   │
│                                                   │
│  1. TcpStream::connect_timeout(addr, 3000ms)     │
│  2. stream.set_nodelay(true)                      │
│  3. writer ← 0xCAFE2001 (BE u32)                 │
│  4. writer.flush()                               │
│  5. login() 호출                                 │
│     a. SHA256(salt || password) 계산             │
│     b. MapPack 전송 (id, pass, version, hostname)│
│     c. FLAG_HAS_NEXT 루프로 응답 수신             │
│     d. session = map["session"]                   │
└─────────────────────────────────────────────────┘
```

### 4.3 Scouter 바이너리 프로토콜 요약

```
요청 패킷 구조:
┌──────────────┬──────────────┬────────────────────┐
│ writeText    │ writeLong    │ writePack          │
│ (cmd 문자열) │ (session i64)│ (MapPack 파라미터) │
└──────────────┴──────────────┴────────────────────┘
   Blob 포맷      Big-endian     [0x0A][count][k/v…]

응답 스트림 구조:
[0x03][Pack]  [0x03][Pack] … [0x04]
  HAS_NEXT      HAS_NEXT       NO_NEXT (종료)
  ↓               ↓
  MapPack         XLogPack
  (커서 업데이트)  (점 1개 데이터)

Decimal 가변 길이 인코딩:
  [0x00]              → 0
  [0x01][1B]          → -128..127
  [0x02][2B BE]       → -32768..32767
  [0x03][3B BE]       → Int3 (-8388608..8388607)
  [0x04][4B BE]       → i32
  [0x05][5B BE]       → Long5
  [0x08][8B BE]       → i64

Blob 길이 헤더:
  [0x00]              → 빈 배열
  [1..253]            → 직접 길이
  [0xFF][ushort 2B]   → 254..65535
  [0xFE][int 4B]      → 65536+
```

---

## 5. 프론트엔드 모듈 상세

### 5.1 컴포넌트 트리

```
App.tsx
├── <header>
│   ├── ConnectionDialog.tsx
│   │   └── invoke: connect_scouter, start_xlog_stream
│   └── 서버 ID 표시
├── XLogToolbar.tsx
│   └── Y축 모드 / 시간 범위 / 에러 필터
├── <main>
│   └── XLogChart.tsx          ← React.memo
│       ├── useXLogStream()    ─ Tauri 이벤트 구독
│       └── useXLogCanvas()    ─ rAF + Canvas 렌더링
└── <aside> 선택 XLog 목록
```

### 5.2 Canvas 엔진 의존 관계

```
XLogChartRenderer
    │
    ├── CoordinateMapper
    │       └── Y_AXIS_CONFIGS (valueExtractor 함수)
    │
    ├── GridCalculator
    │       └── calcNiceInterval() — "nice number" 알고리즘
    │
    ├── PointMap
    │       └── Uint8Array[width × height]
    │             set(x, y, dotSize)  ← 5×5 마킹
    │             has(x, y)          ← O(1) 충돌 체크
    │             queryRect()        ← 드래그 선택
    │
    └── DotImageCache
            └── Map<"color:size", OffscreenCanvas>
                  createDot() — 5×5 + 흰색 노이즈 4픽셀
                  ctx.drawImage(dot, px-2, py-2)  ← 좌상단 기준
```

### 5.3 상태 관리 흐름

```
                Tauri Runtime
                     │
              "xlog-data" 이벤트
                     │
              useXLogStream
                     │  add(SXLog)
                     ▼
              XLogDataStore ──── dirty flag ────►  useXLogCanvas
              (최대 100,000건)                         │
              (5분 윈도우)                    rAF 루프 │
                                             dirty 감지│
                                                       ▼
                                          XLogChartRenderer.render()
                                                       │
                                                  <canvas>
```

---

## 6. Tauri IPC 인터페이스

### 6.1 invoke (JS → Rust)

| 커맨드 | 파라미터 | 반환 | 설명 |
|--------|----------|------|------|
| `connect_scouter` | `host, port, user, pass` | `void` | TCP 연결 + 로그인 |
| `disconnect_scouter` | — | `void` | 연결 종료 |
| `start_xlog_stream` | `objHashes: number[]` | `void` | 스트리밍 시작 |
| `stop_xlog_stream` | — | `void` | 스트리밍 중지 |
| `resolve_texts` | `typeKey, hashes` | `Record<number, string>` | hash → 텍스트 |
| `get_object_list` | — | `MapPack[]` | 에이전트 목록 |

### 6.2 emit (Rust → JS)

| 이벤트 | 페이로드 | 설명 |
|--------|----------|------|
| `xlog-data` | `XLogPack` (JSON) | XLog 트랜잭션 1건 |
| `xlog-error` | `{ message: string }` | 스트리밍 오류 |
| `scouter-connected` | `server_id: string` | 연결 완료 |
| `scouter-disconnected` | — | 연결 해제 |

---

## 7. XLogPack 필드 구조

XLogPack은 Collector로부터 수신 시 **전체가 Blob으로 래핑**된 형태로 전달된다. 내부에는 43개 필드가 순서대로 직렬화되어 있으며, 필드 21번부터는 `remaining() > 0` 체크 후 조건부 파싱한다 (구버전 서버 호환).

```
[PackType=0x15]
[Blob (XLogPack 전체 데이터)]
   └── 내부 ScouterReader:
       1.  endTime          readDecimal()  → i64   종료 시각 (epoch ms)
       2.  objHash          readDecimal()  → i32   에이전트 해시
       3.  service          readDecimal()  → i32   서비스 해시 (GET_TEXT_100 으로 조회)
       4.  txid             readLong()     → i64   트랜잭션 ID (JS에서 string 처리)
       5.  caller           readLong()     → i64   호출자 txid
       6.  gxid             readLong()     → i64   글로벌 트랜잭션 ID
       7.  elapsed          readDecimal()  → i32   응답시간 ms ★ 스캐터 Y축
       8.  error            readDecimal()  → i32   에러 해시 (0=정상)
       9.  cpu              readDecimal()  → i32   CPU 시간 ms
       10. sqlCount         readDecimal()  → i32
       11. sqlTime          readDecimal()  → i32
       12. ipaddr           readBlob()     → Vec<u8>  → "x.x.x.x"
       ... (필드 13~20)
       21+. available() > 0 체크 후 조건부 읽기 (country_code ~ ignoreGlobalSampling)
```

---

## 8. 색상 규칙 (XLog 점 색상)

ASIS `XLogViewPainter.drawXPerfData()` 로직 포팅:

```
xType == 3 또는 4 (비동기/백그라운드 스레드)
    error != 0  →  #FF9999  (연한 빨강)
    error == 0  →  #AAAAAA  (회색)

xType == 0, 1, 2 (일반 Web 트랜잭션)
    error != 0  →  #FF0000  (빨강)
    error == 0  →  objHash 기반 에이전트 색상
                   (12색 팔레트를 Math.abs(hash) % 12 로 순환)
```

---

## 9. 성능 설계

| 항목 | 방식 | 효과 |
|------|------|------|
| 점 충돌 감지 | `Uint8Array PointMap` | O(1) — 배열 순회(O(n)) 대비 수만 배 빠름 |
| 점 렌더링 | `OffscreenCanvas drawImage` | ~4ms/50k점 — `fillRect`(12ms), `arc`(25ms) 대비 우수 |
| 데이터 상한 | 100,000건 + 5분 윈도우 | 메모리 무한 증가 방지 |
| rAF dirty flag | `isDirty()` 체크 후 렌더 | 새 데이터 없으면 렌더링 스킵 |
| Decimal 인코딩 | 1~9바이트 가변 | 네트워크 대역폭 절감 |
| txid 직렬화 | Rust에서 String으로 | JS `Number.MAX_SAFE_INTEGER` 초과 방지 |
